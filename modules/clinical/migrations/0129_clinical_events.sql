CREATE TABLE IF NOT EXISTS clinical_events (
  id bigserial PRIMARY KEY, article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
