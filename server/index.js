import crypto from 'node:crypto';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import {
  initDatabase,
  qGet,
  qAll,
  qRun,
  USE_PG,
  withPgTransaction,
  getSqliteDb
} from './database.js';
import { TASKS } from './tasks.js';

const app = express();

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

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

async function getUserFromRequest(req) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const row = await qGet(
    `
      SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username, u.role, u.approved
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `,
    [sid]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await qRun(`DELETE FROM sessions WHERE id = ?`, [sid]);
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

const requireAuth = asyncRoute(async (req, res, next) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user;
  next();
});

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

function toNumberOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeMonitoringFromFinishPayload(gamePayload) {
  const raw = gamePayload && typeof gamePayload === 'object' ? gamePayload : {};
  const norm = {};

  // time (seconds)
  const timeSec =
    toNumberOrNull(raw.time) ??
    toNumberOrNull(raw.seconds) ??
    toNumberOrNull(raw.elapsedSec) ??
    toNumberOrNull(raw.timeElapsed) ??
    toNumberOrNull(raw.totalTime) ??
    toNumberOrNull(raw.timeScore);
  if (timeSec != null) norm.timeSec = timeSec;

  // clicks
  const clicks = toNumberOrNull(raw.clicks) ?? toNumberOrNull(raw.totalClicks) ?? toNumberOrNull(raw.clickScore) ?? toNumberOrNull(raw.clickCount);
  if (clicks != null) norm.clicks = clicks;

  // resets
  const resets = toNumberOrNull(raw.resets) ?? toNumberOrNull(raw.resetCount) ?? toNumberOrNull(raw.resetCounter) ?? toNumberOrNull(raw.resetCounterValue);
  if (resets != null) norm.resets = resets;

  // give up
  const giveUpRaw = raw.giveUpFlag ?? raw.giveUp;
  if (giveUpRaw != null) {
    const g = toNumberOrNull(giveUpRaw);
    norm.giveUpFlag = g != null ? (g !== 0 ? 1 : 0) : Boolean(giveUpRaw) ? 1 : 0;
  }

  // correctness (could be flag or counter)
  const correctnessFlag = raw.correctnessFlag ?? raw.correctness;
  const correctnessCounter = raw.correctnessCounter ?? raw.correctCount ?? raw.correctRounds ?? raw.correctnessCount;
  const totalCount = raw.totalRounds ?? raw.totalCount;
  const correctness = {};
  const solved = toNumberOrNull(correctnessFlag);
  if (solved != null) correctness.solved = solved !== 0;
  const cc = toNumberOrNull(correctnessCounter);
  if (cc != null) correctness.correctCount = cc;
  const tc = toNumberOrNull(totalCount);
  if (tc != null) correctness.totalCount = tc;
  if (Object.keys(correctness).length) norm.correctness = correctness;

  // errors (some games call it errorScore but it may mean “count”; we keep both if present)
  const errorScore = toNumberOrNull(raw.errorScore);
  const errorCount = toNumberOrNull(raw.totalErrors);
  const errors = {};
  if (errorScore != null) errors.errorScore = errorScore;
  if (errorCount != null) errors.errorCount = errorCount;
  if (Object.keys(errors).length) norm.errors = errors;

  // logical reasoning flag (some games/classes)
  if (raw.logicalReasoningFlag != null) {
    const lr = toNumberOrNull(raw.logicalReasoningFlag);
    norm.logicalReasoningFlag = lr != null ? (lr !== 0 ? 1 : 0) : Boolean(raw.logicalReasoningFlag) ? 1 : 0;
  }

  // Keep all non-normalized keys as extra.
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

/**
 * Prefer authoritative scores from the game's finish payload (same logic as the iframe).
 * Falls back to null so scoreFromMoves can use moves / task-specific rules.
 */
function scoringFromGamePayload(taskDef, gamePayload, moves) {
  if (!gamePayload || typeof gamePayload !== 'object') return null;
  const p = gamePayload;
  const weights = getWeightsForTask(taskDef);
  const neutral = 10;

  const clicksLogged = moves.filter((m) => m.move_type === 'click').length;
  const moveTimes = moves.map((m) => new Date(m.ts).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const startMs = moveTimes.length ? moveTimes[0] : Date.now();
  const elapsedFallback = Math.max(0, (Date.now() - startMs) / 1000);

  const combinedFinal10 = () => {
    const v = Number(p.finalScore ?? p.finalScoreValue ?? p.totalScore);
    return Number.isFinite(v) ? clamp(v, 0, 10) : null;
  };

  const baseReturn = (opts) => ({
    elapsedSec: opts.elapsedSec ?? elapsedFallback,
    clicks: opts.clicks ?? clicksLogged,
    errorScore: opts.errorScore,
    timeScore: opts.timeScore,
    clickScore: opts.clickScore,
    dragScore: opts.dragScore ?? neutral,
    final10: opts.final10,
    finalScore: clamp(opts.final10 * 10, 0, 100),
    dragTimeSec: opts.dragTimeSec
  });

  if (taskDef.type === 'magic_house') {
    const err = Number(p.finalErrorScore);
    const tim = Number(p.timeScore);
    const tot = Number(p.totalScore);
    const totalTime = Number(p.totalTime);
    if (!Number.isFinite(err) || !Number.isFinite(tim)) return null;
    const errorScore = clamp(err, 0, 10);
    const timeScore = clamp(tim, 0, 10);
    const cf = combinedFinal10();
    const final10 =
      Number.isFinite(tot) && tot >= 0
        ? clamp(tot, 0, 10)
        : cf ?? computeWeightedFinal10({
            errorScore,
            timeScore,
            clickScore: neutral,
            dragScore: neutral,
            weights
          });
    const elapsedSec = Number.isFinite(totalTime) && totalTime >= 0 ? totalTime : elapsedFallback;
    return baseReturn({ elapsedSec, errorScore, timeScore, clickScore: neutral, dragScore: neutral, final10 });
  }

  if (taskDef.type === 'shape_sudoku') {
    const err = Number(p.finalErrorRaw);
    const tim = Number(p.timeRaw ?? p.timeScore);
    if (!Number.isFinite(err) || !Number.isFinite(tim)) return null;
    const errorScore = clamp(err, 0, 10);
    const timeScore = clamp(tim, 0, 10);
    const cf = combinedFinal10();
    const final10 =
      cf ??
      computeWeightedFinal10({
        errorScore,
        timeScore,
        clickScore: neutral,
        dragScore: neutral,
        weights
      });
    const totalTime = Number(p.totalTime);
    return baseReturn({
      elapsedSec: Number.isFinite(totalTime) ? totalTime : elapsedFallback,
      errorScore,
      timeScore,
      clickScore: neutral,
      dragScore: neutral,
      final10
    });
  }

  if (taskDef.type === 'organizing_bracelets') {
    const time = Number(p.time);
    let errorScore = Number(p.errorScore);
    let timeScore = Number(p.timeScore);
    let clickScore = Number(p.clickScore);
    const totalErrors = Number(p.totalErrors);
    if (!Number.isFinite(errorScore) && Number.isFinite(totalErrors)) {
      errorScore = clamp(10 - totalErrors * 0.5, 0, 10);
    }
    if (!Number.isFinite(timeScore) && Number.isFinite(time)) {
      timeScore = time < 60 ? 10 : time < 120 ? 8 : time < 180 ? 6 : time < 240 ? 4 : 2;
    }
    if (!Number.isFinite(clickScore)) clickScore = neutral;
    if (!Number.isFinite(errorScore) || !Number.isFinite(timeScore)) return null;
    const cf = combinedFinal10();
    const es = clamp(errorScore, 0, 10);
    const ts = clamp(timeScore, 0, 10);
    const cs = clamp(clickScore, 0, 10);
    const final10 =
      cf ??
      computeWeightedFinal10({
        errorScore: es,
        timeScore: ts,
        clickScore: cs,
        dragScore: neutral,
        weights
      });
    return baseReturn({
      elapsedSec: Number.isFinite(time) ? time : elapsedFallback,
      errorScore: es,
      timeScore: ts,
      clickScore: cs,
      dragScore: neutral,
      final10
    });
  }

  if (taskDef.id === 'cube-game-1') {
    const e = Number(p.finalErrorScore);
    const t = Number(p.timeScore);
    const c = Number(p.clickScore);
    const d = Number(p.dragScore);
    if (![e, t, c, d].every(Number.isFinite)) return null;
    const errorScore = clamp(e, 0, 10);
    const timeScore = clamp(t, 0, 10);
    const clickScore = clamp(c, 0, 10);
    const dragScore = clamp(d, 0, 10);
    const cf = combinedFinal10();
    const final10 =
      cf ??
      computeWeightedFinal10({
        errorScore,
        timeScore,
        clickScore,
        dragScore,
        weights
      });
    const elapsed = Number(p.time);
    return baseReturn({
      elapsedSec: Number.isFinite(elapsed) ? elapsed : elapsedFallback,
      clicks: Number.isFinite(Number(p.clicks)) ? Number(p.clicks) : clicksLogged,
      errorScore,
      timeScore,
      clickScore,
      dragScore,
      final10
    });
  }

  if (taskDef.id === 'bbq-party-2') {
    const e = Number(p.errorScore);
    const tim = Number(p.timeScore);
    const clk = Number(p.clickScore);
    const conn = Number(p.connectionScore);
    if (![e, tim, clk, conn].every(Number.isFinite)) return null;
    const fv = Number(p.finalScoreValue);
    const final10 = Number.isFinite(fv)
      ? clamp(fv, 0, 10)
      : computeWeightedFinal10({
          errorScore: clamp(e, 0, 10),
          timeScore: clamp(tim, 0, 10),
          clickScore: clamp(clk, 0, 10),
          dragScore: clamp(conn, 0, 10),
          weights
        });
    return baseReturn({
      errorScore: clamp(e, 0, 10),
      timeScore: clamp(tim, 0, 10),
      clickScore: clamp(clk, 0, 10),
      dragScore: clamp(conn, 0, 10),
      final10
    });
  }

  if (taskDef.id === 'coloring-page-3') {
    const fs = Number(p.finalScore);
    if (!Number.isFinite(fs)) return null;
    const final10 = clamp(fs, 0, 10);
    return baseReturn({
      errorScore: final10,
      timeScore: neutral,
      clickScore: neutral,
      dragScore: neutral,
      final10
    });
  }

  if (taskDef.id === 'online-class-picture-flow') {
    const e = Number(p.errorScore);
    const tim = Number(p.timeScore);
    const clk = Number(p.clickScore);
    const logic = Number(p.logicScore);
    if (![e, tim, clk, logic].every(Number.isFinite)) return null;
    const cf = combinedFinal10();
    const final10 =
      cf ??
      computeWeightedFinal10({
        errorScore: clamp(e, 0, 10),
        timeScore: clamp(tim, 0, 10),
        clickScore: clamp(clk, 0, 10),
        dragScore: clamp(logic, 0, 10),
        weights
      });
    return baseReturn({
      errorScore: clamp(e, 0, 10),
      timeScore: clamp(tim, 0, 10),
      clickScore: clamp(clk, 0, 10),
      dragScore: clamp(logic, 0, 10),
      final10
    });
  }

  if (taskDef.id === 'burger-recipe-2') {
    const fs = Number(p.finalScore);
    if (!Number.isFinite(fs)) return null;
    const final10 = clamp(fs, 0, 10);
    const e = Number(p.errorScore);
    const tim = Number(p.timeScore);
    const clk = Number(p.clickScore);
    const hasParts = [e, tim, clk].every(Number.isFinite);
    return baseReturn({
      errorScore: hasParts ? clamp(e, 0, 10) : final10,
      timeScore: hasParts ? clamp(tim, 0, 10) : neutral,
      clickScore: hasParts ? clamp(clk, 0, 10) : neutral,
      dragScore: neutral,
      final10
    });
  }

  const err = Number(p.errorScore ?? p.finalErrorScore);
  const tim = Number(p.timeScore ?? p.timeRaw);
  const clk = Number(p.clickScore);
  const dragExtra = Number(p.dragScore ?? p.connectionScore ?? p.logicScore);
  if (![err, tim, clk].every(Number.isFinite)) return null;

  const dragScore = Number.isFinite(dragExtra) ? clamp(dragExtra, 0, 10) : neutral;
  const cf = combinedFinal10();
  const final10 =
    cf ??
    computeWeightedFinal10({
      errorScore: clamp(err, 0, 10),
      timeScore: clamp(tim, 0, 10),
      clickScore: clamp(clk, 0, 10),
      dragScore,
      weights
    });

  let elapsedRaw;
  for (const key of ['totalTime', 'seconds', 'time']) {
    const n = Number(p[key]);
    if (Number.isFinite(n) && n >= 0) {
      elapsedRaw = n;
      break;
    }
  }
  return baseReturn({
    elapsedSec: elapsedRaw !== undefined ? elapsedRaw : elapsedFallback,
    errorScore: clamp(err, 0, 10),
    timeScore: clamp(tim, 0, 10),
    clickScore: clamp(clk, 0, 10),
    dragScore,
    final10
  });
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function scoreFromMoves(taskDef, moves, gamePayload = null) {
  const fromGame = scoringFromGamePayload(taskDef, gamePayload, moves);
  if (fromGame) return fromGame;

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

app.post('/api/auth/register', asyncRoute(async (req, res) => {
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
    const info = await qRun(
      `INSERT INTO users (username, password_hash, role, approved) VALUES (?, ?, ?, ?) RETURNING id`,
      [cleanUsername, passwordHash, cleanRole, 1]
    );
    return res.json({ ok: true, userId: info.lastInsertRowid });
  } catch (e) {
    const code = /** @type {{ code?: string }} */ (e).code;
    const msg = String(/** @type {Error} */ (e).message ?? '');
    if (USE_PG && code === '23505') return res.status(409).json({ error: 'username_taken' });
    if (!USE_PG && /UNIQUE constraint failed/i.test(msg)) return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const cleanUsername = username.trim();
  const user = await qGet(`SELECT id, username, password_hash, role, approved FROM users WHERE username = ?`, [
    cleanUsername
  ]);
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
  await qRun(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, [sessionId, user.id, expiresAt]);

  const cookieSecure = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    expires: new Date(expiresAt)
  });
  return res.json({ ok: true });
}));

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) await qRun(`DELETE FROM sessions WHERE id = ?`, [sid]);
  const cookieSecure = process.env.NODE_ENV === 'production';
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: cookieSecure });
  return res.json({ ok: true });
}));

