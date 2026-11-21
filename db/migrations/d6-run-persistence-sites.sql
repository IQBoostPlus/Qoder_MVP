-- Sites variant: the migration API accepts only CREATE TABLE, ADD COLUMN and
-- plain CREATE INDEX. Custom functions and RPC are unavailable, so the
-- Function commits a run through one conditional write on app.runs and uses
-- d6_event_seq as the committed-event boundary.
ALTER TABLE app.scenarios ADD COLUMN d6_bundle_json jsonb;
ALTER TABLE app.runs ADD COLUMN d6_revision integer;
ALTER TABLE app.runs ADD COLUMN d6_progress_json jsonb;
ALTER TABLE app.runs ADD COLUMN d6_origin_json jsonb;
ALTER TABLE app.runs ADD COLUMN d6_owner_hash text;
ALTER TABLE app.runs ADD COLUMN d6_created_at timestamptz;
ALTER TABLE app.runs ADD COLUMN d6_updated_at timestamptz;
ALTER TABLE app.runs ADD COLUMN d6_event_seq integer;
