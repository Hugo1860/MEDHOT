import { sql } from "@aihot/backend/db";
import { extensionItems } from "@aihot/backend/publication/extension";
import { queryTerms, readingGroup, currentReview, sourceCertainty, aiReviewVersion, requiresAiReview, type ClinicalItem } from "../contract.ts";
import { registrationComparison } from "./relationships.ts";
import { weekRange, numbersSupported } from "./extract.ts";

export async function clinicalItems(filter: Parameters<typeof extensionItems>[0] = {}): Promise<ClinicalItem[]> {
  const rows = await extensionItems(filter);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const sources = await sql`SELECT a.id,s.tags FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id IN ${sql(ids)}`;
  const issues = await sql`SELECT article_id,revision FROM clinical_extraction_issues WHERE article_id IN ${sql(ids)} AND resolved=false`;
  const cards = await sql`SELECT *,generated_at::text AS generated_version FROM clinical_cards WHERE article_id IN ${sql(ids)}`;
  const materials=await sql`SELECT article_id,revision,status,source_url,kind,content_hash,length(body_text) AS chars,fetched_at FROM clinical_materials WHERE article_id IN ${sql(ids)}`;
  const checks = await sql`SELECT * FROM clinical_checks WHERE article_id IN ${sql(ids)}`;
  const aiReviews = await sql`SELECT *,card_generated_at::text AS card_version FROM clinical_ai_reviews WHERE article_id IN ${sql(ids)}`;
  const registrations = await sql`SELECT article_id,revision,registry_id,data,created_at FROM clinical_registrations WHERE article_id IN ${sql(ids)} ORDER BY id DESC`;
  const localChecks = await sql`SELECT id,article_id,revision,kind,result,evidence_url,note,owner,checked_at,expires_at FROM clinical_local_checks WHERE article_id IN ${sql(ids)} ORDER BY id DESC`;
  const events = await sql`SELECT * FROM clinical_events WHERE article_id IN ${sql(ids)}
    OR (kind='review' AND data->>'relatedId' IN ${sql(ids)}) ORDER BY id DESC`;
  const linkedIds = [...new Set(events.filter(e => e.data.relatedId).flatMap(e => [e.article_id, String(e.data.relatedId)]))];
  const linked = new Map((linkedIds.length ? await extensionItems({ ids: linkedIds }) : []).map(i => [i.id, i]));
  return rows.map(row => {
    const material=materials.find(m=>m.article_id===row.id&&m.revision===row.revision);
    const card = cards.find(c => c.article_id === row.id && c.revision === row.revision && (material?.status!=="ready" || c.data.materialHash===material.content_hash));
    // Evidence passages are internal validation material; summary-only sources do not grant republication of them.
    const publicCard = card?.data.card ? Object.fromEntries(Object.entries(card.data.card).map(([key, value]) => [key, value ? { value: (value as { value: string }).value, evidence: "" } : null])) : null;
    const details = card?.data.details ? { ...card.data.details, certainty:sourceCertainty(card.data.card?.certainty?.value)===card.data.details.certainty?card.data.details.certainty:null, interventions:(card.data.details.interventions??[]).filter((v:{value:string;evidence:string}|null)=>v&&numbersSupported(v)).map((v:{value:string})=>({value:v.value,evidence:""})),outcomeTags:(card.data.details.outcomeTags??[]).filter((v:{value:string;evidence:string}|null)=>v&&numbersSupported(v)).map((v:{value:string})=>({value:v.value,evidence:""})), appraisal:(card.data.details.appraisal??[]).map((a:{item:string;finding:{value:string;evidence:string}|null})=>({item:a.item,finding:a.finding&&numbersSupported(a.finding)?{value:a.finding.value,evidence:""}:null})), outcomes: card.data.details.outcomes.map((outcome: Record<string, { value: string } | null>) => Object.fromEntries(Object.entries(outcome).map(([k,v]) => [k,v ? {value:v.value,evidence:""}:null]))) } : null;
    const check=checks.find(c=>c.article_id===row.id);
    const sourceTags=sources.find(s=>s.id===row.id)?.tags??[];
    const aiReviewRequired=requiresAiReview(sourceTags);
    const sourceLanguage=aiReviewRequired?"other":"zh";
    const ai=aiReviewRequired ? aiReviews.find(r=>r.article_id===row.id) : null;
    const aiReview=ai ? {status:ai.status,sameCard:!!card && ai.revision===row.revision && ai.card_version===card.generated_version && ai.input_hash===card.input_hash,current:!!card && ai.revision===row.revision && ai.card_version===card.generated_version && ai.input_hash===card.input_hash && ai.prompt_version===aiReviewVersion && !ai.retry_requested,checkedAt:ai.checked_at.toISOString(),data:ai.data?{...ai.data,fullTextEvidence:[]}:null} : null;
    const registration=registrations.find(r=>r.article_id===row.id&&r.revision===row.revision);
    return { ...row, aiReview, aiReviewRequired, sourceLanguage, material:material?{status:material.status,url:material.source_url,kind:material.kind,chars:material.chars??0,fetchedAt:material.fetched_at.toISOString()}:null, extractionState:issues.some(x=>x.article_id===row.id&&x.revision===row.revision)?"failed":card?"ready":"pending", registration:registration ? {...registration,comparison:registrationComparison(publicCard as never,registration.data.fields)} : null, details, fieldStates: card?.data.fieldStates ?? {}, localChecks: localChecks.filter(c => c.article_id === row.id).map(c => ({ ...c, current:c.revision===row.revision && new Date(c.expires_at)>new Date() })), card: publicCard, basis: card?.data.basis ?? null, generatedAt: card?.generated_at ?? null,
      check: check ? {...check,current:check.data?.revision===row.revision && (!card || check.checked_at>=card.generated_at)} : null,
      history: events.filter(e => e.article_id === row.id || e.data.relatedId === row.id && linked.has(e.article_id)).map(e => {
        const incoming = e.article_id !== row.id;
        const target = linked.get(incoming ? e.article_id : e.data.relatedId);
        return { id: e.id, kind: e.kind, created_at: e.created_at, data: { ...e.data,
          relatedId: target?.id, relatedTitle: target?.title, direction: incoming ? "incoming" : "outgoing",
          currentRecord: incoming ? e.data.revision === target?.revision : e.data.revision === row.revision && (e.kind !== "review" || (e.data.cardGeneratedAt ?? null) === (card?.generated_at?.toISOString() ?? null)),
        } };
      }),
    } as unknown as ClinicalItem;
  });
}

