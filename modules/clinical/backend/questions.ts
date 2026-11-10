import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { sha256 } from "@aihot/backend/lib/ids";
import { actorOf, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { clinicalItems, matches } from "./read.ts";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import type { ClinicalItem } from "../contract.ts";

export function questionEvidence(items:ClinicalItem[],query:Record<string,string>){
  const matched=items.filter(item=>matches(item,query));
  const fingerprint=sha256(JSON.stringify(matched.map(i=>[i.id,i.revision,i.generatedAt,i.aiReviewRequired??true,i.aiReview?.current?i.aiReview:null,i.check?.status,i.check?.data.updates??[],i.check?.data.relations??[],i.history.filter(e=>e.kind==="review"&&e.data.currentRecord&&e.data.relatedId).map(e=>[e.id,e.data.relation,e.data.relatedId]).sort((a,b)=>Number(a[0])-Number(b[0]))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
  return {matched,fingerprint};
}
export async function questions(includeInactive=false){
  const definitions=await sql`SELECT id,label,query,owner,fingerprint,state,active,updated_at FROM clinical_questions WHERE active=true OR ${includeInactive} ORDER BY updated_at DESC LIMIT 200`;
  const items=await clinicalItems();
  const reviews=definitions.length?await sql`SELECT question_id,fingerprint,data,created_at FROM clinical_question_reviews WHERE question_id IN ${sql(definitions.map(r=>r.id))} ORDER BY id DESC`:[];
  return definitions.map(q=>{
    const {matched,fingerprint}=questionEvidence(items,q.query);
    const last=reviews.find(r=>r.question_id===q.id);
    const current=last?.fingerprint===fingerprint;
    return {id:q.id,active:q.active,label:q.label,query:q.query,owner:q.owner,fingerprint,total:matched.length,
      state:current?"已有复核登记":"待复核",changed:!!last&&!current,
      review:current?{...last.data,createdAt:last.created_at}:null,
      items:matched.map(i=>({id:i.id,title:i.title,revision:i.revision,source:i.source})),
      history:reviews.filter(r=>r.question_id===q.id).map(r=>({createdAt:r.created_at,current:r.fingerprint===fingerprint})),
    };
  });
}
export async function createQuestion(raw:unknown,admin:AdminPrincipal){
  const x=z.object({label:z.string().trim().min(4).max(200),owner:z.string().trim().min(2).max(80),query:z.object({
    specialty:z.string().refine(x=>!x||(TOPIC_TAGS as readonly string[]).includes(x)).default(""),
    q:z.string().max(300).default(""),p:z.string().max(300).default(""),i:z.string().max(300).default(""),c:z.string().max(300).default(""),o:z.string().max(300).default(""),
  }).strict()}).parse(raw);
  if(!Object.values(x.query).some(v=>v.trim()))throw new Conflict("请至少设置一项专科、关键词或PICO条件");
  const query=Object.fromEntries(Object.entries(x.query).map(([k,v])=>[k,v.trim()]));
  const {fingerprint}=questionEvidence(await clinicalItems(),query);
  return sql.begin(async tx=>{
    const [row]=await tx`INSERT INTO clinical_questions(label,query,owner,fingerprint,actor) VALUES(${x.label},${tx.json(query)},${x.owner},${fingerprint},${actorOf(admin)}) RETURNING id`;
    await audit(actorOf(admin),"clinical.question",String(row!.id),"登记科室临床问题",null,x,{db:tx});return row;
  });
}
export async function reviewQuestion(id:number,raw:unknown,admin:AdminPrincipal){
  const x=z.object({fingerprint:z.string().length(64),reviewer:z.string().trim().min(2).max(80),conclusion:z.enum(["需要讨论","暂不改变","证据不足","改变"]),reason:z.string().trim().min(20).max(3000)}).parse(raw);
  const items=await clinicalItems();
  await sql.begin(async tx=>{
    const [q]=await tx`SELECT * FROM clinical_questions WHERE id=${id} FOR UPDATE`;
    if(!q)throw new Conflict("临床问题不存在");
    const {matched,fingerprint}=questionEvidence(items,q.query);
    if(fingerprint!==x.fingerprint)throw new Conflict("相关证据已变化，请刷新后重新核查");
    if(!matched.length&&x.conclusion!=="证据不足")throw new Conflict("没有可公开证据，只能登记证据不足");
    const data={reviewer:x.reviewer,conclusion:x.conclusion,reason:x.reason,identity:"管理员登记；实际医师资质和签署须另行核验"};
    await tx`INSERT INTO clinical_question_reviews(question_id,fingerprint,article_ids,data,actor) VALUES(${id},${fingerprint},${matched.map(i=>i.id)},${tx.json(data)},${actorOf(admin)})`;
    await tx`UPDATE clinical_questions SET fingerprint=${fingerprint},state='已复核',updated_at=now() WHERE id=${id}`;
    await audit(actorOf(admin),"clinical.question-review",String(id),x.reason,null,data,{db:tx});
  });
}
export async function refreshQuestions(){
  const rows=await sql`SELECT id,query,fingerprint FROM clinical_questions WHERE active=true`;
  const items=await clinicalItems();let changed=0;
  for(const row of rows){const {fingerprint}=questionEvidence(items,row.query);if(fingerprint===row.fingerprint)continue;
    const updated=await sql`UPDATE clinical_questions SET fingerprint=${fingerprint},state='待复核',updated_at=now() WHERE id=${row.id} AND fingerprint=${row.fingerprint} RETURNING id`;changed+=updated.length;
  }
  return {changed};
}

export async function setQuestionActive(id:number,active:boolean,admin:AdminPrincipal){
  await sql.begin(async tx=>{const rows=await tx`UPDATE clinical_questions SET active=${active},updated_at=now() WHERE id=${id} RETURNING id`;if(!rows.length)throw new Conflict("问题不存在");await audit(actorOf(admin),"clinical.question-state",String(id),active?"恢复问题监测":"暂停问题监测",null,{active},{db:tx});});
}
