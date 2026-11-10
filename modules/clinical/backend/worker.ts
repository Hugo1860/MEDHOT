import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt, failureKind, failedReceiptId } from "@aihot/backend/providers/receipts";
import { modelRoute } from "@aihot/backend/editorial/models";
import { sha256 } from "@aihot/backend/lib/ids";
import { clinicalMaterial } from "./materials.ts";
import { inspectPublication } from "./monitor.ts";
import { ExtractionSchema, chineseSourceTag } from "../contract.ts";
import { doiFrom, groundedCard, groundedDetails, missingStates, prompt, promptVersion, parseClinicalOutput } from "./extract.ts";

export async function enrich(batchSize = 10) {
  if (!config.modelCallsEnabled) return { skipped: "models disabled" };
  const candidates = await sql`SELECT a.id,a.revision,a.title,a.url,a.excerpt,a.body_text,a.body_status,
    c.input_hash AS previous_hash,c.revision AS card_revision,c.schema_version,c.data AS previous_data,
    r.data AS review_data,issue.input_hash AS failed_hash,m.fetched_at AS material_checked,s.enabled AS source_enabled,
    m.body_text AS supplement_text,m.source_url AS supplement_url,m.kind AS supplement_kind,m.content_hash AS supplement_hash
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN clinical_cards c ON c.article_id=a.id
    LEFT JOIN clinical_ai_reviews r ON r.article_id=a.id AND r.revision=a.revision AND r.card_generated_at=c.generated_at AND NOT ${chineseSourceTag}=ANY(s.tags)
    LEFT JOIN clinical_materials m ON m.article_id=a.id AND m.revision=a.revision
    LEFT JOIN clinical_extraction_issues issue ON issue.article_id=a.id AND issue.revision=a.revision AND issue.resolved=false
    WHERE a.processing_state='analyzed' ORDER BY c.generated_at NULLS FIRST,a.created_at`;
  const rows=candidates.filter(a=>{
    if(a.source_enabled && a.review_data && (a.review_data.material!=="full_text"||a.review_data.issues?.length>0) && !a.material_checked)return false;
    const hash=clinicalMaterial(a as never).hash;
    return a.failed_hash!==hash && (a.card_revision!==a.revision || a.schema_version<2 || a.previous_hash!==hash
      || a.review_data?.issues?.length>0 && (a.previous_data?.extractionVersion!==promptVersion || !(a.previous_data?.repairAttempts>=1)));
  }).slice(0,Math.min(10,Math.max(1,Math.trunc(batchSize))));
  let done = 0, failed = 0;
  // The live backfill spends most of its time waiting for model responses. Keep only two in flight.
  for (let at=0;at<rows.length;at+=2) {
    const results=await Promise.allSettled(rows.slice(at,at+2).map(async a=>{
    const input=clinicalMaterial(a as never);
    const {basis,text:material,hash}=input;
    const previousIssues=a.review_data?.issues??[];
    const user=JSON.stringify({material,previousIssues,previousExtraction:previousIssues.length && a.previous_hash===hash ? a.previous_data : null});
    // A current-source card gets at most one additional correction after this prompt's first review.
    const repairAttempts=a.previous_hash===hash && a.previous_data?.extractionVersion===promptVersion ? (a.previous_data.repairAttempts??0)+1 : 0;
    let formatRepaired=false;
    const parse=(text:string)=>{const parsed=parseClinicalOutput(text);formatRepaired=parsed.repaired;return parsed.data;};
    let result:{data:ReturnType<typeof ExtractionSchema.parse>;receiptId:number;reused?:boolean};
    try {
      const [stored]=await sql`SELECT id,response FROM receipts WHERE purpose='clinical_card' AND subject=${`article:${a.id}`} AND status='failed'
        AND request->>'promptVersion'=${promptVersion} AND request->>'userHash'=${sha256(user)} AND request->>'systemHash'=${sha256(prompt)} ORDER BY id DESC LIMIT 1`;
      let recovered:ReturnType<typeof ExtractionSchema.parse>|null=null;
      if(stored){try{recovered=ExtractionSchema.parse(parse(stored.response?.choices?.[0]?.message?.content??""));}catch{}}
      result=recovered ? {data:recovered,receiptId:stored!.id,reused:true} : await chatJson({ ...await modelRoute("clinical"), purpose:"clinical_card",subject:`article:${a.id}`,
        promptVersion,system:prompt,user,schema:ExtractionSchema,parse,maxTokens:7500 });
    }catch(error){
      if(failureKind(error)!=="unusable")throw error;
      await sql.begin(async tx=>{
        await tx`INSERT INTO clinical_extraction_issues(article_id,revision,input_hash,receipt_id,reason) VALUES(${a.id},${a.revision},${hash},${failedReceiptId(error)},${String(error).slice(0,2000)})
          ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,input_hash=excluded.input_hash,receipt_id=excluded.receipt_id,reason=excluded.reason,resolved=false,updated_at=now()`;
        await tx`INSERT INTO clinical_events(article_id,kind,data) VALUES(${a.id},'extraction_failed',${tx.json({revision:a.revision,message:"证据摘录未完成，等待维护人核查；不影响其余资料继续处理。"})})`;
      });
      failed++;return;
    }
    const card = groundedCard(result.data.card, material);
    const details = groundedDetails(result.data.details, card, material);
    const fieldStates: Record<string,string> = missingStates(card, input.hasBody && !input.truncated);
    for (const [key,value] of Object.entries(result.data.card)) if (value && !card[key as keyof typeof card]) fieldStates[key]="failed";
    await sql.begin(async tx => {
      const [current] = await tx`SELECT a.revision,m.content_hash AS supplement_hash FROM articles a LEFT JOIN clinical_materials m ON m.article_id=a.id AND m.revision=a.revision AND m.status='ready' WHERE a.id=${a.id} FOR UPDATE OF a`;
      if (current?.revision !== a.revision || current.supplement_hash!==a.supplement_hash) { await completeReceipt(tx, result.receiptId); return; }
      const [old] = await tx`SELECT data FROM clinical_cards WHERE article_id=${a.id}`;
      const changedFields = Object.keys(card).filter(key => JSON.stringify(old?.data?.card?.[key]) !== JSON.stringify(card[key as keyof typeof card]));
      await tx`INSERT INTO clinical_cards(article_id,revision,input_hash,data,receipt_id,schema_version)
        VALUES(${a.id},${a.revision},${hash},${tx.json({ card, basis, details, fieldStates, extractionVersion:promptVersion, repairAttempts, materialHash:a.supplement_hash??null, materialUrl:a.supplement_url??null } as never)},${result.receiptId},2)
        ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,input_hash=excluded.input_hash,data=excluded.data,
          receipt_id=excluded.receipt_id,schema_version=2,generated_at=now()`;
      await tx`INSERT INTO clinical_events(article_id,kind,data) VALUES(${a.id},'extraction',${tx.json({ revision: a.revision, inputHash: hash, basis, formatRepaired, reusedReceipt:!!result.reused, repairAttempts, previousIssues, changedFields, changes: changedFields.map(key=>({field:key,before:old?.data?.card?.[key]?.value??null,after:card[key as keyof typeof card]?.value??null})) } as never)})`;
      await tx`UPDATE clinical_extraction_issues SET resolved=true,updated_at=now() WHERE article_id=${a.id}`;
      await completeReceipt(tx, result.receiptId);
      done++;
    });
    }));
    const failure=results.find(r=>r.status==="rejected");
    if(failure?.status==="rejected")throw failure.reason;
  }
  return { done, failed };
}

