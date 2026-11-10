CREATE TABLE IF NOT EXISTS clinical_candidates (
  id bigserial PRIMARY KEY, article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  related_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE, revision integer NOT NULL,
  related_revision integer NOT NULL, relation text NOT NULL, basis text NOT NULL,
  state text NOT NULL DEFAULT '待核查', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(article_id, related_id, revision, related_revision)
);
