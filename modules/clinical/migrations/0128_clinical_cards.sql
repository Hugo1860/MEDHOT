CREATE TABLE IF NOT EXISTS clinical_cards (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, input_hash text NOT NULL, data jsonb NOT NULL,
  receipt_id bigint REFERENCES receipts(id), generated_at timestamptz NOT NULL DEFAULT now()
);
