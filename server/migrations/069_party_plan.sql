-- Migration: 069_party_plan
-- Project plan for running the party as an operation: what gets picked up, set
-- up, minded during the party, and packed away afterwards. The existing to-do
-- list (059) answers "who is doing what"; this answers "how many helpers do we
-- need, and when" — hence time_minutes and people_needed, which the admin view
-- sums per phase into a staffing strip.
--
-- Phases are data, not an enum, for the same reason logistics categories are
-- (068): every party invents its own steps and none of them are worth a deploy.
-- Same registry shape, same NULL-label-means-i18n-key convention, same
-- is_builtin deletion guard. 'other' is the sweep target for ON DELETE SET
-- DEFAULT so deleting a phase reparents its tasks instead of destroying work.
--
-- linked_todo_id is a soft pointer at the per-person to-do list: a plan task can
-- spawn or adopt a TODO so the person acting on it sees it in their own list.
-- ON DELETE SET NULL — deleting the TODO unlinks, it does not delete the plan
-- task, because the work still needs doing even if nobody is assigned to it.
--
-- time_minutes and people_needed are nullable: "unknown yet" is a real state
-- during planning, and NULL keeps it out of the totals rather than pretending an
-- unestimated task takes zero minutes.
--
-- Authoritative copy lives in server/config/schema.js; this file is for human
-- reference and manual psql application.

CREATE TABLE IF NOT EXISTS party_plan_phases (
  id          SERIAL      PRIMARY KEY,
  key         TEXT        NOT NULL UNIQUE,
  label       TEXT,
  icon        TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO party_plan_phases (key, label, icon, sort_order, is_builtin)
VALUES ('pickup',   NULL, '🚗', 1, TRUE),
       ('setup',    NULL, '🔨', 2, TRUE),
       ('during',   NULL, '🎉', 3, TRUE),
       ('teardown', NULL, '🧹', 4, TRUE),
       ('other',    NULL, '📦', 5, TRUE)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_party_plan_phases_sort
  ON party_plan_phases (sort_order, id);

CREATE TABLE IF NOT EXISTS party_plan_tasks (
  id             SERIAL      PRIMARY KEY,
  title          TEXT        NOT NULL,
  notes          TEXT,
  done           BOOLEAN     NOT NULL DEFAULT FALSE,
  phase          TEXT        NOT NULL DEFAULT 'other'
                             REFERENCES party_plan_phases(key)
                             ON UPDATE CASCADE ON DELETE SET DEFAULT,
  time_minutes   INTEGER     CHECK (time_minutes IS NULL OR time_minutes >= 0),
  people_needed  INTEGER     CHECK (people_needed IS NULL OR people_needed >= 0),
  assignees      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  linked_todo_id INTEGER     REFERENCES party_todos(id) ON DELETE SET NULL,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_by     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_party_plan_tasks_sort
  ON party_plan_tasks (phase, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_party_plan_tasks_linked
  ON party_plan_tasks (linked_todo_id);
