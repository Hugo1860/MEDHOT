import { sql } from "@aihot/backend/db";
import { guardedFetch, requireOk, type GuardedResponse } from "@aihot/backend/lib/http-fetch";
import { readable, isSignInRedirect } from "@aihot/backend/content/extract";
import { stripTags } from "@aihot/backend/lib/text";
import { sha256 } from "@aihot/backend/lib/ids";
import { parseHTML } from "linkedom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chineseSourceTag } from "../contract.ts";

export interface MaterialRow {
  title:string; url:string; excerpt:string|null; body_text:string|null; body_status:string;
  supplement_text?:string|null; supplement_url?:string|null; supplement_kind?:string|null; supplement_hash?:string|null;
}
// These live journal pages are a failed-loading / permission template, not a short research paper.
export function unusableMaterial(text:string) {
  return /页面未找到\s*\/\s*Page Not Found/.test(text) && /本文无摘要信息/.test(text)
    || /^(?:全文加载中[.\s]*|\s)*(?:Access Denied|Just a moment|Forbidden)\b/i.test(text);
}
export function clinicalMaterial(a:MaterialRow) {
  const body=a.supplement_text || (a.body_status==="ok" && a.body_text && !unusableMaterial(a.body_text)?a.body_text:null);
  const excerpt=a.excerpt && !unusableMaterial(a.excerpt)?a.excerpt:"";
  const raw=`${a.title}\n${a.url}\n${a.supplement_text?`补充材料来源：${a.supplement_url}\n材料格式：${a.supplement_kind}\n`:""}${body||excerpt}`;
  const text=raw.slice(0,120000);
  return {text,hash:sha256(text),hasBody:!!body,truncated:raw.length>text.length,
    basis:body?`已提取正文（${a.supplement_kind==="abstract"?"补充摘要；":""}非人工全文核验）${raw.length>text.length?"；材料过长，仅读取部分":""}`:"仅标题/摘要"};
}
type Fetch=(url:string)=>Promise<GuardedResponse>;
const retrieve:Fetch=url=>guardedFetch(url,{timeoutMs:20000,maxBytes:20*1024*1024});
export type MaterialAttempt={url:string;status:string;chars?:number};
type Supplement={status:"ready"|"unavailable"|"unchanged";url:string|null;kind:string|null;text:string|null;attempts:MaterialAttempt[]};
const key=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const doiIn=(s:string)=>s.match(/10\.\d{4,9}\/[a-z0-9._;()/:+-]+/i)?.[0].replace(/[.,;]+$/,"")??null;
// Europe PMC abstracts can contain literal P<0.001 next to HTML headings.
// Preserve mathematical less-than signs before removing actual element markup.
export const materialText=(html:string)=>stripTags(html.replace(/<(?![a-z/!?])/gi,"&lt;"));
export function publisherAbstract(html:string,title:string,doi:string|null) {
  const{document}=parseHTML(html);
  const meta=(name:string)=>[...document.querySelectorAll(`meta[name="${name}"]`)].map(e=>e.getAttribute("content")??"");
  const identifiers=meta("citation_doi");
  if(doi?!identifiers.some(x=>x.toLowerCase()===doi.toLowerCase()):!meta("citation_title").some(x=>key(x)===key(title)))return null;
  const abstracts=meta("citation_abstract").map(x=>materialText(x).replace(/^null\s+/,"").trim()).filter(x=>x.length>=200&&!unusableMaterial(x));
  return abstracts.length?`${title}\nDOI: ${identifiers[0]??"未提供"}\nPublisher abstract\n${abstracts[0]}`:null;
}
export function primaryDocuments(html:string,url:string) {
  const {document}=parseHTML(html);const candidates:Array<{url:string;label:string}>=[];
  const pdf=document.querySelector('meta[name="citation_pdf_url"]')?.getAttribute("content");
  if(pdf)candidates.push({url:new URL(pdf,url).href,label:"publisher article PDF"});
  const content=document.querySelector("main,article,[role=main]")??document;
  for(const a of content.querySelectorAll("a[href]")){
    const label=a.textContent?.trim()??"",href=a.getAttribute("href")!;
    if(/supplement|reporting summary|copyright|permissions|附件.*声明/i.test(label))continue;
    if(/\.pdf(?:[?#]|$)/i.test(href) || /iris\.who\.int\/.*(?:bitstream|content)/i.test(href)){
      const target=new URL(href,url);
      if(target.hostname===new URL(url).hostname || target.hostname==="iris.who.int")candidates.push({url:target.href,label});
    }
  }
  return [...new Map(candidates.map(c=>[c.url,c])).values()].slice(0,2);
}
export async function pdfText(bytes:Buffer) {
  if(!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))throw new Error("not a PDF document");
  const dir=await mkdtemp(join(tmpdir(),"clinical-pdf-"));
  try{
    await writeFile(join(dir,"source.pdf"),bytes);
    await promisify(execFile)("pdftotext",["-layout","-enc","UTF-8",join(dir,"source.pdf"),join(dir,"source.txt")],{timeout:30000,maxBuffer:1024*1024});
    const text=await readFile(join(dir,"source.txt"),"utf8");
    if(text.trim().length<200 || (text.match(/\uFFFD/g)?.length??0)>text.length/100)throw new Error("PDF has no usable text layer");
    return text;
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function acquireMaterial(a:MaterialRow,fetch:Fetch=retrieve,decodePdf=pdfText):Promise<Supplement> {
  const attempts:MaterialAttempt[]=[];
  let best={text:a.body_status==="ok"&&!unusableMaterial(a.body_text??"")?a.body_text??"":"",url:a.url,kind:"html"};
  let changed=false,doi=doiIn(a.url);
  const read=async(url:string)=>{const r=requireOk(await fetch(url));if(isSignInRedirect(url,r.url))throw new Error("source redirects to authentication; no readable material");attempts.push({url,status:"HTTP 200"});return r;};
  const failed=(url:string,e:unknown)=>attempts.push({url,status:String(e).slice(0,500)});
  const consider=(text:string,url:string,kind:string)=>{
    if(text.length>=200&&!unusableMaterial(text)&&text.length>best.text.length){best={text,url,kind};changed=true;}
  };
  try{
    const r=await read(a.url);
    if(/pdf/i.test(r.headers.get("content-type")??""))consider(await decodePdf(r.body),a.url,"pdf");
    else if(/html/i.test(r.headers.get("content-type")??"")){
      const html=r.text();const{document}=parseHTML(html);
      const pageDoi=document.querySelector('meta[name="citation_doi"]')?.getAttribute("content");
      if(doi&&pageDoi&&doi.toLowerCase()!==pageDoi.toLowerCase())throw new Error("publisher DOI does not match the original URL");
      doi=pageDoi??doi;
      const body=readable(html,r.url)?.text;
      if(body)consider(body,a.url,"html");
      const abstract=publisherAbstract(html,a.title,doi);
      if(abstract)consider(abstract,a.url,"abstract");
      const declared=document.querySelector('meta[name="citation_abstract_url"],meta[name="citation_abstract_html_url"]')?.getAttribute("content");
      const alternate=declared?new URL(declared,r.url):null;
      if(alternate&&alternate.origin===new URL(r.url).origin&&alternate.href!==r.url)try{
        const other=await read(alternate.href),content=other.text();
        const summary=publisherAbstract(content,a.title,doi);
        // A declared abstract page is still checked against the article identifier before using its text.
        if(summary){
          consider(summary,alternate.href,"abstract");
          const text=readable(content,other.url)?.text;if(text)consider(text,alternate.href,"html");
        }
      }catch(e){failed(alternate.href,e);}
      // The document must be linked by the original publisher; supplementary reports are not the main paper.
      for(const candidate of primaryDocuments(html,r.url))try{
        const pdf=await read(candidate.url),text=await decodePdf(pdf.body),opening=text.slice(0,10000);
        if(!key(opening).includes(key(a.title)) && !(doi&&opening.toLowerCase().includes(doi.toLowerCase())))throw new Error("PDF title/DOI does not match the original article");
        consider(text,candidate.url,"pdf");
      }catch(e){failed(candidate.url,e);}
    }
  }catch(e){failed(a.url,e);}
  // An exact DOI / complete-title match prevents attaching a different study's abstract or full text.
  const indexedPublisher=/(^|\.)(nejm\.org|jamanetwork\.com|bmj\.com)$/.test(new URL(a.url).hostname);
  if(best.text.length<12000&&(doi||indexedPublisher)){
    const query=doi?`DOI:"${doi}"`:`TITLE:"${a.title.replaceAll('"'," ")}"`;
    const url=`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${new URLSearchParams({query,format:"json",resultType:"core",pageSize:"2"})}`;
    try{
      const payload=JSON.parse((await read(url)).text());
      const matches=(payload.resultList?.result??[]).filter((r:any)=>doi?String(r.doi??"").toLowerCase()===doi.toLowerCase():key(r.title??"")===key(a.title));
      if(matches.length!==1)throw new Error("no unique exact identifier/title match");
      const r=matches[0];
      if(r.abstractText){
        const text=`${r.title}\nDOI: ${r.doi??"未提供"}\nPMID: ${r.pmid??"未提供"}\nAbstract\n${materialText(r.abstractText)}`;
        consider(text,`https://europepmc.org/article/${r.source}/${r.id}`,"abstract");
      }
      if(r.isOpenAccess==="Y" && /^PMC\d+$/.test(r.pmcid??"")){
        const fullUrl=`https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`;
        try{
          const xml=(await read(fullUrl)).text();const{document}=parseHTML(xml);
          const ids=[...document.querySelectorAll('article-id[pub-id-type="doi"]')].map(el=>el.textContent?.trim().toLowerCase());
          if(r.doi&&!ids.includes(r.doi.toLowerCase()))throw new Error("full text DOI mismatch");
          if(!document.querySelector("article > body, article body"))throw new Error("full text body missing");
          consider(materialText(xml),fullUrl,"open_access_xml");
        }catch(e){failed(fullUrl,e);}
      }
    }catch(e){failed(url,e);}
  }
  if(changed)attempts.push({url:best.url,status:"accepted",chars:best.text.length});
  return {status:changed?"ready":best.text?"unchanged":"unavailable",url:changed?best.url:null,kind:changed?best.kind:null,text:changed?best.text:null,attempts};
}
export async function supplementMaterials(batchSize=2,acquire=acquireMaterial) {
  if(process.env.COLLECT_ENABLED!=="true")return {skipped:"collection disabled"};
  const rows=await sql`SELECT a.id,a.revision,a.title,a.url,a.excerpt,a.body_text,a.body_status,${chineseSourceTag}=ANY(s.tags) AS review_exempt FROM articles a
    JOIN sources s ON s.id=a.source_id LEFT JOIN clinical_ai_reviews r ON r.article_id=a.id
    LEFT JOIN clinical_materials m ON m.article_id=a.id
    WHERE a.processing_state='analyzed' AND s.enabled AND (m.article_id IS NULL OR m.revision<>a.revision)
    AND (${chineseSourceTag}=ANY(s.tags) OR r.data->>'material'<>'full_text' OR jsonb_array_length(r.data->'issues')>0)
    ORDER BY length(coalesce(a.body_text,'')),a.id LIMIT ${Math.max(1,Math.min(10,Math.trunc(batchSize)))}`;
  let improved=0,next=0;
  // Live publisher timeouts dominate the backfill; two independent articles can be read concurrently.
  await Promise.all(Array.from({length:Math.min(2,rows.length)},async()=>{while(next<rows.length){
    const a=rows[next++]!;
    const got=await acquire(a as unknown as MaterialRow);
    await sql.begin(async tx=>{
      const [current]=await tx`SELECT revision FROM articles WHERE id=${a.id} FOR UPDATE`;
      if(current?.revision!==a.revision)return;
      await tx`INSERT INTO clinical_materials(article_id,revision,status,source_url,kind,body_text,content_hash,attempts)
        VALUES(${a.id},${a.revision},${got.status},${got.url},${got.kind},${got.text},${got.text?sha256(got.text):null},${tx.json(got.attempts)})
        ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,source_url=excluded.source_url,kind=excluded.kind,body_text=excluded.body_text,content_hash=excluded.content_hash,attempts=excluded.attempts,fetched_at=now()`;
      await tx`INSERT INTO clinical_events(article_id,kind,data) VALUES(${a.id},'material',${tx.json({revision:a.revision,message:got.status==="ready"?(a.review_exempt?"已补充可访问的原文材料，等待重新摘录；中文信源无需AI确认复核。":"已补充可访问的原文材料，等待重新摘录与AI复核。"):"本轮未取得更完整的可访问材料，保留原文链接。",status:got.status,url:got.url,format:got.kind,chars:got.text?.length??0})})`;
      if(got.status==="ready")improved++;
    });
  }}));
  return {checked:rows.length,improved};
}
