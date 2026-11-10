// Share images only need public title/summary metadata. Keep the same page visibility rule without
// loading bodies, translations, related stories or signed media that never appear on these cards.
import { CATEGORY_LABELS, type CategoryKey } from '@aihot/contracts/taxonomy';
import { beijingDate } from '@aihot/contracts/time';
import { ITEM_COPY, withSubject } from '@aihot/site';
import type { OgCard } from '../media/og.ts';
import { sql } from '../db.ts';
import { hasItemPage, publicSourceName } from './rules.ts';

export async function loadItemShare(id: string) {
  const [row] = await sql<{
    id: string; title: string; original_title: string | null; summary: string | null; category: CategoryKey | null; selected: boolean;
    score: number | null; published_at: Date | null; timeline_at: Date; source_name: string; source_mode: string; visibility: string;
  }[]>`SELECT p.article_id AS id, p.title, p.original_title, p.summary, p.category, p.selected, p.score, p.published_at, p.timeline_at,
      s.name AS source_name, s.participation_mode AS source_mode, p.visibility
    FROM publications p JOIN sources s ON s.id = p.source_id WHERE p.article_id = ${id}`;
  if (!row || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return null;
  const summaryOnly = row.visibility === 'summary-only';
  return { id: row.id, title: row.title, originalTitle: row.original_title, summary: row.summary, category: summaryOnly ? null : row.category, selected: !summaryOnly && row.selected,
    score: summaryOnly || row.score === null ? null : Math.round(Number(row.score)), timelineAt: row.timeline_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    source: { name: publicSourceName(row.source_name) } };
}

/** The article card used by both HTTP responses and preparation before publishing a link. */
export async function loadItemOgCard(id: string): Promise<OgCard | null> {
  const item = await loadItemShare(id);
  if (!item) return null;
  return {
    kicker: item.category ? CATEGORY_LABELS[item.category] : withSubject('动态'),
    title: item.title,
    subtitle: item.summary,
    meta: `${item.source.name} · ${beijingDate(item.timelineAt)}`,
    badge: item.selected && item.score !== null && ITEM_COPY.showScore ? { value: String(Math.round(item.score)), label: '精选评分' } : null,
  };
}
