// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - an article page cannot tell which of its tags are a topic's own, so they link to filtered lists;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const CHINESE_NURSING = "journal-chinese-nursing";
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01'),
    (${CHINESE_NURSING}, '中华护理杂志', 'web_list', 'T1', 'editorial', true, '2100-01-01')
    ON CONFLICT (id) DO NOTHING`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "research"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "medical-ai" ? "医疗AI" : r.category === "guideline" ? "指南/共识" : r.category === "safety" ? "药械安全" : "临床研究", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `NEJM 发布临床研究 ${T}`, subjects: ["nejm"] });
  const product = await report({ at: hoursAgo(31), title: `New England Journal of Medicine 刊发研究 ${T}`, subjects: ["nejm"] });
  const english = await report({ at: hoursAgo(32), title: `临床研究发布 ${T}`, originalTitle: `NEJM publishes a clinical study ${T}`, subjects: ["nejm", "jama"] });
  const subpoena = await report({ at: hoursAgo(33), title: `JAMA 发布研究更正 ${T}`, subjects: ["jama", "nejm", "bmj"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `jama 公布研究规范 ${T}`, subjects: ["jama", "nejm"] });
  const pact = await report({ at: hoursAgo(35), title: `多家医学期刊签署研究协议 ${T}`, subjects: ["jama", "nejm", "bmj"] });
  const networked = await report({ at: hoursAgo(36), title: `JAMA Network 标准发布 ${T}`, subjects: ["jama", "nejm"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布JAMA的新研究 ${T}`, subjects: ["jama", "nejm"] });
  const headline = await report({ at: hoursAgo(38), title: `NEJM 被一篇盘点提到 ${T}`, subjects: ["bmj"] });
  const safety = await report({ at: hoursAgo(39), title: `患者安全框架发布 ${T}`, tags: ["患者安全"] });

  const nejm = await members("nejm");
  for (const id of [about, product, english]) assert.ok(nejm.includes(id), "about NEJM");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!nejm.includes(id), "only mentions NEJM");
  const jama = await members("jama");
  for (const id of [subpoena, lowerCase, networked, adjacent]) assert.ok(jama.includes(id), "about JAMA");
  for (const id of [english, pact]) assert.ok(!jama.includes(id), "only mentions JAMA");
  assert.ok((await members("patient-safety")).includes(safety), "a clinical field takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["nejm", "clinical-research"]);
  assert.deepEqual(await topicsOf(subpoena), ["jama", "clinical-research"]);
  assert.deepEqual(await topicsOf(pact), ["clinical-research"]);
  assert.deepEqual(await topicsOf(safety), ["patient-safety", "clinical-research"]);
});

test("an institution or journal topic takes reports from its configured source", async () => {
  const own = await report({ source: CHINESE_NURSING, at: hoursAgo(2), title: `护理研究发布 ${T}` });
  const mention = await report({ source: MEDIA, at: hoursAgo(1), title: `中华护理杂志被提及 ${T}` });
  const nursing = await members("chinese-nursing-journal");
  assert.ok(nursing.includes(own), "the journal's own report belongs to its topic without an entity tag");
  assert.ok(!nursing.includes(mention), "a title mention from another source is not enough for a source-only topic");

  const res = await app.inject({ method: "GET", url: `/api/site/items/${own}` });
  const body = JSON.parse(res.body) as { topics: Array<{ slug: string }> };
  assert.deepEqual(body.topics.map((t) => t.slug), ["chinese-nursing-journal", "clinical-research"]);
});

test("an article page says which of its tags are a topic's own", async () => {
  // A direction's or a form's tags, and the tag cards show for a company (its subject tag is never shown).
  const id = await report({ at: hoursAgo(3), title: `NEJM 发布患者安全研究 ${T}`, subjects: ["nejm", "jama"], tags: ["患者安全", "NEJM", "JAMA"] });
  const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
  const body = JSON.parse(res.body) as { tags: string[]; tagTopics: Record<string, string>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.tags, ["临床研究", "患者安全", "NEJM", "JAMA"]);
  assert.deepEqual(body.tagTopics, { "临床研究": "clinical-research", "患者安全": "patient-safety", NEJM: "nejm", JAMA: "jama" });
  // The company its title does not name is a topic of the tag, not of the article.
  assert.deepEqual(body.topics.map((t) => t.slug), ["nejm", "patient-safety", "clinical-research"]);
});

test("renaming a company topic keeps its old full name usable for search", async () => {
  const id = await report({at: hoursAgo(2), title: `JAMA Network 更新 ${T}`, subjects: ['jama'], selected: false});
  for (const query of ['JAMA Network', 'JAMA']) {
    const res = await app.inject({method: 'GET', url: `/api/site/pool?q=${encodeURIComponent(query)}`});
    assert.equal(res.statusCode, 200);
    assert.ok(ids(JSON.parse(res.body).items).includes(id), 'full company names must still find subject-tagged reports');
  }
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`患者安全研究发布 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `患者安全研究发布 ${T}`, tags: ["患者安全"], fact: await fact(launch.id, "发布研究") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "patient-safety", name: "患者安全" }, { slug: "clinical-research", name: "临床研究" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `EMA 发布监管更新 ${T}`, subjects: ["ema"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `EMA 撤回的消息 ${T}`, subjects: ["ema"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("ema");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "ema")!;
  assert.equal(summary.latest?.title, `EMA 发布监管更新 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("cardiovascular");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("cardiovascular", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
