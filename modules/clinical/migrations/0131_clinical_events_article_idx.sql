CREATE INDEX CONCURRENTLY IF NOT EXISTS clinical_events_article_idx ON clinical_events(article_id, id DESC);
