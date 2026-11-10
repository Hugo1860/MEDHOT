import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { useState } from "react";
import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import { loadOr404 } from "@aihot/web/lib/api.server";
import { SITE } from "@aihot/site";
import { fields, issueLabel, missingLabels, checklist, evidencePresentation, hasFact, materialLabels, type Card, type ClinicalItem } from "../contract.ts";
import { ClinicalHeading } from "./shared.tsx";
export const handle = { tab: "clinical", name: "证据卡" };
export const headers = () => ({ "Cache-Control": "no-store" });
export async function loader({ params, request }: LoaderFunctionArgs) { return loadOr404<ClinicalItem>(`/api/clinical/items/${encodeURIComponent(params.id!)}`, { signal: request.signal }); }
export const meta = () => [{ title: `临床证据卡 · ${SITE.name}` }, { name: "robots", content: "noindex" }];
export default function Detail() {
  const item = useLoaderData<typeof loader>();
  const [message, setMessage] = useState("");
  const revalidator = useRevalidator();
  const reviews = item.history.filter(e => e.kind === "review" && e.data.direction !== "incoming");
  const updates = item.history.filter(e => e.data.direction === "incoming" && e.data.currentRecord);
  const currentReview = reviews.find(e => e.data.currentRecord);
  const reading = checklist(item);
  const presentation=evidencePresentation(item);
  const exempt=item.aiReviewRequired===false;
  const ai=!exempt && item.aiReview?.current ? item.aiReview : null;
  const available=(Object.entries(fields) as Array<[keyof Card,string]>).filter(([key])=>hasFact(item.card?.[key]?.value));
  const missing=(Object.entries(fields) as Array<[keyof Card,string]>).filter(([key])=>!hasFact(item.card?.[key]?.value));
  return <main className="clinical"><ClinicalHeading title={item.title}><p>{item.source} · 关注度 {item.score ?? "未评分"}/100 · 资料修订 {item.revision}</p>
    <p><a href={item.url} target="_blank" rel="noopener noreferrer">核对原文 ↗</a> · <Link to={`/items/${item.id}`}>阅读摘要</Link> · <Link to={`/feedback?pageUrl=${encodeURIComponent(`/clinical/items/${item.id}`)}`}>反馈更正</Link></p></ClinicalHeading>
    <p>{item.summary}</p>{item.material&&<p className="clinical-note">{item.material.status==="ready"?<>已补充{item.material.kind==="abstract"?"摘要":item.material.kind==="pdf"?"原文PDF材料":"原文材料"} · <a href={item.material.url!} target="_blank" rel="noopener noreferrer">核对补充来源 ↗</a> · {new Date(item.material.fetchedAt).toLocaleDateString("zh-CN")}</>:"本轮未取得更完整的可访问材料；保留摘要和原文链接。"}</p>}{item.extractionState==="failed"&&<p className="clinical-alert">新版证据摘录未完成，需维护人核查；以下已有摘录不代表本次提取成功。</p>}
    {updates.length > 0 && <section className="clinical-alert"><h2>有后续资料关联，请先核对</h2><p>以下关系由管理员登记，不代表自动医学审查。</p>{updates.map(e => <p key={e.id}>{String(e.data.relation)} · {String(e.data.conclusion)}：<Link to={`/clinical/items/${e.data.relatedId}`}>{String(e.data.relatedTitle)}</Link></p>)}</section>}
    <section className="clinical-note"><h2>阅读与适用性</h2><p>{item.basis || "证据卡等待后台提取"} · AI 摘录 · {currentReview ? `复核记录：${currentReview.data.conclusion}（${currentReview.data.reviewer}）` : "尚无当前版本人工复核记录"}</p>
      <p>临床关注分用于阅读排序，不是 GRADE 分级或治疗推荐。能否改变实践需结合完整证据、现行指南及具体患者判断。</p>
      <p>建议讨论：研究人群与本科患者是否一致？获益与伤害是否有临床意义？现行指南是否已经纳入？</p></section>
    <section className="clinical-note"><h2>{exempt?"证据卡展示":"AI材料复核"}</h2><p>{exempt?"中文信源无需AI确认复核":ai?.status==="checked"?`已完成 · ${ai.data?materialLabels[ai.data.material]:"材料待核对"}`:ai?.status==="failed"?"本次AI复核未完成":"等待当前版本AI复核"} · 不等同人工临床验收</p>
      {ai?.data&&<p>{ai.data.summary}</p>}<p>{presentation.reason}</p>
      {ai?.data?.issues.length ? <details><summary>查看AI发现的问题（{ai.data.issues.length}项）</summary>{ai.data.issues.map((issue,i)=><p key={i}>{issueLabel(issue.field)}：{issue.reason}</p>)}</details>:null}
      {ai&&<p className="clinical-meta">复核时间：{new Date(ai.checkedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</p>}</section>
    {presentation.mode!=="hidden"&&<details className="clinical-note" key={`${item.generatedAt}:${ai?.checkedAt}`} open={presentation.mode==="expanded"}><summary>临床证据卡 · 已提取 {available.length}/{Object.keys(fields).length} 项 · 展开查看</summary>
    <section className="clinical-note"><h2>可能影响谁</h2><p>{item.tags.filter(tag=>(TOPIC_TAGS as readonly string[]).includes(tag)).join(" / ") || "科室待核对"} · {item.card?.population?.value || "研究人群待核对"}</p><p>{String(currentReview?.data.affected || item.card?.applicability?.value || "诊疗环节与排除人群尚待核查")}</p>
      <h2>对实践的影响</h2><p>{currentReview ? `人工登记结论：${currentReview.data.practice || "尚未判断"}` : "尚无人工判断，不据此直接改变实践"}</p><p>原文推荐：{item.card?.recommendation?.value || "未明确报告"}</p>
      <h2>采用前需要核查</h2><p>{String(currentReview?.data.beforeUse || "中国适应证、指南、药品可及性、医保、设备条件和基线风险差异")}</p>
      {item.localChecks?.length ? item.localChecks.map(c=><article key={c.id}><strong>{c.kind} · {c.result}{!c.current && " · 已过期或对应旧版本"}</strong><p>{c.note}</p><p><a href={c.evidence_url} target="_blank" rel="noopener noreferrer">核查依据</a> · {c.owner} · {new Date(c.checked_at).toLocaleDateString("zh-CN")} · 有效至 {new Date(c.expires_at).toLocaleDateString("zh-CN")}</p></article>) : <p>尚无院内核查记录；未查到不代表不可用或未获批准。</p>}</section>
      <p>适用地区：{item.card?.region?.value || "原文未明确 / 待核对"}。中国适用情况：{item.card?.chinaStatus?.value || "本材料未提供，需核查中国批准适应证、指南、药品可及性和院内条件"}。</p>
    <h2>临床证据卡</h2><dl className="clinical-facts">{available.map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{item.card?.[key]?.value || (item.fieldStates?.[key] ? missingLabels[item.fieldStates[key]!] : "所读取材料未报告 / 尚待提取")}</dd></div>)}</dl>
    {missing.length>0&&<details><summary>查看未报告字段（{missing.length}项）</summary><dl className="clinical-facts">{missing.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{missingLabels[item.fieldStates?.[key] || "insufficient"]}</dd></div>)}</dl></details>}
    <p className="clinical-meta">生成时间：{item.generatedAt ? new Date(item.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待生成"}。原文数值优先；系统不从相对效应推算 NNT/NNH。</p>
    {!!item.details?.outcomes.length && <section><h2>按结局核对结果</h2>{item.details.outcomes.map((o,i)=><article className="clinical-entry" key={i}><h3>{o.outcome?.value}</h3><dl className="clinical-facts">{Object.entries({comparison:"比较组",time:"时间点",subgroup:"亚组",effect:"相对效应及置信区间",absolute:"绝对效应",harm:"伤害"}).map(([k,label])=><div key={k}><dt>{label}</dt><dd>{o[k as keyof typeof o]?.value || "所读材料未报告"}</dd></div>)}</dl></article>)}</section>}
    <h2>批判性阅读提示 · {reading.kind}</h2><p>用于检查报告信息，不等同研究质量或偏倚风险评级。请结合证据卡与原文逐项核查。</p><ul>{reading.items.map(t=><li key={t}><strong>{t}</strong><p>{item.details?.appraisal?.find(a=>a.item===t)?.finding?.value || "待核查：所读材料未提供针对本项的可定位摘录。"}</p></li>)}</ul>
    <section><h2>注册与发表结果核对</h2>{item.registration ? <><p>{item.registration.registry_id} · 注册快照 {item.registration.data.snapshotDate} · {item.registration.data.owner} · <a href={item.registration.data.url} target="_blank" rel="noopener noreferrer">注册依据</a></p><p>{item.registration.data.note}</p>{item.registration.comparison.map(c=><article key={c.key} className="clinical-entry"><strong>{c.label} · {c.status}</strong><p>注册：{c.registered||"未提供"}</p><p>发表：{c.published||"未提取"}</p></article>)}<p>文字差异不自动代表结局变更或研究违规，需核对注册历史与全文。</p></> : <p>尚无对应注册快照，不能判断结果是否一致。授权接口或人工核查资料就绪后补充。</p>}</section>
    </details>}
    <section className={item.check?.status === "alert" ? "clinical-alert" : "clinical-note"}><h2>版本与撤稿核查</h2>{item.check?.current===false&&<p>资料或证据卡已更新，等待重新核查；下列为历史核查记录。</p>}<p>{item.check?.data.message || "尚未核查出版商更新状态"}</p>
      <p>最后核查：{item.check ? new Date(item.check.checked_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未执行"}</p>
      {item.check?.data.updates?.map((u,i) => <p key={i}>{u.type} · <a href={u.url || `https://doi.org/${encodeURIComponent(u.DOI || "")}`} target="_blank" rel="noopener noreferrer">{u.source || "出版商"} 更新文件：{u.DOI || u.pmid}</a></p>)}
      {item.check?.data.coverage?.map(c=><p key={c.provider}>{c.provider}：{c.status}</p>)}
      {item.check?.data.relations?.map(r=><p key={r.type+r.identifier}>{r.type} · <a href={r.url} target="_blank" rel="noopener noreferrer">{r.identifier}</a> · {r.source}</p>)}
      <p>指南版本替代与预印本正式发表关系，可由管理员核查后登记在下面的版本记录中。</p></section>
    <details><summary>变更记录（{item.history.length}条）</summary>{item.history.length ? item.history.map(e => <article className="clinical-entry" key={e.id}><strong>{e.kind === "review" ? `${e.data.direction === "incoming" ? "关联资料登记 · " : ""}${e.data.conclusion} · ${e.data.reviewer}` : e.kind === "status" ? "出版商状态核查" : e.kind==="extraction_failed"?"证据卡提取未完成":e.kind==="ai_review"?"AI材料复核":e.kind==="material"?"原文材料补充":"证据卡生成"}</strong><p>{String(e.data.reason || e.data.message || e.data.basis || "")}</p>{!!e.data.identity && <p>{String(e.data.identity)}</p>}{!!e.data.relatedId && <p>{String(e.data.relation)}：<Link to={`/clinical/items/${e.data.relatedId}`}>{String(e.data.relatedTitle)}</Link>{!e.data.currentRecord && "（登记对应的资料版本已更新，请重新核对）"}</p>}{Array.isArray(e.data.changedFields) && <p className="clinical-meta">资料修订 {String(e.data.revision)} · 更新字段：{e.data.changedFields.map(k => fields[k as keyof Card] || String(k)).join("、") || "无字段变化"}</p>}{Array.isArray(e.data.changes)&&<details><summary>查看字段前后变化</summary>{(e.data.changes as Array<{field:string;before:string|null;after:string|null}>).map(c=><p key={c.field}>{fields[c.field as keyof Card]||c.field}：{c.before||"未报告"} → {c.after||"未报告"}</p>)}</details>}<small>{new Date(e.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></article>) : <p>暂无记录</p>}</details>
    <details className="clinical-note"><summary>管理员登记复核 / 版本关系</summary><p>需要后台登录；复核姓名由管理员登记，不自动证明专家资质。在新版或更正文件的证据卡登记被更新资料 ID，原资料页会同步显示关联。</p><form className="clinical-filters" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      try {
        const me = await fetch("/api/admin/me"); if (!me.ok) throw new Error("请先登录管理后台");
        const { csrf } = await me.json();
        const body: Record<string, unknown> = { ...Object.fromEntries(form), revision: item.revision }; if (!body.relatedId) { delete body.relatedId; delete body.relation; }
        const r = await fetch(`/api/admin/clinical/${item.id}/review`, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error("保存失败，请检查权限、关联资料和版本是否变化"); setMessage("复核记录已保存"); revalidator.revalidate();
      } catch (error) { setMessage((error as Error).message); }
    }}><label>复核姓名<input name="reviewer" required minLength={2} maxLength={80}/></label><label>结论<select name="conclusion"><option>待专家复核</option><option>核对完成</option><option>需更正</option></select></label>
      <label>对实践的影响<select name="practice"><option>尚未判断</option><option>需要讨论</option><option>暂不改变</option><option>改变</option></select></label>
      <label>影响人群与诊疗环节<textarea name="affected" maxLength={1200}/></label><label>采用前核查事项<textarea name="beforeUse" maxLength={2000}/></label>
      <label>依据与局限<textarea name="reason" minLength={10} maxLength={1500} required/></label><label>关联资料 ID（选填）<input name="relatedId" maxLength={80}/></label><label>关系<select name="relation"><option>替代旧版</option><option>正式发表</option><option>更正</option><option>撤稿</option><option>相关证据</option></select></label><button>保存复核</button><Link to="/admin/login">登录后台</Link><Link to={`/clinical/manage?id=${encodeURIComponent(item.id)}`}>打开审核工作台</Link></form><p role="status">{message}</p></details>
  </main>;
}
