import { sql } from "@aihot/backend/db";
import type { Card } from "../contract.ts";
export const registryFields = {population:"注册人群",intervention:"注册干预",comparator:"注册对照",outcomes:"注册主要终点",sampleSize:"注册样本量",followUp:"注册时间点"} as const;
export function registrationComparison(card:Card|null, registered:Record<string,string>){
  return Object.entries(registryFields).map(([key,label])=>{
    const before=registered[key]??"";const after=card?.[key as keyof Card]?.value??"";
    return {key,label,registered:before,published:after,status:!before||!after?"材料缺失，无法比较":before.replace(/\s/g,"")===after.replace(/\s/g,"")?"文本相同，仍需核对定义":"文字不同，需人工核对"};
  });
}
export function candidateRelation(a:{source_id:string;title:string;category:string|null;card:Card},b:typeof a){
  const reg=(x:Card)=>x.registration?.value?.match(/(?:NCT\d{8}|ChiCTR\w+)/i)?.[0].toLowerCase();
  if(reg(a.card)&&reg(a.card)===reg(b.card))return {relation:"相关证据",basis:"相同注册号；可能为同一试验的不同结局或时间点，不能自动合并。"};
  const key=(s:string)=>s.toLowerCase().replace(/20\d{2}|第[一二三四五六七八九十\d]+版|更新版|修订版|update[ds]?|version\s*\d+/g,"").replace(/[\s\p{P}]/gu,"");
  if(a.category==="guideline"&&b.category==="guideline"&&a.source_id===b.source_id&&key(a.title).length>=8&&key(a.title)===key(b.title))return {relation:"替代旧版",basis:"同一来源且规范化标题相同；仅为版本候选，须核对发布机构、适用人群和推荐变化。"};
  return null;
}
export async function discoverRelations(){
  const rows=await sql`SELECT a.id,a.revision,a.source_id,a.title,a.timeline_at,p.category,c.data FROM articles a JOIN clinical_cards c ON c.article_id=a.id AND c.revision=a.revision LEFT JOIN publications p ON p.article_id=a.id ORDER BY a.timeline_at DESC NULLS LAST LIMIT 500`;
  let created=0;
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i]!,b=rows[j]!;
    if(!a.timeline_at||!b.timeline_at||new Date(a.timeline_at)<=new Date(b.timeline_at))continue;
    const match=candidateRelation({...a,card:a.data.card} as never,{...b,card:b.data.card} as never);if(!match)continue;
    const inserted=await sql`INSERT INTO clinical_candidates(article_id,related_id,revision,related_revision,relation,basis) VALUES(${a.id},${b.id},${a.revision},${b.revision},${match.relation},${match.basis}) ON CONFLICT DO NOTHING RETURNING id`;
    created+=inserted.length;
  }
  return {created,coverage:"最近500条证据卡；无可靠标识或标题不匹配的资料仍需人工发现"};
}
