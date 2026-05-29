CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  week_end   TEXT NOT NULL,
  category   TEXT NOT NULL,
  label      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📌',
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_week_start ON summaries(week_start);
CREATE INDEX IF NOT EXISTS idx_category ON summaries(category);
