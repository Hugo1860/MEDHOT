import { Link, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { defineWebModule } from "@aihot/web/modules";
import { IconDoc } from "@aihot/web/components/icons";
import type { ClinicalItem } from "./contract.ts";
function Entry() {
  const { pathname } = useLocation();
  const item = /^\/items\/([^/]+)$/.exec(pathname);
  const id = item?.[1];
  const [updated, setUpdated] = useState(false);
  const [preferred,setPreferred]=useState("/clinical");
  useEffect(()=>{try{const p=JSON.parse(localStorage.getItem("ipubmed:clinical-profile")||"{}");const q=new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([k,v])=>["specialty","subspecialty","role","mode","certainty","category"].includes(k)&&typeof v==="string")) as Record<string,string>);setPreferred(q.size?`/clinical?${q}`:"/clinical");}catch{}},[pathname]);
  useEffect(() => {
    setUpdated(false);
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/clinical/items/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async r => r.ok ? await r.json() as ClinicalItem : null)
      .then(data => { if (!controller.signal.aborted) setUpdated(!!data && (data.check?.status === "alert" || data.check?.status === "updated" || data.history.some(e => e.data.direction === "incoming" && e.data.currentRecord))); })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  if (pathname !== "/" && !item) return null;
  return <div className="mb-4 rounded-card border border-line p-3 text-sm"><Link to={item ? `/clinical/items/${item[1]}` : preferred} className="text-accent font-semibold">{updated ? "发现后续版本或更正记录，请先核对 →" : item ? "查看临床证据卡、适用性与版本核查 →" : "进入临床阅读：按专科、临床问题筛选与查看科室周报 →"}</Link><p className="text-ink-3 mt-1">关注分数用于阅读排序，证据确定性与推荐强度请核对原文。</p></div>;
}
export default defineWebModule({ name: "clinical",
  sidebar: { section: "临床", items: [{ to: "/clinical", label: "临床阅读", icon: IconDoc, end: true }, { to: "/clinical/weekly", label: "科室周报", icon: IconDoc }, { to: "/clinical/questions", label: "临床问题", icon: IconDoc }] },
  tabs: [{ key: "clinical", to: "/clinical", label: "临床", icon: IconDoc }],
  tools: [{ to:"/clinical/questions",label:"临床问题与证据变化",icon:<IconDoc/> },{ to: "/clinical", label: "临床证据与专科阅读", icon: <IconDoc /> }, { to: "/clinical/weekly", label: "科室周报", icon: <IconDoc /> }],
  root: { Top: Entry },
});
