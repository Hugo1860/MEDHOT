import { useEffect, useState } from "react";
import { Form, Link, useLoaderData, useLocation, useNavigate, type LoaderFunctionArgs } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { SITE } from "@aihot/site";
import { TOPIC_TAGS, CATEGORIES } from "@aihot/industry/taxonomy";
import { questions, readingGroup, designs, populations, roles, modes, type ClinicalItem } from "../contract.ts";
import { ClinicalHeading, Item } from "./shared.tsx";
export const handle = { tab: "clinical", name: "临床阅读" };
export const meta = () => [{ title: `临床阅读 · ${SITE.name}` }];
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams;
  return { ...await apiGet<{ items: ClinicalItem[]; total: number; page: number;facets?:{interventions:string[];outcomes:string[];sourceLanguages:{zh:number;other:number}} }>(`/api/clinical/items?${q}`, { signal: request.signal }), query: Object.fromEntries(q) };
}
export default function Clinical() {
  const data = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Array<{ label: string; query: string; seen?:string }>>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("ipubmed:clinical-queries") || "[]"); if (Array.isArray(v)) setSaved(v.filter(x => typeof x.label === "string" && typeof x.query === "string").slice(0, 20)); } catch {} }, []);
  const [changes,setChanges]=useState<Record<string,number>>({});
  useEffect(()=>{const c=new AbortController();void Promise.all(saved.filter(s=>s.seen).map(async s=>{try{const q=new URLSearchParams(s.query);q.delete("page");q.set("after",s.seen!);const r=await fetch(`/api/clinical/items?${q}`,{signal:c.signal});if(r.ok){const result=await r.json();if(!c.signal.aborted)setChanges(v=>({...v,[s.query]:result.total}));}}catch{}}));return()=>c.abort();},[saved]);
  const markSeen=(query:string)=>{const next=saved.map(s=>s.query===query?{...s,seen:new Date().toISOString()}:s);try{localStorage.setItem("ipubmed:clinical-queries",JSON.stringify(next));setSaved(next);}catch{setNotice("浏览器未允许保存");}};
  const [profile,setProfile]=useState<Record<string,string>>({});
  useEffect(()=>{try { const p=JSON.parse(localStorage.getItem("ipubmed:clinical-profile")||"{}"); if(p && typeof p==="object" && !Array.isArray(p)) setProfile(p); }catch{}},[]);
  const saveProfile=(event:React.MouseEvent<HTMLButtonElement>)=>{ const current=Object.fromEntries(new FormData(event.currentTarget.form!));const p=Object.fromEntries(Object.entries(current).filter(([k])=>["specialty","subspecialty","role","mode","certainty","category"].includes(k) && typeof current[k] === "string")) as Record<string,string>; try{localStorage.setItem("ipubmed:clinical-profile",JSON.stringify(p));setProfile(p);setNotice("阅读偏好已保存在此浏览器");}catch{setNotice("浏览器未允许保存");}};
  const save = () => {
    const label = [data.query.specialty, data.query.question, data.query.q, data.query.p, data.query.i].filter(Boolean).join(" · ") || "全部临床动态";
    const next = [{ label, query: search, seen:new Date().toISOString() }, ...saved.filter(x => x.query !== search)].slice(0, 20);
    try { localStorage.setItem("ipubmed:clinical-queries", JSON.stringify(next)); setSaved(next); setNotice("检索条件已保存在此浏览器"); } catch { setNotice("浏览器未允许保存"); }
  };
  return <main className="clinical"><ClinicalHeading title="临床阅读"><p>围绕你的专科和临床问题，阅读研究、指南与安全更新。</p></ClinicalHeading>
    <section className="clinical-note"><strong>中文信源 {data.facets?.sourceLanguages.zh??0} 条</strong> · {data.query.sourceLanguage==="zh"?<Link to="/clinical">查看全部信源</Link>:<Link to="/clinical?sourceLanguage=zh">查看中文信源数据 →</Link>}<p>中文期刊、国家疾控局和中国疾控中心资料集中在这里；按发布时间排序，不会被近期外文资料挤到后续页面。</p></section>
    <p>阅读方式：{modes[data.query.mode as keyof typeof modes] || "全部阅读"} · 角色：{data.query.role || "未设置"}</p>
    {Object.keys(profile).length>0 && <p><button onClick={()=>navigate(`/clinical?${new URLSearchParams(profile)}`)}>使用我的阅读偏好</button><button onClick={()=>{localStorage.removeItem("ipubmed:clinical-profile");setProfile({});}}>清除阅读偏好</button></p>}
    <Form method="get" key={search} className="clinical-filters">
      <label>专科<select name="specialty" defaultValue={data.query.specialty || ""}><option value="">全部专科</option>{TOPIC_TAGS.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>临床问题<select name="question" defaultValue={data.query.question || ""}><option value="">全部问题</option>{questions.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>内容类型<select name="category" defaultValue={data.query.category || ""}><option value="">全部类型</option>{CATEGORIES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
      <label>信源语言<select name="sourceLanguage" defaultValue={data.query.sourceLanguage || ""}><option value="">全部信源</option><option value="zh">中文信源（{data.facets?.sourceLanguages.zh??0}）</option><option value="other">其他信源（{data.facets?.sourceLanguages.other??0}）</option></select></label>
      <label>研究设计<select name="design" defaultValue={data.query.design || ""}><option value="">全部设计</option>{designs.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>患者特征<select name="patient" defaultValue={data.query.patient || ""}><option value="">全部人群</option>{populations.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>原文证据确定性<select name="certainty" defaultValue={data.query.certainty || ""}><option value="">全部（含未知）</option>{["高","中","低","极低"].map(t=><option key={t}>{t}</option>)}</select></label>
      <label>发表状态<select name="publication" defaultValue={data.query.publication || ""}><option value="">全部状态</option>{["正式发表","预印本","草案","研究方案","其他"].map(t=><option key={t}>{t}</option>)}</select></label>
      <label>职业角色<select name="role" defaultValue={data.query.role || ""}><option value="">未设置</option>{roles.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>阅读模式<select name="mode" defaultValue={data.query.mode || ""}><option value="">全部阅读</option>{Object.entries(modes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>亚专科关键词<input name="subspecialty" defaultValue={data.query.subspecialty} maxLength={120} placeholder="按自己的亚专科关键词筛选"/></label>
      <label>干预标签<select name="interventionTag" defaultValue={data.query.interventionTag || ""}><option value="">全部干预</option>{data.facets?.interventions.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>结局标签<select name="outcomeTag" defaultValue={data.query.outcomeTag || ""}><option value="">全部结局</option>{data.facets?.outcomes.map(t=><option key={t}>{t}</option>)}</select></label>
      <label className="clinical-inline"><input type="checkbox" name="aiReviewed" value="true" defaultChecked={data.query.aiReviewed==="true"}/>无需复核或AI复核已完成</label>
      <label className="clinical-inline"><input type="checkbox" name="reviewed" value="true" defaultChecked={data.query.reviewed==="true"}/>仅当前版本人工复核</label>
      <label>关键词<input name="q" defaultValue={data.query.q} placeholder="疾病、药物或研究" maxLength={300}/></label>
      {([['p','人群 P'],['i','干预 I'],['c','对照 C'],['o','结局 O']] as const).map(([name,label]) => <label key={name}>{label}<input name={name} defaultValue={data.query[name]} placeholder="检索证据卡字段" maxLength={300}/></label>)}
      <label className="clinical-inline"><input type="checkbox" name="selected" value="true" defaultChecked={data.query.selected === "true"}/>仅精选</label>
      <button type="submit">筛选</button><button type="button" onClick={save}>保存检索</button><button type="button" onClick={saveProfile}>保存当前阅读偏好</button><Link to="/clinical">清除</Link>
    </Form><p className="clinical-meta">PICO 只匹配已提取字段，缺失字段不会猜测；治疗/诊断等为文本辅助筛选，并非系统综述检索。仅精选不等于高确定性证据。晨读最多5条；值班模式只展示安全及撤稿提醒。</p>
    {data.query.role && <p className="clinical-note">{({临床:"重点核对人群、结局和实践适用性。",药学:"重点核对适应证、用药安全、获益伤害和药品可及性。",护理:"重点核对护理措施、患者安全和流程条件。",质控:"重点核对安全事件、质量指标和院内流程。",科研:"重点核对设计、注册、效应量和局限。",教学:"重点核对可讨论的临床问题和批判性阅读清单。"} as Record<string,string>)[data.query.role]}</p>}
    {notice && <p role="status">{notice}</p>}
    {saved.length > 0 && <section className="clinical-saved"><h2>我的临床问题</h2>{saved.map(s => <span key={s.query}><button onClick={() => navigate(`/clinical${s.query.startsWith("?") ? s.query : ""}`)}>{s.label}</button>{s.seen&&<button onClick={()=>{const q=new URLSearchParams(s.query);q.delete("page");q.set("after",s.seen!);navigate(`/clinical?${q}`);}}>新增或变化 {changes[s.query]??"…"}</button>}<button onClick={()=>markSeen(s.query)}>标为已查看</button></span>)}<button onClick={() => { localStorage.removeItem("ipubmed:clinical-queries"); setSaved([]); }}>清空已保存条件</button></section>}
    <p>找到 {data.total} 条 · 第 {data.page} 页 <Link to={`/clinical/weekly?specialty=${encodeURIComponent(data.query.specialty || "")}`}>查看本科室周报 →</Link></p>
    {data.items.length ? ([["priority", "必须知道 · 安全与撤稿核查"], ["discussion", "值得讨论 · 精选与指南"], ["reading", "保持了解 · 研究动态"]] as const).map(([group, title]) => {
      const items = data.items.filter(i => readingGroup(i) === group);
      return items.length > 0 && <section key={group}><h2>{title}</h2>{items.map(item => <Item key={item.id} item={item} deep={data.query.mode === "deep"}/>)}</section>;
    }) : <p className="clinical-empty">当前条件下没有资料。可清除 PICO 字段或扩大专科范围。</p>}
    <nav className="clinical-pagination">{data.page > 1 && <Link to={`?${new URLSearchParams({ ...data.query, page: String(data.page - 1) })}`}>上一页</Link>}{data.total > data.page * 30 && <Link to={`?${new URLSearchParams({ ...data.query, page: String(data.page + 1) })}`}>下一页</Link>}</nav>
  </main>;
}
