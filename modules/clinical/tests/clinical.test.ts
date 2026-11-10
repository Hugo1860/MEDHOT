import { stub, Reply } from "../../../tests/setup.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql, closeDb } from "@aihot/backend/db";
import { fields, checklist, sourceCertainty, DetailSchema, OutcomeSchema, AiReviewSchema, evidencePresentation, type ClinicalItem } from "../contract.ts";
import { reviewCards, qualifyReview, retryAiReview, reviewSchemaFor, reviewClaims, reviewPromptVersion } from "../backend/ai-review.ts";
import { acquireMaterial, clinicalMaterial, unusableMaterial, primaryDocuments, supplementMaterials, publisherAbstract, materialText } from "../backend/materials.ts";
import { sha256 } from "@aihot/backend/lib/ids";
import { doiFrom, groundedCard, groundedDetails, missingStates, weekRange, parseClinicalOutput, promptVersion } from "../backend/extract.ts";
import { enrich, monitor } from "../backend/worker.ts";
import { clinicalItems, matches, weekly, search } from "../backend/read.ts";
import { installModules } from "@aihot/backend/modules";
import clinical from "../server.ts";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { passwordLogin, sessionPrincipal, SESSION_COOKIE } from "@aihot/backend/admin/auth";
import { reverseUpdates, pubmedRelations, inspectPublication } from "../backend/monitor.ts";
import { evaluation, saveTask, saveCheck, saveLabel, saveEdition, saveReview, verifyReviewer, saveRegistration, exportGold, retryExtraction, workbench } from "../backend/workflow.ts";
import { candidateRelation, registrationComparison } from "../backend/relationships.ts";
import { parseSelectionGoldJsonl } from "../../../scripts/eval-selection-core.ts";
import { createQuestion,reviewQuestion,questions,refreshQuestions,setQuestionActive } from "../backend/questions.ts";
installModules([clinical]);
after(closeDb);
test("unsupported facts are removed and original evidence must be present", () => {
  const empty = Object.fromEntries(Object.keys(fields).map(k => [k, null]));
  const card = groundedCard({ ...empty, sampleSize: { value: "120人", evidence: "120 patients" }, certainty: { value: "高", evidence: "not in input" } }, "Trial enrolled 120 patients.");
  assert.equal(card.sampleSize?.value, "120人"); assert.equal(card.certainty, null);
  assert.equal(groundedCard({ ...empty, sampleSize: { value: "1200人", evidence: "120 patients" } }, "Trial enrolled 120 patients.").sampleSize, null);
  const nestedMissing = groundedCard({ ...empty, population: { value: null, evidence: null }, intervention:{value:"unsourced"}, sampleSize: { value: "120人", evidence: "120 patients" } }, "Trial enrolled 120 patients.");
  assert.equal(nestedMissing.population, null);assert.equal(nestedMissing.intervention,null);
  assert.equal(nestedMissing.sampleSize?.value, "120人");
  assert.equal(doiFrom("https://doi.org/10.1000/abc.2026"), "10.1000/abc.2026");
});
test("clinical extraction is receipted, grounded, and does not repay for an unchanged article", async () => {
  const card = { ...Object.fromEntries(Object.keys(fields).map(k => [k, null])), sampleSize: { value: "120人", evidence: "120 patients" } };
  const provider = await stub(() => ({ choices: [{ message: { content: JSON.stringify({card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}}) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  Object.assign(process.env, { CLINICAL_MODEL: "default", LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "clinical-test" });
  try {
    await sql`INSERT INTO sources(id,name,kind) VALUES('clinical-model','model test','rss')`;
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES('clinical-model','clinical-model','clinical-model','https://example.com/model','Trial','Trial enrolled 120 patients.','analyzed',now(),now())`;
    assert.equal((await enrich()).done,1);
    assert.equal((await enrich()).done,0);
    const [row] = await sql`SELECT c.data,r.status FROM clinical_cards c JOIN receipts r ON r.id=c.receipt_id WHERE c.article_id='clinical-model'`;
    assert.equal(row.data.card.sampleSize.value,"120人");
    assert.equal(row.status,"completed");
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE purpose='clinical_card'`)[0].n,1);
  } finally { await provider.close(); }
});
test("AI review is receipted, version-bound, isolated from human acceptance, and holds unusable responses", async()=>{
  let invalid=false,changeCard=false;
  const result={material:"abstract",adequacy:"limited",summary:"仅能核对摘要内的样本量，缺少完整研究结果。",issues:[],fullTextEvidence:[]};
  const provider=await stub(async(_hit,req)=>{
    if(changeCard){await sql`UPDATE clinical_cards SET generated_at=generated_at+interval '1 second' WHERE article_id='clinical-model'`;changeCard=false;}
    const card={...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),sampleSize:{value:"240人",evidence:"240 patients"}};
    const output=req.body.includes("医学文献结构化摘录助手")?{card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}}:result;
    return {choices:[{message:{content:JSON.stringify(invalid?{}:output)}}],usage:{prompt_tokens:10,completion_tokens:10}};
  });
  Object.assign(process.env,{CLINICAL_MODEL:"default",LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:"test-key",LLM_MODEL:"clinical-test"});
  try{
    const enabled=config.modelCallsEnabled;config.modelCallsEnabled=false;
    try{assert.deepEqual(await reviewCards(),{skipped:"models disabled"});assert.equal(provider.hits(),0);}finally{config.modelCallsEnabled=enabled;}
    assert.equal((await reviewCards()).done,1);assert.equal((await reviewCards()).done,0);assert.equal(provider.hits(),1);
    await sql`UPDATE clinical_ai_reviews SET prompt_version='legacy',data=${sql.json({...result,issues:[{field:"sampleSize",reason:"old review flags the existing excerpt"}]})} WHERE article_id='clinical-model'`;
    await sql`UPDATE clinical_cards SET data=jsonb_set(data,'{extractionVersion}','"legacy"') WHERE article_id='clinical-model'`;
    assert.equal((await enrich()).done,0);assert.equal((await reviewCards()).done,0);assert.equal(provider.hits(),1,"old flagged cards wait for source supplementation before either paid step");
    await sql`UPDATE clinical_ai_reviews SET prompt_version=${reviewPromptVersion},data=${sql.json(result)} WHERE article_id='clinical-model'`;
    await sql`UPDATE clinical_cards SET data=jsonb_set(data,'{extractionVersion}',${sql.json(promptVersion)}::jsonb) WHERE article_id='clinical-model'`;
    const [receipt]=await sql`SELECT status FROM receipts WHERE purpose='clinical_review'`;assert.equal(receipt.status,"completed");
    await sql`UPDATE receipts SET status='failed' WHERE purpose='clinical_review'`;
    await sql`UPDATE clinical_ai_reviews SET status='failed',retry_requested=true WHERE article_id='clinical-model'`;
    assert.equal((await reviewCards()).done,1);assert.equal(provider.hits(),1,"valid paid response is recovered without another request");
    await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible,selected,visible_after,tags)
      VALUES('clinical-model','Trial','clinical-model','news','https://example.com/model',now(),now(),now(),'public',true,false,now(),ARRAY['心血管'])`;
    let [item]=await clinicalItems({ids:["clinical-model"]});assert.equal(item.aiReview?.current,true);assert.equal(matches(item,{aiReviewed:"true"}),true);assert.equal(matches(item,{reviewed:"true"}),false);
    await sql`UPDATE clinical_ai_reviews SET data=jsonb_set(data,'{fullTextEvidence}','["private full text quotation"]') WHERE article_id='clinical-model'`;
    [item]=await clinicalItems({ids:["clinical-model"]});assert.deepEqual(item.aiReview?.data?.fullTextEvidence,[]);assert.equal(evidencePresentation(item).mode,"collapsed");
    const [before]=await sql`SELECT (SELECT count(*)::int FROM clinical_labels) AS labels,(SELECT count(*)::int FROM clinical_reviewers) AS reviewers`;
    assert.deepEqual({...before},{labels:0,reviewers:0});
    await sql`UPDATE clinical_cards SET generated_at=generated_at+interval '1 second' WHERE article_id='clinical-model'`;
    [item]=await clinicalItems({ids:["clinical-model"]});assert.equal(item.aiReview?.current,false);assert.equal(matches(item,{aiReviewed:"true"}),false);
    changeCard=true;assert.equal((await reviewCards()).done,0); // replacement during model call cannot inherit approval
    invalid=true;assert.equal((await reviewCards()).failed,1);const calls=provider.hits();assert.equal((await reviewCards()).failed,0);assert.equal(provider.hits(),calls);
    [item]=await clinicalItems({ids:["clinical-model"]});assert.equal(item.aiReview?.status,"failed");assert.equal(evidencePresentation(item).mode,"collapsed");
    const admin={name:"test",userId:null} as never;
    await assert.rejects(()=>retryAiReview("clinical-model",{revision:99,reason:"核对异常后允许一次重新复核"},admin),/版本/);
    await retryAiReview("clinical-model",{revision:1,reason:"本地假服务已经修复，允许重新复核"},admin);
    invalid=false;assert.equal((await reviewCards()).done,1);assert.equal((await reviewCards()).done,0);
    const supplementary="The completed trial enrolled 240 patients. Full source details are available here.";
    await sql`INSERT INTO clinical_materials(article_id,revision,status,source_url,kind,body_text,content_hash)
      VALUES('clinical-model',1,'ready','https://example.com/full','html',${supplementary},${sha256(supplementary)})`;
    [item]=await clinicalItems({ids:["clinical-model"]});assert.equal(item.card,null);assert.equal(item.aiReview?.current,false);
    assert.equal(item.material?.url,"https://example.com/full");assert.ok(!JSON.stringify(item).includes(supplementary));
    const callsBefore=provider.hits();assert.equal((await reviewCards()).done,0);assert.equal(provider.hits(),callsBefore,"old source card is not reviewed again");
    assert.equal((await enrich()).done,1);assert.equal((await reviewCards()).done,1);
    assert.equal((await enrich()).done,0);assert.equal((await reviewCards()).done,0);assert.equal(provider.hits(),callsBefore+2);
    [item]=await clinicalItems({ids:["clinical-model"]});assert.equal(item.card?.sampleSize?.value,"240人");assert.equal(item.aiReview?.current,true);
    assert.equal(item.card?.sampleSize?.evidence,"");
    assert.equal((await sql`SELECT excerpt FROM articles WHERE id='clinical-model'`)[0].excerpt,"Trial enrolled 120 patients.","supplement does not rewrite original material or site full-text permissions");
    await sql`DELETE FROM publications WHERE article_id='clinical-model'`;
  }finally{await provider.close();}
});
test("evidence display requires clinical content, full material and a current AI review",()=>{
  const fact=(value:string)=>({value,evidence:""});
  const card={...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),design:fact("RCT"),population:fact("成人患者"),intervention:fact("治疗方案"),outcomes:fact("主要临床结局"),effects:fact("RR 0.8")};
  const data={material:"full_text",adequacy:"sufficient",summary:"已对照所读材料。",issues:[],fullTextEvidence:[]} as const;
  const item={card,details:{design:"RCT",outcomes:[]},basis:"已提取正文（非人工全文核验）",aiReview:{current:true,status:"checked",checkedAt:new Date().toISOString(),data}} as unknown as ClinicalItem;
  assert.equal(evidencePresentation(item).mode,"expanded");
  assert.equal(evidencePresentation({...item,aiReview:{...item.aiReview!,data:{...item.aiReview!.data!,material:"abstract"}}}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,basis:"仅标题/摘要"}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,card:{...item.card!,effects:null}}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,aiReview:{...item.aiReview!,current:false}}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,card:{doi:fact("10.1000/test"),population:fact("未报告")} as never}).mode,"hidden");
  assert.equal(evidencePresentation({...item,aiReview:{...item.aiReview!,data:{...item.aiReview!.data!,issues:[{field:"effects",reason:"数字方向与原文相反"}]}}}).mode,"hidden");
  assert.equal(evidencePresentation({...item,aiReviewRequired:false,aiReview:null}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,aiReviewRequired:false,aiReview:{...item.aiReview!,data:{...item.aiReview!.data!,issues:[{field:"effects",reason:"历史复核不再作为中文信源门槛"}]}}}).mode,"collapsed");
  assert.equal(evidencePresentation({...item,aiReviewRequired:false,card:{doi:fact("10.1000/test")} as never}).mode,"hidden");
  const review={...item.aiReview!.data!,fullTextEvidence:["method passage","result passage"]};
  const withoutExcerpts=AiReviewSchema.parse({material:"full_text",adequacy:"sufficient",summary:"返回省略了全文定位片段",issues:[{field:"研究类型及材料是否完整",reason:"仅展示的问题标签，不是写入路径"}]});
  assert.deepEqual(withoutExcerpts.fullTextEvidence,[]);assert.equal(qualifyReview(withoutExcerpts,"method passage result passage",true,false).material,"insufficient");
  const findings=Array.from({length:35},(_,i)=>({field:`结局分组/${i+1}`,reason:"对应比较组或时间点尚不能由所引片段支持"}));
  assert.deepEqual(AiReviewSchema.parse({...withoutExcerpts,issues:findings}).issues,findings,"a multi-outcome review preserves all valid findings");
  assert.equal(qualifyReview(review,"method passage result passage",true,false).material,"full_text");
  for(const [material,body,truncated] of [["method passage",true,false],["method passage result passage",false,false],["method passage result passage",true,true]] as const){assert.equal(qualifyReview(review,material,body,truncated).material,"insufficient");}
});
test("Chinese source policy skips paid confirmation and old review gates while preserving supplementation and receipts",async()=>{
  const id="clinical-chinese-policy";
  const text="研究纳入120例患者。";
  const card={...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),sampleSize:{value:"120例患者",evidence:text}};
  const result={material:"abstract",adequacy:"limited",summary:"仅取得摘要。",issues:[],fullTextEvidence:[]};
  let changeSource=false;
  const provider=await stub(async(_hit,req)=>{
    if(changeSource){await sql`UPDATE sources SET tags=ARRAY['中文'] WHERE id=${id}`;changeSource=false;}
    return {choices:[{message:{content:JSON.stringify(req.body.includes("医学文献结构化摘录助手")?{card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}}:result)}}],usage:{prompt_tokens:10,completion_tokens:10}};
  });
  Object.assign(process.env,{CLINICAL_MODEL:"default",LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:"test-key",LLM_MODEL:"clinical-test"});
  const collect=process.env.COLLECT_ENABLED;
  try{
    await sql`INSERT INTO sources(id,name,kind,tags) VALUES(${id},'中文标题的境外期刊','rss',ARRAY['中国'])`;
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES(${id},${id},${id},'https://example.com/chinese','中文研究标题',${text},'analyzed',now(),now())`;
    await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible,selected,visible_after,tags) VALUES(${id},'中文研究标题',${id},'news','https://example.com/chinese',now(),now(),now(),'public',true,false,now(),ARRAY['心血管'])`;
    assert.equal((await enrich()).done,1);assert.equal((await reviewCards()).done,1);assert.equal(provider.hits(),2,"Chinese titles and country tags do not exempt a source");
    await sql`UPDATE clinical_ai_reviews SET status='failed',retry_requested=true,data=${sql.json({...result,issues:[{field:"card.sampleSize",claim:"120例患者",reason:"历史争议"}]})} WHERE article_id=${id}`;
    await sql`UPDATE clinical_cards SET data=jsonb_set(data,'{extractionVersion}','"legacy"') WHERE article_id=${id}`;
    await sql`UPDATE sources SET tags=ARRAY['中文','中国'] WHERE id=${id}`;
    let [item]=await clinicalItems({ids:[id]});assert.equal(item.aiReviewRequired,false);assert.equal(item.aiReview,null);assert.equal(evidencePresentation(item).mode,"collapsed");
    assert.equal(item.sourceLanguage,"zh");const chineseSearch=await search({sourceLanguage:"zh",q:"中文研究标题"});assert.equal(chineseSearch.total,1);assert.equal(chineseSearch.items[0]?.id,id);assert.ok(chineseSearch.facets.sourceLanguages.zh>=1);
    assert.equal((await search({sourceLanguage:"other",q:"中文研究标题"})).total,0);
    assert.equal(matches(item,{aiReviewed:"true"}),true);assert.equal(matches(item,{reviewed:"true"}),false);
    const task=(await workbench()).tasks.find(t=>t.id===id)!;assert.equal(task.ai_review_status,"exempt");assert.equal(task.ai_review_error,null);
    await assert.rejects(()=>retryAiReview(id,{revision:1,reason:"中文来源不应再创建付费复核任务"},{name:"test",userId:null} as never),/无需AI确认复核/);
    assert.equal((await enrich()).done,0,"legacy review issues must not trigger another extraction");
    assert.equal((await reviewCards()).done,0);assert.equal(provider.hits(),2);
    assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_ai_reviews WHERE article_id=${id}`)[0].n,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${`article:${id}`} AND status='completed'`)[0].n,2,"historical paid receipts remain");
    assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_events WHERE article_id=${id} AND kind='ai_review_exempt'`)[0].n,1);
    await sql`UPDATE sources SET tags=ARRAY[]::text[] WHERE id=${id}`;changeSource=true;
    assert.equal((await reviewCards()).done,0,"a source exempted during a paid call cannot receive a new approval");assert.equal(provider.hits(),3);
    assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_ai_reviews WHERE article_id=${id}`)[0].n,0);
    process.env.COLLECT_ENABLED="true";
    const calls:string[]=[];
    await supplementMaterials(10,async a=>{calls.push(a.title);return {status:"ready",url:a.url,kind:"abstract",text:text+"结果材料已补充。",attempts:[]};});
    assert.deepEqual(calls,["中文研究标题"],"Chinese sources can obtain source material without an AI review record");
    [item]=await clinicalItems({ids:[id]});assert.equal(item.card,null,"changed material still invalidates the old extraction");assert.equal(item.aiReviewRequired,false);
    assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_events WHERE article_id=${id} AND kind='review'`)[0].n,0);
  }finally{if(collect===undefined)delete process.env.COLLECT_ENABLED;else process.env.COLLECT_ENABLED=collect;await sql`DELETE FROM articles WHERE id=${id}`;await sql`DELETE FROM sources WHERE id=${id}`;await provider.close();}
});
test("AI findings must identify an actually filled claim, not a missing field or a hypothetical reader inference",()=>{
  const extraction={card:{effects:{value:"相对风险估计降低20%，未报告CI",evidence:"risk estimated 20% lower"},funding:null},details:{appraisal:[{item:"注册、资金与利益冲突",finding:null}]}};
  const base={material:"abstract",adequacy:"limited",summary:"摘要未报告置信区间及资金披露，属于覆盖限制。",issues:[]};
  const schema=reviewSchemaFor(extraction);
  assert.ok(schema.safeParse(base).success);
  assert.ok(schema.safeParse({...base,issues:[{field:"card.effects",claim:extraction.card.effects.value,reason:"应核对原文比较方向"}]}).success);
  for(const issue of [{field:"card.funding",claim:"无资助",reason:"资金未披露"},{field:"details.appraisal.0.finding",claim:"未填写",reason:"缺失不是断言"},{field:"card.effects",claim:"绝对风险降低20%",reason:"并非卡片原断言"},{field:"__proto__",claim:"恶意路径",reason:"不允许读取原型"}]){
    assert.equal(schema.safeParse({...base,issues:[issue]}).success,false);
  }
  assert.deepEqual(reviewClaims(extraction),{"card.effects":extraction.card.effects.value});
});
test("source supplementation rejects loading templates and mismatched papers, and follows publisher primary documents",async()=>{
  const bad="全文加载中... 页面未找到/Page Not Found 0 0 摘要 本文无摘要信息 登录机构账户";
  assert.equal(unusableMaterial(bad),true);
  const a={title:"Exact trial title",url:"https://example.com/10.1000/exact",body_status:"ok",body_text:bad,excerpt:null};
  assert.equal(clinicalMaterial(a).hasBody,false);
  assert.ok(!clinicalMaterial(a).text.includes("页面未找到"));
  const response=(url:string,text:string,type="text/html")=>({url,status:200,body:Buffer.from(text),headers:new Headers({"content-type":type}),truncated:false,text:()=>text});
  const abstract="Trial enrolled 120 adults, randomly assigned to intervention or placebo. ".repeat(6);
  const fetch=async(url:string)=>url===a.url?response(url,"<html><title>Article</title><body>全文加载中... 页面未找到/Page Not Found 本文无摘要信息</body></html>"):response(url,JSON.stringify({resultList:{result:[{doi:"10.1000/exact",title:a.title,abstractText:abstract,source:"MED",id:"123",pmid:"123"}]}}),"application/json");
  const metadata='<html><head><meta name="citation_title" content="Exact trial title"><meta name="citation_doi" content="10.1000/exact"><meta name="citation_abstract" content="null '+abstract+'"></head><body>'+bad+'</body></html>';
  assert.ok(publisherAbstract(metadata,a.title,"10.1000/exact")?.includes(abstract.trim()));
  assert.equal(publisherAbstract(metadata,a.title,"10.1000/different"),null);
  const fromMetadata=await acquireMaterial(a,async url=>url===a.url?response(url,metadata):response(url,'{"resultList":{"result":[]}}',"application/json"));
  assert.equal(fromMetadata.kind,"abstract");assert.equal(fromMetadata.status,"ready");assert.ok(!fromMetadata.text?.includes("页面未找到"));
  const got=await acquireMaterial(a,fetch);
  assert.equal(got.status,"ready");assert.equal(got.kind,"abstract");assert.ok(got.text?.includes(abstract.trim()));
  const mismatch=await acquireMaterial(a,async url=>url===a.url?fetch(url):response(url,JSON.stringify({resultList:{result:[{doi:"10.1000/other",title:a.title,abstractText:abstract}]}}),"application/json"));
  assert.equal(mismatch.status,"unavailable");
  const html='<html><a href="/main.pdf">Download guidance</a><a href="/extra.pdf">Supplementary information</a><a href="https://other.test/a.pdf">Unrelated</a></html>';
  assert.deepEqual(primaryDocuments(html,a.url).map(x=>x.url),["https://example.com/main.pdf"]);
  const pdf=await acquireMaterial({...a,body_text:null,body_status:"unconfirmed"},async url=>url===a.url?response(url,html):url.endsWith("main.pdf")?response(url,"%PDF-contents","application/pdf"):response(url,'{"resultList":{"result":[]}}',"application/json"),async bytes=>{assert.ok(bytes.toString().startsWith("%PDF"));return a.title+"\n"+abstract;});
  assert.equal(pdf.kind,"pdf");assert.equal(pdf.status,"ready");
  const otherPdf=await acquireMaterial({...a,body_text:null,body_status:"unconfirmed"},async url=>url===a.url?response(url,html):url.endsWith("main.pdf")?response(url,"%PDF-contents","application/pdf"):response(url,'{"resultList":{"result":[]}}',"application/json"),async()=>"A different paper without the expected identifier. ".repeat(10));
  assert.equal(otherPdf.status,"unavailable");assert.ok(otherPdf.attempts.some(x=>x.status.includes("does not match")));
  const login=await acquireMaterial({...a,body_text:null,body_status:"unconfirmed"},async url=>url===a.url?response("https://example.com/login","<html><article>"+abstract+"</article></html>"):response(url,'{"resultList":{"result":[]}}',"application/json"));
  assert.equal(login.status,"unavailable");assert.ok(login.attempts.some(x=>x.status.includes("authentication")));
  const long=clinicalMaterial({...a,body_text:"Methods and Results ".repeat(9000)});assert.equal(long.truncated,true);
  assert.equal(qualifyReview({material:"full_text",adequacy:"sufficient",summary:"只能检查部分材料",issues:[],fullTextEvidence:["Methods","Results"]},long.text,long.hasBody,long.truncated).material,"insufficient");
  const statistical='<h4>Results</h4>Weight changed (P<0.001). Pain improved (P < 0.05); CI &lt;1.<h4>Harms</h4>Gastrointestinal adverse events.';
  assert.equal(materialText(statistical),'Results Weight changed (P<0.001). Pain improved (P < 0.05); CI <1. Harms Gastrointestinal adverse events.');
  const statistics=await acquireMaterial(a,async url=>url===a.url?fetch(url):response(url,JSON.stringify({resultList:{result:[{doi:"10.1000/exact",title:a.title,abstractText:statistical+abstract,source:"MED",id:"123"}]}}),"application/json"));
  assert.ok(statistics.text?.includes('P<0.001). Pain improved (P < 0.05)'));
  assert.ok(statistics.text?.includes('Gastrointestinal adverse events.'));
});
test("week boundaries use Beijing calendar and reject impossible dates", () => {
  assert.equal(weekRange("2026-11-09").start.toISOString(), "2026-11-08T16:00:00.000Z");
  assert.equal(weekRange("2026-11-15").key, "2026-11-09");
  assert.throws(() => weekRange("2026-02-30"));
});
test("search and weekly reports immediately omit withdrawn and unreleased items; stale cards disappear", async () => {
  await sql`INSERT INTO sources(id,name,kind) VALUES('clinical-test','clinical-test','rss')`;
  for (const id of ["clinical-public","clinical-withdrawn","clinical-future"]) {
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${id},'clinical-test',${id},${`https://example.com/${id}`},${id},now(),now())`;
    await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible,selected,visible_after,tags)
      VALUES(${id},'治疗研究','clinical-test','news','https://example.com',now(),now(),now(),${id === "clinical-withdrawn" ? "withdrawn" : "public"},true,true,${new Date(Date.now() + (id === "clinical-future" ? 86400000 : -86400000))},ARRAY['心血管'])`;
  }
  await sql`INSERT INTO clinical_cards(article_id,revision,input_hash,data) VALUES('clinical-public',2,'x','{"card":{},"basis":"stale"}')`;
  const rows = await clinicalItems({ ids: ["clinical-public","clinical-withdrawn","clinical-future"] });
  assert.equal(rows.length,1); assert.equal(rows[0].card,null);
  assert.ok(matches(rows[0],{ specialty:"心血管",question:"治疗" }));
  assert.equal(matches(rows[0],{ p:"孕妇" }),false);
  const today = new Date(Date.now()+28800000).toISOString().slice(0,10);
  const report = await weekly(today,"心血管"); assert.equal(report.total,1);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id='clinical-public'`;
  assert.equal((await weekly(today,"心血管")).total,0);
});
test("review writes require a live administrator, CSRF and the current revision, and persist an audit", async () => {
  const app = Fastify();
  clinical.http!(app);
  const oldPassword = config.adminPassword;
  config.adminPassword = "clinical-test-password-only";
  try {
    const payload = { revision: 1, conclusion: "待专家复核", reviewer: "测试管理员", reason: "测试环境核对记录，尚未进行临床专家审查。" };
    const request = { method: "POST" as const, url: "/api/admin/clinical/clinical-model/review", payload };
    assert.equal((await app.inject(request)).statusCode,401);
    const { token } = await passwordLogin(config.adminPassword,"/admin","clinical-test");
    const cookie = `${SESSION_COOKIE}=${token}`;
    assert.equal((await app.inject({ ...request, headers: { cookie } })).statusCode,403);
    const principal = await sessionPrincipal(cookie);
    const headers = { cookie, "x-csrf-token": principal!.csrf };
    const retry={method:"POST" as const,url:"/api/admin/clinical/clinical-model/ai-review-retry",payload:{revision:99,reason:"核对记录之后允许本版本重新处理"}};
    assert.equal((await app.inject(retry)).statusCode,401);assert.equal((await app.inject({...retry,headers:{cookie}})).statusCode,403);assert.equal((await app.inject({...retry,headers})).statusCode,409);
    assert.equal((await app.inject({ ...request, headers, payload: { ...payload, revision: 99 } })).statusCode,409);
    assert.equal((await app.inject({ ...request, headers })).statusCode,200);
    assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_events WHERE article_id='clinical-model' AND kind='review'`)[0].n,1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='clinical.review'`)[0].n,1);
  } finally { config.adminPassword = oldPassword; await app.close(); }
});
test("old evidence shows a public replacement, never inherits its review, and loses a withdrawn relation", async () => {
  for (const id of ["clinical-old", "clinical-replacement"]) {
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${id},'clinical-test',${id},${`https://example.com/${id}`},${id},now(),now())`;
    await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible)
      VALUES(${id},${id},'clinical-test','news','https://example.com',now(),now(),now(),'public',${id !== "clinical-old"})`;
  }
  await sql`INSERT INTO clinical_events(article_id,kind,data) VALUES('clinical-replacement','review','{"revision":1,"relatedId":"clinical-old","relation":"替代旧版","conclusion":"核对完成"}')`;
  let [old] = await clinicalItems({ ids: ["clinical-old"] });
  assert.equal(old.history[0].data.direction,"incoming");
  assert.equal(old.history[0].data.relatedId,"clinical-replacement");
  assert.equal(old.history[0].data.currentRecord,true);
  assert.equal((await clinicalItems()).some(i => i.id === "clinical-old"),false,"old evidence is reachable by its link without reentering the current reading pool");
  const [replacement] = await clinicalItems({ ids: ["clinical-replacement"] });
  assert.equal(replacement.history[0].data.relatedId,"clinical-old");
  await sql`UPDATE articles SET revision=2 WHERE id='clinical-replacement'`;
  [old] = await clinicalItems({ ids: ["clinical-old"] });
  assert.equal(old.history[0].data.currentRecord,false);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id='clinical-replacement'`;
  [old] = await clinicalItems({ ids: ["clinical-old"] });
  assert.equal(old.history.length,0);
});

