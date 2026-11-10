import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { fakeApi, itemDetail, startWebServer, visit } from "./web-server.ts";

test("clinical specialty search can be saved, evidence remains qualified, and weekly report follows specialty", async () => {
  const item = { id: "clinical-fixture", title: "临床证据检查", source: "示例期刊", summary: "试验摘要", tags: ["心血管"], category: "research", selected: true, score: 88,
    timeline_at: "2026-11-09T00:00:00Z", revision: 1, url: "https://example.org/trial", card: null, basis: null, generatedAt: null, check: null,
    history: [{ id: 1, kind: "review", created_at: "2026-11-09T00:00:00Z", data: { direction: "incoming", currentRecord: true, relatedId: "new-guideline", relatedTitle: "正式指南新版本", relation: "替代旧版", revision: 1, conclusion: "核对完成", reviewer: "示例登记" } }] };
  const api = fakeApi(url => {
    if (url.pathname === "/api/clinical/items") return { items: [item], total: 1, page: 1, facets:{interventions:[],outcomes:[],sourceLanguages:{zh:76,other:231}} };
    if (url.pathname === "/api/clinical/items/clinical-fixture") return item;
    if (url.pathname === "/api/site/items/clinical-fixture") return itemDetail({ id: item.id, title: item.title });
    if (url.pathname === "/api/clinical/weekly") return { key: "2026-11-09", total: 1, specialty: url.searchParams.get("specialty"), provisional: true, priority: [], discussion: [item], reading: [] };
  });
  const browser = await chromium.launch({ channel: "chromium" });
  const web = await startWebServer(api);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await visit(page, web.origin + "/clinical");
    await expect(page.getByText("中文信源 76 条",{exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"查看中文信源数据 →"})).toHaveAttribute("href","/clinical?sourceLanguage=zh");
    await expect(page.getByRole("combobox",{name:"信源语言"})).toHaveValue("");
    await page.getByRole("combobox",{name:"信源语言"}).selectOption("zh");
    await page.getByRole("button",{name:"筛选",exact:true}).click();
    await expect(page).toHaveURL(/sourceLanguage=zh/);
    await expect(page.getByRole("link",{name:"查看全部信源"})).toBeVisible();
    await page.getByRole("combobox", { name: /^专科/ }).selectOption("心血管");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/specialty=/);
    await page.getByRole("button", { name: "保存检索", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("检索条件已保存在此浏览器");
    await page.reload();
    await expect(page.getByRole("heading", { name: "我的临床问题" })).toBeVisible();
    await page.getByRole("link", { name: "查看本科室周报 →" }).click();
    await expect(page.getByRole("heading", { name: "心血管学习周报" })).toBeVisible();
    await page.getByRole("link", { name: "临床证据检查", exact: true }).click();
    await expect(page.getByText("尚无当前版本人工复核记录", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "有后续资料关联，请先核对" })).toBeVisible();
    await expect(page.getByRole("link", { name: "正式指南新版本" }).first()).toHaveAttribute("href", "/clinical/items/new-guideline");
    await expect(page.getByText("暂无可展示的临床证据信息，请阅读摘要或核对原文。")).toBeVisible();
    await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: "/tmp/medhot-clinical-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(web.origin + "/clinical");
    await expect(page.getByRole("heading", { name: "值得讨论 · 精选与指南" })).toBeVisible();
    await page.screenshot({ path: "/tmp/medhot-clinical-desktop.png", fullPage: true });
    await page.goto(web.origin + "/items/clinical-fixture");
    await expect(page.getByRole("link", { name: "发现后续版本或更正记录，请先核对 →" })).toBeVisible();
  } finally { await browser.close(); await web.stop(); }
});

