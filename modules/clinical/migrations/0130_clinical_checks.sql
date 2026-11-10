CREATE TABLE IF NOT EXISTS clinical_checks (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL, data jsonb NOT NULL
);