test("structured outcomes retain their own evidence; missing material and reported certainty stay distinct",()=>{
 assert.equal(sourceCertainty("极低"),"极低");assert.equal(sourceCertainty("高到低"),null);assert.equal(sourceCertainty("证据确定性不高"),null);assert.equal(sourceCertainty("高质量"),null);
 const empty=Object.fromEntries(Object.keys(fields).map(k=>[k,null]));
 const card=groundedCard({...empty,design:{value:"RCT",evidence:"randomized trial"},population:{value:"成人",evidence:"adults"}},"randomized trial in adults; mortality HR 0.8");
 const d=groundedDetails({design:"RCT",patients:["成人","儿童"],certainty:"高",publication:null,outcomes:[{outcome:{value:"死亡",evidence:"mortality"},comparison:null,time:null,subgroup:null,effect:{value:"HR 0.7",evidence:"HR 0.8"},absolute:null,harm:null}]},card,"randomized trial in adults; mortality HR 0.8");
 assert.equal(d.design,"RCT");assert.deepEqual(d.patients,["成人"]);assert.equal(d.certainty,null);assert.equal(d.outcomes[0]!.effect,null);
 assert.equal(missingStates(card,false).sampleSize,"insufficient");assert.equal(missingStates(card,true).sampleSize,"not_reported");
 assert.ok(checklist({details:d} as never).items.includes("预先注册的主要终点"));
 const unsupported=groundedDetails({...d,interventions:[{value:"dose 30mg",evidence:"dose 10mg"}],appraisal:[{item:"盲法及偏离既定干预",finding:{value:"1200例受试者",evidence:"120 patients"}}]},card,"randomized trial in adults; dose 10mg; 120 patients");
 assert.equal(unsupported.interventions.length,0);assert.equal(unsupported.appraisal[0]!.finding,null);
});
test("retraction reverse lookup and PubMed preserve notice direction and per-provider uncertainty",async()=>{
 const notices=[{DOI:"10.1000/notice","update-to":[{DOI:"10.1000/paper",type:"retraction",source:"retraction-watch"}]},{DOI:"10.1000/unrelated","update-to":[{DOI:"10.1000/else",type:"retraction"}]}];
 assert.equal(reverseUpdates("10.1000/PAPER",notices).length,1);
 const xml='<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">123</PMID><CommentsCorrectionsList><CommentsCorrections RefType="RetractionIn"><PMID>456</PMID></CommentsCorrections><CommentsCorrections RefType="RetractionOf"><PMID>789</PMID></CommentsCorrections></CommentsCorrectionsList></MedlineCitation></PubmedArticle></PubmedArticleSet>';
 assert.deepEqual(pubmedRelations(xml,"123").updates.map(u=>u.pmid),["456"]);
 assert.throws(()=>pubmedRelations(xml,"999"));
 const hit:string[]=[];
 const result=await inspectPublication("10.1000/paper",null,async url=>{hit.push(url);return url.includes("filter=")?JSON.stringify({message:{items:notices,"total-results":2}}):JSON.stringify({message:{DOI:"10.1000/paper"}});});
 assert.equal(result.status,"alert");assert.equal(hit.length,3);assert.equal(result.data.updates[0]!.source,"Retraction Watch / Crossref");
 const unavailable=await inspectPublication(null,null,async()=>{throw new Error("must not request");});assert.equal(unavailable.status,"unavailable");
 const partial=await inspectPublication("10.1000/paper",null,async url=>{if(url.includes("filter="))throw new Error("offline");return JSON.stringify({message:{DOI:"10.1000/paper"}});});assert.equal(partial.status,"partial");
});
test("workflow records are revision-bound, local checks expire, and study splits cannot leak",async()=>{
 const admin={userId:null,name:"test reviewer",csrf:"dev",dev:true};
 await saveTask("clinical-model",{revision:1,state:"待复核",assignee:"医师甲",dueAt:null,reason:"测试任务分配，尚未完成临床复核。"},admin);
 await assert.rejects(()=>saveTask("clinical-model",{revision:99,state:"待复核",assignee:"医师甲",dueAt:null,reason:"过期任务应拒绝写入当前版本。"},admin));
 await saveCheck("clinical-model",{revision:1,kind:"中国适应证",result:"资料不足",evidenceUrl:"https://example.com/regulator",owner:"医师甲",checkedAt:new Date(Date.now()-86400000).toISOString(),expiresAt:new Date(Date.now()-3600000).toISOString(),note:"测试资料不足，不能作为已获批准的依据。"},admin);
 const base={revision:1,studyKey:"trial-1",split:"development",reviewer:"医师甲",specialty:"心血管",decision:"select",importantSafety:true,useful:null,rank:null,session:"",correctFields:0,checkedFields:0,reason:"真实测试材料的标注流程，非临床人员实际验收。"};
 await saveLabel("clinical-model",base,admin);
 await assert.rejects(()=>saveLabel("clinical-model",{...base,split:"holdout"},admin));
 const metrics=evaluation([{article_id:"x",revision:1,data:{...base,systemSelected:false,systemVisible:false}}]);
 assert.equal(metrics.consensusArticles,0);assert.equal(metrics.safety.total,0);
 const agreed=evaluation([{article_id:"x",revision:1,data:{...base,systemSelected:false,systemVisible:false}},{article_id:"x",revision:1,data:{...base,reviewer:"医师乙",systemSelected:false,systemVisible:false}}]);
 assert.equal(agreed.safety.missed,1);assert.equal(agreed.safety.total,1);
});
test("published specialty editions preserve versions but withdrawn citations and dependent discussion disappear",async()=>{
 const admin={userId:null,name:"editor",csrf:"dev",dev:true};
 const x={date:"2026-01-05",specialty:"心血管",expectedVersion:0,state:"草稿",reviewer:"医师甲",note:"测试周报流程，依据测试材料进行审阅。",discussion:"讨论这一研究的结局与局限。"};
 await assert.rejects(()=>saveEdition({...x,state:"已发布"},["clinical-old"],admin));
 await saveEdition(x,["clinical-old"],admin);
 await saveEdition({...x,expectedVersion:1,state:"已审阅"},["clinical-old"],admin);
 await saveEdition({...x,expectedVersion:2,state:"已发布"},["clinical-old"],admin);
 let w=await weekly(x.date,x.specialty);assert.equal(w.total,1);assert.equal(w.edition!.data.discussion,x.discussion);
 await assert.rejects(()=>saveEdition({...x,expectedVersion:2,state:"已更正"},[],admin));
 await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id='clinical-old'`;
 w=await weekly(x.date,x.specialty);assert.equal(w.total,0);assert.equal(w.removed,1);assert.equal(w.edition!.data.discussion,"");
});
test("structured filters do not treat selection as certainty",async()=>{
 const [item]=await clinicalItems({ids:["clinical-replacement"]});
 const sample={id:"x",title:"Test",summary:"",tags:["心血管"],card:null,selected:true,category:"research",score:80,url:"https://example.com",source:"test",timeline_at:new Date().toISOString(),revision:1,basis:null,generatedAt:null,check:null,history:[],details:{design:"RCT",patients:["成人"],certainty:null,publication:"预印本",outcomes:[]}};
 assert.equal(matches(sample as never,{certainty:"高"}),false);assert.equal(matches(sample as never,{design:"RCT",patient:"成人"}),true);assert.equal(matches(sample as never,{mode:"duty"}),false);
 assert.equal(matches({...sample,sourceLanguage:"zh"} as never,{sourceLanguage:"zh"}),true);assert.equal(matches({...sample,sourceLanguage:"other"} as never,{sourceLanguage:"zh"}),false);
 assert.equal(item,undefined,"withdrawn material is never exposed by ID");
});
test("registry comparisons and version candidates never assert equivalence from missing fields",()=>{
 const card=groundedCard({...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),outcomes:{value:"死亡率",evidence:"mortality"},registration:{value:"NCT12345678",evidence:"NCT12345678"}},"mortality NCT12345678");
 const result=registrationComparison(card,{outcomes:"住院时间"});assert.equal(result.find(x=>x.key==="outcomes")!.status,"文字不同，需人工核对");assert.equal(result.find(x=>x.key==="population")!.status,"材料缺失，无法比较");
 assert.equal(candidateRelation({source_id:"s",title:"A",category:"research",card},{source_id:"s",title:"B",category:"research",card})!.relation,"相关证据");
});
test("new clinical admin routes deny anonymous access and shared accounts cannot certify experts",async()=>{
 const app=Fastify();clinical.http!(app);
 try{
  assert.equal((await app.inject({url:"/api/admin/clinical/workbench"})).statusCode,401);
  assert.equal((await app.inject({url:"/api/admin/clinical/clinical-model/material"})).statusCode,401);
  assert.equal((await app.inject({url:"/api/admin/clinical/labels/export"})).statusCode,401);
  await assert.rejects(()=>verifyReviewer({userId:9999,name:"专家甲",institution:"测试机构",specialties:["心血管"],evidenceUrl:"https://example.com/verification",note:"测试核验凭据，仅限测试数据。",active:true},{userId:null,name:"test",csrf:"dev",dev:true}));
 }finally{await app.close();}
});
test("review validity is lost after evidence regeneration even at the same article revision",async()=>{
 await sql`UPDATE publications SET visibility='public' WHERE article_id='clinical-public'`;
 await sql`UPDATE clinical_cards SET revision=1,generated_at=now() WHERE article_id='clinical-public'`;
 await saveReview("clinical-public",{revision:1,conclusion:"核对完成",reviewer:"测试医师",reason:"仅测试复核版本绑定，不是实际医学审核。"},{userId:null,name:"test",csrf:"dev",dev:true});
 let [item]=await clinicalItems({ids:["clinical-public"]});assert.equal(item.history.find(e=>e.kind==='review')!.data.currentRecord,true);
 await sql`UPDATE clinical_cards SET generated_at=now()+interval '1 second' WHERE article_id='clinical-public'`;
 [item]=await clinicalItems({ids:["clinical-public"]});assert.equal(item.history.find(e=>e.kind==='review')!.data.currentRecord,false);
});
test("public evidence never includes internal quotation passages in new outcome or appraisal fields",async()=>{
 const hidden={value:"摘要值",evidence:"PRIVATE_QUOTATION_FOR_REVIEW"};
 await sql`UPDATE clinical_cards SET data=${sql.json({card:{population:hidden},details:{design:null,patients:[],certainty:null,publication:null,interventions:[hidden],outcomeTags:[hidden],appraisal:[{item:"x",finding:hidden}],outcomes:[{outcome:hidden}]}})} WHERE article_id='clinical-public'`;
 const [item]=await clinicalItems({ids:["clinical-public"]});
 assert.ok(item.details);assert.equal(JSON.stringify(item).includes("PRIVATE_QUOTATION_FOR_REVIEW"),false);
 await sql`UPDATE clinical_cards SET data=jsonb_set(data,'{details,appraisal}','[{"item":"主要结局、获益与伤害","finding":{"value":"16例严重伤害","evidence":"adverse events were reported"}}]') WHERE article_id='clinical-public'`;
 assert.equal((await clinicalItems({ids:["clinical-public"]}))[0]!.details!.appraisal[0]!.finding,null,"historical unanchored numeric findings are also hidden without another paid call");
});

test("human agreement exports into the existing SelectBench parser without generating labels",async()=>{
 const admin={userId:null,name:"test reviewer",csrf:"dev",dev:true};
 await saveLabel("clinical-model",{revision:1,studyKey:"trial-1",split:"development",reviewer:"医师乙",specialty:"心血管",decision:"select",importantSafety:true,useful:null,rank:null,session:"",correctFields:0,checkedFields:0,reason:"第二名测试人员的标注记录，仅验证导出流程。"},admin);
 const gold=await exportGold();assert.equal(gold.length,1);assert.equal(parseSelectionGoldJsonl(gold.map(r=>JSON.stringify(r)).join("\n"))[0]!.gold.decision,"select");
});
test("priority events sort across the whole filtered pool before the first page is sliced",async()=>{
 for(let i=0;i<31;i++){const id=`clinical-rank-${i}`;const at=new Date(Date.now()-i*1000);
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${id},'clinical-test',${id},${`https://example.com/${id}`},${id},${at},${at})`;
  await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible,selected,category,tags) VALUES(${id},${id},'clinical-test','news','https://example.com',${at},${at},${at},'public',true,false,${i===30?"safety":"research"},ARRAY['心血管'])`;
 }
 const result=await search({q:"clinical-rank"});assert.equal(result.total,31);assert.equal(result.items.length,30);assert.equal(result.items[0]!.id,"clinical-rank-30");
});

test("clinical questions invalidate old conclusions immediately when evidence changes or is withdrawn",async()=>{
 const admin={userId:null,name:"test",csrf:"dev",dev:true};
 const created=await createQuestion({label:"测试临床问题的证据变化",owner:"测试维护人",query:{q:"clinical-rank",specialty:"心血管"}},admin);
 const id=created!.id;let q=(await questions()).find(q=>q.id===id)!;
 assert.equal(q.total,31);assert.equal(q.review,null);
 await reviewQuestion(id,{fingerprint:q.fingerprint,reviewer:"测试医师",conclusion:"暂不改变",reason:"测试结论：仅验证证据变化使旧记录失效，不是真实临床建议。"},admin);
 q=(await questions()).find(q=>q.id===id)!;assert.ok(q.review);
 const before=q.fingerprint;
 await sql`INSERT INTO clinical_events(article_id,kind,data) VALUES('clinical-rank-0','review','{"revision":1,"relatedId":"clinical-public","relation":"更正","conclusion":"核对完成"}')`;
 q=(await questions()).find(q=>q.id===id)!;assert.equal(q.total,31);assert.equal(q.changed,true);assert.equal(q.review,null,"a manual correction invalidates the old conclusion before any withdrawal");
 await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id='clinical-rank-0'`;
 q=(await questions()).find(q=>q.id===id)!;assert.equal(q.total,30);assert.equal(q.review,null);assert.equal(q.changed,true);
 await assert.rejects(()=>reviewQuestion(id,{fingerprint:before,reviewer:"测试医师",conclusion:"暂不改变",reason:"旧指纹不可写入已变化的证据集合，请重新核查。"},admin));
 assert.equal((await refreshQuestions()).changed,1);
 await setQuestionActive(id,false,admin);assert.equal((await questions()).some(q=>q.id===id),false);assert.equal((await questions(true)).find(q=>q.id===id)!.history.length,1);
});


