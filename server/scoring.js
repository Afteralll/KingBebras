import { TASKS } from './tasks.js';

export const SUBSCORE_WEIGHTS = {
  errors: 0.5,
  time: 0.25,
  clicks: 0.15,
  resets: 0.1
};

export const SUBSCORE_THRESHOLDS = {
  timeSecondsPerPoint: 60,
  clicksPerPoint: 10,
  resetPenaltyPerUnit: 1
};

/** Fallback decrement when a task id is missing from {@link TASK_ERROR_DECREMENTS}. */
export const DEFAULT_ERROR_DECREMENT = 0.5;

/**
 * Per-task error decrement for error_score = max(0, 10 - decrement * errors).
 * `null` means the task has no error sub-score (weight redistributes to other metrics).
 * @type {Record<string, number | null>}
 */
export const TASK_ERROR_DECREMENTS = {
  'magic-house-3': 1.0,
  'sudoku-2': 1.6,
  'organizing-bracelets-3': 1.6,
  'bbq-party-2': 3.33,
  planes: 1.25,
  'journey-to-the-hive-3': 2.0,
  'cube-game-1': null,
  'golden-ticket': 0.5,
  'online-class-picture-flow': 1.1,
  'burger-recipe-2': 1.25,
  'remembering-faces-2': 0.58,
  'tug-of-war-2': 1.0
};

/** @param {string | null | undefined} taskId */
export function getTaskErrorDecrement(taskId) {
  if (!taskId) return DEFAULT_ERROR_DECREMENT;
  if (Object.prototype.hasOwnProperty.call(TASK_ERROR_DECREMENTS, taskId)) {
    return TASK_ERROR_DECREMENTS[taskId];
  }
  return DEFAULT_ERROR_DECREMENT;
}

export const GIVE_UP_PENALTY = 0.5;

export const DIFFICULTY_WEIGHTS = {
  A: 0.22,
  B: 0.33,
  C: 0.45
};

export const TOTAL_DIFFICULTY_WEIGHT = 4.0;

export const ONLINE_CLASS_TASK_ID = 'online-class-picture-flow';

export const CT_SKILL_KEYS = [
  'decomposition',
  'pattern_recognition',
  'abstraction',
  'modelling_simulation',
  'algorithms',
  'evaluation',
  'logical_reasoning'
];

/** @type {Record<string, string[]>} */
export const TASK_CT_SKILLS = {
  'magic-house-3': ['decomposition', 'pattern_recognition', 'abstraction', 'logical_reasoning'],
  'sudoku-2': ['decomposition', 'algorithms'],
  'organizing-bracelets-3': ['pattern_recognition', 'abstraction'],
  'bbq-party-2': ['logical_reasoning'],
  planes: ['algorithms', 'evaluation', 'logical_reasoning'],
  'journey-to-the-hive-3': ['pattern_recognition', 'algorithms', 'evaluation'],
  'cube-game-1': ['decomposition', 'logical_reasoning'],
  'golden-ticket': ['decomposition', 'algorithms', 'evaluation', 'logical_reasoning'],
  'online-class-picture-flow': ['logical_reasoning'],
  'burger-recipe-2': [
    'decomposition',
    'pattern_recognition',
    'modelling_simulation',
    'algorithms',
    'evaluation'
  ],
  'remembering-faces-2': [
    'decomposition',
    'pattern_recognition',
    'modelling_simulation',
    'algorithms',
    'evaluation'
  ],
  'tug-of-war-2': ['decomposition', 'modelling_simulation', 'algorithms', 'evaluation']
};