test("clinical preferences persist independently and audit workbench submits a revision-bound check",async()=>{
 let saved:Record<string,unknown>|null=null;
 const api=fakeApi(async(url,res,req)=>{
  if(url.pathname==="/api/clinical/items")return {items:[],total:0,page:1};
  if(url.pathname==="/api/admin/me")return {csrf:"test-csrf"};
  if(url.pathname==="/api/admin/clinical/editions")return [];
  if(url.pathname==="/api/admin/clinical/workbench")return {tasks:[{id:"work",title:"待核查安全资料",revision:3,category:"safety",state:"待复核",assignee:"",due_at:null,reviewed_revision:3,processing_state:"analyzed",check_status:null}],sources:[],reviewers:[],identities:[],metrics:{labeledArticles:0,consensusArticles:0,unresolvedArticles:0,safety:{missed:0,total:0},precision:{useful:0,total:0},topTen:{useful:0,total:0},fields:{correct:0,checked:0},notice:"尚无医师标注"}};
  if(url.pathname==="/api/admin/clinical/work/material")return {title:"待核查安全资料",body_text:"测试原文材料",excerpt:"",data:{card:{}},supplement:{status:"ready",kind:"abstract",source_url:"https://example.org/supplement",body_text:"补充摘要含实际核查结果",fetched_at:"2026-11-10T00:00:00Z"},candidates:[]};
  if(url.pathname==="/api/admin/clinical/work/check"){
    assert.equal(req.headers["x-csrf-token"],"test-csrf");
    saved=JSON.parse(await new Promise<string>(resolve=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>resolve(s));}));return {ok:true};
  }
 });
 const web=await startWebServer(api);const browser=await chromium.launch({channel:"chromium"});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await visit(page,web.origin+"/clinical");
  await page.getByRole("combobox",{name:"职业角色"}).selectOption("护理");
  await page.getByRole("combobox",{name:"阅读模式"}).selectOption("duty");
  await page.getByRole("button",{name:"保存当前阅读偏好"}).click();
  await expect(page.getByRole("status")).toHaveText("阅读偏好已保存在此浏览器");
  await page.reload();await page.getByRole("button",{name:"使用我的阅读偏好"}).click();
  await expect(page).toHaveURL(/mode=duty/);await expect(page.getByRole("combobox",{name:"职业角色"})).toHaveValue("护理");
  await page.goto(web.origin+"/clinical/manage?id=work");await expect(page.getByRole("heading",{name:"临床评测进度"})).toBeVisible();
  await page.getByText("查看采集材料及逐字段依据（仅后台）",{exact:true}).click();
  await expect(page.getByText("补充摘要含实际核查结果",{exact:true})).toBeVisible();await expect(page.getByRole("link",{name:"补充材料原文"})).toHaveAttribute("href","https://example.org/supplement");
  await page.getByText("登记院内条件 / 注册结果核查",{exact:true}).click();
  await page.getByLabel("核查依据网址").fill("https://example.org/approved");
  await page.getByLabel("维护负责人").fill("资料维护人");
  await page.getByLabel("实际核查时间").fill("2026-01-01T10:00");await page.getByLabel("有效至").fill("2027-01-01T10:00");
  await page.getByLabel("依据、差异和限制（不要填写患者信息）").fill("这是一条测试核查记录，资料不足需要继续核查。");
  await page.locator("details").filter({has:page.getByText("登记院内条件 / 注册结果核查",{exact:true})}).getByRole("button",{name:"保存记录"}).click();
  await expect(page.getByRole("status")).toContainText("记录已保存");assert.equal((saved as Record<string,unknown>|null)?.revision,3);assert.equal((saved as Record<string,unknown>|null)?.result,"资料不足");
  assert.deepEqual(errors,[]);await page.screenshot({path:"/tmp/medhot-clinical-workbench-mobile.png",fullPage:true});
 }finally{await browser.close();await web.stop();}
});

test("a clinical question with new evidence hides its old practice conclusion",async()=>{
 const api=fakeApi(url=>url.pathname==="/api/clinical/questions"?[{id:1,active:true,label:"某治疗是否适合目标人群",query:{specialty:"心血管",p:"成人"},owner:"测试维护人",total:1,state:"待复核",changed:true,review:null,items:[{id:"new-evidence",title:"新增研究需要核查",source:"示例期刊",revision:2}],history:[{createdAt:"2026-01-01T00:00:00Z",current:false}]}]:undefined);
 const web=await startWebServer(api);const browser=await chromium.launch({channel:"chromium"});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await visit(page,web.origin+"/clinical/questions");
  await expect(page.getByRole("heading",{name:"临床问题与证据变化"})).toBeVisible();await expect(page.getByText("证据集合已变化",{exact:false})).toBeVisible();
  await expect(page.getByRole("link",{name:"新增研究需要核查"})).toHaveAttribute("href","/clinical/items/new-evidence");
  await expect(page.getByText("人工登记结论",{exact:false})).toHaveCount(0);
  await page.screenshot({path:"/tmp/medhot-clinical-questions-mobile.png",fullPage:true});
 }finally{await browser.close();await web.stop();}
});

