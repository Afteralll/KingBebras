import crypto from 'node:crypto';
import fs from 'node:fs';

import { TASKS } from './tasks.js';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function tierConfig(tier) {
  if (tier === 'strong') return { errorMin: 0, errorMax: 2, timeMin: 38, timeMax: 95, clickMin: 12, clickMax: 38, failRate: 0.08 };
  if (tier === 'average') return { errorMin: 2, errorMax: 5, timeMin: 70, timeMax: 145, clickMin: 22, clickMax: 58, failRate: 0.22 };
  return { errorMin: 4, errorMax: 9, timeMin: 95, timeMax: 210, clickMin: 30, clickMax: 78, failRate: 0.38 };
}

function buildGamePayload(taskId, tier, taskIndex, rng) {
  const cfg = tierConfig(tier);
  const jitter = () => randBetween(rng, -0.35, 0.35);
  const errors = Math.max(0, Math.round(randBetween(rng, cfg.errorMin, cfg.errorMax) + jitter() * 2));
  const seconds = round1(randBetween(rng, cfg.timeMin, cfg.timeMax) + taskIndex * 2.5);
  const clicks = Math.round(randBetween(rng, cfg.clickMin, cfg.clickMax) + taskIndex);
  const solved = rng() > cfg.failRate ? 1 : 0;
  const giveUp = tier === 'developing' && rng() < 0.04 ? 1 : 0;

  if (taskId === 'remembering-faces-2') {
    const totalErrors = solved ? Math.min(errors, 2) : Math.max(3, errors + 2);
    return {
      correctness: solved,
      giveUpFlag: giveUp,
      resetCount: Math.round(randBetween(rng, 0, tier === 'strong' ? 1 : 3)),
      totalErrors,
      seconds,
      clicks
    };
  }
  if (taskId === 'tug-of-war-2') {
    return {
      errorScore: solved ? Math.abs(Math.round(randBetween(rng, 0, 1))) : Math.round(randBetween(rng, 2, 5)),
      timeScore: seconds,
      clicks,
      giveUpFlag: giveUp
    };
  }
  if (taskId === 'planes' || taskId === 'golden-ticket') {
    return {
      errorScore: errors,
      timeScore: seconds,
      clickScore: clicks,
      correctnessFlag: solved,
      giveUpFlag: giveUp,
      resetCounter: Math.round(randBetween(rng, 0, tier === 'strong' ? 1 : 3))
    };
  }
  if (taskId === 'cube-game-1') {
    return {
      errorScore: errors,
      timeScore: seconds,
      clickScore: round1(randBetween(rng, 6, 10)),
      dragScore: round1(randBetween(rng, 6, solved ? 9.5 : 5)),
      clicks
    };
  }
  if (taskId === 'burger-recipe-2') {
    return { errorScore: errors, timeScore: seconds, correctnessFlag: solved, clicks, giveUpFlag: giveUp };
  }
  return {
    errorScore: errors,
    timeScore: seconds,
    correctnessFlag: solved,
    clicks,
    giveUpFlag: giveUp,
    totalScore: round1(Math.max(1, 10 - errors * 0.55 - seconds / 120))
  };
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function sqlJsonText(obj) {
  return `'${esc(JSON.stringify(obj))}'`;
}

const TEACHER = { username: 'youssef', password: 'youssef1234', displayName: 'Youssef Hassan' };
const STUDENTS = [
  { username: 'youssef_maria', password: 'maria2026', displayName: 'Maria K.', tier: 'strong' },
  { username: 'youssef_omar', password: 'omar2026', displayName: 'Omar S.', tier: 'average' },
  { username: 'youssef_layla', password: 'layla2026', displayName: 'Layla M.', tier: 'developing' }
];

const lines = [];
lines.push('-- KingBebras demo: teacher youssef + 3 students with completed exams');
lines.push('-- Run in Neon: SQL Editor → paste all → Run');
lines.push('BEGIN;');
lines.push(
  `DELETE FROM student_credentials WHERE teacher_user_id IN (SELECT id FROM users WHERE username = '${TEACHER.username}');`
);
lines.push(
  `DELETE FROM users WHERE created_by_teacher_id IN (SELECT id FROM users WHERE username = '${TEACHER.username}');`
);
lines.push(`DELETE FROM users WHERE username = '${TEACHER.username}';`);

const th = sha256(`${TEACHER.username}\n${TEACHER.password}`);
lines.push(
  `INSERT INTO users (username, password_hash, role, approved, display_name) VALUES ('${TEACHER.username}', '${th}', 'teacher', 1, '${esc(TEACHER.displayName)}');`
);

const baseStart = Date.now() - 3 * 24 * 60 * 60 * 1000;

for (const spec of STUDENTS) {
  const sh = sha256(`${spec.username}\n${spec.password}`);
  lines.push(
    `INSERT INTO users (username, password_hash, role, approved, created_by_teacher_id, display_name) VALUES ('${spec.username}', '${sh}', 'student', 1, (SELECT id FROM users WHERE username='${TEACHER.username}'), '${esc(spec.displayName)}');`
  );
  lines.push(
    `INSERT INTO student_credentials (student_user_id, teacher_user_id, password_plain) VALUES ((SELECT id FROM users WHERE username='${spec.username}'), (SELECT id FROM users WHERE username='${TEACHER.username}'), '${spec.password}');`
  );
}

for (const spec of STUDENTS) {
  const attemptId = crypto.randomBytes(16).toString('hex');
  const seed = Math.floor(Math.random() * 1e9);
  const rng = mulberry32([...spec.username].reduce((a, c) => a + c.charCodeAt(0), 0) + 17);
  let cursor = baseStart + spec.username.length * 600_000 + 120_000;
  let examEnd = cursor;

  lines.push(
    `INSERT INTO attempts (id, user_id, seed, started_at) VALUES ('${attemptId}', (SELECT id FROM users WHERE username='${spec.username}'), ${seed}, to_timestamp(${cursor / 1000}));`
  );

  for (let idx = 0; idx < TASKS.length; idx++) {
    const task = TASKS[idx];
    const dur = Math.round(randBetween(rng, 4.5, 11) * 60 * 1000);
    const start = cursor;
    const end = cursor + dur;
    cursor = end + Math.round(randBetween(rng, 0.4, 2.5) * 60 * 1000);
    examEnd = end;

    const payload = buildGamePayload(task.id, spec.tier, idx, rng);
    const breakdown = { normalized: {}, extra: {}, raw: payload };

    lines.push(
      `INSERT INTO attempt_tasks (attempt_id, task_id, task_index, started_at, finished_at, breakdown_json, game_payload_json) VALUES ('${attemptId}', '${task.id}', ${idx}, to_timestamp(${start / 1000}), to_timestamp(${end / 1000}), ${sqlJsonText(breakdown)}, ${sqlJsonText(payload)});`
    );
  }

  lines.push(`UPDATE attempts SET finished_at = to_timestamp(${examEnd / 1000}) WHERE id = '${attemptId}';`);
}

lines.push('COMMIT;');
lines.push('');
lines.push('-- Logins:');
lines.push('--   Teacher: youssef / youssef1234');
lines.push('--   Maria:   youssef_maria / maria2026');
lines.push('--   Omar:    youssef_omar / omar2026');
lines.push('--   Layla:   youssef_layla / layla2026');

const outPath = new URL('./seed-youssef-neon.sql', import.meta.url);
fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outPath.pathname} (${lines.length} lines)`);