export function matches(item: ClinicalItem, q: Record<string, string>) {
  if (q.specialty && !item.tags.includes(q.specialty)) return false;
  if (q.category && item.category !== q.category) return false;
  if (q.selected === "true" && !item.selected) return false;
  if (q.design && item.details?.design !== q.design) return false;
  if (q.patient && !item.details?.patients.includes(q.patient as never)) return false;
  if (q.certainty && item.details?.certainty !== q.certainty) return false;
  if (q.publication && item.details?.publication !== q.publication) return false;
  if (q.sourceLanguage && item.sourceLanguage !== q.sourceLanguage) return false;
  if (q.interventionTag && !item.details?.interventions?.some(v=>v?.value===q.interventionTag)) return false;
  if (q.outcomeTag && !item.details?.outcomeTags?.some(v=>v?.value===q.outcomeTag)) return false;
  if (q.reviewed === "true" && currentReview(item)?.data.conclusion !== "核对完成") return false;
  if (q.aiReviewed === "true" && item.aiReviewRequired!==false && !(item.aiReview?.current && item.aiReview.status==="checked")) return false;
  if (q.mode === "duty" && readingGroup(item) !== "priority") return false;
  if (q.after && Number.isFinite(Date.parse(q.after)) && Date.parse(item.timeline_at) <= Date.parse(q.after) && !item.history.some(e=>Date.parse(e.created_at)>Date.parse(q.after))) return false;
  const text = `${item.title} ${item.summary ?? ""} ${item.tags.join(" ")} ${JSON.stringify(item.card ?? {})}`.toLowerCase();
  if (q.question && !queryTerms[q.question]?.some(t => text.includes(t.toLowerCase()))) return false;
  for (const k of ["q", "subspecialty", "p", "i", "c", "o"]) {
    const field = ({ p: "population", i: "intervention", c: "comparator", o: "outcomes" } as const)[k as "p"];
    const haystack = field ? item.card?.[field]?.value.toLowerCase() ?? "" : text;
    if (q[k] && !q[k].trim().toLowerCase().split(/\s+/).every(t => haystack.includes(t))) return false;
  }
  return true;
}

export async function search(q: Record<string, string>) {
  const order = {priority:0,discussion:1,reading:2};
  const all=await clinicalItems();
  const facets={interventions:[...new Set(all.flatMap(i=>(i.details?.interventions??[]).flatMap(v=>v?[v.value]:[])))].sort(),outcomes:[...new Set(all.flatMap(i=>(i.details?.outcomeTags??[]).flatMap(v=>v?[v.value]:[])))].sort(),sourceLanguages:{zh:all.filter(i=>i.sourceLanguage==="zh").length,other:all.filter(i=>i.sourceLanguage!=="zh").length}};
  let items = all.filter(i => matches(i, q));
  items.sort((a,b) => order[readingGroup(a)]-order[readingGroup(b)] || Date.parse(b.timeline_at)-Date.parse(a.timeline_at));
  if(q.mode === "morning") items=items.slice(0,5);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  return { items: items.slice((page - 1) * 30, page * 30), total: items.length, page, facets };
}

export async function weekly(date: string, specialty: string) {
  const period = weekRange(date);
  const [edition] = await sql`SELECT version,state,article_ids,data,created_at FROM clinical_editions WHERE week=${period.key} AND specialty=${specialty} AND state IN ('已发布','已更正') ORDER BY version DESC LIMIT 1`;
  const items = edition ? await clinicalItems({ids:edition.article_ids}) : (await clinicalItems({ since: period.start, until: period.end })).filter(i => !specialty || i.tags.includes(specialty));
  const removed = edition ? edition.article_ids.length-items.length : 0;
  const publication = edition ? {...edition, article_ids:undefined, data:removed ? {reviewer:edition.data.reviewer,note:"引用资料已撤回或不可公开，相关讨论暂不展示，请编辑更正。",discussion:""} : edition.data} : null;
  const priority = items.filter(i => readingGroup(i) === "priority");
  const discussion = items.filter(i => readingGroup(i) === "discussion");
  return { key: period.key, start: period.start.toISOString(), end: period.end.toISOString(), specialty, total: items.length,
    provisional: period.end > new Date(), edition:publication, removed, priority, discussion, reading: items.filter(i => !priority.includes(i) && !discussion.includes(i)) };
}
