ALTER TABLE clinical_cards ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