test("live classification envelopes are accepted and unsupported classifications remain unknown",()=>{
 const d=DetailSchema.parse({design:{value:"其他",evidence:"source text"},patients:[{value:"成人",evidence:"adults"},"未知分组"],certainty:"高到低",publication:"未经核实",outcomes:[]});
 assert.equal(d.design,"其他");assert.deepEqual(d.patients,["成人"]);assert.equal(d.certainty,null);assert.equal(d.publication,null);
 assert.equal(DetailSchema.parse({...d,design:"无法分类的研究"}).design,null);
});
test("a flat appraisal finding retains its original evidence and still rejects unsupported numbers",()=>{
 const card={...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),design:{value:"横断面观察研究",evidence:"cross-sectional study"}} as never;
 const text="Patients' medical data from 1973 to 2026 were obtained. Individuals with FXS were identified using diagnostic codes.";
 const input={design:"观察研究",patients:[],certainty:null,publication:null,outcomes:[],appraisal:[
  {item:"选择偏倚与可比性",finding:"病例须至少2次就诊记录",evidence:"Individuals with FXS were identified using diagnostic codes."},
  {item:"时间顺序与反向因果",finding:"数据来自1973至2026年",evidence:"Patients' medical data from 1973 to 2026 were obtained."},
 ]};
 const d=groundedDetails(input,card,text);
 assert.equal(d.appraisal[0]!.finding,null);
 assert.equal(d.appraisal[1]!.finding?.value,"数据来自1973至2026年");
 assert.equal(d.appraisal[1]!.finding?.evidence,"Patients' medical data from 1973 to 2026 were obtained.");
});
test("one unusable extraction is isolated without recurring paid retries; a maintainer can release it",async()=>{
 const card=Object.fromEntries(Object.keys(fields).map(k=>[k,null]));
 const response={choices:[{message:{content:JSON.stringify({card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}})}}],usage:{prompt_tokens:10,completion_tokens:10}};
 let bad=true;
 const provider=await stub((_hit,req)=>{if(req.body.includes("clinical-unusable")&&bad)return {choices:[{message:{content:'{"card":{}}'}}]};return response;});
 Object.assign(process.env,{CLINICAL_MODEL:"default",LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:"test-key",LLM_MODEL:"clinical-test"});
 try{
  for(const id of ["clinical-unusable","clinical-after-error"])await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES(${id},'clinical-model',${id},${`https://example.com/${id}`},${id},'source abstract','analyzed',now(),now())`;
  assert.deepEqual(await enrich(),{done:1,failed:1});assert.equal(provider.hits(),2);
  assert.deepEqual(await enrich(),{done:0,failed:0});assert.equal(provider.hits(),2);
  assert.equal((await sql`SELECT resolved FROM clinical_extraction_issues WHERE article_id='clinical-unusable'`)[0].resolved,false);
  await assert.rejects(()=>retryExtraction("clinical-unusable",{revision:99,reason:"测试过期版本不能解除失败状态。"},{userId:null,name:"test",csrf:"dev",dev:true}));
  await retryExtraction("clinical-unusable",{revision:1,reason:"测试维护人已经核查模型返回并允许重新处理。"},{userId:null,name:"test",csrf:"dev",dev:true});bad=false;
  assert.deepEqual(await enrich(),{done:1,failed:0});assert.equal(provider.hits(),3);
  assert.equal((await sql`SELECT resolved FROM clinical_extraction_issues WHERE article_id='clinical-unusable'`)[0].resolved,true);
 }finally{await provider.close();}
});
test("a previously rejected but now valid paid response is recovered without another model request",async()=>{
 const card=Object.fromEntries(Object.keys(fields).map(k=>[k,null]));
 const provider=await stub(()=>({choices:[{message:{content:JSON.stringify({card,details:{design:{value:"其他",evidence:"source"},patients:[],certainty:null,publication:null,outcomes:[]}})+"}"}}],usage:{prompt_tokens:10,completion_tokens:10}}));
 Object.assign(process.env,{CLINICAL_MODEL:"default",LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:"test-key",LLM_MODEL:"clinical-test"});
 try{
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES('clinical-recover','clinical-model','clinical-recover','https://example.com/recover','Recover','source abstract','analyzed',now(),now())`;
  assert.equal((await enrich()).done,1);
  const [before]=await sql`SELECT id,attempts FROM receipts WHERE purpose='clinical_card' AND subject='article:clinical-recover'`;
  // Reproduce the persisted state left by the old classification validator, using this local paid stub response.
  await sql`DELETE FROM clinical_cards WHERE article_id='clinical-recover'`;await sql`UPDATE receipts SET status='failed' WHERE id=${before.id}`;
  assert.equal((await enrich()).done,1);assert.equal(provider.hits(),1);
  const [after]=await sql`SELECT attempts,status FROM receipts WHERE id=${before.id}`;
  assert.equal(after.attempts,before.attempts);assert.equal(after.status,"completed");
  assert.equal((await sql`SELECT count(*)::int AS n FROM clinical_events WHERE article_id='clinical-recover' AND data->>'reusedReceipt'='true' AND data->>'formatRepaired'='true'`)[0].n,1);
 }finally{await provider.close();}
});


