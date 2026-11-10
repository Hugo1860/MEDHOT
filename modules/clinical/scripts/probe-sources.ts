// Read-only source inspection; no DB or model calls.
import { load } from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
function failure(error: unknown): { message: string; cause?: ReturnType<typeof failure> } {
  return error instanceof Error ? { message: error.message, ...(error.cause ? { cause: failure(error.cause) } : {}) } : { message: String(error) };
}
const urls = process.argv.slice(2);
await Promise.all(urls.map(async url => {
  try {
    // Use the collector's identity and address guard: CDE returns a page to a generic browser UA,
    // but rejects our named crawler with a malformed 403 response. A browser probe is not acceptance.
    const r = await guardedFetch(url, { timeoutMs: 20000, maxBytes: 2 * 1024 * 1024 });
    const text = r.text(); const $ = load(text);
    console.log(JSON.stringify({ url, status:r.status, bytes:text.length, title:$("title").text(), links: $("a[href]").toArray().map(a => ({text:$(a).text().trim().slice(0,100),href:$(a).attr("href"),parent:$(a).parent().attr("class"),date:$(a).parent().text().trim().slice(-120)})).filter(x => x.text.length>18).slice(0,10), rss:text.includes("<rss") }));
  } catch(e) { console.log(JSON.stringify({url,error:failure(e)})); }
}));
