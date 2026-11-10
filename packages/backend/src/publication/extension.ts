// Modules read the current public projection here, including old articles linked by a saved report.
import { sql } from "../db.ts";
import { listedCondition, storyReportCondition } from "./scope.ts";
export async function extensionItems(filter: { ids?: string[]; since?: Date; until?: Date } = {}) {
  return sql`SELECT p.article_id AS id, p.title, p.summary, p.category, p.tags, p.score, p.selected,
    p.url, p.published_at, p.timeline_at, p.source_id, s.name AS source, a.revision
    FROM publications p JOIN sources s ON s.id=p.source_id JOIN articles a ON a.id=p.article_id
    WHERE ${filter.ids ? storyReportCondition(new Date()) : listedCondition(new Date())}
    ${filter.ids ? sql`AND p.article_id IN ${sql(filter.ids.length ? filter.ids : [""])}` : sql``}
    ${filter.since ? sql`AND p.timeline_at >= ${filter.since}` : sql``}
    ${filter.until ? sql`AND p.timeline_at < ${filter.until}` : sql``}
    ORDER BY p.timeline_at DESC, p.article_id DESC`;
}