test("regenerating a card rechecks publication status even when the article revision stays unchanged",async()=>{
 const id="clinical-status-refresh";
 // Earlier review invalidation fixtures deliberately used a future generation timestamp.
 await sql`UPDATE clinical_cards SET generated_at=clock_timestamp() WHERE generated_at>clock_timestamp()`;
 await sql`INSERT INTO articles(id,source_id,identity_key,url,title,processing_state,discovered_at,timeline_at) VALUES(${id},'clinical-model',${id},'https://example.com/status','Status refresh','analyzed',now(),now())`;
 await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,visibility,eligible) VALUES(${id},'Status refresh','clinical-model','news','https://example.com/status',now(),now(),now(),'public',true)`;
 await sql`INSERT INTO clinical_cards(article_id,revision,input_hash,data,schema_version) VALUES(${id},1,'x','{"card":{}}',2)`;
 await sql`INSERT INTO clinical_checks(article_id,status,data,checked_at) VALUES(${id},'checked','{"revision":1,"monitorVersion":2}',now()-interval '1 hour')`;
 assert.equal((await clinicalItems({ids:[id]}))[0]!.check!.current,false);
 let hits=0;const inspect=async()=>{hits++;return {status:"unavailable",data:{message:"local fixture",updates:[],relations:[],coverage:[]}};};
 await monitor(inspect as never);assert.ok(hits>0);assert.equal((await clinicalItems({ids:[id]}))[0]!.check!.current,true);
 hits=0;assert.equal((await monitor(inspect as never)).checked,0);assert.equal(hits,0);
 await sql`UPDATE clinical_cards SET generated_at=clock_timestamp() WHERE article_id=${id}`;
 assert.equal((await clinicalItems({ids:[id]}))[0]!.check!.current,false);
 assert.equal((await monitor(inspect as never)).checked,1);assert.equal(hits,1);
});


test("flat model outcomes preserve each field's own original evidence and reject invented numbers",()=>{
 const row=OutcomeSchema.parse({outcome:"死亡率",outcomeEvidence:"mortality",comparison:"对照",comparisonEvidence:"placebo",time:null,timeEvidence:null,subgroup:null,subgroupEvidence:null,effect:"HR 0.7",effectEvidence:"HR 0.8",absolute:null,absoluteEvidence:null,harm:null,harmEvidence:null});
 const many=DetailSchema.parse({design:null,patients:[],certainty:null,publication:null,outcomes:Array.from({length:13},()=>row),interventions:Array.from({length:13},(_,i)=>({value:`药物${i}`,evidence:`medicine ${i}`}))});assert.equal(many.interventions.length,13);assert.equal(many.outcomes.length,13,"reported outcomes beyond twelve are retained, not silently discarded");
 assert.equal(row.outcome!.evidence,"mortality");assert.equal(row.comparison!.value,"对照");
 const card=Object.fromEntries(Object.keys(fields).map(k=>[k,null]));
 const details=groundedDetails({design:null,patients:[],certainty:null,publication:null,outcomes:[row]},card as never,"mortality compared with placebo HR 0.8");
 assert.equal(details.outcomes[0]!.outcome!.value,"死亡率");assert.equal(details.outcomes[0]!.effect,null);
});


test("clinical JSON recovery removes only one redundant final brace and rejects internal or truncated damage",()=>{
 assert.deepEqual(parseClinicalOutput('{"card":{},"details":{}}}'),{data:{card:{},details:{}},repaired:true});
 assert.equal(parseClinicalOutput('```json\n{"card":{},"details":{}}\n```').repaired,false);
 assert.throws(()=>parseClinicalOutput('{"card":{"value":"x",},"details":{}}'));
 assert.throws(()=>parseClinicalOutput('{"card":{},"details":{'));
 assert.throws(()=>parseClinicalOutput('{"card":{},"details":{}}}}'));
 const repeated='{"card":{},"details":{"appraisal":[]},"interventions":[]},"interventions":[]},"details":{"appraisal":[]}}}';
 assert.deepEqual(parseClinicalOutput(repeated),{data:{card:{},details:{appraisal:[]},interventions:[]},repaired:true});
 assert.deepEqual(parseClinicalOutput('{"card":{},"details":{}},"outcomes":null}').data,{card:{},details:{},outcomes:null});
 assert.throws(()=>parseClinicalOutput('{"card":{},"details":{"design":"RCT"}},"details":{"design":"观察研究"}}'));
 assert.throws(()=>parseClinicalOutput('{"card":{},"details":{}},"unexpected":true}'));
 assert.equal(DetailSchema.parse({design:null,patients:[],certainty:null,publication:null,outcomes:[],appraisal:[{item:"研究类型及材料是否完整",finding:"没有原文引用的模型描述"}]}).appraisal[0]!.finding,null);
});


test("supplementation is disabled by the collection valve, runs once per version, and discards in-flight old material",async()=>{
  await sql`INSERT INTO sources(id,name,kind) VALUES('clinical-material-source','source','rss')`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,processing_state,discovered_at,timeline_at) VALUES('clinical-material-once','clinical-material-source','clinical-material-once','https://example.com/paper','Trial','analyzed',now(),now())`;
  await sql`INSERT INTO clinical_ai_reviews(article_id,revision,card_generated_at,input_hash,prompt_version,status,data) VALUES('clinical-material-once',1,now(),'old','old','checked','{"material":"insufficient","issues":[]}')`;
  let calls=0,change=false;
  const acquire=async()=>{calls++;if(change)await sql`UPDATE articles SET revision=revision+1 WHERE id='clinical-material-once'`;return {status:"ready" as const,url:"https://example.com/paper.pdf",kind:"pdf",text:"Original source study methods and results.",attempts:[]};};
  const enabled=process.env.COLLECT_ENABLED;process.env.COLLECT_ENABLED="false";
  try{assert.deepEqual(await supplementMaterials(1,acquire),{skipped:"collection disabled"});assert.equal(calls,0);}finally{process.env.COLLECT_ENABLED=enabled;}
  assert.deepEqual(await supplementMaterials(1,acquire),{checked:1,improved:1});
  assert.deepEqual(await supplementMaterials(1,acquire),{checked:0,improved:0});assert.equal(calls,1);
  assert.equal((await sql`SELECT site_fulltext FROM sources WHERE id='clinical-material-source'`)[0].site_fulltext,false);
  await sql`UPDATE articles SET revision=revision+1 WHERE id='clinical-material-once'`;change=true;
  assert.deepEqual(await supplementMaterials(1,acquire),{checked:1,improved:0});
  assert.equal((await sql`SELECT revision FROM clinical_materials WHERE article_id='clinical-material-once'`)[0].revision,1);
});

