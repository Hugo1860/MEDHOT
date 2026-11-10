CREATE TABLE IF NOT EXISTS clinical_registrations (
  id bigserial PRIMARY KEY, article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, registry_id text NOT NULL, data jsonb NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