app.get('/api/me', asyncRoute(async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    username: user.username,
    userId: user.userId,
    role: user.role,
    approved: user.approved
  });
}));

app.get('/api/tasks', requireAuth, requireStudent, (req, res) => {
  return res.json({ tasks: TASKS });
});

app.post('/api/teacher/students/upload', requireAuth, requireTeacher, asyncRoute(async (req, res) => {
  const { csvText } = req.body ?? {};
  if (typeof csvText !== 'string') return res.status(400).json({ error: 'bad_request' });

  const names = parseStudentNames(csvText);
  if (!names.length) return res.status(400).json({ error: 'no_students_found' });

  const created = [];

  try {
    if (USE_PG) {
      await withPgTransaction(async ({ run }) => {
        for (const name of names) {
          const base = usernameBaseFromName(name);
          let usernameCandidate = '';
          for (let tries = 0; tries < 20; tries++) {
            const suffix = Math.floor(1000 + Math.random() * 9000);
            const candidate = `st_${base}_${suffix}`;
            const hit = (await run(`SELECT 1 AS x FROM users WHERE username = ?`, [candidate])).rows[0];
            if (!hit) {
              usernameCandidate = candidate;
              break;
            }
          }
          if (!usernameCandidate) throw new Error('username_generation_failed');
          const password = generateReadablePassword();
          const passwordHash = sha256(`${usernameCandidate}\n${password}`);
          const ins = await run(
            `INSERT INTO users (username, password_hash, role, approved, created_by_teacher_id, display_name)
             VALUES (?, ?, 'student', 1, ?, ?) RETURNING id`,
            [usernameCandidate, passwordHash, req.user.userId, name]
          );
          const studentUserId = Number(ins.rows[0].id);
          await run(
            `INSERT INTO student_credentials (student_user_id, teacher_user_id, password_plain)
             VALUES (?, ?, ?)
             ON CONFLICT (student_user_id) DO UPDATE SET
               teacher_user_id = EXCLUDED.teacher_user_id,
               password_plain = EXCLUDED.password_plain`,
            [studentUserId, req.user.userId, password]
          );
          created.push({ name, username: usernameCandidate, password, createdAt: nowIso() });
        }
      });
    } else {
      const db = getSqliteDb();
      const insert = db.prepare(
        `INSERT INTO users (username, password_hash, role, approved, created_by_teacher_id, display_name)
         VALUES (?, ?, 'student', 1, ?, ?)`
      );
      const upsertCredential = db.prepare(
        `INSERT INTO student_credentials (student_user_id, teacher_user_id, password_plain)
         VALUES (?, ?, ?)
         ON CONFLICT (student_user_id) DO UPDATE SET
           teacher_user_id = excluded.teacher_user_id,
           password_plain = excluded.password_plain`
      );
      const exists = db.prepare(`SELECT 1 FROM users WHERE username = ?`);

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
      tx(names);
    }
  } catch {
    return res.status(500).json({ error: 'upload_failed' });
  }

  return res.json({ ok: true, count: created.length, credentials: created });
}));

