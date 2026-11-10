CREATE TABLE IF NOT EXISTS clinical_local_checks (
  id bigserial PRIMARY KEY, article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, kind text NOT NULL, result text NOT NULL, evidence_url text NOT NULL,
  note text NOT NULL, owner text NOT NULL, actor text NOT NULL, checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
