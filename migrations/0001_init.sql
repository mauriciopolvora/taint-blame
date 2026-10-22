CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  cwd TEXT,
  started_at INTEGER NOT NULL
);

CREATE TABLE context_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  trust TEXT NOT NULL CHECK (trust IN ('trusted', 'semi', 'untrusted')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX context_events_session_ts ON context_events(session_id, ts);

CREATE TABLE write_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  ts INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  old_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  context_ids TEXT NOT NULL, -- JSON array of context_events.id seen before this write
  verdict TEXT,              -- green | amber | red, null until attributed
  attributed_at INTEGER
);
CREATE INDEX write_events_session_ts ON write_events(session_id, ts);

CREATE TABLE attributions (
  write_id TEXT NOT NULL REFERENCES write_events(id),
  context_id TEXT NOT NULL REFERENCES context_events(id),
  method TEXT NOT NULL CHECK (method IN ('overlap', 'llm')),
  confidence REAL NOT NULL,
  reason TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('green', 'amber', 'red')),
  PRIMARY KEY (write_id, context_id, method)
);