app.get('/api/teacher/students/credentials', requireAuth, requireTeacher, asyncRoute(async (req, res) => {
  const rows = await qAll(
    `
      SELECT u.id, u.username, u.display_name, sc.password_plain, sc.created_at
      FROM users u
      JOIN student_credentials sc ON sc.student_user_id = u.id
      WHERE u.role = 'student' AND u.created_by_teacher_id = ?
      ORDER BY sc.created_at DESC, u.username ASC
      `,
    [req.user.userId]
  );

  return res.json({
    credentials: rows.map((r) => ({
      studentId: r.id,
      name: r.display_name ?? '',
      username: r.username,
      password: r.password_plain,
      createdAt: r.created_at
    }))
  });
}));

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

app.get('/api/teacher/students/results', requireAuth, requireTeacher, asyncRoute(async (req, res) => {
  const students = await qAll(
    `SELECT id, username, display_name
       FROM users
       WHERE role = 'student' AND created_by_teacher_id = ?
       ORDER BY display_name ASC, username ASC`,
    [req.user.userId]
  );

  const out = [];
  for (const s of students) {
    const a = await qGet(
      `SELECT id, user_id, started_at, finished_at
       FROM attempts
       WHERE user_id = ?
       ORDER BY started_at ASC
       LIMIT 1`,
      [s.id]
    );
    const taskMonitoring = {};

    if (a) {
      const rows = await qAll(
        `SELECT task_id, started_at, finished_at, breakdown_json, game_payload_json
       FROM attempt_tasks
       WHERE attempt_id = ?`,
        [a.id]
      );
      for (const r of rows) {
        const parsedBreakdown = r.breakdown_json ? safeJsonParse(r.breakdown_json) : null;
        const parsedPayload = r.game_payload_json ? safeJsonParse(r.game_payload_json) : null;
        const monitoring =
          parsedBreakdown && typeof parsedBreakdown === 'object' && (parsedBreakdown.normalized || parsedBreakdown.extra || parsedBreakdown.raw)
            ? parsedBreakdown
            : normalizeMonitoringFromFinishPayload(parsedPayload);
        taskMonitoring[r.task_id] = {
          startedAt: r.started_at ?? null,
          finishedAt: r.finished_at ?? null,
          monitoring
        };
      }
    }

    out.push({
      studentId: s.id,
      name: s.display_name ?? '',
      username: s.username,
      attemptId: a?.id ?? null,
      startedAt: a?.started_at ?? null,
      finishedAt: a?.finished_at ?? null,
      taskMonitoring
    });
  }

  return res.json({
    students: out,
    tasks: TASKS.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category
    }))
  });
}));

