import crypto from 'node:crypto';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { openDb } from './db.js';
import { TASKS } from './tasks.js';

const app = express();
const db = openDb();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const SESSION_COOKIE = 'kb_session';
const SESSION_TTL_DAYS = 14;

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getUserFromRequest(req) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const row = db
    .prepare(
      `
      SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username, u.role, u.approved
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `
    )
    .get(sid);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
    return null;
  }
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role ?? 'student',
    approved: Number(row.approved ?? 1) === 1,
    sessionId: row.session_id
  };
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  next();
}

function requireTeacher(req, res, next) {
  if (req.user?.role !== 'teacher') return res.status(403).json({ error: 'teacher_only' });
  if (!req.user?.approved) return res.status(403).json({ error: 'teacher_not_approved' });
  next();
}

function requireStudent(req, res, next) {
  if (req.user?.role !== 'student') return res.status(403).json({ error: 'student_only' });
  next();
}

function normalizeName(input) {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function parseStudentNames(csvText) {
  const lines = String(csvText ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const rawNames = lines.map((line, idx) => {
    const first = line.split(',')[0]?.trim() ?? '';
    if (idx === 0 && /^(name|student|student_name)$/i.test(first)) return '';
    return normalizeName(first);
  });
  return rawNames.filter(Boolean);
}

function usernameBaseFromName(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);
  return base || 'student';
}

function generateReadablePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clamp(x, min, max) {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function normalizeWeights(weights) {
  const w = {
    error: Number(weights?.error ?? 0.6),
    time: Number(weights?.time ?? 0.3),
    click: Number(weights?.click ?? 0.1),
    drag: Number(weights?.drag ?? 0)
  };
  const sum = w.error + w.time + w.click + w.drag;
  if (!Number.isFinite(sum) || sum <= 0) return { error: 0.6, time: 0.3, click: 0.1, drag: 0 };
  return {
    error: w.error / sum,
    time: w.time / sum,
    click: w.click / sum,
    drag: w.drag / sum
  };
}

function computeWeightedFinal10({ errorScore, timeScore, clickScore, dragScore, weights }) {
  const w = normalizeWeights(weights);
  return (
    w.error * clamp(errorScore, 0, 10) +
    w.time * clamp(timeScore, 0, 10) +
    w.click * clamp(clickScore, 0, 10) +
    w.drag * clamp(dragScore ?? 10, 0, 10)
  );
}

function getWeightsForTask(taskDef) {
  const raw = taskDef?.scoring?.weights ?? null;
  return normalizeWeights(raw ?? { error: 0.6, time: 0.3, click: 0.1, drag: 0 });
}

function weightsToPercentString(w) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  return `error ${pct(w.error)}, time ${pct(w.time)}, click ${pct(w.click)}${w.drag > 0 ? `, drag ${pct(w.drag)}` : ''}`;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function scoreFromMoves(taskDef, moves) {
  const errorStart = 10;
  const timeStart = 10;
  const clickStart = 10;
  const dragStart = 10;

  const clicks = moves.filter((m) => m.move_type === 'click').length;

  const moveTimes = moves.map((m) => new Date(m.ts).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const startMs = moveTimes.length ? moveTimes[0] : Date.now();
  const endMs = Date.now();
  const elapsedSec = Math.max(0, (endMs - startMs) / 1000);

  const timeDecay = taskDef?.scoring?.timeDecayPerSecond ?? 0.05;
  const clickDecay = taskDef?.scoring?.clickDecayPerClick ?? 0.2;
  const dragDecay = taskDef?.scoring?.dragDecayPerSecond ?? 0.1;

  const timeScore = clamp(timeStart - elapsedSec * timeDecay, 0, 10);
  const clickScore = clamp(clickStart - clicks * clickDecay, 0, 10);
  let dragScore = clamp(dragStart - 0 * dragDecay, 0, 10);

  let errorDeductions = 0;

  if (taskDef.type === 'magic_house') {
    for (const m of moves) {
      if (m.move_type !== 'magic_pick') continue;
      const p = safeJsonParse(m.payload_json) ?? {};
      const matches = Number(p.matches ?? 0);
      if (Number.isFinite(matches) && matches > 0) {
        errorDeductions += matches * 0.5;
      }
    }
  } else if (taskDef.type === 'shape_sudoku') {
    for (const m of moves) {
      if (m.move_type !== 'sudoku_pick') continue;
      const p = safeJsonParse(m.payload_json) ?? {};
      const errors = Number(p.errors ?? 0);
      if (Number.isFinite(errors) && errors > 0) {
        errorDeductions += errors * 1.5;
      }
    }
  } else if (taskDef.type === 'organizing_bracelets') {
    for (const m of moves) {
      if (m.move_type !== 'bracelet_drop') continue;
      const p = safeJsonParse(m.payload_json) ?? {};
      const errors = Number(p.errors ?? 0);
      if (Number.isFinite(errors) && errors > 0) {
        errorDeductions += errors * 1.5;
      }
    }
  } else if (taskDef.type === 'cube_game') {
    // Prefer a summary payload sent by the task at "finish" time (less noisy than logging every click).
    const summaryMove = [...moves].reverse().find((m) => m.move_type === 'cube_summary');
    if (summaryMove) {
      const p = safeJsonParse(summaryMove.payload_json) ?? {};
      const wrongSelections = Number(p.wrongSelections ?? 0);
      const clicksFromTask = Number(p.clicks ?? clicks);
      const dragTimeSec = Number(p.dragTimeSec ?? 0);
      const elapsedFromTask = Number(p.elapsedSec ?? elapsedSec);

      if (Number.isFinite(wrongSelections) && wrongSelections > 0) {
        errorDeductions += wrongSelections * 1; // -1 per wrong selection
      }
      dragScore = clamp(dragStart - dragTimeSec * dragDecay, 0, 10);

      // overwrite time/click scores with task-provided counts (if any)
      const timeScore2 = clamp(timeStart - elapsedFromTask * timeDecay, 0, 10);
      const clickScore2 = clamp(clickStart - clicksFromTask * clickDecay, 0, 10);

      const errorScore2 = clamp(errorStart - errorDeductions, 0, 10);
      const final10 = computeWeightedFinal10({
        errorScore: errorScore2,
        timeScore: timeScore2,
        clickScore: clickScore2,
        dragScore,
        weights: taskDef?.scoring?.weights
      });
      const finalScore = clamp(final10 * 10, 0, 100);
      return {
        elapsedSec: elapsedFromTask,
        clicks: clicksFromTask,
        dragTimeSec,
        errorScore: errorScore2,
        timeScore: timeScore2,
        clickScore: clickScore2,
        dragScore,
        final10,
        finalScore
      };
    }
  } else {
    // fallback: use summed penalty as "points off" from a 10-point error score
    const summedPenalty = moves.reduce((acc, m) => acc + (Number(m.penalty) || 0), 0);
    errorDeductions += summedPenalty;
  }

  const errorScore = clamp(errorStart - errorDeductions, 0, 10);
  const final10 = computeWeightedFinal10({
    errorScore,
    timeScore,
    clickScore,
    dragScore,
    weights: taskDef?.scoring?.weights
  });
  const finalScore = clamp(final10 * 10, 0, 100);

  return {
    elapsedSec,
    clicks,
    errorScore,
    timeScore,
    clickScore,
    dragScore,
    final10,
    finalScore
  };
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const cleanUsername = username.trim();
  const cleanRole = role === 'teacher' ? 'teacher' : 'student';
  if (cleanRole !== 'teacher') {
    return res.status(403).json({ error: 'student_registration_disabled' });
  }
  if (cleanUsername.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'weak_credentials' });
  }

  const passwordHash = sha256(`${cleanUsername}\n${password}`);
  try {
    const info = db
      .prepare(`INSERT INTO users (username, password_hash, role, approved) VALUES (?, ?, ?, ?)`)
      .run(cleanUsername, passwordHash, cleanRole, 1);
    return res.json({ ok: true, userId: info.lastInsertRowid });
  } catch (e) {
    return res.status(409).json({ error: 'username_taken' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const cleanUsername = username.trim();
  const user = db
    .prepare(`SELECT id, username, password_hash, role, approved FROM users WHERE username = ?`)
    .get(cleanUsername);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const passwordHash = sha256(`${cleanUsername}\n${password}`);
  if (passwordHash !== user.password_hash) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.role === 'teacher' && Number(user.approved ?? 1) !== 1) {
    return res.status(403).json({ error: 'teacher_not_approved' });
  }

  const sessionId = randomId(24);
  const expiresAt = addDays(new Date(), SESSION_TTL_DAYS).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(
    sessionId,
    user.id,
    expiresAt
  );

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires: new Date(expiresAt)
  });
  return res.json({ ok: true });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
  res.clearCookie(SESSION_COOKIE);
  return res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    username: user.username,
    userId: user.userId,
    role: user.role,
    approved: user.approved
  });
});

