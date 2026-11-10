CREATE TABLE IF NOT EXISTS clinical_ai_reviews (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, card_generated_at timestamptz NOT NULL, input_hash text NOT NULL,
  prompt_version text NOT NULL, status text NOT NULL, data jsonb,
  receipt_id bigint REFERENCES receipts(id), error text,
  retry_requested boolean NOT NULL DEFAULT false, checked_at timestamptz NOT NULL DEFAULT now()
);
