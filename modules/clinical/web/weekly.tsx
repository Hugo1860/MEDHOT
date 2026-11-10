import { Form, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { apiGet } from "@aihot/web/lib/api.server";
import { SITE } from "@aihot/site";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import type { ClinicalItem } from "../contract.ts";
import { ClinicalHeading, Item } from "./shared.tsx";
export const handle = { tab: "clinical", name: "科室周报" };
export const meta = () => [{ title: `科室周报 · ${SITE.name}` }];
export const headers = () => ({ "Cache-Control": "no-store" });
type Weekly = { edition?: {version:number;state:string;data:{reviewer:string;note:string;discussion:string}} | null; removed?:number; key: string; start: string; end: string; specialty: string; total: number; provisional: boolean; priority: ClinicalItem[]; discussion: ClinicalItem[]; reading: ClinicalItem[] };
export async function loader({ request }: LoaderFunctionArgs) { return apiGet<Weekly>(`/api/clinical/weekly?${new URL(request.url).searchParams}`, { signal: request.signal }); }
export default function Weekly() {
  const d = useLoaderData<typeof loader>();
  return <main className="clinical"><ClinicalHeading title={`${d.specialty || "全科室"}学习周报`}><p>{d.key} 起的一周（北京时间周一至周日） · {d.total} 条{d.provisional ? " · 本周持续更新" : " · 历史周报"}</p></ClinicalHeading>
    <Form method="get" className="clinical-filters" key={d.key + d.specialty}><label>专科<select name="specialty" defaultValue={d.specialty}><option value="">全部专科</option>{TOPIC_TAGS.map(t => <option key={t}>{t}</option>)}</select></label><label>选择任意一天查看当周<input name="date" type="date" defaultValue={d.key} required/></label><button>查看周报</button><button type="button" onClick={() => window.print()}>打印 / 保存 PDF</button></Form>
    {d.edition&&<section className="clinical-note"><h2>{d.edition.state} · 版本{d.edition.version}</h2><p>登记复核人：{d.edition.data.reviewer}</p><p>{d.edition.data.note}</p><p>{d.edition.data.discussion}</p>{!!d.removed&&<p>有{d.removed}条引用目前不可公开，已移除并隐藏相关讨论。</p>}</section>}
    <p className="clinical-note">按当前仍可公开的资料自动编排；撤回后会从历史周报中移除。科室标签来自自动分类，内容用于晨读和讨论，未代表科室审核或 CME 学分。</p>
    {([["优先核查 · 安全与撤稿更新", d.priority], ["值得讨论 · 精选与指南", d.discussion], ["保持了解 · 研究动态", d.reading]] as const).map(([title,items]) => <section key={title}><h2>{title}（{items.length}）</h2>{items.length ? items.map(i => <Item key={i.id} item={i}/>) : <p className="clinical-empty">本周暂无此类内容</p>}</section>)}
    <section className="clinical-note"><h2>科室讨论提纲</h2><p>选取一项研究：概括 PICO，核对主要终点和绝对获益，讨论人群差异与院内可行性，记录需要补查的证据。是否调整流程由科室结合完整证据决定。</p></section>
  </main>;
}
