-- Historical baseline from migration 01a1f8f5-176e-7d86-b344-a67b36579a38.
-- Apply only to a new site. These tables already exist on the A verification site.
CREATE TABLE app.d5_generation_runs (
  user_hash TEXT NOT NULL, run_id TEXT NOT NULL, request_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_hash, run_id)
);
CREATE TABLE app.d5_generation_slots (
  user_hash TEXT NOT NULL, run_id TEXT NOT NULL, slot TEXT NOT NULL, event TEXT NOT NULL,
  session_id TEXT, meta TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_hash, run_id, slot, event)
);
CREATE TABLE app.d5_generation_results (
  user_hash TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_hash, run_id, kind)
);
