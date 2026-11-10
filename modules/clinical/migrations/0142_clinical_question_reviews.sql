CREATE TABLE IF NOT EXISTS clinical_question_reviews (
  id bigserial PRIMARY KEY, question_id bigint NOT NULL REFERENCES clinical_questions(id) ON DELETE CASCADE,
  fingerprint text NOT NULL, article_ids text[] NOT NULL, data jsonb NOT NULL,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