app.get('/api/tasks', requireAuth, requireStudent, (req, res) => {
  return res.json({ tasks: TASKS });
});

app.post('/api/teacher/students/upload', requireAuth, requireTeacher, (req, res) => {
  const { csvText } = req.body ?? {};
  if (typeof csvText !== 'string') return res.status(400).json({ error: 'bad_request' });

  const names = parseStudentNames(csvText);
  if (!names.length) return res.status(400).json({ error: 'no_students_found' });

  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, approved, created_by_teacher_id, display_name)
     VALUES (?, ?, 'student', 1, ?, ?)`
  );
  const upsertCredential = db.prepare(
    `INSERT INTO student_credentials (student_user_id, teacher_user_id, password_plain)
     VALUES (?, ?, ?)
     ON CONFLICT(student_user_id) DO UPDATE SET
       teacher_user_id = excluded.teacher_user_id,
       password_plain = excluded.password_plain`
  );
  const exists = db.prepare(`SELECT 1 FROM users WHERE username = ?`);

  const created = [];
  const tx = db.transaction((rows) => {
    for (const name of rows) {
      const base = usernameBaseFromName(name);
      let usernameCandidate = '';
      for (let tries = 0; tries < 20; tries++) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const candidate = `st_${base}_${suffix}`;
        if (!exists.get(candidate)) {
          usernameCandidate = candidate;
          break;
        }
      }
      if (!usernameCandidate) throw new Error('username_generation_failed');
      const password = generateReadablePassword();
      const passwordHash = sha256(`${usernameCandidate}\n${password}`);
      const info = insert.run(usernameCandidate, passwordHash, req.user.userId, name);
      const studentUserId = Number(info.lastInsertRowid);
      upsertCredential.run(studentUserId, req.user.userId, password);
      created.push({ name, username: usernameCandidate, password, createdAt: nowIso() });
    }
  });

  try {
    tx(names);
  } catch {
    return res.status(500).json({ error: 'upload_failed' });
  }

  return res.json({ ok: true, count: created.length, credentials: created });
});

app.get('/api/teacher/students/credentials', requireAuth, requireTeacher, (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT u.id, u.username, u.display_name, sc.password_plain, sc.created_at
      FROM users u
      JOIN student_credentials sc ON sc.student_user_id = u.id
      WHERE u.role = 'student' AND u.created_by_teacher_id = ?
      ORDER BY sc.created_at DESC, u.username ASC
      `
    )
    .all(req.user.userId);

  return res.json({
    credentials: rows.map((r) => ({
      studentId: r.id,
      name: r.display_name ?? '',
      username: r.username,
      password: r.password_plain,
      createdAt: r.created_at
    }))
  });
});

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

