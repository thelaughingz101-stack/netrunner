// Append-only. Never edit a migration that has shipped; add a new one.
export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE config (
    version    INTEGER PRIMARY KEY AUTOINCREMENT,
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    trigger     TEXT NOT NULL,             -- schedule | manual | api | cli
    kind        TEXT NOT NULL,             -- digest | prompt | rollup
    mode        TEXT,                      -- morning | nightly | weekly | monthly | manual-<platform>
    lookback    TEXT,
    dry_run     INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL,             -- running | ok | error | skipped
    llm_tier    TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    stats_json  TEXT,
    error       TEXT
  );
  CREATE INDEX runs_started ON runs(started_at DESC);

  CREATE TABLE feed_results (
    run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    feed_name  TEXT NOT NULL,
    url        TEXT NOT NULL,
    status     TEXT NOT NULL,              -- ok | empty | error
    item_count INTEGER NOT NULL DEFAULT 0,
    error      TEXT
  );
  CREATE INDEX feed_results_run ON feed_results(run_id);

  CREATE TABLE run_items (
    run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    item_id   TEXT NOT NULL,
    source    TEXT,
    category  TEXT,
    title     TEXT,
    link      TEXT,
    published TEXT,
    placement TEXT,                        -- section | excluded | missing | recovered
    PRIMARY KEY (run_id, item_id)
  );

  CREATE TABLE digests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT REFERENCES runs(id) ON DELETE SET NULL,
    date       TEXT NOT NULL,              -- YYYY-MM-DD in the configured timezone
    mode       TEXT NOT NULL,
    content    TEXT NOT NULL,
    dry_run    INTEGER NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'run', -- run | import | upload
    extra_json TEXT,                        -- manual-mode parts (howToUse, systemInstructions, userRequest)
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX digests_date ON digests(date DESC, mode);

  CREATE TABLE stories (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );
  CREATE TABLE story_days (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    PRIMARY KEY (story_id, day)
  );

  CREATE TABLE deliveries (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    status TEXT NOT NULL,                   -- sent | skipped | dry-run | error
    detail TEXT,
    at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  /* 2 */ `
  -- One run at a time across processes (the app and Windows Task Scheduler's headless CLI runs).
  CREATE TABLE run_lock (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    label      TEXT NOT NULL,
    pid        INTEGER NOT NULL,
    started_at TEXT NOT NULL
  );
  `,
];
