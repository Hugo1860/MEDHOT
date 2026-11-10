CREATE TABLE IF NOT EXISTS clinical_materials (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, status text NOT NULL, source_url text,
  kind text, body_text text, content_hash text, attempts jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now()
);