app.get('/api/teacher/students/results', requireAuth, requireTeacher, (req, res) => {
  const students = db
    .prepare(
      `SELECT id, username, display_name
       FROM users
       WHERE role = 'student' AND created_by_teacher_id = ?
       ORDER BY display_name ASC, username ASC`
    )
    .all(req.user.userId);

  const attemptByUser = db
    .prepare(
      `SELECT id, user_id, started_at, finished_at
       FROM attempts
       WHERE user_id = ?`
    );

  const tasksByAttempt = db
    .prepare(
      `SELECT task_id, final_score, breakdown_json
       FROM attempt_tasks
       WHERE attempt_id = ?`
    );

  const taskDefs = new Map(TASKS.map((t) => [t.id, t]));
  const catWeights = { A: 0.22, B: 0.33, C: 0.55 };

  const out = students.map((s) => {
    const a = attemptByUser.get(s.id) ?? null;
    const taskScores = {};
    const taskBreakdowns = {};
    const cat = { A: { sum: 0, max: 0 }, B: { sum: 0, max: 0 }, C: { sum: 0, max: 0 } };

    if (a) {
      const rows = tasksByAttempt.all(a.id);
      for (const r of rows) {
        taskScores[r.task_id] = r.final_score;
        taskBreakdowns[r.task_id] = r.breakdown_json ? safeJsonParse(r.breakdown_json) : null;
        const def = taskDefs.get(r.task_id);
        const catKey = def?.category ?? null;
        if (catKey && cat[catKey]) {
          cat[catKey].max += Number(def?.maxScore ?? 100);
          if (Number.isFinite(r.final_score)) cat[catKey].sum += Number(r.final_score);
        }
      }
    }

    const catPct = (k) => (cat[k].max > 0 ? (cat[k].sum / cat[k].max) * 100 : null);
    const catA = catPct('A');
    const catB = catPct('B');
    const catC = catPct('C');
    const overallWeighted =
      (Number.isFinite(catA) ? catA * catWeights.A : 0) +
      (Number.isFinite(catB) ? catB * catWeights.B : 0) +
      (Number.isFinite(catC) ? catC * catWeights.C : 0);

    return {
      studentId: s.id,
      name: s.display_name ?? '',
      username: s.username,
      attemptId: a?.id ?? null,
      startedAt: a?.started_at ?? null,
      finishedAt: a?.finished_at ?? null,
      categoryPercents: { A: catA, B: catB, C: catC },
      overallWeightedPercent: a ? overallWeighted : null,
      taskScores,
      taskBreakdowns
    };
  });

  return res.json({
    students: out,
    tasks: TASKS.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      maxScore: t.maxScore ?? 100,
      weights: normalizeWeights(t?.scoring?.weights ?? { error: 0.6, time: 0.3, click: 0.1, drag: 0 })
    })),
    overallWeights: { A: 0.22, B: 0.33, C: 0.55 }
  });
});

