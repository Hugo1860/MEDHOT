import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { Link } from "react-router";
import { evidencePresentation, type ClinicalItem } from "../contract.ts";
import "./style.css";
export function Item({ item, deep = false }: { item: ClinicalItem; deep?: boolean }) {
  const presentation=evidencePresentation(item);
  return <article className="clinical-entry"><div className="clinical-meta">{item.source} · {new Date(item.timeline_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} · {item.tags.filter(tag=>(TOPIC_TAGS as readonly string[]).includes(tag)).join(" / ")}</div>
    <h2><Link to={`/clinical/items/${item.id}`}>{item.title}</Link></h2>
    {item.check?.status === "alert" && <p className="clinical-alert">存在撤稿/撤回更新，请先核对记录</p>}
    <p>{item.summary}</p>{deep && presentation.mode==="expanded" && <p>人群：{item.card?.population?.value}<br/>主要结局：{item.card?.outcomes?.value}{item.card?.limitations?.value&&<><br/>局限：{item.card.limitations.value}</>}</p>}
    <div className="clinical-meta">{item.selected ? "精选" : "动态"} · 关注度 {item.score ?? "未评分"} · {item.aiReviewRequired===false?"中文信源无需AI确认复核":item.aiReview?.current&&item.aiReview.status==="checked"?"AI复核已完成":"待AI复核"} · {presentation.mode==="hidden"?"证据卡暂不展示":presentation.mode==="collapsed"?"证据卡默认折叠":"可查看证据卡"}</div>
  </article>;
}
export function ClinicalHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return <header className="clinical-heading"><nav><Link to="/clinical">临床阅读</Link><Link to="/clinical/weekly">科室周报</Link><Link to="/clinical/questions">临床问题</Link><Link to="/all">全部动态</Link><Link to="/clinical/manage">审核与标注</Link></nav><h1>{title}</h1>{children}</header>;
}
