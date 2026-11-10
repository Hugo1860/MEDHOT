import { Link,useLoaderData } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { SITE } from "@aihot/site";
import { ClinicalHeading } from "./shared.tsx";
export const handle={tab:"clinical",name:"临床问题"};
export const meta=()=>[{title:`临床问题与证据变化 · ${SITE.name}`}];
export const headers=()=>({"Cache-Control":"no-store"});
export interface Question {id:number;active:boolean;label:string;query:Record<string,string>;owner:string;fingerprint:string;total:number;state:string;changed:boolean;review:{reviewer:string;conclusion:string;reason:string;identity:string;createdAt:string}|null;items:Array<{id:string;title:string;revision:number;source:string}>;history:Array<{createdAt:string;current:boolean}>}
export async function loader(){return apiGet<Question[]>("/api/clinical/questions");}
export default function Questions(){const rows=useLoaderData<typeof loader>();return <main className="clinical"><ClinicalHeading title="临床问题与证据变化"><p>由科室维护人登记PICO和检索条件。发现新增资料、修订或状态变化后，旧结论转为待复核；匹配范围不等同系统综述。</p></ClinicalHeading>
  {!rows.length&&<p className="clinical-empty">尚未登记公开临床问题。你仍可在临床阅读保存个人检索；科室维护人可在审核工作台登记共同关注的问题。</p>}
  {rows.map(q=><section key={q.id} className="clinical-entry"><h2>{q.label}</h2><p>{q.owner} · {q.total}条匹配资料 · {q.state}</p><p>{Object.entries(q.query).filter(([,v])=>v).map(([k,v])=>`${({specialty:"专科",q:"关键词",p:"人群",i:"干预",c:"对照",o:"结局"} as Record<string,string>)[k]}：${v}`).join("；")}</p>
    {q.changed&&<p className="clinical-alert">证据集合已变化，之前的结论需重新核查，暂不展示为当前建议。</p>}
    {q.review&&<div className="clinical-note"><strong>人工登记结论：{q.review.conclusion}</strong><p>{q.review.reason}</p><p>{q.review.reviewer} · {q.review.identity} · {new Date(q.review.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</p></div>}
    <ul>{q.items.map(i=><li key={i.id}><Link to={`/clinical/items/${i.id}`}>{i.title}</Link> · {i.source} · 资料修订{i.revision}</li>)}</ul>
    <p><Link to={`/clinical?${new URLSearchParams(q.query)}`}>打开该问题的检索条件</Link> · <Link to="/clinical/manage">登记重新复核</Link></p>
    {!!q.history.length&&<details><summary>复核历史（{q.history.length}）</summary>{q.history.map((h,i)=><p key={i}>{new Date(h.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})} · {h.current?"对应当前证据":"对应旧证据，结论不再作为当前建议"}</p>)}</details>}
  </section>)}
</main>;}