app.get('/api/teacher/students/results.csv', requireAuth, requireTeacher, (req, res) => {
  const students = db
    .prepare(
      `SELECT id, username, display_name
       FROM users
       WHERE role = 'student' AND created_by_teacher_id = ?
       ORDER BY display_name ASC, username ASC`
    )
    .all(req.user.userId);

  const attemptByUser = db
    .prepare(
      `SELECT id, started_at, finished_at
       FROM attempts
       WHERE user_id = ?`
    );

  const tasksByAttempt = db
    .prepare(
      `SELECT task_id, final_score, breakdown_json
       FROM attempt_tasks
       WHERE attempt_id = ?`
    );

  const taskIds = TASKS.map((t) => t.id);
  const header = [
    'name',
    'username',
    'attempt_id',
    'started_at',
    'finished_at',
    'A_percent',
    'B_percent',
    'C_percent',
    'overall_weighted_percent',
    ...taskIds.flatMap((tid) => [
      `${tid}__final`,
      `${tid}__error10`,
      `${tid}__time10`,
      `${tid}__click10`,
      `${tid}__drag10`,
      `${tid}__weights`
    ])
  ];
  const lines = [header.map(csvEscape).join(',')];

  const taskDefs = new Map(TASKS.map((t) => [t.id, t]));
  const catWeights = { A: 0.22, B: 0.33, C: 0.55 };

  for (const s of students) {
    const a = attemptByUser.get(s.id) ?? null;
    const scoreMap = {};
    const breakdownMap = {};
    const cat = { A: { sum: 0, max: 0 }, B: { sum: 0, max: 0 }, C: { sum: 0, max: 0 } };
    if (a) {
      const rows = tasksByAttempt.all(a.id);
      for (const r of rows) {
        scoreMap[r.task_id] = r.final_score;
        breakdownMap[r.task_id] = r.breakdown_json ? safeJsonParse(r.breakdown_json) : null;
        const def = taskDefs.get(r.task_id);
        const catKey = def?.category ?? null;
        if (catKey && cat[catKey]) {
          cat[catKey].max += Number(def?.maxScore ?? 100);
          if (Number.isFinite(r.final_score)) cat[catKey].sum += Number(r.final_score);
        }
      }
    }
    const catPct = (k) => (cat[k].max > 0 ? (cat[k].sum / cat[k].max) * 100 : null);
    const catA = catPct('A');
    const catB = catPct('B');
    const catC = catPct('C');
    const overallWeighted =
      (Number.isFinite(catA) ? catA * catWeights.A : 0) +
      (Number.isFinite(catB) ? catB * catWeights.B : 0) +
      (Number.isFinite(catC) ? catC * catWeights.C : 0);

    const row = [
      s.display_name ?? '',
      s.username,
      a?.id ?? '',
      a?.started_at ?? '',
      a?.finished_at ?? '',
      Number.isFinite(catA) ? catA.toFixed(2) : '',
      Number.isFinite(catB) ? catB.toFixed(2) : '',
      Number.isFinite(catC) ? catC.toFixed(2) : '',
      a ? overallWeighted.toFixed(2) : '',
      ...taskIds.flatMap((tid) => {
        const v = scoreMap[tid];
        const b = breakdownMap[tid] ?? null;
        const weightsText = b?.weightsText ?? '';
        return [
          Number.isFinite(v) ? Number(v).toFixed(2) : '',
          Number.isFinite(b?.errorScore) ? Number(b.errorScore).toFixed(2) : '',
          Number.isFinite(b?.timeScore) ? Number(b.timeScore).toFixed(2) : '',
          Number.isFinite(b?.clickScore) ? Number(b.clickScore).toFixed(2) : '',
          Number.isFinite(b?.dragScore) ? Number(b.dragScore).toFixed(2) : '',
          weightsText
        ];
      })
    ];
    lines.push(row.map(csvEscape).join(','));
  }

  const csv = lines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kingbebras-results.csv"');
  return res.send(csv);
});