test("limited evidence starts folded, empty or disputed cards stay hidden, and full reviewed evidence opens",async()=>{
 const fact=(value:string)=>({value,evidence:""});
 const card={design:fact("RCT"),population:fact("成人研究人群"),intervention:fact("研究干预"),outcomes:fact("主要终点"),effects:fact("RR 0.8"),sampleSize:fact("120人")};
 const api=fakeApi(url=>{
  if(!url.pathname.startsWith("/api/clinical/items/"))return;
  const id=url.pathname.split("/").pop();
  return {id,title:"证据卡展示测试",source:"测试期刊",summary:"摘要仍然可读",tags:["心血管"],category:"research",score:85,selected:true,url:"https://example.org/trial",revision:1,timeline_at:"2026-11-10T00:00:00Z",generatedAt:"2026-11-10T00:00:00Z",material:{status:"ready",url:"https://example.org/source-abstract",kind:"abstract",fetchedAt:"2026-11-10T00:00:00Z",chars:1200},basis:"已提取正文（非人工全文核验）",aiReviewRequired:!id?.startsWith("chinese"),card:id?.endsWith("empty")?{doi:fact("10.1000/test")}:card,history:[],check:{status:"alert",checked_at:"2026-11-10T00:00:00Z",data:{message:"存在撤稿更新，请先核查"}},details:{design:"RCT",outcomes:[],appraisal:[]},aiReview:{current:true,status:"checked",checkedAt:"2026-11-10T01:00:00Z",data:{material:id==="full"?"full_text":"abstract",adequacy:id==="full"?"sufficient":"limited",summary:"AI只核对实际读取材料。",issues:id==="disputed"||id==="chinese"?[{field:"__proto__",reason:"结果方向与原文不一致"}]:[],fullTextEvidence:[]}}};
 });
 const web=await startWebServer(api);const browser=await chromium.launch({channel:"chromium"});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});
  await visit(page,web.origin+"/clinical/items/abstract");
  await expect(page.getByRole("link",{name:"核对补充来源 ↗"})).toHaveAttribute("href","https://example.org/source-abstract");
  await expect(page.getByText("摘要仍然可读")).toBeVisible();await expect(page.getByText("存在撤稿更新，请先核查")).toBeVisible();
  await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toBeHidden();
  await page.getByText(/^临床证据卡 · 已提取/).click();await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toBeVisible();await expect(page.getByText("120人",{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto(web.origin+"/clinical/items/full");await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toBeVisible();
  for(const id of ["empty","disputed"]){await page.goto(web.origin+"/clinical/items/"+id);await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toHaveCount(0);await expect(page.getByText("存在撤稿更新，请先核查")).toBeVisible();}
  await page.getByText("查看AI发现的问题（1项）").click();await expect(page.getByText("__proto__：结果方向与原文不一致",{exact:true})).toBeVisible();
  await page.goto(web.origin+"/clinical/items/chinese");await expect(page.getByRole("heading",{name:"AI材料复核",exact:true})).toHaveCount(0);await expect(page.getByText("中文信源无需AI确认复核 · 不等同人工临床验收",{exact:true})).toBeVisible();
  await expect(page.getByText("等待当前版本AI复核",{exact:false})).toHaveCount(0);await page.getByText(/^临床证据卡 · 已提取/).click();await expect(page.getByText("120人",{exact:true})).toBeVisible();await expect(page.getByText("存在撤稿更新，请先核查")).toBeVisible();
  await page.goto(web.origin+"/clinical/items/chinese-empty");await expect(page.getByRole("heading",{name:"临床证据卡",exact:true})).toHaveCount(0);

 }finally{await browser.close();await web.stop();}
});
