-- Qoder Sites 业务八表候选迁移（目标 app schema，使用受限 DDL）。
-- 在已配置数据库、尚无业务八表的站点校验后应用；D1 临时验证表独立保留。
-- 楼栋或校门的混合端点由应用按 d2-1 地图校验。
-- 可含小数的字段使用 JSONB 数值；值域与训练标记由 Function 校验。

CREATE TABLE app.campus_buildings (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  zone            TEXT NOT NULL,              -- 真实苑/园分区
  category        TEXT NOT NULL,
  floors          INTEGER, -- NULL = 大跨度通高/未公开
  capacity        INTEGER NOT NULL,
  risk_tag        TEXT,
  polygon_json    JSONB NOT NULL,              -- Point[]
  adjacency_json  JSONB NOT NULL,              -- BuildingId[]，不含路口
  is_training     INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.road_segments (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  from_node_id      TEXT NOT NULL,             -- Building.id 或 Junction.id
  to_node_id        TEXT NOT NULL,             -- Building.id 或 Junction.id
  geometry_json     JSONB NOT NULL,             -- Point[]
  blocked           INTEGER NOT NULL DEFAULT 0,
  hazard            TEXT,
  block_reason      TEXT,
  is_training       INTEGER NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.disaster_templates (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  modifiers_json        JSONB NOT NULL,         -- ScenarioModifiers
  start_building_id     TEXT NOT NULL REFERENCES app.campus_buildings(id),
  standard_actions_json JSONB NOT NULL,         -- StandardActionItem[]
  critical_items_json   JSONB NOT NULL,         -- StandardActionItem[]
  is_training           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.action_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  target_kind       TEXT NOT NULL,
  critical          INTEGER NOT NULL,
  weight            JSONB NOT NULL,
  duration_sim      JSONB NOT NULL,
  resource_id       TEXT NOT NULL,
  resource_units    INTEGER NOT NULL DEFAULT 1,
  preconditions_json JSONB NOT NULL,            -- ActionPrecondition[]
  is_training       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE app.scenarios (
  id                    TEXT PRIMARY KEY,
  template_id           TEXT NOT NULL REFERENCES app.disaster_templates(id),
  source                TEXT NOT NULL,
  title                 TEXT NOT NULL,
  modifiers_json        JSONB NOT NULL,
  start_building_id     TEXT NOT NULL REFERENCES app.campus_buildings(id),
  t_end                 JSONB NOT NULL,
  nodes_json            JSONB NOT NULL,         -- ScenarioNode[]
  standard_actions_json JSONB NOT NULL,
  critical_items_json   JSONB NOT NULL,
  is_training           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.runs (
  id              TEXT PRIMARY KEY,            -- run_id
  scenario_id     TEXT NOT NULL REFERENCES app.scenarios(id),
  branch          TEXT NOT NULL,
  playback_speed  JSONB NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  total_score     INTEGER,
  discrimination  JSONB,
  response        JSONB,
  coverage        JSONB,
  violation       JSONB,
  score_json      JSONB,                         -- ScoreResult，含明细与排序结果
  is_training     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE app.run_events (
  run_id        TEXT NOT NULL REFERENCES app.runs(id),
  seq           INTEGER NOT NULL,
  t_sim         JSONB NOT NULL,
  kind          TEXT NOT NULL,
  payload_json  JSONB NOT NULL,                 -- VerdictAttempt | ActionAttempt | SortSubmission
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE app.ugc_reports (
  id                    TEXT PRIMARY KEY,
  scenario_id           TEXT NOT NULL REFERENCES app.scenarios(id),
  appears_at_sim        JSONB NOT NULL,
  category              TEXT NOT NULL,
  text                  TEXT NOT NULL,
  event_truth_json      JSONB NOT NULL,          -- EventTruth
  judgment_windows_json JSONB NOT NULL,          -- JudgmentWindow[]
  priority              INTEGER NOT NULL,
  is_training           INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, priority)
);

CREATE INDEX idx_road_segments_from ON app.road_segments(from_node_id);
CREATE INDEX idx_road_segments_to ON app.road_segments(to_node_id);
CREATE INDEX idx_scenarios_template ON app.scenarios(template_id);
CREATE INDEX idx_runs_scenario ON app.runs(scenario_id);
CREATE INDEX idx_run_events_run_time ON app.run_events(run_id, t_sim);
CREATE INDEX idx_ugc_reports_scenario_time ON app.ugc_reports(scenario_id, appears_at_sim);