app.post('/api/attempts/start', requireAuth, requireStudent, (req, res) => {
  // One attempt per student (ever). If an attempt exists, reuse it.
  const existing = db
    .prepare(`SELECT id, started_at, finished_at FROM attempts WHERE user_id = ? ORDER BY started_at ASC LIMIT 1`)
    .get(req.user.userId);
  if (existing) {
    if (existing.finished_at) {
      return res.status(409).json({
        error: 'attempt_already_completed',
        attemptId: existing.id,
        startedAt: existing.started_at,
        finishedAt: existing.finished_at
      });
    }
    return res.json({
      ok: true,
      attemptId: existing.id,
      existing: true,
      startedAt: existing.started_at,
      finishedAt: existing.finished_at
    });
  }

  const attemptId = randomId(16);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  db.prepare(`INSERT INTO attempts (id, user_id, seed) VALUES (?, ?, ?)`).run(attemptId, req.user.userId, seed);
  const created = db.prepare(`SELECT started_at FROM attempts WHERE id = ?`).get(attemptId);

  const insertTask = db.prepare(
    `INSERT INTO attempt_tasks (attempt_id, task_id, task_index) VALUES (?, ?, ?)`
  );
  TASKS.slice(0, 15).forEach((t, idx) => insertTask.run(attemptId, t.id, idx));

  return res.json({ ok: true, attemptId, existing: false, startedAt: created?.started_at ?? nowIso(), finishedAt: null });
});

app.get('/api/attempts/current', requireAuth, requireStudent, (req, res) => {
  const row = db
    .prepare(
      `
      SELECT id, started_at, finished_at, seed
      FROM attempts
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `
    )
    .get(req.user.userId);
  return res.json({ attempt: row ?? null });
});

app.get('/api/attempts/:attemptId/tasks', requireAuth, requireStudent, (req, res) => {
  const { attemptId } = req.params;
  const owned = db
    .prepare(`SELECT 1 FROM attempts WHERE id = ? AND user_id = ?`)
    .get(attemptId, req.user.userId);
  if (!owned) return res.status(403).json({ error: 'not_allowed' });

  const rows = db
    .prepare(
      `
      SELECT task_id, task_index, started_at, finished_at, final_score
      FROM attempt_tasks
      WHERE attempt_id = ?
      ORDER BY task_index ASC
      `
    )
    .all(attemptId);
  return res.json({
    tasks: rows.map((r) => ({
      taskId: r.task_id,
      taskIndex: r.task_index,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      finalScore: r.final_score
    }))
  });
});

app.post('/api/attempts/end', requireAuth, requireStudent, (req, res) => {
  const { attemptId } = req.body ?? {};
  if (typeof attemptId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const info = db
    .prepare(
      `
      UPDATE attempts
      SET finished_at = COALESCE(finished_at, ?)
      WHERE id = ? AND user_id = ?
      `
    )
    .run(nowIso(), attemptId, req.user.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'attempt_not_found' });
  return res.json({ ok: true });
});

