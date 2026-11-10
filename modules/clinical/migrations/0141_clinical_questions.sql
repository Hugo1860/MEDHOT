CREATE TABLE IF NOT EXISTS clinical_questions (
  id bigserial PRIMARY KEY, label text NOT NULL, query jsonb NOT NULL, owner text NOT NULL,
  fingerprint text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '待复核',
  active boolean NOT NULL DEFAULT true, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
