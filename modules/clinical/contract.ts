import { z } from "zod";
export const fields = {
  design: "研究设计 / 文件类型", population: "P · 研究人群", intervention: "I · 干预 / 暴露",
  comparator: "C · 对照", outcomes: "O · 主要结局", sampleSize: "样本量", followUp: "随访时间",
  effects: "效应量与置信区间", absoluteEffects: "绝对效应", harms: "伤害与不良事件",
  limitations: "局限与偏倚", certainty: "原文证据确定性", recommendation: "原文推荐方向与强度",
  region: "适用地区", applicability: "适用与排除人群", chinaStatus: "原文提及的中国适用情况",
  funding: "资金来源与利益冲突", registration: "试验注册号", doi: "DOI", pmid: "PMID",
  documentStatus: "正式版 / 草案 / 预印本", version: "版本与更新说明",
  peerReview: "原文披露的同行评议状态", sponsorRole: "资助方在研究中的角色", conflicts: "利益冲突披露",
} as const;
export type FieldKey = keyof typeof fields;
// The live provider also represents an unreported fact as { value: null, evidence: null }.
// A field missing either value or evidence contributes no claim; it must not reject the other grounded fields.
const fact = z.preprocess(input => {
  if (input && typeof input === "object" && (!("value" in input) || typeof input.value !== "string" || !("evidence" in input) || typeof input.evidence !== "string")) return null;
  return input;
}, z.object({ value: z.string().max(1200), evidence: z.string().max(1800) }).nullable());
export const CardSchema = z.object(Object.fromEntries(Object.keys(fields).map(key => [key, fact])) as Record<FieldKey, typeof fact>);
export type Card = z.infer<typeof CardSchema>;
export const aiReviewVersion="clinical-review-2";
export const chineseSourceTag="中文";
export function requiresAiReview(sourceTags:readonly string[]) { return !sourceTags.includes(chineseSourceTag); }
export const AiReviewSchema = z.object({
  material: z.enum(["full_text", "abstract", "report", "insufficient"]),
  adequacy: z.enum(["sufficient", "limited", "empty"]),
  summary: z.string().trim().min(1).max(700),
  // Live reviews identify either a card field or a Chinese checklist item; this is a display label, never a write path.
  issues: z.array(z.object({ field:z.string().trim().min(1).max(120), claim:z.string().min(1).max(1200).optional(), reason:z.string().trim().min(1).max(500) })).max(120),
  fullTextEvidence: z.array(z.string().trim().min(1).max(1200)).max(3).default([]),
});
export type AiReviewData = z.infer<typeof AiReviewSchema>;
export function issueLabel(path:string) {
  const field=path.replace(/^card\./,"");
  if(Object.hasOwn(fields,field))return fields[field as FieldKey];
  if(path.startsWith("details.outcomes."))return "结局分组";
  if(path.startsWith("details.appraisal."))return "批判性阅读摘录";
  if(path.startsWith("details."))return "研究分类与标签";
  return path;
}
export const materialLabels = { full_text:"AI识别为全文材料", abstract:"仅摘要", report:"报道或简讯", insufficient:"材料不足" };
export interface AiReview { sameCard?:boolean; status:"checked"|"failed"; current:boolean; checkedAt:string; data:AiReviewData|null; }
const clinicalFields:FieldKey[] = ["population","intervention","comparator","outcomes","sampleSize","followUp","effects","absoluteEffects","harms","limitations","recommendation","applicability"];
export function hasFact(value:string|undefined) {
  return !!value?.trim() && !/^(?:未报告|未提供|未提及|未明确|未知|待核查|不适用|材料不足|所读(?:取)?材料未报告|not reported|not provided|not specified|unknown|n\/?a)[。.]?$/i.test(value.trim());
}
export function evidencePresentation(item:Pick<ClinicalItem,"card"|"details"|"basis"|"aiReview"|"aiReviewRequired">):{mode:"hidden"|"collapsed"|"expanded";reason:string;filled:number} {
  const has=(k:FieldKey)=>hasFact(item.card?.[k]?.value);
  const filled=Object.keys(fields).filter(k=>has(k as FieldKey)).length;
  const required=item.aiReviewRequired!==false;
  const review=required && item.aiReview?.current ? item.aiReview : null;
  if(required && (review ?? (item.aiReview?.sameCard ? item.aiReview : null))?.status==="checked" && item.aiReview?.data?.issues.length) return {mode:"hidden",reason:"AI复核发现摘录依据或解释问题，证据卡暂不展示，请核对原文。",filled};
  if(!clinicalFields.some(has) && !item.details?.outcomes.some(o=>hasFact(o.effect?.value)||hasFact(o.harm?.value))) return {mode:"hidden",reason:"暂无可展示的临床证据信息，请阅读摘要或核对原文。",filled};
  if(!required) return {mode:"collapsed",reason:"中文信源无需AI确认复核；已提取内容可直接查看，默认折叠。",filled};
  if(review?.data?.adequacy==="empty") return {mode:"hidden",reason:"AI复核认为材料不足以形成临床证据卡，请核对原文。",filled};
  if(!review || review.status!=="checked") return {mode:"collapsed",reason:review?.status==="failed"?"AI复核未完成，现有摘录默认折叠。":"等待当前版本AI复核，现有摘录默认折叠。",filled};
  if(review.data?.material!=="full_text" || !item.basis?.startsWith("已提取正文")) return {mode:"collapsed",reason:"未取得可确认的全文材料，仅展示有限摘录，默认折叠。",filled};
  const core = item.details?.design==="指南" ? has("recommendation") && (has("population")||has("applicability"))
    : has("design") && has("population") && (has("intervention")||has("comparator")) && has("outcomes") && (has("effects")||!!item.details?.outcomes.some(o=>hasFact(o.effect?.value)));
  if(review.data.adequacy!=="sufficient" || !core) return {mode:"collapsed",reason:"关键临床字段仍不完整，证据卡默认折叠。",filled};
  return {mode:"expanded",reason:"AI已核对所读材料与摘录的一致性；不等同人工临床验收。",filled};
}
export function sourceCertainty(value:string|undefined):"高"|"中"|"低"|"极低"|null {
  const m=value?.trim().match(/^(?:证据确定性[：:]?\s*|GRADE[：:]?\s*)?(极低|低|中等|中|高)(?:确定性(?:证据)?)?[。.]?$/);
  return m ? m[1]==="中等" ? "中" : m[1] as "高"|"中"|"低"|"极低" : null;
}
export const designs = ["RCT", "观察研究", "系统评价", "诊断研究", "医疗AI", "指南", "其他"] as const;
export const populations = ["成人", "儿童", "老年", "孕产妇", "肾功能不全"] as const;
export const roles = ["临床", "药学", "护理", "质控", "科研", "教学"] as const;
export const modes = { morning: "晨间5分钟", deep: "深度阅读", duty: "值班提醒" } as const;
export const missingLabels = { not_reported: "所读材料未报告", insufficient: "材料不足，需核对全文", not_applicable: "不适用（有原文依据）", pending: "尚待提取", failed: "依据校验未通过，需核对原文" };
export const OutcomeSchema = z.preprocess(input=>{
  if(!input||typeof input!=="object"||!("outcomeEvidence" in input))return input;
  const row=input as Record<string,unknown>;
  return Object.fromEntries(["outcome","comparison","time","subgroup","effect","absolute","harm"].map(key=>[key,row[key]==null||row[`${key}Evidence`]==null?null:{value:row[key],evidence:row[`${key}Evidence`]}]));
},z.object({ outcome: fact, comparison: fact, time: fact, subgroup: fact, effect: fact, absolute: fact, harm: fact }));
// Live model responses sometimes wrap classification values in the same value/evidence envelope as facts.
const classificationValue = (input:unknown) => input && typeof input === "object" && "value" in input ? input.value : input;
export const DetailSchema = z.object({
  design: z.preprocess(classificationValue,z.enum(designs).nullable()).catch(null),
  patients: z.preprocess(input => Array.isArray(input) ? input.map(classificationValue).filter(v=>(populations as readonly unknown[]).includes(v)) : [],z.array(z.enum(populations)).max(5)),
  certainty: z.preprocess(classificationValue,z.enum(["高", "中", "低", "极低"]).nullable()).catch(null),
  publication: z.preprocess(classificationValue,z.enum(["正式发表", "预印本", "草案", "研究方案", "其他"]).nullable()).catch(null),
  interventions:z.array(fact).max(60).default([]), outcomeTags:z.array(fact).max(60).default([]),
  outcomes: z.array(OutcomeSchema).max(60),
  // A live provider returned the appraisal evidence beside a string finding, rather than inside it.
  appraisal: z.array(z.preprocess(input=>{
    if(input&&typeof input==="object"&&"finding" in input&&typeof input.finding==="string")
      return {...input,finding:"evidence" in input&&typeof input.evidence==="string"?{value:input.finding,evidence:input.evidence}:null};
    return input;
  },z.object({item:z.string().max(120),finding:fact}))).max(12).default([]),
});
export type EvidenceDetails = z.infer<typeof DetailSchema>;
export const ExtractionSchema = z.object({ card: CardSchema, details: DetailSchema });
export interface ReviewTask { article_id: string; revision: number; state: string; assignee: string; due_at: string | null; updated_at: string; }
export interface ClinicalItem {
  id: string; title: string; summary: string | null; category: string | null; tags: string[]; score: number | null;
  selected: boolean; url: string; source: string; timeline_at: string; revision: number;
  card: Card | null; basis: string | null; generatedAt: string | null;
  aiReview?: AiReview | null;
  aiReviewRequired?: boolean;
  sourceLanguage?: "zh"|"other";
  material?: {status:string;url:string|null;kind:string|null;fetchedAt:string;chars:number}|null;
  registration?: {registry_id:string;data:{url:string;owner:string;snapshotDate:string;note:string};comparison:Array<{key:string;label:string;registered:string;published:string;status:string}>}|null;
  extractionState?:"failed"|"ready"|"pending";
  details?: EvidenceDetails | null;
  localChecks?: Array<{id:number;kind:string;result:string;evidence_url:string;note:string;owner:string;checked_at:string;expires_at:string;current:boolean}>;
  fieldStates?: Partial<Record<FieldKey, keyof typeof missingLabels>>;
  check: { current?:boolean; status: string; checked_at: string; data: { message?: string; updates?: Array<{ type: string; DOI?: string; pmid?:string; url?:string; source?:string }>; relations?:Array<{type:string;identifier:string;url:string;source:string}>; coverage?:Array<{provider:string;status:string}>; doi?: string } } | null;
  history: Array<{ id: number; kind: string; data: Record<string, unknown>; created_at: string }>;
}
export function currentReview(item: ClinicalItem) {
  return item.history.find(e => e.kind === "review" && e.data.direction !== "incoming" && e.data.currentRecord);
}
export const appraisalLists: Record<string, string[]> = {
    RCT: ["随机序列与分配隐藏", "盲法及偏离既定干预", "预先注册的主要终点", "失访与意向治疗分析", "绝对获益与伤害报告"],
    观察研究: ["选择偏倚与可比性", "混杂因素及控制方法", "时间顺序与反向因果", "缺失数据及敏感性分析"],
    系统评价: ["检索范围与截止日期", "预先规定的纳入标准", "纳入研究的偏倚评价", "异质性与合并方法", "发表偏倚及证据确定性"],
    诊断研究: ["参考标准是否合适", "连续入组及受试者谱", "盲法与验证偏倚", "敏感度、特异度及置信区间", "实际适用场景"],
    医疗AI: ["独立外部验证与数据泄漏", "数据漂移与更新策略", "不同患者亚组的表现与公平性", "临床流程的前瞻性验证", "真实患者结局及伤害"],
    指南: ["目标人群与排除条件", "正式版本、发布与替代日期", "推荐方向、强弱和证据确定性", "获益伤害、资源及适用地区", "与上一版推荐的变化"],
    其他: ["研究类型及材料是否完整", "主要结局、获益与伤害", "适用人群和局限", "注册、资金与利益冲突"],
  };
export function checklist(item: ClinicalItem) {
  const kind = item.details?.design || (item.category === "guideline" ? "指南" : "其他");
  return {kind,items:appraisalLists[kind]??appraisalLists.其他!};
}
export function readingGroup(item: ClinicalItem): "priority" | "discussion" | "reading" {
  const retraction = item.history.some(e => e.data.direction === "incoming" && e.data.currentRecord && e.data.relation === "撤稿");
  const concern=item.check?.data.updates?.some(u=>/concern/i.test(u.type));
  return item.category === "safety" || item.check?.status === "alert" || concern || retraction ? "priority"
    : item.selected || item.category === "guideline" ? "discussion" : "reading";
}
export const questions = ["治疗", "诊断", "病因", "预后", "临床预测", "安全", "指南"] as const;
export const queryTerms: Record<string, string[]> = {
  治疗: ["治疗", "干预", "therapy", "treatment", "random"], 诊断: ["诊断", "敏感度", "diagnos"],
  病因: ["病因", "暴露", "etiolog", "risk factor"], 预后: ["预后", "生存", "prognos"],
  临床预测: ["预测", "prediction", "predictive"], 安全: ["安全", "召回", "safety", "recall"], 指南: ["指南", "guideline", "共识"],
};
