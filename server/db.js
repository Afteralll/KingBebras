import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.KB_DB_PATH
  ? path.resolve(process.env.KB_DB_PATH)
  : path.join(process.cwd(), 'server', 'data.sqlite');
const SCHEMA_PATH = path.join(process.cwd(), 'server', 'schema.sql');

export function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  const ensureColumn = (name, sql) => {
    if (!userCols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${sql}`);
  };
  ensureColumn('role', `role TEXT NOT NULL DEFAULT 'student'`);
  ensureColumn('approved', 'approved INTEGER NOT NULL DEFAULT 1');
  ensureColumn('created_by_teacher_id', 'created_by_teacher_id INTEGER');
  ensureColumn('display_name', 'display_name TEXT');

  const attemptTaskCols = db.prepare(`PRAGMA table_info(attempt_tasks)`).all().map((c) => c.name);
  const ensureAttemptTaskColumn = (name, sql) => {
    if (!attemptTaskCols.includes(name)) db.exec(`ALTER TABLE attempt_tasks ADD COLUMN ${sql}`);
  };
  ensureAttemptTaskColumn('breakdown_json', 'breakdown_json TEXT');
  ensureAttemptTaskColumn('game_payload_json', 'game_payload_json TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS student_credentials (
      student_user_id INTEGER PRIMARY KEY,
      teacher_user_id INTEGER NOT NULL,
      password_plain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  return db;
}

