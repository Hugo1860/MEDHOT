CREATE TABLE IF NOT EXISTS clinical_reviewers (
  user_id bigint PRIMARY KEY REFERENCES admin_users(id), name text NOT NULL, institution text NOT NULL,
  specialties text[] NOT NULL, evidence_url text NOT NULL, note text NOT NULL,
  verified_by text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true
);
