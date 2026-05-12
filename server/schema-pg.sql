-- Neon / PostgreSQL schema (mirrors server/schema.sql)

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  approved INTEGER NOT NULL DEFAULT 1,
  created_by_teacher_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  seed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempt_tasks (
  attempt_id TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_index INTEGER NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  final_score DOUBLE PRECISION,
  breakdown_json TEXT,
  game_payload_json TEXT,
  PRIMARY KEY (attempt_id, task_id)
);

CREATE TABLE IF NOT EXISTS moves (
  id BIGSERIAL PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  move_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id, task_id) REFERENCES attempt_tasks (attempt_id, task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_credentials (
  student_user_id BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  teacher_user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  password_plain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
