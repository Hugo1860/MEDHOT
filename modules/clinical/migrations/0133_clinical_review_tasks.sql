CREATE TABLE IF NOT EXISTS clinical_review_tasks (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  revision integer NOT NULL, state text NOT NULL DEFAULT '待分配', assignee text NOT NULL DEFAULT '',
  due_at timestamptz, reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