app.get('/api/teacher/students/results.csv', requireAuth, requireTeacher, asyncRoute(async (req, res) => {
  const students = await qAll(
    `SELECT id, username, display_name
       FROM users
       WHERE role = 'student' AND created_by_teacher_id = ?
       ORDER BY display_name ASC, username ASC`,
    [req.user.userId]
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
    const a = await qGet(
      `SELECT id, started_at, finished_at
       FROM attempts
       WHERE user_id = ?
       ORDER BY started_at ASC
       LIMIT 1`,
      [s.id]
    );
    const scoreMap = {};
    const breakdownMap = {};
    const cat = { A: { sum: 0, max: 0 }, B: { sum: 0, max: 0 }, C: { sum: 0, max: 0 } };
    if (a) {
      const rows = await qAll(
        `SELECT task_id, final_score, breakdown_json
       FROM attempt_tasks
       WHERE attempt_id = ?`,
        [a.id]
      );
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
}));

app.post('/api/attempts/start', requireAuth, requireStudent, asyncRoute(async (req, res) => {
  const existing = await qGet(
    `SELECT id, started_at, finished_at FROM attempts WHERE user_id = ? ORDER BY started_at ASC LIMIT 1`,
    [req.user.userId]
  );
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
  await qRun(`INSERT INTO attempts (id, user_id, seed) VALUES (?, ?, ?)`, [attemptId, req.user.userId, seed]);
  const created = await qGet(`SELECT started_at FROM attempts WHERE id = ?`, [attemptId]);

  for (let idx = 0; idx < TASKS.length; idx++) {
    const t = TASKS[idx];
    await qRun(`INSERT INTO attempt_tasks (attempt_id, task_id, task_index) VALUES (?, ?, ?)`, [
      attemptId,
      t.id,
      idx
    ]);
  }

  return res.json({
    ok: true,
    attemptId,
    existing: false,
    startedAt: created?.started_at ?? nowIso(),
    finishedAt: null
  });
}));

app.get('/api/attempts/current', requireAuth, requireStudent, asyncRoute(async (req, res) => {
  const row = await qGet(
    `
      SELECT id, started_at, finished_at, seed
      FROM attempts
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [req.user.userId]
  );
  return res.json({ attempt: row ?? null });
}));

app.get('/api/attempts/:attemptId/tasks', requireAuth, requireStudent, asyncRoute(async (req, res) => {
  const { attemptId } = req.params;
  const owned = await qGet(`SELECT 1 FROM attempts WHERE id = ? AND user_id = ?`, [attemptId, req.user.userId]);
  if (!owned) return res.status(403).json({ error: 'not_allowed' });

  const rows = await qAll(
    `
      SELECT task_id, task_index, started_at, finished_at, breakdown_json, game_payload_json
      FROM attempt_tasks
      WHERE attempt_id = ?
      ORDER BY task_index ASC
      `,
    [attemptId]
  );
  return res.json({
    tasks: rows.map((r) => ({
      taskId: r.task_id,
      taskIndex: r.task_index,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      monitoringAvailable: Boolean(r.finished_at && (r.breakdown_json || r.game_payload_json))
    }))
  });
}));

app.post('/api/attempts/end', requireAuth, requireStudent, asyncRoute(async (req, res) => {
  const { attemptId } = req.body ?? {};
  if (typeof attemptId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const info = await qRun(
    `
      UPDATE attempts
      SET finished_at = COALESCE(finished_at, ?)
      WHERE id = ? AND user_id = ?
      `,
    [nowIso(), attemptId, req.user.userId]
  );
  if (info.changes === 0) return res.status(404).json({ error: 'attempt_not_found' });
  return res.json({ ok: true });
}));

app.post('/api/moves', requireAuth, requireStudent, asyncRoute(async (req, res) => {
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

  const taskRow = await qGet(
    `SELECT 1 FROM attempt_tasks at
       JOIN attempts a ON a.id = at.attempt_id
       WHERE at.attempt_id = ? AND at.task_id = ? AND a.user_id = ? AND a.finished_at IS NULL`,
    [attemptId, taskId, req.user.userId]
  );
  if (!taskRow) return res.status(403).json({ error: 'not_allowed' });

  await qRun(
    `UPDATE attempt_tasks
     SET started_at = COALESCE(started_at, ?)
     WHERE attempt_id = ? AND task_id = ?`,
    [nowIso(), attemptId, taskId]
  );

  await qRun(`INSERT INTO moves (attempt_id, task_id, move_type, payload_json, penalty) VALUES (?, ?, ?, ?, ?)`, [
    attemptId,
    taskId,
    moveType,
    payloadJson,
    pen
  ]);

  return res.json({ ok: true });
}));

app.post('/api/tasks/finish', requireAuth, requireStudent, asyncRoute(async (req, res) => {
  const { attemptId, taskId, finalAnswer, gamePayload } = req.body ?? {};
  if (typeof attemptId !== 'string' || typeof taskId !== 'string') {
    return res.status(400).json({ error: 'bad_request' });
  }

  const taskDef = TASKS.find((t) => t.id === taskId);
  if (!taskDef) return res.status(404).json({ error: 'task_not_found' });

  const allowed = await qGet(
    `SELECT 1
       FROM attempt_tasks at
       JOIN attempts a ON a.id = at.attempt_id
       WHERE at.attempt_id = ? AND at.task_id = ? AND a.user_id = ? AND a.finished_at IS NULL`,
    [attemptId, taskId, req.user.userId]
  );
  if (!allowed) return res.status(403).json({ error: 'not_allowed' });

  const monitoring = normalizeMonitoringFromFinishPayload(gamePayload);

  const info = await qRun(
    `
      UPDATE attempt_tasks
      SET finished_at = COALESCE(finished_at, ?),
          breakdown_json = COALESCE(breakdown_json, ?),
          game_payload_json = COALESCE(game_payload_json, ?)
      WHERE attempt_id = ? AND task_id = ?
    `,
    [
      nowIso(),
      JSON.stringify(monitoring),
      gamePayload ? JSON.stringify(gamePayload) : null,
      attemptId,
      taskId
    ]
  );

  if (info.changes === 0) return res.status(404).json({ error: 'attempt_task_not_found' });
  return res.json({
    ok: true,
    monitoring,
    finalAnswer: finalAnswer ?? null
  });
}));

app.use(express.static(path.join(process.cwd(), 'public')));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

(async () => {
  await initDatabase();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `KingBebras running on http://localhost:${port}${USE_PG ? ' (PostgreSQL)' : ' (SQLite)'}`
    );
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

