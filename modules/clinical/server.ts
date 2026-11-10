import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";

import { saveReview,saveTask,saveCheck,saveLabel,saveEdition,EditionSchema,workbench,verifyReviewer,saveRegistration,exportGold,retryExtraction } from "./backend/workflow.ts";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { supplementMaterials } from "./backend/materials.ts";
import { enrich, monitor } from "./backend/worker.ts";
import { reviewCards, retryAiReview } from "./backend/ai-review.ts";
import { clinicalItems, search, weekly } from "./backend/read.ts";
import { questions,createQuestion,reviewQuestion,refreshQuestions,setQuestionActive } from "./backend/questions.ts";
import { discoverRelations } from "./backend/relationships.ts";
import { weekRange } from "./backend/extract.ts";

const query = z.record(z.string(), z.string().max(300));
const today = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);
export default defineServerModule({ name: "clinical",
  models: { clinical: { label: "临床证据摘录与AI复核（逐字段原文依据）", env: "CLINICAL_MODEL", purposes: ["clinical_card","clinical_review"] } },
  schedules: [
    { name: "clinical.materials", cron: "4-59/15 * * * *", run: supplementMaterials },
    { name: "clinical.enrich", cron: "*/5 * * * *", run: enrich },
    { name: "clinical.review", cron: "2-59/5 * * * *", run: reviewCards },
    { name:"clinical.questions",cron:"*/5 * * * *",run:refreshQuestions },
    { name:"clinical.relations",cron:"13 * * * *",run:discoverRelations },
    { name: "clinical.monitor", cron: "7,22,37,52 * * * *", run: monitor },
  ],
  llms: () => ({ api: ["/api/clinical/items：临床问题与 PICO 字段检索", "/api/clinical/questions：科室问题、证据变化与复核记录", "/api/clinical/weekly?date=YYYY-MM-DD&specialty=科室：科室周报"], pages: ["/clinical：临床阅读", "/clinical/questions：临床问题与证据变化", "/clinical/weekly：科室周报"], usage: ["临床关注度不是证据等级；证据卡为 AI 摘录，核查记录不等于临床专家审查。"] }),
  http(app) {
    app.get("/api/clinical/questions",async(_req,reply)=>{reply.header("Cache-Control","no-store");return questions();});
    app.get("/api/admin/clinical/questions",adminHandler(async()=>questions(true)));
    app.post("/api/admin/clinical/questions/:id/state",adminHandler(async(req,_reply,admin)=>{const x=z.object({active:z.boolean()}).parse(req.body);await setQuestionActive(z.coerce.number().int().positive().parse((req.params as {id:string}).id),x.active,admin);return {ok:true};}));
    app.post("/api/admin/clinical/question",adminHandler(async(req,_reply,admin)=>createQuestion(req.body,admin)));
    app.post("/api/admin/clinical/questions/:id/review",adminHandler(async(req,_reply,admin)=>{await reviewQuestion(z.coerce.number().int().positive().parse((req.params as {id:string}).id),req.body,admin);return {ok:true};}));
    app.get("/api/clinical/items", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const parsed = query.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "查询过长或格式错误" });
      return search(parsed.data);
    });
    app.get("/api/clinical/items/:id", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const [item] = await clinicalItems({ ids: [(req.params as { id: string }).id] });
      return item ?? reply.code(404).send({ error: "内容不存在或已撤回" });
    });
    app.get("/api/clinical/weekly", async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const parsed = query.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "参数错误" });
      const date = parsed.data.date || today();
      try { weekRange(date); } catch { return reply.code(400).send({ error: "日期格式或日期无效" }); }
      return weekly(date, parsed.data.specialty || "");
    });
    app.post("/api/admin/clinical/reviewer",adminHandler(async(req,_reply,admin)=>{await verifyReviewer(req.body,admin);return {ok:true};}));
    app.get("/api/admin/clinical/workbench", adminHandler(async () => workbench()));
    app.get("/api/admin/clinical/sample/export",adminHandler(async(_req,reply)=>{
      const rows=await sql`WITH ranked AS (SELECT a.id,a.revision,a.title,a.url,a.processing_state,a.body_text,a.excerpt,p.category,p.tags,c.data->'card'->'registration'->>'value' AS registration,c.data->'card'->'doi'->>'value' AS doi,
        row_number() OVER(PARTITION BY coalesce(p.category,'unknown'),a.processing_state ORDER BY md5(a.id)) AS rn
        FROM articles a LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN clinical_cards c ON c.article_id=a.id AND c.revision=a.revision WHERE a.processing_state IN ('analyzed','blocked'))
        SELECT * FROM ranked ORDER BY rn,id LIMIT 200`;
      return reply.type("application/x-ndjson").header("Content-Disposition",'attachment; filename="clinical-unlabeled-200.jsonl"').send(rows.map(r=>JSON.stringify({...r,gold:null,reviewStatus:"待医师标注，未划分开发/留出集",studyKey:r.registration||r.doi||r.id})).join("\n")+(rows.length?"\n":""));
    }));
    app.get("/api/admin/clinical/gold/export",adminHandler(async(_req,reply)=>{
      const rows=await exportGold();return reply.type("application/x-ndjson").header("Content-Disposition",'attachment; filename="clinical-gold.jsonl"').send(rows.map(r=>JSON.stringify(r)).join("\n")+(rows.length?"\n":""));
    }));
    app.get("/api/admin/clinical/labels/export", adminHandler(async (_req,reply) => {
      const rows=await sql`SELECT article_id,revision,study_key,split,data,created_at FROM clinical_labels ORDER BY id`;
      return reply.type("application/x-ndjson").header("Content-Disposition",'attachment; filename="clinical-labels.jsonl"').send(rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
    }));
    app.get("/api/admin/clinical/:id/material", adminHandler(async (req,reply) => {
      const [row]=await sql`SELECT a.title,a.excerpt,a.body_text,c.data FROM articles a LEFT JOIN clinical_cards c ON c.article_id=a.id WHERE a.id=${(req.params as {id:string}).id}`;
      if(!row)return reply.code(404).send({error:"资料不存在"});
      const candidates=await sql`SELECT c.*,a.title AS related_title FROM clinical_candidates c JOIN articles a ON a.id=c.related_id WHERE c.article_id=${(req.params as {id:string}).id} ORDER BY c.id DESC`;
      const [supplement]=await sql`SELECT * FROM clinical_materials WHERE article_id=${(req.params as {id:string}).id}`;
      return {...row,candidates,supplement};
    }));
    app.get("/api/admin/clinical/editions", adminHandler(async () => sql`SELECT week,specialty,version,state,data,created_at FROM clinical_editions ORDER BY id DESC LIMIT 100`));
    for (const [action, save] of Object.entries({review:saveReview,task:saveTask,check:saveCheck,label:saveLabel,registration:saveRegistration,"extraction-retry":retryExtraction,"ai-review-retry":retryAiReview})) {
      app.post(`/api/admin/clinical/:id/${action}`, adminHandler(async (req,_reply,admin) => {
        await save((req.params as {id:string}).id,req.body,admin); return {ok:true};
      }));
    }
    app.post("/api/admin/clinical/edition", adminHandler(async (req,_reply,admin) => {
      const x=EditionSchema.parse(req.body); const period=weekRange(x.date);
      const items=(await clinicalItems({since:period.start,until:period.end})).filter(i=>!x.specialty||i.tags.includes(x.specialty));
      await saveEdition(x,items.map(i=>i.id),admin); return {ok:true};
    }));
  },
});