app.post('/api/moves', requireAuth, requireStudent, (req, res) => {
  const { attemptId, taskId, moveType, payload, penalty } = req.body ?? {};
  if (
    typeof attemptId !== 'string' ||
    typeof taskId !== 'string' ||
    typeof moveType !== 'string'
  ) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const pen = Number.isFinite(penalty) ? Number(penalty) : 0;
  const payloadJson = JSON.stringify(payload ?? {});

  const taskRow = db
    .prepare(
      `SELECT 1 FROM attempt_tasks at
       JOIN attempts a ON a.id = at.attempt_id
       WHERE at.attempt_id = ? AND at.task_id = ? AND a.user_id = ? AND a.finished_at IS NULL`
    )
    .get(attemptId, taskId, req.user.userId);
  if (!taskRow) return res.status(403).json({ error: 'not_allowed' });

  db.prepare(
    `UPDATE attempt_tasks
     SET started_at = COALESCE(started_at, ?)
     WHERE attempt_id = ? AND task_id = ?`
  ).run(nowIso(), attemptId, taskId);

  db.prepare(
    `INSERT INTO moves (attempt_id, task_id, move_type, payload_json, penalty) VALUES (?, ?, ?, ?, ?)`
  ).run(attemptId, taskId, moveType, payloadJson, pen);

  return res.json({ ok: true });
});

app.post('/api/tasks/finish', requireAuth, requireStudent, (req, res) => {
  const { attemptId, taskId, finalAnswer, gamePayload } = req.body ?? {};
  if (typeof attemptId !== 'string' || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }

  const taskDef = TASKS.find((t) => t.id === taskId);
  if (!taskDef) return res.status(404).json({ error: 'task_not_found' });

  const allowed = db
    .prepare(
      `SELECT 1
       FROM attempt_tasks at
       JOIN attempts a ON a.id = at.attempt_id
       WHERE at.attempt_id = ? AND at.task_id = ? AND a.user_id = ? AND a.finished_at IS NULL`
    )
    .get(attemptId, taskId, req.user.userId);
  if (!allowed) return res.status(403).json({ error: 'not_allowed' });

  const moves = db
    .prepare(
      `SELECT ts, move_type, payload_json, penalty
       FROM moves
       WHERE attempt_id = ? AND task_id = ?
       ORDER BY id ASC`
    )
    .all(attemptId, taskId);

  const scoring = scoreFromMoves(taskDef, moves);
  const weights = getWeightsForTask(taskDef);

  const info = db
    .prepare(
      `
      UPDATE attempt_tasks
      SET finished_at = COALESCE(finished_at, ?),
          final_score = COALESCE(final_score, ?),
          breakdown_json = COALESCE(breakdown_json, ?),
          game_payload_json = COALESCE(game_payload_json, ?)
      WHERE attempt_id = ? AND task_id = ?
    `
    )
    .run(
      nowIso(),
      scoring.finalScore,
      JSON.stringify({
        errorScore: scoring.errorScore,
        timeScore: scoring.timeScore,
        clickScore: scoring.clickScore,
        dragScore: scoring.dragScore,
        elapsedSec: scoring.elapsedSec,
        clicks: scoring.clicks,
        dragTimeSec: scoring.dragTimeSec,
        weights,
        weightsText: weightsToPercentString(weights),
        final10: scoring.final10,
        finalScore: scoring.finalScore
      }),
      gamePayload ? JSON.stringify(gamePayload) : null,
      attemptId,
      taskId
    );

  if (info.changes === 0) return res.status(404).json({ error: 'attempt_task_not_found' });
  return res.json({
    ok: true,
    finalScore: scoring.finalScore,
    breakdown: {
      errorScore: scoring.errorScore,
      timeScore: scoring.timeScore,
      clickScore: scoring.clickScore,
      dragScore: scoring.dragScore,
      elapsedSec: scoring.elapsedSec,
      clicks: scoring.clicks,
      dragTimeSec: scoring.dragTimeSec
    },
    weights: weights,
    weightsText: weightsToPercentString(weights),
    finalAnswer: finalAnswer ?? null
  });
});

app.use(express.static(path.join(process.cwd(), 'public')));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`KingBebras running on http://localhost:${port}`);
});