function clamp(x, min, max) {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function toNum(v) {
  if (v == null) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} raw
 * @param {string | null | undefined} taskId
 */
export function extractRawMetrics(raw, taskId) {
  const empty = {
    errors: null,
    time_seconds: null,
    clicks: null,
    resets: null,
    give_up_flag: null,
    logic_flag: null
  };
  if (!raw || typeof raw !== 'object') return empty;

  let errors = toNum(raw.totalErrors);
  if (errors == null) errors = toNum(raw.errorScore);

  let time_seconds =
    toNum(raw.time) ??
    toNum(raw.seconds) ??
    toNum(raw.totalTime) ??
    toNum(raw.elapsedSec) ??
    toNum(raw.timeElapsed);
  if (time_seconds == null) time_seconds = toNum(raw.timeScore);

  let clicks = toNum(raw.clicks) ?? toNum(raw.clickCount);
  if (clicks == null) clicks = toNum(raw.clickScore);

  let resets = toNum(raw.resets) ?? toNum(raw.resetCount) ?? toNum(raw.resetCounter);

  let give_up_flag = null;
  const giveUpRaw = raw.giveUpFlag ?? raw.giveUp;
  if (giveUpRaw != null) {
    const g = toNum(giveUpRaw);
    give_up_flag = g != null ? (g !== 0 ? 1 : 0) : giveUpRaw ? 1 : 0;
  }

  let logic_flag = null;
  if (taskId === ONLINE_CLASS_TASK_ID) {
    const lf = raw.logicFlag ?? raw.logicScore ?? raw.logicalReasoningFlag;
    if (lf != null) {
      const lfn = toNum(lf);
      logic_flag = lfn != null ? (lfn !== 0 ? 1 : 0) : lf ? 1 : 0;
    }
  }

  return { errors, time_seconds, clicks, resets, give_up_flag, logic_flag };
}

/**
 * @param {ReturnType<typeof extractRawMetrics>} rawMetrics
 * @param {string | null | undefined} taskId
 */
export function computeSubScores(rawMetrics, taskId) {
  const out = {
    error_score: null,
    time_score: null,
    click_score: null,
    reset_score: null
  };

  const errorDecrement = getTaskErrorDecrement(taskId);
  if (rawMetrics.errors != null && errorDecrement != null) {
    let effectiveErrors = rawMetrics.errors;
    if (taskId === ONLINE_CLASS_TASK_ID && rawMetrics.logic_flag === 0) {
      effectiveErrors += 1;
    }
    out.error_score = clamp(10 - errorDecrement * effectiveErrors, 0, 10);
  }

  if (rawMetrics.time_seconds != null) {
    out.time_score = clamp(
      10 - Math.floor(rawMetrics.time_seconds / SUBSCORE_THRESHOLDS.timeSecondsPerPoint),
      0,
      10
    );
  }

  if (rawMetrics.clicks != null) {
    out.click_score = clamp(
      10 - Math.floor(rawMetrics.clicks / SUBSCORE_THRESHOLDS.clicksPerPoint),
      0,
      10
    );
  }

  if (rawMetrics.resets != null) {
    out.reset_score = clamp(
      10 - rawMetrics.resets * SUBSCORE_THRESHOLDS.resetPenaltyPerUnit,
      0,
      10
    );
  }

  return out;
}

/**
 * @param {ReturnType<typeof extractRawMetrics>} rawMetrics
 * @param {ReturnType<typeof computeSubScores>} subScores
 */
export function computeTaskScore(rawMetrics, subScores) {
  /** @type {Array<[keyof typeof SUBSCORE_WEIGHTS, number]>} */
  const logged = [];
  if (rawMetrics.errors != null && subScores.error_score != null) {
    logged.push(['errors', subScores.error_score]);
  }
  if (rawMetrics.time_seconds != null && subScores.time_score != null) {
    logged.push(['time', subScores.time_score]);
  }
  if (rawMetrics.clicks != null && subScores.click_score != null) {
    logged.push(['clicks', subScores.click_score]);
  }
  if (rawMetrics.resets != null && subScores.reset_score != null) {
    logged.push(['resets', subScores.reset_score]);
  }

  if (!logged.length) {
    return { task_score: 0, raw_task_score: 0, rescaled_weights: {} };
  }

  let totalWeight = 0;
  for (const [key] of logged) totalWeight += SUBSCORE_WEIGHTS[key];

  let raw_task_score = 0;
  /** @type {Record<string, number>} */
  const rescaled_weights = {};
  for (const [key, sub] of logged) {
    const w = SUBSCORE_WEIGHTS[key] / totalWeight;
    rescaled_weights[key] = w;
    raw_task_score += w * sub;
  }

  if (rawMetrics.give_up_flag === 1) {
    raw_task_score -= GIVE_UP_PENALTY;
  }

  return {
    task_score: clamp(raw_task_score, 0, 10),
    raw_task_score,
    rescaled_weights
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} gamePayload
 * @param {string} taskId
 */
export function computeTaskScoringFromPayload(gamePayload, taskId) {
  const rawMetrics = extractRawMetrics(gamePayload, taskId);
  const subScores = computeSubScores(rawMetrics, taskId);
  const composite = computeTaskScore(rawMetrics, subScores);
  return {
    rawMetrics,
    ...subScores,
    ...composite
  };
}

/** @param {'A' | 'B' | 'C' | string | null | undefined} category */
export function getDifficultyWeight(category) {
  return DIFFICULTY_WEIGHTS[category] ?? 0;
}

/**
 * @param {Record<string, number>} taskScoresByTaskId taskId -> task_score (0-10)
 */
export function computeExamSummary(taskScoresByTaskId) {
  /** @type {Record<string, number>} */
  const perTaskScores = {};
  for (const task of TASKS) {
    perTaskScores[task.id] = Number(taskScoresByTaskId[task.id] ?? 0) || 0;
  }

  let weightedSum = 0;
  for (const task of TASKS) {
    weightedSum += perTaskScores[task.id] * getDifficultyWeight(task.category);
  }
  const final_exam_score = (weightedSum / TOTAL_DIFFICULTY_WEIGHT) * 10;

  /** @type {Record<string, number>} */
  const skillScores = {};
  for (const skillKey of CT_SKILL_KEYS) {
    let sum = 0;
    let weightSum = 0;
    for (const task of TASKS) {
      if (!TASK_CT_SKILLS[task.id]?.includes(skillKey)) continue;
      const dw = getDifficultyWeight(task.category);
      sum += perTaskScores[task.id] * dw;
      weightSum += dw;
    }
    skillScores[`skill_${skillKey}_score`] = weightSum > 0 ? (sum / weightSum) * 10 : 0;
  }

  return {
    final_exam_score,
    perTaskScores,
    ...skillScores
  };
}

/**
 * @param {{ task_id: string, finished_at?: unknown, final_score?: unknown, game_payload_json?: string | null, breakdown_json?: string | null }} row
 * @param {(json: string | null | undefined) => unknown} safeJsonParse
 */
export function resolveTaskComputedScores(row, safeJsonParse) {
  const breakdown =
    row.breakdown_json && typeof row.breakdown_json === 'string'
      ? safeJsonParse(row.breakdown_json)
      : row.breakdown_json;
  if (breakdown?.computed && typeof breakdown.computed === 'object') {
    return breakdown.computed;
  }

  const payload =
    row.game_payload_json && typeof row.game_payload_json === 'string'
      ? safeJsonParse(row.game_payload_json)
      : row.game_payload_json;
  if (payload && typeof payload === 'object') {
    return computeTaskScoringFromPayload(payload, row.task_id);
  }

  const finalScore = Number(row.final_score);
  return {
    task_score: Number.isFinite(finalScore) ? finalScore : 0,
    error_score: null,
    time_score: null,
    click_score: null,
    reset_score: null,
    rawMetrics: extractRawMetrics(null, row.task_id)
  };
}
