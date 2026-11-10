import { z } from "zod";
import { extensionItems } from "@aihot/backend/publication/extension";
import { sql } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { actorOf, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { registryFields } from "./relationships.ts";
import { weekRange } from "./extract.ts";
import { aiReviewVersion, chineseSourceTag } from "../contract.ts";

const note = z.string().trim().min(10).max(3000);
const link = z.string().url().max(1500).refine(s => /^https?:\/\//i.test(s), "需要 HTTP(S) 原文地址");
export const ReviewSchema = z.object({ revision: z.number().int().positive(),
  conclusion: z.enum(["核对完成", "需更正", "待专家复核"]), reviewer: z.string().trim().min(2).max(80), reason: note,
  practice: z.enum(["改变", "需要讨论", "暂不改变", "尚未判断"]).default("尚未判断"),
  affected: z.string().max(1200).default(""), beforeUse: z.string().max(2000).default(""),
  relatedId: z.string().max(80).optional(), relation: z.enum(["替代旧版", "正式发表", "更正", "撤稿", "相关证据"]).optional(),
});
export const TaskSchema = z.object({ revision: z.number().int().positive(), state: z.enum(["待分配", "待复核", "需补资料", "需更正"]),
  assignee: z.string().trim().max(80), dueAt: z.string().datetime().nullable(), reason: note });
export const LocalCheckSchema = z.object({ revision: z.number().int().positive(),
  kind: z.enum(["中国适应证", "指南状态", "药品可及性", "医保", "设备条件", "基线风险", "注册结果核对"]),
  result: z.enum(["已核实", "不一致", "不适用", "资料不足"]), evidenceUrl: link,
  note, owner: z.string().trim().min(2).max(80), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).refine(x => Date.parse(x.expiresAt) > Date.parse(x.checkedAt) && Date.parse(x.checkedAt) <= Date.now(), "核查时间必须真实且有效期在核查之后");
export const LabelSchema = z.object({ revision: z.number().int().positive(), studyKey: z.string().trim().min(1).max(200),
  split: z.enum(["development", "holdout"]), reviewer: z.string().trim().min(2).max(80), specialty: z.enum(TOPIC_TAGS),
  decision: z.enum(["select", "reject", "either"]), importantSafety: z.boolean(), useful: z.boolean().nullable(),
  rank: z.number().int().min(1).max(10).nullable(), session: z.string().max(120),
  correctFields: z.number().int().min(0).max(100), checkedFields: z.number().int().min(0).max(100),
  reason: note,
}).refine(x => x.correctFields <= x.checkedFields, "正确数不能超过核查数");

export async function saveReview(id: string, raw: unknown, admin: AdminPrincipal) {
  const input = ReviewSchema.parse(raw);
  await sql.begin(async tx => {
    const [a] = await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;
    if (!a || a.revision !== input.revision) throw new Conflict("内容版本已变化，请刷新后复核");
    if (input.relatedId) {
      const [related] = await tx`SELECT id FROM articles WHERE id=${input.relatedId}`;
      if (!related || input.relatedId === id || !input.relation) throw new Conflict("关联资料或关系无效");
    }
    const [user] = admin.userId ? await tx`SELECT email,feishu_union_id FROM admin_users WHERE id=${admin.userId}` : [];
    const personal = !!user?.feishu_union_id && user.email !== "admin@local";
    const [verified] = personal ? await tx`SELECT name,institution,specialties FROM clinical_reviewers WHERE user_id=${admin.userId!} AND active=true` : [];
    const [card] = await tx`SELECT generated_at FROM clinical_cards WHERE article_id=${id} AND revision=${input.revision}`;
    const record = { ...input, reviewer:verified?.name??input.reviewer, cardGeneratedAt:card?.generated_at?.toISOString()??null, signedBy: admin.name,
      identity: verified ? `机构已登记资质：${verified.institution}；个人账号签署` : personal ? "个人账号提交，资质仍需机构核验" : "共享管理账号代录，非专家本人签署", role: "管理员登记的复核记录" };
    if(input.relatedId) await tx`UPDATE clinical_candidates SET state='已登记关系' WHERE article_id=${id} AND related_id=${input.relatedId} AND revision=${input.revision}`;
    await tx`INSERT INTO clinical_events(article_id,kind,data) VALUES(${id},'review',${tx.json(record as never)})`;
    await tx`INSERT INTO clinical_review_tasks(article_id,revision,state,assignee,reason) VALUES(${id},${input.revision},${input.conclusion === "核对完成" ? "已复核" : input.conclusion},${input.reviewer},${input.reason})
      ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,assignee=excluded.assignee,reason=excluded.reason,updated_at=now()`;
    await audit(actorOf(admin), "clinical.review", `content:${id}`, input.reason, null, record, { db: tx });
  });
}
export async function saveTask(id: string, raw: unknown, admin: AdminPrincipal) {
  const input = TaskSchema.parse(raw);
  await sql.begin(async tx => {
    const [a] = await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;
    if (!a || a.revision !== input.revision) throw new Conflict("资料版本变化，请刷新");
    await tx`INSERT INTO clinical_review_tasks(article_id,revision,state,assignee,due_at,reason)
      VALUES(${id},${input.revision},${input.state},${input.assignee},${input.dueAt},${input.reason})
      ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,assignee=excluded.assignee,due_at=excluded.due_at,reason=excluded.reason,updated_at=now()`;
    await audit(actorOf(admin), "clinical.assign", `content:${id}`, input.reason, null, input, { db: tx });
  });
}
export async function saveCheck(id: string, raw: unknown, admin: AdminPrincipal) {
  const x = LocalCheckSchema.parse(raw);
  await sql.begin(async tx => {
    const [a] = await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;
    if (!a || a.revision !== x.revision) throw new Conflict("资料版本变化，请刷新");
    await tx`INSERT INTO clinical_local_checks(article_id,revision,kind,result,evidence_url,note,owner,actor,checked_at,expires_at)
      VALUES(${id},${x.revision},${x.kind},${x.result},${x.evidenceUrl},${x.note},${x.owner},${actorOf(admin)},${x.checkedAt},${x.expiresAt})`;
    await audit(actorOf(admin), "clinical.local-check", `content:${id}`, x.note, null, x, { db: tx });
  });
}
export async function saveLabel(id: string, raw: unknown, admin: AdminPrincipal) {
  const x = LabelSchema.parse(raw);
  const publication=(await extensionItems()).find(a=>a.id===id);
  await sql.begin(async tx => {
    const [a] = await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;
    if (!a || a.revision !== x.revision) throw new Conflict("资料版本变化，请刷新");
    await tx`INSERT INTO clinical_study_groups(study_key,split) VALUES(${x.studyKey},${x.split}) ON CONFLICT DO NOTHING`;
    const [group] = await tx`SELECT split FROM clinical_study_groups WHERE study_key=${x.studyKey}`;
    if (group?.split !== x.split) throw new Conflict("同研究不能跨开发集与留出集");
    const conflicting = await tx`SELECT id FROM clinical_labels WHERE (study_key=${x.studyKey} OR article_id=${id}) AND split<>${x.split} LIMIT 1`;
    if (conflicting.length) throw new Conflict("同研究或同资料不能跨开发集与留出集，请核对分组");
    const [check]=await tx`SELECT status FROM clinical_checks WHERE article_id=${id}`;
    const data = { ...x, systemSelected: !!publication?.selected, systemVisible:!!publication, systemAlert:publication?.category==="safety" || check?.status==="alert" };
    await tx`INSERT INTO clinical_labels(article_id,revision,study_key,split,data,actor) VALUES(${id},${x.revision},${x.studyKey},${x.split},${tx.json(data as never)},${actorOf(admin)})`;
    await audit(actorOf(admin), "clinical.label", `content:${id}`, x.reason, null, data, { db: tx });
  });
}
export function evaluation(rows: Array<{ article_id: string; revision: number; data: Record<string, any> }>) {
  const latest = new Map<string, typeof rows[number]>();
  for (const r of rows) { const k = `${r.article_id}:${r.revision}:${r.data.reviewer}`; if (!latest.has(k)) latest.set(k,r); }
  const groups = new Map<string, typeof rows>();
  for (const r of latest.values()) { const k = `${r.article_id}:${r.revision}`; groups.set(k,[...groups.get(k) ?? [],r]); }
  const consensus = [...groups.values()].filter(rs => rs.length >= 2 && new Set(rs.map(r => `${r.data.decision}:${r.data.importantSafety}`)).size === 1).map(rs => rs[0]!);
  const decided = consensus.filter(r => r.data.decision !== "either");
  const safety = consensus.filter(r => r.data.importantSafety);
  const selected = decided.filter(r => r.data.systemSelected);
  const ranked = [...latest.values()].filter(r => r.data.rank && r.data.useful !== null);
  const fields = [...latest.values()].reduce((a,r) => ({ correct:a.correct+r.data.correctFields,checked:a.checked+r.data.checkedFields }),{correct:0,checked:0});
  return { labeledArticles: groups.size, consensusArticles: consensus.length, unresolvedArticles: groups.size-consensus.length,
    safety: { missed:safety.filter(r => !r.data.systemVisible || !(r.data.systemSelected || r.data.systemAlert)).length,total:safety.length },
    precision: { useful:selected.filter(r => r.data.decision === "select").length,total:selected.length },
    topTen: { useful:ranked.filter(r => r.data.useful).length,total:ranked.length }, fields,
    notice:"仅统计已登记样本；姓名由管理员登记，不代表独立专家身份已核验。未采集到的材料需另加入样本，不能据此证明采集无漏报。" };
}
export async function workbench() {
  const tasks = await sql`SELECT a.id,a.title,a.revision,a.processing_state,p.category,p.tags,p.selected,
    t.state,t.assignee,t.due_at,t.revision AS reviewed_revision,k.status AS check_status,e.reason AS extraction_error,
    CASE WHEN ${chineseSourceTag}=ANY(s.tags) THEN 'exempt' WHEN r.revision=a.revision AND r.card_generated_at=c.generated_at AND r.input_hash=c.input_hash AND r.prompt_version=${aiReviewVersion} AND NOT r.retry_requested THEN r.status ELSE 'pending' END AS ai_review_status,
    CASE WHEN ${chineseSourceTag}=ANY(s.tags) THEN '中文信源无需AI确认复核' ELSE r.data->>'summary' END AS ai_review_summary,
    CASE WHEN ${chineseSourceTag}=ANY(s.tags) THEN NULL ELSE r.error END AS ai_review_error
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN clinical_review_tasks t ON t.article_id=a.id
    LEFT JOIN clinical_checks k ON k.article_id=a.id LEFT JOIN clinical_extraction_issues e ON e.article_id=a.id AND e.revision=a.revision AND e.resolved=false
    LEFT JOIN clinical_cards c ON c.article_id=a.id LEFT JOIN clinical_ai_reviews r ON r.article_id=a.id
    ORDER BY (p.category='safety' OR k.status='alert') DESC NULLS LAST,a.created_at DESC LIMIT 500`;
  const labels = await sql`SELECT article_id,revision,study_key,split,data FROM clinical_labels ORDER BY id DESC`;
  const sources = await sql`SELECT id,name,enabled,health FROM sources WHERE id LIKE 'official-%' ORDER BY id`;
  const reviewers = await sql`SELECT r.user_id,r.name,r.institution,r.specialties,r.active,r.verified_at FROM clinical_reviewers r ORDER BY r.name`;
  const identities = await sql`SELECT id,display_name FROM admin_users WHERE feishu_union_id IS NOT NULL`;
  return { tasks, sources, metrics:evaluation(labels as never), metricsBySpecialty:[...new Set(labels.map(r=>r.data.specialty))].map(specialty=>({specialty,...evaluation(labels.filter(r=>r.data.specialty===specialty) as never)})), labels, reviewers, identities };
}
export async function verifyReviewer(raw:unknown,admin:AdminPrincipal){
  const x=z.object({userId:z.number().int().positive(),name:z.string().min(2).max(80),institution:z.string().min(2).max(150),specialties:z.array(z.enum(TOPIC_TAGS)).min(1),evidenceUrl:link,note,active:z.boolean()}).parse(raw);
  if(x.userId===admin.userId)throw new Conflict("资质登记需由另一位管理员核验，不能自我认证");
  await sql.begin(async tx=>{
    const [user]=await tx`SELECT feishu_union_id FROM admin_users WHERE id=${x.userId}`;
    if(!user?.feishu_union_id)throw new Conflict("需要已登录过的个人账号，共享密码不能绑定专家资质");
    await tx`INSERT INTO clinical_reviewers(user_id,name,institution,specialties,evidence_url,note,verified_by,active)
      VALUES(${x.userId},${x.name},${x.institution},${x.specialties},${x.evidenceUrl},${x.note},${actorOf(admin)},${x.active})
      ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,institution=excluded.institution,specialties=excluded.specialties,evidence_url=excluded.evidence_url,note=excluded.note,verified_by=excluded.verified_by,verified_at=now(),active=excluded.active`;
    await audit(actorOf(admin),"clinical.reviewer",String(x.userId),x.note,null,x,{db:tx});
  });
}
export const EditionSchema = z.object({ date:z.string().date(),specialty:z.string().refine(x => !x || (TOPIC_TAGS as readonly string[]).includes(x)),
  expectedVersion:z.number().int().min(0),state:z.enum(["草稿","已审阅","已发布","已更正"]),
  reviewer:z.string().trim().min(2).max(80),note,discussion:z.string().max(4000),
});
export async function saveEdition(raw:unknown, ids:string[], admin:AdminPrincipal) {
  const x=EditionSchema.parse(raw); const period=weekRange(x.date);
  if ((x.state==="已发布" || x.state==="已更正") && period.end>new Date()) throw new Conflict("当周尚未结束，只能保存草稿或审阅记录");
  await sql.begin(async tx => {
    const [prev]=await tx`SELECT version,state,article_ids,data FROM clinical_editions WHERE week=${period.key} AND specialty=${x.specialty} ORDER BY version DESC LIMIT 1`;
    if ((prev?.version??0)!==x.expectedVersion) throw new Conflict("周报已有新版本，请刷新");
    const transitions:Record<string,string[]>={ "": ["草稿"], 草稿:["草稿","已审阅"], 已审阅:["草稿","已发布"], 已发布:["已更正"], 已更正:["已更正"] };
    if (!transitions[prev?.state??""]?.includes(x.state)) throw new Conflict("请依次完成草稿、审阅、发布；已发布周报需登记更正");
    const revisions=await tx`SELECT id,revision FROM articles WHERE id IN ${tx(ids.length?ids:[""])}`;
    const revisionMap=Object.fromEntries(revisions.map(r=>[r.id,r.revision]));
    if(x.state==="已发布" && (prev?.data.discussion!==x.discussion || JSON.stringify([...prev.article_ids].sort())!==JSON.stringify([...ids].sort()) || Object.entries(prev.data.revisions??{}).some(([id,revision])=>revisionMap[id]!==revision)))throw new Conflict("已审阅内容或引用版本已变化，须重新保存草稿并审阅");
    try { await tx`INSERT INTO clinical_editions(week,specialty,version,state,article_ids,data,actor)
      VALUES(${period.key},${x.specialty},${x.expectedVersion+1},${x.state},${ids},${tx.json({reviewer:x.reviewer,note:x.note,discussion:x.discussion,revisions:revisionMap} as never)},${actorOf(admin)})`; }
    catch (e) { if ((e as {code?:string}).code==="23505") throw new Conflict("周报已被其他管理员更新，请刷新"); throw e; }
    await audit(actorOf(admin),"clinical.edition",`${period.key}:${x.specialty}`,x.note,null,x,{db:tx});
  });
}

export async function saveRegistration(id:string,raw:unknown,admin:AdminPrincipal){
  const x=z.object({revision:z.number().int().positive(),registryId:z.string().regex(/^(?:NCT\d{8}|ChiCTR[a-z0-9]+)$/i),url:link,snapshotDate:z.string().date(),owner:z.string().min(2).max(80),note,
    fields:z.object(Object.fromEntries(Object.keys(registryFields).map(k=>[k,z.string().max(1200)])) as Record<keyof typeof registryFields,z.ZodString>)}).parse(raw);
  if(x.snapshotDate>new Date().toISOString().slice(0,10))throw new Conflict("注册快照日期不能是未来");
  await sql.begin(async tx=>{const [a]=await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;if(!a||a.revision!==x.revision)throw new Conflict("资料已变更，请刷新");
    const [c]=await tx`SELECT data FROM clinical_cards WHERE article_id=${id} AND revision=${x.revision}`;
    if(!String(c?.data?.card?.registration?.value??"").toLowerCase().includes(x.registryId.toLowerCase()))throw new Conflict("证据卡未报告该注册号，须先核实文献与注册的关系");
    await tx`INSERT INTO clinical_registrations(article_id,revision,registry_id,data,actor) VALUES(${id},${x.revision},${x.registryId},${tx.json(x as never)},${actorOf(admin)})`;
    await audit(actorOf(admin),"clinical.registration",`content:${id}`,x.note,null,x,{db:tx});});
}

export async function exportGold(){
  type GoldRecord={article_id:string;revision:number;study_key:string;split:string;data:Record<string,any>;title:string;excerpt:string|null;body_text:string|null;published_at:Date|null;name:string;kind:string;tier:string};
  const rows=await sql<GoldRecord[]>`SELECT l.article_id,l.revision,l.study_key,l.split,l.data,a.title,a.excerpt,a.body_text,a.published_at,s.name,s.kind,s.tier
    FROM clinical_labels l JOIN articles a ON a.id=l.article_id AND a.revision=l.revision JOIN sources s ON s.id=a.source_id ORDER BY l.id DESC`;
  const latest=new Map<string,GoldRecord>();for(const r of rows){const key=`${r.article_id}:${r.data.reviewer}`;if(!latest.has(key))latest.set(key,r);}
  const groups=new Map<string,GoldRecord[]>();for(const r of latest.values())groups.set(r.article_id,[...groups.get(r.article_id)??[],r]);
  return [...groups.values()].filter(rs=>rs.length>=2 && new Set(rs.map(r=>r.data.decision)).size===1).map(rs=>{const r=rs[0]!;return {
    caseId:`clinical-${r.article_id}-r${r.revision}`,material:{title:r.title,originalTitle:null,publishedAt:r.published_at?.toISOString()??null,sourceName:r.name,bodyZh:null,bodyOriginal:r.body_text||r.excerpt||r.title},
    sourceFacts:{sourceKind:r.kind,sourceTier:r.tier,firstParty:r.tier==="T1",language:"unknown"},samplingContext:{benchmarkSplit:r.split,samplingStratum:r.data.specialty},gold:{decision:r.data.decision},
  };});
}

export async function retryExtraction(id:string,raw:unknown,admin:AdminPrincipal){
  const x=z.object({revision:z.number().int().positive(),reason:note}).parse(raw);
  await sql.begin(async tx=>{const [a]=await tx`SELECT revision FROM articles WHERE id=${id} FOR UPDATE`;if(a?.revision!==x.revision)throw new Conflict("资料已变更，请刷新");
    await tx`UPDATE clinical_extraction_issues SET resolved=true,updated_at=now() WHERE article_id=${id} AND revision=${x.revision}`;
    await audit(actorOf(admin),"clinical.extraction-retry",`content:${id}`,x.reason,null,{revision:x.revision},{db:tx});});
}
