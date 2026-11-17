-- D1 契约基线 · 八表初版 DDL
-- 目标：按 run_id + seq 可还原一次推演；ugc_reports.is_training 固定为 1。
-- 方言：SQLite 兼容写法（TEXT / INTEGER / REAL / JSON 文本）。
-- D2 核对 Qoder Sites 实际数据库方言与迁移限制后冻结；此前允许等价类型调整。
--
-- 路网节点口径（v4.1）：Junction（校门/路口）是静态路网节点，不计入 20 栋。
-- 为保持八表基线，本版不单列 junction 表；road_segments 端点保存楼栋或路口 id，
-- 由应用层按 fixtures/junctions 校验。D2 若需数据库级外键，再与 B 共同确认增量迁移。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campus_buildings (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  zone            TEXT NOT NULL,              -- 真实苑/园分区
  category        TEXT NOT NULL,
  floors          INTEGER CHECK (floors IS NULL OR floors > 0), -- NULL = 大跨度通高/未公开
  capacity        INTEGER NOT NULL CHECK (capacity >= 0),
  risk_tag        TEXT,
  polygon_json    TEXT NOT NULL,              -- Point[]
  adjacency_json  TEXT NOT NULL,              -- BuildingId[]，不含路口
  is_training     INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS road_segments (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  from_node_id      TEXT NOT NULL,             -- Building.id 或 Junction.id
  to_node_id        TEXT NOT NULL,             -- Building.id 或 Junction.id
  geometry_json     TEXT NOT NULL,             -- Point[]
  blocked           INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  hazard            TEXT CHECK (hazard IN ('flood', 'fire', 'debris') OR hazard IS NULL),
  block_reason      TEXT,
  is_training       INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1),
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_node_id <> to_node_id)
);

CREATE TABLE IF NOT EXISTS disaster_templates (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  modifiers_json        TEXT NOT NULL,         -- ScenarioModifiers
  start_building_id     TEXT NOT NULL REFERENCES campus_buildings(id),
  standard_actions_json TEXT NOT NULL,         -- StandardActionItem[]
  critical_items_json   TEXT NOT NULL,         -- StandardActionItem[]
  is_training           INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  target_kind       TEXT NOT NULL CHECK (target_kind IN ('building', 'road')),
  critical          INTEGER NOT NULL CHECK (critical IN (0, 1)),
  weight            REAL NOT NULL CHECK (weight >= 0),
  duration_sim      REAL NOT NULL CHECK (duration_sim >= 0),
  resource_id       TEXT NOT NULL,
  resource_units    INTEGER NOT NULL DEFAULT 1 CHECK (resource_units > 0),
  preconditions_json TEXT NOT NULL,            -- ActionPrecondition[]
  is_training       INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id                    TEXT PRIMARY KEY,
  template_id           TEXT NOT NULL REFERENCES disaster_templates(id),
  source                TEXT NOT NULL CHECK (source IN ('generated', 'fallback', 'canonical')),
  title                 TEXT NOT NULL,
  modifiers_json        TEXT NOT NULL,
  start_building_id     TEXT NOT NULL REFERENCES campus_buildings(id),
  t_end                 REAL NOT NULL CHECK (t_end >= 0),
  nodes_json            TEXT NOT NULL,         -- ScenarioNode[]
  standard_actions_json TEXT NOT NULL,
  critical_items_json   TEXT NOT NULL,
  is_training           INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,            -- run_id
  scenario_id     TEXT NOT NULL REFERENCES scenarios(id),
  branch          TEXT NOT NULL,
  playback_speed  REAL NOT NULL DEFAULT 1 CHECK (playback_speed > 0),
  started_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at        TEXT,
  total_score     INTEGER CHECK (total_score BETWEEN 0 AND 100),
  discrimination  REAL CHECK (discrimination BETWEEN 0 AND 100),
  response        REAL CHECK (response BETWEEN 0 AND 100),
  coverage        REAL CHECK (coverage BETWEEN 0 AND 100),
  violation       REAL CHECK (violation BETWEEN 0 AND 100),
  score_json      TEXT,                         -- ScoreResult，含明细与排序结果
  is_training     INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1)
);

CREATE TABLE IF NOT EXISTS run_events (
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL CHECK (seq > 0),
  t_sim         REAL NOT NULL CHECK (t_sim >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('verdict', 'action', 'sort')),
  payload_json  TEXT NOT NULL,                 -- VerdictAttempt | ActionAttempt | SortSubmission
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS ugc_reports (
  id                    TEXT PRIMARY KEY,
  scenario_id           TEXT NOT NULL REFERENCES scenarios(id),
  appears_at_sim        REAL NOT NULL CHECK (appears_at_sim >= 0),
  category              TEXT NOT NULL,
  text                  TEXT NOT NULL,
  event_truth_json      TEXT NOT NULL,          -- EventTruth
  judgment_windows_json TEXT NOT NULL,          -- JudgmentWindow[]
  priority              INTEGER NOT NULL CHECK (priority >= 1),
  is_training           INTEGER NOT NULL DEFAULT 1 CHECK (is_training = 1),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scenario_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_road_segments_from ON road_segments(from_node_id);
CREATE INDEX IF NOT EXISTS idx_road_segments_to ON road_segments(to_node_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_template ON scenarios(template_id);
CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_time ON run_events(run_id, t_sim);
CREATE INDEX IF NOT EXISTS idx_ugc_reports_scenario_time ON ugc_reports(scenario_id, appears_at_sim);
