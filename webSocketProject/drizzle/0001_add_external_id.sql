ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "external_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "matches_external_id_unique" ON "matches" ("external_id");