export async function monitor(inspect = inspectPublication) {
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: "collection disabled" };
  const rows = await sql`SELECT a.id,a.revision,a.url,a.raw,c.data FROM articles a LEFT JOIN clinical_cards c ON c.article_id=a.id
    LEFT JOIN clinical_checks k ON k.article_id=a.id WHERE c.article_id IS NOT NULL
    AND (k.checked_at IS NULL OR k.checked_at < c.generated_at OR k.checked_at < now()-interval '24 hours' OR (k.data->'coverage' @> '[{"status":"失败，状态未知"}]'::jsonb AND k.checked_at < now()-interval '15 minutes') OR k.data->>'monitorVersion' IS DISTINCT FROM '2' OR k.data->>'revision' IS DISTINCT FROM a.revision::text) ORDER BY k.checked_at NULLS FIRST LIMIT 12`;
  for (const a of rows) {
    const doi = doiFrom(`${a.data?.card?.doi?.value ?? ""} ${a.url} ${JSON.stringify(a.raw ?? {})}`);
    const rawPmid = String(a.data?.card?.pmid?.value ?? "");
    const pmid = rawPmid.match(/^(?:PMID:?\s*)?(\d{1,10})$/i)?.[1] ?? /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/.exec(a.url)?.[1] ?? null;
    const inspection = await inspect(doi,pmid);
    const status=inspection.status; const data={...inspection.data,revision:a.revision,monitorVersion:2};
    await sql.begin(async tx => {
      const [old] = await tx`SELECT status,data FROM clinical_checks WHERE article_id=${a.id}`;
      if (!old || old.status !== status || JSON.stringify(old.data) !== JSON.stringify(data))
        await tx`INSERT INTO clinical_events(article_id,kind,data) VALUES(${a.id},'status',${tx.json({ status, ...data } as never)})`;
      await tx`INSERT INTO clinical_checks(article_id,status,data) VALUES(${a.id},${status},${tx.json(data as never)})
        ON CONFLICT(article_id) DO UPDATE SET status=excluded.status,data=excluded.data,checked_at=now()`;
      if(status === "alert" || status === "updated") await tx`INSERT INTO clinical_review_tasks(article_id,revision,state,reason) VALUES(${a.id},${a.revision},'待复核','出版商状态或版本发生变化，需要核对。')
        ON CONFLICT(article_id) DO UPDATE SET state='待复核',revision=excluded.revision,reason=excluded.reason,updated_at=now()
        WHERE clinical_review_tasks.revision<>excluded.revision OR ${!old || old.status !== status || JSON.stringify(old.data?.updates)!==JSON.stringify(data.updates) || JSON.stringify(old.data?.relations)!==JSON.stringify(data.relations)}`;
    });
  }
  return { checked: rows.length };
}
