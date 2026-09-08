/*
  Cute To-Do — D1 schema

  One account, one shared board.

  The 4/4/4 shape is enforced in the Worker (SQLite cannot express "at most
  4 children" as a constraint), but the structure below is what makes the
  caps checkable: counting rows per parent.

  Comments here are block comments on purpose. The D1 dashboard console
  collapses a pasted file onto one line, and a "--" comment would then run
  to the end of that line and swallow the entire script.
*/

CREATE TABLE IF NOT EXISTS goals (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS systems (
  id         TEXT    PRIMARY KEY,
  goal_id    TEXT    NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT    PRIMARY KEY,
  system_id  TEXT    NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  dod        TEXT    NOT NULL DEFAULT '',
  done       INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_systems_goal ON systems(goal_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_system ON tasks(system_id, position);

/*
  Single-row table holding UI state that belongs to the account rather than
  to a device: which goal tab was open, which systems were expanded. This is
  what makes a phone and a laptop feel like the same app.
*/
CREATE TABLE IF NOT EXISTS prefs (
  id    TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