test("current-source AI corrections stop after one feedback pass and resume only for changed material",async()=>{
 const id='clinical-bounded-repair';
 const a={title:'Bounded repair trial',url:'https://example.com/bounded',excerpt:'Trial enrolled 120 patients.',body_text:null,body_status:'unconfirmed'};
 const card={...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),sampleSize:{value:'120人',evidence:'120 patients'}};
 const provider=await stub(()=>({choices:[{message:{content:JSON.stringify({card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}})}}],usage:{prompt_tokens:10,completion_tokens:10}}));
 Object.assign(process.env,{CLINICAL_MODEL:'default',LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:'test-key',LLM_MODEL:'clinical-test'});
 try{
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES(${id},'clinical-model',${id},${a.url},${a.title},${a.excerpt},'analyzed',now(),now())`;
  await sql`INSERT INTO clinical_materials(article_id,revision,status) VALUES(${id},1,'unchanged')`;
  await sql`INSERT INTO clinical_cards(article_id,revision,input_hash,data,schema_version) VALUES(${id},1,${clinicalMaterial(a).hash},${sql.json({card,extractionVersion:promptVersion,repairAttempts:0})},2)`;
  const review={material:'abstract',issues:[{field:'card.sampleSize',claim:'120人',reason:'需要按原文重新核查'}]};
  await sql`INSERT INTO clinical_ai_reviews(article_id,revision,card_generated_at,input_hash,prompt_version,status,data) SELECT article_id,revision,generated_at,input_hash,${reviewPromptVersion},'checked',${sql.json(review)} FROM clinical_cards WHERE article_id=${id}`;
  await enrich();
  assert.equal((await sql`SELECT data->>'repairAttempts' AS n FROM clinical_cards WHERE article_id=${id}`)[0].n,'1');
  await sql`UPDATE clinical_ai_reviews r SET card_generated_at=c.generated_at FROM clinical_cards c WHERE c.article_id=r.article_id AND c.article_id=${id}`;
  const count=async()=>Number((await sql`SELECT count(*) AS n FROM receipts WHERE purpose='clinical_card' AND subject=${`article:${id}`}`)[0].n);
  assert.equal(await count(),1);await enrich();assert.equal(await count(),1,'unresolved issues cannot start an unlimited paid loop');
  await sql`UPDATE articles SET excerpt='Updated trial enrolled 120 patients; follow-up now available.' WHERE id=${id}`;
  await enrich();assert.equal(await count(),2);
  assert.equal((await sql`SELECT data->>'repairAttempts' AS n FROM clinical_cards WHERE article_id=${id}`)[0].n,'0');
 }finally{await provider.close();}
});

test("a paired model batch drains its other paid request before reporting a service failure",async()=>{
 let active=0,maxActive=0,slowFinished=false;
 const card=Object.fromEntries(Object.keys(fields).map(k=>[k,null]));
 const provider=await stub(async(_hit,req)=>{
  active++;maxActive=Math.max(maxActive,active);
  const bad=req.body.includes('parallel-bad');
  await new Promise(r=>setTimeout(r,bad?10:100));active--;
  if(bad)return new Reply(503,{error:{message:'local service unavailable'}});
  slowFinished=true;return {choices:[{message:{content:JSON.stringify({card,details:{design:null,patients:[],certainty:null,publication:null,outcomes:[]}})}}],usage:{prompt_tokens:10,completion_tokens:10}};
 });
 Object.assign(process.env,{CLINICAL_MODEL:'default',LLM_BASE_URL:`${provider.url}/v1`,LLM_API_KEY:'test-key',LLM_MODEL:'clinical-test'});
 try{
  for(const id of ['parallel-bad','parallel-good'])await sql`INSERT INTO articles(id,source_id,identity_key,url,title,excerpt,processing_state,discovered_at,timeline_at) VALUES(${id},'clinical-model',${id},${`https://example.com/${id}`},${id},'source abstract','analyzed',now(),now())`;
  await assert.rejects(()=>enrich(2));
  assert.equal(maxActive,2);assert.equal(active,0);assert.equal(slowFinished,true);
  assert.equal((await sql`SELECT status FROM receipts WHERE purpose='clinical_card' AND subject='article:parallel-good'`)[0].status,'completed');
 }finally{await provider.close();}
});
