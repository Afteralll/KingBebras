PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  approved INTEGER NOT NULL DEFAULT 1,
  created_by_teacher_id INTEGER,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by_teacher_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  seed INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_tasks (
  attempt_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  final_score REAL,
  breakdown_json TEXT,
  game_payload_json TEXT,
  PRIMARY KEY (attempt_id, task_id),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  move_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  penalty REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id, task_id) REFERENCES attempt_tasks(attempt_id, task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_credentials (
  student_user_id INTEGER PRIMARY KEY,
  teacher_user_id INTEGER NOT NULL,
  password_plain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE
);

