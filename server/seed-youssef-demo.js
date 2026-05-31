/**
 * Seeds demo data: teacher "youssef" + 3 students with completed exams and believable scores.
 *
 * Usage:
 *   npm run seed:youssef
 *
 * Neon (production):
 *   set DATABASE_URL=postgresql://...   (PowerShell: $env:DATABASE_URL="...")
 *   npm run seed:youssef
 */
import crypto from 'node:crypto';

import { TASKS } from './tasks.js';
import { initDatabase, poolEnd, qGet, qRun } from './database.js';

const TEACHER = {
  username: 'youssef',
  password: 'youssef1234',
  displayName: 'Youssef Hassan'
};

const STUDENTS = [
  {
    username: 'youssef_maria',
    password: 'maria2026',
    displayName: 'Maria K.',
    tier: 'strong'
  },
  {
    username: 'youssef_omar',
    password: 'omar2026',
    displayName: 'Omar S.',
    tier: 'average'
  },
  {
    username: 'youssef_layla',
    password: 'layla2026',
    displayName: 'Layla M.',
    tier: 'developing'
  }
];

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function toNumberOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Same shape as server/index.js normalizeMonitoringFromFinishPayload */
function normalizeMonitoringFromFinishPayload(gamePayload) {
  const raw = gamePayload && typeof gamePayload === 'object' ? gamePayload : {};
  const norm = {};

  const timeSec =
    toNumberOrNull(raw.time) ??
    toNumberOrNull(raw.seconds) ??
    toNumberOrNull(raw.elapsedSec) ??
    toNumberOrNull(raw.timeElapsed) ??
    toNumberOrNull(raw.totalTime) ??
    toNumberOrNull(raw.timeScore);
  if (timeSec != null) norm.timeSec = timeSec;

  const clicks =
    toNumberOrNull(raw.clicks) ??
    toNumberOrNull(raw.totalClicks) ??
    toNumberOrNull(raw.clickScore) ??
    toNumberOrNull(raw.clickCount);
  if (clicks != null) norm.clicks = clicks;

  const resets =
    toNumberOrNull(raw.resets) ??
    toNumberOrNull(raw.resetCount) ??
    toNumberOrNull(raw.resetCounter) ??
    toNumberOrNull(raw.resetCounterValue);
  if (resets != null) norm.resets = resets;

  const giveUpRaw = raw.giveUpFlag ?? raw.giveUp;
  if (giveUpRaw != null) {
    const g = toNumberOrNull(giveUpRaw);
    norm.giveUpFlag = g != null ? (g !== 0 ? 1 : 0) : Boolean(giveUpRaw) ? 1 : 0;
  }

  const correctnessFlag = raw.correctnessFlag ?? raw.correctness;
  const correctnessCounter =
    raw.correctnessCounter ?? raw.correctCount ?? raw.correctRounds ?? raw.correctnessCount;
  const totalCount = raw.totalRounds ?? raw.totalCount;
  const correctness = {};
  const solved = toNumberOrNull(correctnessFlag);
  if (solved != null) correctness.solved = solved !== 0;
  const cc = toNumberOrNull(correctnessCounter);
  if (cc != null) correctness.correctCount = cc;
  const tc = toNumberOrNull(totalCount);
  if (tc != null) correctness.totalCount = tc;
  if (Object.keys(correctness).length) norm.correctness = correctness;

  const errorScore = toNumberOrNull(raw.errorScore);
  const errorCount = toNumberOrNull(raw.totalErrors);
  const errors = {};
  if (errorScore != null) errors.errorScore = errorScore;
  if (errorCount != null) errors.errorCount = errorCount;
  if (Object.keys(errors).length) norm.errors = errors;

  if (raw.logicalReasoningFlag != null) {
    const lr = toNumberOrNull(raw.logicalReasoningFlag);
    norm.logicalReasoningFlag = lr != null ? (lr !== 0 ? 1 : 0) : Boolean(raw.logicalReasoningFlag) ? 1 : 0;
  }

  const used = new Set([
    'time',
    'seconds',
    'elapsedSec',
    'timeElapsed',
    'totalTime',
    'timeScore',
    'clicks',
    'totalClicks',
    'clickScore',
    'clickCount',
    'resets',
    'resetCount',
    'resetCounter',
    'resetCounterValue',
    'giveUpFlag',
    'giveUp',
    'correctnessFlag',
    'correctness',
    'correctnessCounter',
    'correctCount',
    'correctRounds',
    'correctnessCount',
    'totalRounds',
    'totalCount',
    'errorScore',
    'totalErrors',
    'logicalReasoningFlag'
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(raw)) {
    if (used.has(k)) continue;
    extra[k] = v;
  }

  return { normalized: norm, extra, raw };
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
  if (tier === 'strong') {
    return { errorMin: 0, errorMax: 2, timeMin: 38, timeMax: 95, clickMin: 12, clickMax: 38, failRate: 0.08 };
  }
  if (tier === 'average') {
    return { errorMin: 2, errorMax: 5, timeMin: 70, timeMax: 145, clickMin: 22, clickMax: 58, failRate: 0.22 };
  }
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
    const errorScore = solved ? Math.abs(Math.round(randBetween(rng, 0, 1))) : Math.round(randBetween(rng, 2, 5));
    return {
      errorScore,
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
    const dragScore = round1(randBetween(rng, 6, solved ? 9.5 : 5));
    return {
      errorScore: errors,
      timeScore: seconds,
      clickScore: round1(randBetween(rng, 6, 10)),
      dragScore,
      clicks
    };
  }

  if (taskId === 'burger-recipe-2') {
    return {
      errorScore: errors,
      timeScore: seconds,
      correctnessFlag: solved,
      clicks,
      giveUpFlag: giveUp
    };
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

async function removeExistingDemo() {
  const teacher = await qGet(`SELECT id FROM users WHERE username = ?`, [TEACHER.username]);
  if (!teacher?.id) return;

  const students = await qGet(`SELECT COUNT(*) AS c FROM users WHERE created_by_teacher_id = ?`, [teacher.id]);
  console.log(`Removing existing demo (teacher id ${teacher.id}, ${students?.c ?? 0} students)...`);

  await qRun(`DELETE FROM users WHERE created_by_teacher_id = ?`, [teacher.id]);
  await qRun(`DELETE FROM users WHERE id = ?`, [teacher.id]);
}

async function insertUser({ username, password, role, approved, createdByTeacherId, displayName }) {
  const passwordHash = sha256(`${username}\n${password}`);
  const info = await qRun(
    `INSERT INTO users (username, password_hash, role, approved, created_by_teacher_id, display_name)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [username, passwordHash, role, approved ?? 1, createdByTeacherId ?? null, displayName ?? null]
  );
  return info.lastInsertRowid;
}

async function seedStudentExam({ student, teacherId, baseStartMs }) {
  const rng = mulberry32(
    [...student.username].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + teacherId * 17
  );
  const attemptId = randomId(16);
  const seed = Math.floor(rng() * 1_000_000_000);
  const examStart = new Date(baseStartMs);
  const examEnd = new Date(baseStartMs);

  await qRun(`INSERT INTO attempts (id, user_id, seed, started_at, finished_at) VALUES (?, ?, ?, ?, ?)`, [
    attemptId,
    student.id,
    seed,
    examStart.toISOString(),
    null
  ]);

  let cursor = baseStartMs + 2 * 60 * 1000;

  for (let idx = 0; idx < TASKS.length; idx++) {
    const task = TASKS[idx];
    const taskDurationMs = Math.round(randBetween(rng, 4.5, 11) * 60 * 1000);
    const startedAt = new Date(cursor);
    const finishedAt = new Date(cursor + taskDurationMs);
    cursor = finishedAt.getTime() + Math.round(randBetween(rng, 0.4, 2.5) * 60 * 1000);
    examEnd.setTime(finishedAt.getTime());

    const gamePayload = buildGamePayload(task.id, student.tier, idx, rng);
    const monitoring = normalizeMonitoringFromFinishPayload(gamePayload);

    await qRun(
      `INSERT INTO attempt_tasks (
         attempt_id, task_id, task_index, started_at, finished_at,
         breakdown_json, game_payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        attemptId,
        task.id,
        idx,
        startedAt.toISOString(),
        finishedAt.toISOString(),
        JSON.stringify(monitoring),
        JSON.stringify(gamePayload)
      ]
    );
  }

  await qRun(`UPDATE attempts SET finished_at = ? WHERE id = ?`, [examEnd.toISOString(), attemptId]);
  return { attemptId, finishedAt: examEnd.toISOString() };
}

async function main() {
  await initDatabase();
  await removeExistingDemo();

  const teacherId = await insertUser({
    username: TEACHER.username,
    password: TEACHER.password,
    role: 'teacher',
    approved: 1,
    displayName: TEACHER.displayName
  });

  console.log(`Created teacher "${TEACHER.username}" (id ${teacherId})`);

  const baseStartMs = Date.now() - 3 * 24 * 60 * 60 * 1000;

  for (const spec of STUDENTS) {
    const studentId = await insertUser({
      username: spec.username,
      password: spec.password,
      role: 'student',
      approved: 1,
      createdByTeacherId: teacherId,
      displayName: spec.displayName
    });

    await qRun(
      `INSERT INTO student_credentials (student_user_id, teacher_user_id, password_plain)
       VALUES (?, ?, ?)`,
      [studentId, teacherId, spec.password]
    );

    const student = { id: studentId, tier: spec.tier, username: spec.username };
    const exam = await seedStudentExam({ student, teacherId, baseStartMs: baseStartMs + spec.username.length * 600_000 });

    console.log(
      `  Student "${spec.displayName}" (${spec.username}) — attempt ${exam.attemptId}, finished ${exam.finishedAt}`
    );
  }

  console.log('\nDemo accounts (save these):');
  console.log(`  Teacher: ${TEACHER.username} / ${TEACHER.password}`);
  for (const s of STUDENTS) {
    console.log(`  Student: ${s.username} / ${s.password} (${s.displayName})`);
  }
  console.log('\nLog in as youssef on the site → Teacher Coordinator → Refresh Marks to view all 12 tasks.');
}

main()
  .then(() => poolEnd())
  .catch((err) => {
    console.error(err);
    poolEnd().finally(() => process.exit(1));
  });
