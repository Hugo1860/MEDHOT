CREATE TABLE IF NOT EXISTS clinical_editions (
  id bigserial PRIMARY KEY, week text NOT NULL, specialty text NOT NULL,
  version integer NOT NULL, state text NOT NULL, article_ids text[] NOT NULL,
  data jsonb NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(week, specialty, version)
);
