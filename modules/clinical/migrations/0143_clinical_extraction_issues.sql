CREATE TABLE IF NOT EXISTS clinical_extraction_issues (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE, revision integer NOT NULL,
  input_hash text NOT NULL, receipt_id bigint REFERENCES receipts(id), reason text NOT NULL,
  resolved boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
