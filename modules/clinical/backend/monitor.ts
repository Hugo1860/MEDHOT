import { XMLParser } from "fast-xml-parser";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { setTimeout as delay } from "node:timers/promises";
export type Update = { type:string; DOI?:string; pmid?:string; url:string; source:string };
export type Relation = { type:string; identifier:string; url:string; source:string };
type Retrieve = (url:string)=>Promise<string>;
let nextNcbiRequest=0;
const retrieve:Retrieve=async url=>{
  // NCBI permits at most three E-utilities requests/second without an API key.
  if(new URL(url).hostname==="eutils.ncbi.nlm.nih.gov"){
    const start=Math.max(Date.now(),nextNcbiRequest);nextNcbiRequest=start+350;
    if(start>Date.now())await delay(start-Date.now());
  }
  return requireOk(await guardedFetch(url,{timeoutMs:15000,maxBytes:2000000})).text();
};
const list=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
const doiKey=(x:string)=>x.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,"");
export function reverseUpdates(target:string, works:any[]):Update[]{
  return works.flatMap(w=>list(w["update-to"]).filter(u=>typeof u.DOI==="string" && doiKey(u.DOI)===doiKey(target) && typeof u.type==="string")
    .map(u=>({type:u.type,DOI:typeof w.DOI==="string"?w.DOI:undefined,url:typeof w.DOI==="string"?`https://doi.org/${encodeURIComponent(w.DOI)}`:`https://doi.org/${encodeURIComponent(target)}`,source:u.source==="retraction-watch"?"Retraction Watch / Crossref":"Crossref"})));
}
export function crossrefRelations(message:any):Relation[]{
  const names:Record<string,string>={"is-preprint-of":"预印本的正式发表版本","has-preprint":"关联预印本","is-replaced-by":"被新版本替代","replaces":"替代旧版本","has-version":"关联版本","is-version-of":"所属版本"};
  return Object.entries(message.relation??{}).flatMap(([key,values])=>names[key]?list(values).filter(v=>v["id-type"]==="doi"&&typeof v.id==="string").map(v=>({type:names[key]!,identifier:v.id,url:`https://doi.org/${encodeURIComponent(v.id)}`,source:"Crossref出版商关系"})):[]);
}
export function pubmedRelations(xml:string,expectedPmid:string,expectedDoi?:string):{updates:Update[];relations:Relation[]}{
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml);
  const article=list(parsed.PubmedArticleSet?.PubmedArticle).find(a=>String(a.MedlineCitation?.PMID?.["#text"]??a.MedlineCitation?.PMID)===expectedPmid);
  if(!article)throw new Error("PubMed未返回目标记录");
  const identifiers=list(article.PubmedData?.ArticleIdList?.ArticleId).filter(i=>i["@_IdType"]==="doi").map(i=>String(i["#text"]??""));
  if(expectedDoi && identifiers.length && !identifiers.some(id=>doiKey(id)===doiKey(expectedDoi)))throw new Error("PubMed DOI与目标不一致");
  const links=list(article.MedlineCitation?.CommentsCorrectionsList?.CommentsCorrections);
  const types:Record<string,string>={RetractionIn:"retraction",ErratumIn:"correction",ExpressionOfConcernIn:"expression-of-concern",UpdateIn:"update",CorrectedandRepublishedIn:"corrected-and-republished",RetractedandRepublishedIn:"retracted-and-republished"};
  const updates=links.filter(l=>types[l["@_RefType"]]).flatMap(l=>{const pmid=String(l.PMID?.["#text"]??l.PMID??"");return /^\d+$/.test(pmid)?[{type:types[l["@_RefType"]]!,pmid,url:`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,source:"PubMed"}]:[];});
  return {updates,relations:[]};
}
export async function inspectPublication(doi:string|null,pmid:string|null,read:Retrieve=retrieve){
  const updates:Update[]=[];const relations:Relation[]=[];const coverage:Array<{provider:string;status:string}>=[];
  if(doi){
    try{const m=JSON.parse(await read(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).message;
      if(!m||typeof m.DOI!=="string"||doiKey(m.DOI)!==doiKey(doi))throw new Error("DOI mismatch");
      for(const u of list(m["updated-by"]))if(typeof u.DOI==="string"&&typeof u.type==="string")updates.push({type:u.type,DOI:u.DOI,url:`https://doi.org/${encodeURIComponent(u.DOI)}`,source:"Crossref"});
      relations.push(...crossrefRelations(m));coverage.push({provider:"Crossref单篇元数据",status:"完成"});
    }catch{coverage.push({provider:"Crossref单篇元数据",status:"失败，状态未知"});}
    try{const m=JSON.parse(await read(`https://api.crossref.org/works?${new URLSearchParams({filter:`updates:${doi}`,rows:"100"})}`)).message;
      if(!Array.isArray(m?.items))throw new Error("invalid response");updates.push(...reverseUpdates(doi,m.items));
      coverage.push({provider:"Crossref公告反查（含其收录的Retraction Watch数据）",status:Number(m["total-results"]??0)>100?"仅完成前100条，覆盖不全":"完成"});
    }catch{coverage.push({provider:"Crossref公告反查",status:"失败，状态未知"});}
  }else coverage.push({provider:"Crossref",status:"无DOI，无法查询"});
  if(!pmid && doi){try{const m=JSON.parse(await read(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${new URLSearchParams({db:"pubmed",term:`"${doi}"[doi]`,retmode:"json",retmax:"2"})}`)).esearchresult;
    if(!m||!Array.isArray(m.idlist))throw new Error("invalid mapping");
    if(String(m.count)==="1" && m.idlist.length===1 && /^\d+$/.test(m.idlist[0]))pmid=m.idlist[0];
    coverage.push({provider:"DOI映射PMID",status:pmid?"完成":Number(m.count)>1?"多条候选，待核对":"未找到映射"});
  }catch{coverage.push({provider:"DOI映射PMID",status:"失败，状态未知"});}}
  if(pmid){try{const data=pubmedRelations(await read(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${new URLSearchParams({db:"pubmed",id:pmid,retmode:"xml"})}`),pmid,doi??undefined);updates.push(...data.updates);coverage.push({provider:"PubMed",status:"完成"});}catch{coverage.push({provider:"PubMed",status:"失败，状态未知"});}}
  else coverage.push({provider:"PubMed",status:"无PMID，无法查询"});
  const unique=[...new Map(updates.map(u=>[`${u.type}:${u.DOI?.toLowerCase()??u.pmid}`,u])).values()];
  unique.sort((a,b)=>(a.type+(a.DOI??a.pmid)).localeCompare(b.type+(b.DOI??b.pmid)));
  relations.sort((a,b)=>(a.type+a.identifier).localeCompare(b.type+b.identifier));
  const incomplete=coverage.some(c=>c.status!=="完成");
  const status=unique.some(u=>/retract|withdraw/i.test(u.type))?"alert":unique.length||relations.length?"updated":!doi&&!pmid?"unavailable":coverage.some(c=>c.status==="完成")?incomplete?"partial":"checked":"error";
  return {status,data:{doi,pmid,updates:unique,relations,coverage,message:unique.length?"发现出版商/索引更新记录，请核对原公告。":relations.length?"发现版本关系，请核对关联原文。":"本轮未取得更新关系；请查看各渠道覆盖情况，不能据此排除撤稿、更正或版本变化。"}};
}
