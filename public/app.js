import { teacherT, translateWeightsLine, currentTeacherLang } from './teacher-i18n.js';
import { applyUiI18n, currentUiLang, uiT } from './ui-i18n.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  tasks: [],
  attemptId: null,
  activeTask: null,
  resultsByTaskId: {},
  examEndsAt: null,
  generatedCredentials: [],
  teacherResultsPayload: null,
  teacherCredentialsLoaded: false
};

let timerIntervalId = null;
const EXAM_DURATION_MS = 45 * 60 * 1000;

let translateScriptLoading = false;
let translateReady = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureGoogleTranslateLoaded() {
  if (translateReady) return Promise.resolve();
  if (window.google?.translate?.TranslateElement) {
    if (!document.querySelector('#google_translate_element .goog-te-combo')) {
      // eslint-disable-next-line no-new
      new window.google.translate.TranslateElement(
        { pageLanguage: 'en', autoDisplay: false },
        'google_translate_element'
      );
    }
    translateReady = true;
    return Promise.resolve();
  }
  if (translateScriptLoading) {
    return new Promise((resolve) => {
      const check = () => {
        if (translateReady) return resolve();
        setTimeout(check, 100);
      };
      check();
    });
  }

  translateScriptLoading = true;
  return new Promise((resolve, reject) => {
    window.googleTranslateElementInit = () => {
      // eslint-disable-next-line no-new
      new window.google.translate.TranslateElement(
        { pageLanguage: 'en', autoDisplay: false },
        'google_translate_element'
      );
      translateReady = true;
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onerror = () => reject(new Error('translate_load_failed'));
    document.body.appendChild(script);
  });
}

function setGoogTransCookie(lang) {
  // cookie format: /<source>/<target>
  const target = lang === 'de' || lang === 'ar' ? lang : 'en';
  const value = `/en/${target}`;
  document.cookie = `googtrans=${encodeURIComponent(value)}; path=/`;
}

async function translatePageTo(lang) {
  setGoogTransCookie(lang);
  await ensureGoogleTranslateLoaded();
  for (let i = 0; i < 40; i++) {
    const combo = document.querySelector('.goog-te-combo');
    if (combo) {
      combo.value = lang;
      combo.dispatchEvent(new Event('change'));
      return true;
    }
    await wait(100);
  }
  return false;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    ...opts
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error ?? 'request_failed'), { res, json });
  return json;
}

function show(el, yes) {
  el.style.display = yes ? '' : 'none';
}

function setAlert(el, kind, msg) {
  if (!msg) return show(el, false);
  el.classList.remove('ok', 'bad');
  el.classList.add(kind);
  el.textContent = msg;
  show(el, true);
}

function isExamRunning() {
  return Boolean(state.attemptId && state.examEndsAt && Date.now() < state.examEndsAt);
}

function parseServerDate(value) {
  if (!value) return NaN;
  if (typeof value !== 'string') return NaN;
  // SQLite datetime('now') format: YYYY-MM-DD HH:MM:SS
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    const ts = Date.parse(value.replace(' ', 'T') + 'Z');
    if (Number.isFinite(ts)) return ts;
  }
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) return ts;
  return NaN;
}

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderTimer() {
  const timerEl = $('#examTimer');
  if (!timerEl) return;
  if (!state.examEndsAt) {
    timerEl.textContent = '45:00';
    show(timerEl, false);
    return;
  }
  show(timerEl, true);
  timerEl.textContent = formatRemaining(state.examEndsAt - Date.now());
}

function renderExamControls() {
  const startBtn = $('#startExamBtn');
  const endBtn = $('#endExamBtn');
  if (!startBtn || !endBtn) return;
  const hasAttempt = Boolean(state.attemptId);
  const running = isExamRunning();
  startBtn.disabled = hasAttempt; // once exam started, never start again
  endBtn.disabled = !running;
}

function stopExamTimer() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function startExamTimer() {
  stopExamTimer();
  renderTimer();
  timerIntervalId = setInterval(async () => {
    if (!state.examEndsAt) {
      stopExamTimer();
      return;
    }
    const remaining = state.examEndsAt - Date.now();
    renderTimer();
    if (remaining > 0) return;
    stopExamTimer();
    await endChallenge(true);
  }, 1000);
}

function renderMe() {
  const me = $('#me');
  if (!state.me?.authenticated) {
    me.textContent = uiT('not_logged_in');
    show($('#logoutBtn'), false);
    show($('#authCard'), true);
    show($('#sessionCard'), false);
    show($('#teacherCard'), false);
    show($('#taskCard'), false);
    show($('#examTimer'), false);
    renderExamControls();
    return;
  }
  me.textContent = uiT(
    'logged_in_as',
    {
      username: state.me.username,
      rolePart: state.me.role ? ` (${state.me.role})` : ''
    },
    currentUiLang()
  );
  show($('#logoutBtn'), true);
  show($('#authCard'), false);
  const isTeacher = state.me.role === 'teacher';
  show($('#teacherCard'), isTeacher);
  show($('#sessionCard'), !isTeacher);
  show($('#taskCard'), !isTeacher && Boolean(state.activeTask));
  show($('#examTimer'), !isTeacher && Boolean(state.examEndsAt));
  renderExamControls();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }
}

function flashCopied(btn, lang) {
  const prev = btn.textContent;
  btn.textContent = teacherT(lang, 'copied');
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = prev;
    btn.disabled = false;
  }, 1200);
}

function formatTeacherDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function getRawMetricPairs(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.keys(raw)
    .sort((a, b) => a.localeCompare(b))
    .filter((k) => {
      if (k === 'totalScore' && Object.prototype.hasOwnProperty.call(raw, 'errorScore')) return false;
      return true;
    })
    .map((k) => {
      const v = raw[k];
      const valueStr =
        v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
      return { key: k, value: valueStr };
    })
    .filter((p) => p.value !== '');
}

function credentialsPlainText(rows, lang) {
  const t = (k) => teacherT(lang, k);
  return rows
    .map((r, idx) => {
      const createdAt = r.createdAt ? ` | ${t('created')}: ${r.createdAt}` : '';
      return `${idx + 1}. ${r.name} | ${r.username} | ${r.password}${createdAt}`;
    })
    .join('\n');
}

function applyTeacherStaticI18n() {
  const lang = currentTeacherLang();
  document.querySelectorAll('[data-teacher-i18n]').forEach((el) => {
    const key = el.getAttribute('data-teacher-i18n');
    if (key) el.textContent = teacherT(lang, key);
  });
}

function renderGeneratedCredentials() {
  const container = $('#generatedCredentials');
  const countEl = $('#credentialsCount');
  if (!container) return;

  const lang = currentTeacherLang();
  const t = (k) => teacherT(lang, k);
  const rows = state.generatedCredentials ?? [];

  if (countEl) countEl.textContent = rows.length ? `${rows.length} ${t('accounts')}` : '';

  container.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'teacher-empty';
    empty.textContent = t('no_credentials');
    container.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'teacher-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['#', t('csv_name'), t('csv_username'), t('col_password'), t('created'), '']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');

    const num = document.createElement('td');
    num.className = 'teacher-num';
    num.textContent = String(idx + 1);
    tr.append(num);

    const nameTd = document.createElement('td');
    nameTd.className = 'teacher-name';
    nameTd.textContent = (r.name || '').trim() || t('noName');
    tr.append(nameTd);

    const userTd = document.createElement('td');
    const userCode = document.createElement('code');
    userCode.className = 'teacher-mono';
    userCode.textContent = r.username ?? '';
    userTd.append(userCode);
    tr.append(userTd);

    const passTd = document.createElement('td');
    passTd.className = 'teacher-password-cell';
    const passWrap = document.createElement('div');
    passWrap.className = 'teacher-password-wrap';
    const passCode = document.createElement('code');
    passCode.className = 'teacher-mono teacher-password';
    passCode.textContent = r.password ?? '';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-sm btn-icon';
    toggleBtn.textContent = t('show_password');
    let revealed = false;
    toggleBtn.addEventListener('click', () => {
      revealed = !revealed;
      passCode.classList.toggle('is-hidden', !revealed);
      toggleBtn.textContent = t(revealed ? 'hide_password' : 'show_password');
      toggleBtn.setAttribute('aria-label', toggleBtn.textContent);
    });
    toggleBtn.setAttribute('aria-label', t('show_password'));
    passCode.classList.add('is-hidden');
    passWrap.append(passCode, toggleBtn);
    passTd.append(passWrap);
    tr.append(passTd);

    const createdTd = document.createElement('td');
    createdTd.className = 'teacher-date';
    createdTd.textContent = formatTeacherDate(r.createdAt);
    tr.append(createdTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'teacher-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-sm';
    copyBtn.textContent = t('copy_row');
    const line = `${(r.name || '').trim() || t('noName')}\t${r.username}\t${r.password}`;
    copyBtn.addEventListener('click', async () => {
      await copyText(line);
      flashCopied(copyBtn, lang);
    });
    actionsTd.append(copyBtn);
    tr.append(actionsTd);

    tbody.append(tr);
  });

  table.append(tbody);
  container.append(table);
}

function renderTeacherResultsPreview() {
  const container = $('#teacherResults');
  const countEl = $('#marksCount');
  const subtitleEl = $('#marksSubtitle');
  if (!container) return;

  const lang = currentTeacherLang();
  const t = (k) => teacherT(lang, k);
  const res = state.teacherResultsPayload;
  const students = res?.students ?? [];
  const tasks = res?.tasks ?? [];

  if (subtitleEl) subtitleEl.textContent = t('monitoringTitleLine');
  if (countEl) countEl.textContent = students.length ? `${students.length} ${t('students_label')}` : '';

  container.innerHTML = '';
  if (!students.length) {
    const empty = document.createElement('div');
    empty.className = 'teacher-empty';
    empty.textContent = t('no_marks');
    container.append(empty);
    return;
  }

  for (const s of students) {
    let statusKey = 'statusNotStarted';
    if (s.finishedAt) statusKey = 'statusFinished';
    else if (s.startedAt) statusKey = 'statusStarted';

    const card = document.createElement('article');
    card.className = 'teacher-student-card';

    const header = document.createElement('div');
    header.className = 'teacher-student-header';

    const identity = document.createElement('div');
    identity.className = 'teacher-student-identity';
    const nameEl = document.createElement('div');
    nameEl.className = 'teacher-student-name';
    nameEl.textContent = (s.name || '').trim() || t('noName');
    const userEl = document.createElement('div');
    userEl.className = 'teacher-student-user muted';
    userEl.textContent = s.username ?? '';
    identity.append(nameEl, userEl);

    const status = document.createElement('span');
    status.className = `teacher-status ${statusKey === 'statusFinished' ? 'is-finished' : statusKey === 'statusStarted' ? 'is-started' : 'is-idle'}`;
    status.textContent = t(statusKey);
    header.append(identity, status);
    card.append(header);

    const meta = document.createElement('div');
    meta.className = 'teacher-student-meta';
    const started = document.createElement('span');
    const startedLbl = document.createElement('strong');
    startedLbl.textContent = t('attemptStartedAt');
    started.append(startedLbl, ' ', document.createTextNode(formatTeacherDate(s.startedAt)));
    const finished = document.createElement('span');
    const finishedLbl = document.createElement('strong');
    finishedLbl.textContent = t('attemptFinishedAt');
    finished.append(finishedLbl, ' ', document.createTextNode(formatTeacherDate(s.finishedAt)));
    meta.append(started, finished);
    card.append(meta);

    const taskList = document.createElement('div');
    taskList.className = 'teacher-task-list';
    let hasActivity = false;

    for (const task of tasks) {
      const tm = s.taskMonitoring?.[task.id] ?? null;
      if (!tm?.finishedAt && !tm?.startedAt) continue;
      hasActivity = true;

      const taskCard = document.createElement('div');
      taskCard.className = 'teacher-task-card';

      const taskHead = document.createElement('div');
      taskHead.className = 'teacher-task-head';
      const title = document.createElement('span');
      title.className = 'teacher-task-title';
      title.textContent = task.title;
      const cat = document.createElement('span');
      cat.className = `teacher-cat cat-${(task.category || '').toLowerCase()}`;
      cat.textContent = task.category ?? '';
      taskHead.append(title, cat);
      taskCard.append(taskHead);

      const raw = tm?.monitoring?.raw ?? null;
      const pairs = getRawMetricPairs(raw);
      if (pairs.length) {
        const metrics = document.createElement('div');
        metrics.className = 'teacher-metrics';
        for (const { key, value } of pairs) {
          const chip = document.createElement('span');
          chip.className = 'teacher-metric';
          const k = document.createElement('span');
          k.className = 'teacher-metric-key';
          k.textContent = key;
          const v = document.createElement('span');
          v.className = 'teacher-metric-val';
          v.textContent = value;
          chip.append(k, v);
          metrics.append(chip);
        }
        taskCard.append(metrics);
      }

      taskList.append(taskCard);
    }

    if (!hasActivity) {
      const idle = document.createElement('p');
      idle.className = 'teacher-no-activity muted';
      idle.textContent = t('no_task_activity');
      card.append(idle);
    } else {
      card.append(taskList);
    }

    container.append(card);
  }
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function buildTeacherCsv(res, lang) {
  const t = (key) => teacherT(lang, key);
  const students = res.students ?? [];
  const taskIds = (res.tasks ?? []).map((x) => x.id);
  const rawKeysByTask = {};
  for (const tid of taskIds) rawKeysByTask[tid] = new Set();
  for (const s of students) {
    for (const tid of taskIds) {
      const raw = s?.taskMonitoring?.[tid]?.monitoring?.raw;
      if (!raw || typeof raw !== 'object') continue;
      for (const k of Object.keys(raw)) {
        if (k === 'totalScore' && Object.prototype.hasOwnProperty.call(raw, 'errorScore')) continue;
        rawKeysByTask[tid].add(k);
      }
    }
  }

  const header = [
    t('csv_name'),
    t('csv_username'),
    t('csv_attempt_id'),
    t('csv_started_at'),
    t('csv_finished_at'),
    ...taskIds.flatMap((tid) => {
      const keys = Array.from(rawKeysByTask[tid] ?? []).sort((a, b) => a.localeCompare(b));
      return [
        ...keys.map((k) => `${tid}__${k}`)
      ];
    })
  ];
  const lines = [header.map(csvEscape).join(',')];

  for (const s of students) {
    const row = [
      s.name ?? '',
      s.username,
      s.attemptId ?? '',
      s.startedAt ?? '',
      s.finishedAt ?? '',
      ...taskIds.flatMap((tid) => {
        const tm = s?.taskMonitoring?.[tid] ?? null;
        const raw = tm?.monitoring?.raw && typeof tm.monitoring.raw === 'object' ? tm.monitoring.raw : null;
        const keys = Array.from(rawKeysByTask[tid] ?? []).sort((a, b) => a.localeCompare(b));
        return [
          ...keys.map((k) => {
            const v = raw ? raw[k] : null;
            if (v == null) return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean') return String(v);
            return JSON.stringify(v);
          })
        ];
      })
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function rerenderTeacherLocalized() {
  if (state.me?.role !== 'teacher') return;
  applyTeacherStaticI18n();
  renderGeneratedCredentials();
  if (state.teacherResultsPayload) renderTeacherResultsPreview();
}

async function refreshTeacherCredentials() {
  const res = await api('/api/teacher/students/credentials');
  state.generatedCredentials = res.credentials ?? [];
  state.teacherCredentialsLoaded = true;
  renderGeneratedCredentials();
}

function renderTasks() {
  const list = $('#tasksList');
  list.innerHTML = '';
  state.tasks.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = 'taskItem';
    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${idx + 1}. ${t.title}`;
    const sub = document.createElement('small');
    sub.textContent = `${t.id}${t.category ? ` • Difficulty ${t.category}` : ''}`;
    left.append(title, document.createElement('br'), sub);

    const r = state.resultsByTaskId?.[t.id] ?? null;
    const right = document.createElement('div');
    right.className = 'taskActions';

    const btn = document.createElement('button');
    const isFinished = Boolean(r);
    const canOpen = Boolean(state.attemptId) && isExamRunning() && !isFinished;
    btn.className = `btn${isFinished ? ' done' : ''}`;
    btn.textContent = isFinished ? 'Finished' : canOpen ? 'Open' : 'Locked';
    btn.disabled = !canOpen;
    if (canOpen) {
      btn.addEventListener('click', () => openTask(t));
    }

    right.append(btn);
    if (isFinished) {
      const status = document.createElement('span');
      status.className = 'taskScore';
      status.textContent = uiT('game_finished');
      right.append(status);
    }

    item.append(left, right);
    list.append(item);
  });
  renderExamControls();
}

function enterTaskFullscreen() {
  const frame = $('#taskFrame');
  const wrap = $('#taskFrameWrap') ?? frame;
  const el = frame ?? wrap;
  if (!el?.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen().catch(() => {});
}

function openTask(task) {
  if (!isExamRunning()) {
    setAlert($('#sessionMsg'), 'bad', uiT('start_exam_first'));
    return;
  }
  if (state.resultsByTaskId?.[task.id]) {
    setAlert($('#sessionMsg'), 'bad', uiT('game_already_finished'));
    return;
  }
  state.activeTask = task;
  $('#taskTitle').textContent = task.title;
  $('#taskMeta').textContent = `Task id: ${task.id}${task.category ? ` • Difficulty ${task.category}` : ''} • Max score: ${task.maxScore ?? 100}`;
  const frame = $('#taskFrame');
  const lang = $('#translateLang')?.value ?? 'en';
  try {
    localStorage.setItem('kb_lang', lang);
  } catch {
    // ignore
  }
  const baseUrl = task.url ?? `/tasks/${task.id}/index.html`;
  frame.src = baseUrl.includes('?') ? `${baseUrl}&lang=${encodeURIComponent(lang)}` : `${baseUrl}?lang=${encodeURIComponent(lang)}`;
  show($('#taskCard'), true);
  setAlert($('#taskMsg'), 'ok', null);
  // Opening a game should immediately go fullscreen.
  enterTaskFullscreen();
}

function closeTaskFrame() {
  const frame = $('#taskFrame');
  frame.src = 'about:blank';
  show($('#taskCard'), false);
  state.activeTask = null;

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!state.activeTask) return;
    if (e.key !== 'Escape') return;
    // Keep task view locked while a game is active.
    e.preventDefault();
    e.stopPropagation();
  },
  true
);

document.addEventListener('fullscreenchange', () => {
  if (!state.activeTask) return;
  if (document.fullscreenElement) return;
  // If fullscreen is dismissed (e.g. Escape), immediately restore it.
  enterTaskFullscreen();
});

async function refreshMe() {
  state.me = await api('/api/me');
  renderMe();
  if (state.me?.authenticated) {
    if (state.me.role === 'teacher') {
      applyTeacherStaticI18n();
      state.tasks = [];
      state.attemptId = null;
      state.examEndsAt = null;
      state.resultsByTaskId = {};
      renderTimer();
      renderTasks();
      if (!state.teacherCredentialsLoaded) {
        try {
          await refreshTeacherCredentials();
        } catch {
          // non-fatal; teacher can retry manually
        }
      } else {
        renderGeneratedCredentials();
      }
      try {
        await refreshTeacherMarks();
      } catch {
        renderTeacherResultsPreview();
      }
      renderExamControls();
      return;
    }
    const { tasks } = await api('/api/tasks');
    state.tasks = tasks;
    const current = await api('/api/attempts/current');
    state.attemptId = current.attempt?.id ?? null;
    $('#attemptId').textContent = state.attemptId ?? '—';
    state.examEndsAt = null;
    state.resultsByTaskId = {};

    if (state.attemptId) {
      const startedAtMs = parseServerDate(current.attempt?.started_at);
      const finishedAtMs = parseServerDate(current.attempt?.finished_at);
      if (Number.isFinite(startedAtMs) && !Number.isFinite(finishedAtMs)) {
        const endsAt = startedAtMs + EXAM_DURATION_MS;
        state.examEndsAt = endsAt;
        if (endsAt > Date.now()) {
          startExamTimer();
          setAlert($('#sessionMsg'), 'ok', uiT('exam_resumed'));
        }
      }
      const { tasks: attemptTasks } = await api(`/api/attempts/${state.attemptId}/tasks`);
      for (const row of attemptTasks) {
        if (!row?.finishedAt) continue;
        state.resultsByTaskId[row.taskId] = { finished: true };
      }
    }
    renderTimer();
    renderTasks();
    renderExamControls();
    if (state.attemptId && state.examEndsAt && state.examEndsAt <= Date.now()) {
      await endChallenge(true);
    }
  }
}

async function createAttempt() {
  const res = await api('/api/attempts/start', { method: 'POST', body: '{}' });
  state.attemptId = res.attemptId;
  $('#attemptId').textContent = state.attemptId;
  return res;
}

async function startExam() {
  if (state.me?.role === 'teacher') {
    setAlert($('#sessionMsg'), 'bad', uiT('teacher_cannot_start'));
    return;
  }
  if (state.attemptId) {
    setAlert($('#sessionMsg'), 'bad', uiT('exam_already_started'));
    return;
  }
  const startRes = await createAttempt();
  state.resultsByTaskId = {};
  const startedAtMs = Number.isFinite(parseServerDate(startRes?.startedAt))
    ? parseServerDate(startRes?.startedAt)
    : Date.now();
  state.examEndsAt = startedAtMs + EXAM_DURATION_MS;
  if (state.examEndsAt <= Date.now()) {
    await endChallenge(true);
    return;
  }
  startExamTimer();
  closeTaskFrame();
  renderTimer();
  renderTasks();
  renderExamControls();
  setAlert($('#sessionMsg'), 'ok', uiT('exam_started'));
}

async function finishTask(gamePayload = null) {
  if (!state.activeTask || !state.attemptId) return;
  const taskId = state.activeTask.id;
  const attemptId = state.attemptId;

  // Close the iframe and update the UI immediately so a single Finish/Give-Up
  // press is enough even when the server is slow (e.g. cold-starting free tier).
  state.resultsByTaskId[taskId] = { finished: true };
  renderTasks();
  setAlert($('#taskMsg'), 'ok', uiT('game_finished'));
  closeTaskFrame();

  // Persist scores in the background; network hiccups won't block the UX.
  try {
    await api('/api/tasks/finish', {
      method: 'POST',
      body: JSON.stringify({
        attemptId,
        taskId,
        finalAnswer: null,
        gamePayload: gamePayload ?? null
      })
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('finishTask save failed', err);
  }
}

async function endChallenge(auto = false) {
  if (!state.attemptId) return;
  if (!state.examEndsAt && !auto) return;

  const attemptId = state.attemptId;
  if (state.activeTask) {
    closeTaskFrame();
  }

  try {
    const { tasks: attemptTasks } = await api(`/api/attempts/${attemptId}/tasks`);
    const startedUnfinished = attemptTasks.filter((row) => row.startedAt && !row.finishedAt);
    for (const row of startedUnfinished) {
      try {
        const res = await api('/api/tasks/finish', {
          method: 'POST',
          body: JSON.stringify({
            attemptId,
            taskId: row.taskId,
            finalAnswer: null
          })
        });
        state.resultsByTaskId[row.taskId] = {
          finished: true
        };
      } catch {
        // continue finalizing remaining started tasks
      }
    }
    await api('/api/attempts/end', {
      method: 'POST',
      body: JSON.stringify({ attemptId })
    });
  } finally {
    state.examEndsAt = null;
    stopExamTimer();
    renderTimer();
    renderTasks();
    renderExamControls();
  }

  setAlert($('#sessionMsg'), 'ok', auto ? uiT('time_up_auto_submit') : uiT('challenge_submitted'));
}

async function logMove(evt) {
  const { taskId, moveType, payload, penalty } = evt;
  if (!state.attemptId) return;
  if (!taskId || !moveType) return;
  await api('/api/moves', {
    method: 'POST',
    body: JSON.stringify({
      attemptId: state.attemptId,
      taskId,
      moveType,
      payload: payload ?? {},
      penalty: Number.isFinite(penalty) ? penalty : 0
    })
  });
}

window.addEventListener('message', async (e) => {
  if (e.origin !== window.location.origin) return;
  const msg = e.data;
  if (!msg) return;
  if (msg.kind === 'kb_finish') {
    try {
      await finishTask(msg.payload ?? null);
    } catch (err) {
      // non-fatal; keep UX smooth even if finish call hiccups
    }
    return;
  }
  if (msg.kind !== 'kb_move') return;
  try {
    await logMove(msg);
  } catch (err) {
    // non-fatal; keep UX smooth even if logging hiccups
  }
});

$('#loginBtn').addEventListener('click', async () => {
  setAlert($('#authMsg'), 'ok', null);
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value, password: $('#password').value })
    });
    await refreshMe();
  } catch (e) {
    setAlert($('#authMsg'), 'bad', uiT('login_failed', { err: e.json?.error ?? 'unknown' }));
  }
});

$('#registerBtn').addEventListener('click', async () => {
  setAlert($('#authMsg'), 'ok', null);
  try {
    const role = 'teacher';
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value, password: $('#password').value, role })
    });
    setAlert($('#authMsg'), 'ok', uiT('registered_now_login'));
  } catch (e) {
    setAlert($('#authMsg'), 'bad', uiT('register_failed', { err: e.json?.error ?? 'unknown' }));
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  stopExamTimer();
  state.attemptId = null;
  state.activeTask = null;
  state.resultsByTaskId = {};
  state.examEndsAt = null;
  state.teacherCredentialsLoaded = false;
  state.teacherResultsPayload = null;
  show($('#taskCard'), false);
  renderTimer();
  renderExamControls();
  await refreshMe();
});

$('#startExamBtn')?.addEventListener('click', async () => {
  try {
    await startExam();
  } catch (e) {
    const err = e.json?.error ?? 'unknown';
    if (err === 'attempt_already_completed') {
      setAlert($('#sessionMsg'), 'bad', uiT('already_completed_only_attempt'));
      return;
    }
    setAlert($('#sessionMsg'), 'bad', uiT('could_not_start_exam', { err }));
  }
});

$('#endExamBtn')?.addEventListener('click', () => {
  endChallenge(false).catch(() => {
    setAlert($('#sessionMsg'), 'bad', uiT('could_not_submit'));
  });
});

$('#maximizeTaskBtn')?.addEventListener('click', () => {
  if (!state.activeTask) return;
  enterTaskFullscreen();
});

$('#finishTaskBtn').addEventListener('click', () => {
  finishTask().catch(() => {});
});

$('#uploadStudentsBtn')?.addEventListener('click', async () => {
  setAlert($('#teacherMsg'), 'ok', null);
  const csvText = $('#studentsCsv')?.value ?? '';
  try {
    const res = await api('/api/teacher/students/upload', {
      method: 'POST',
      body: JSON.stringify({ csvText })
    });
    state.generatedCredentials = res.credentials ?? [];
    state.teacherCredentialsLoaded = true;
    renderGeneratedCredentials();
    setAlert($('#teacherMsg'), 'ok', uiT('created_student_accounts', { count: res.count ?? state.generatedCredentials.length }));
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', uiT('upload_failed', { err: e.json?.error ?? 'unknown' }));
  }
});

async function refreshTeacherMarks() {
  const res = await api('/api/teacher/students/results');
  state.teacherResultsPayload = res;
  renderTeacherResultsPreview();
}

$('#refreshResultsBtn')?.addEventListener('click', async () => {
  setAlert($('#teacherMsg'), 'ok', null);
  try {
    await refreshTeacherMarks();
    setAlert($('#teacherMsg'), 'ok', uiT('marks_refreshed'));
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', uiT('could_not_load_marks', { err: e.json?.error ?? 'unknown' }));
  }
});

$('#copyAllCredentialsBtn')?.addEventListener('click', async () => {
  const lang = currentTeacherLang();
  const rows = state.generatedCredentials ?? [];
  if (!rows.length) return;
  const btn = $('#copyAllCredentialsBtn');
  await copyText(credentialsPlainText(rows, lang));
  if (btn) flashCopied(btn, lang);
});

$('#refreshCredentialsBtn')?.addEventListener('click', async () => {
  setAlert($('#teacherMsg'), 'ok', null);
  try {
    await refreshTeacherCredentials();
    setAlert($('#teacherMsg'), 'ok', uiT('credentials_refreshed'));
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', uiT('could_not_load_credentials', { err: e.json?.error ?? 'unknown' }));
  }
});

$('#downloadResultsBtn')?.addEventListener('click', async () => {
  const lang = currentTeacherLang();
  setAlert($('#teacherMsg'), 'ok', null);
  try {
    const res = await api('/api/teacher/students/results');
    state.teacherResultsPayload = res;
    renderTeacherResultsPreview();
    const csv = buildTeacherCsv(res, lang);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kingbebras-results.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', uiT('could_not_download', { err: e.json?.error ?? 'unknown' }));
  }
});

$('#translateBtn')?.addEventListener('click', async () => {
  const lang = $('#translateLang')?.value ?? 'en';
  try {
    // Keep AI/i18n work present but inactive; Google Translate handles visible strings.
    await translatePageTo(lang);
  } catch {
    // ignore
  }
  rerenderTeacherLocalized(); // teacher textarea/local labels still need rerender
});

$('#translateLang')?.addEventListener('change', () => {
  try {
    localStorage.setItem('kb_lang', $('#translateLang')?.value ?? 'en');
  } catch {
    // ignore
  }
  // Keep our built-in i18n available (hidden), but do not force-apply it now.
  // applyUiI18n(currentUiLang());
  rerenderTeacherLocalized();
});

// Initial language setup.
try {
  const saved = localStorage.getItem('kb_lang');
  if (saved && $('#translateLang')) $('#translateLang').value = saved;
} catch {
  // ignore
}
// Do not auto-apply our built-in UI i18n while using Google Translate.
// applyUiI18n(currentUiLang());

refreshMe().catch(() => {});

// BBQParty-style animated background (lightweight)
(() => {
  const bgCanvas = document.getElementById('bgCanvas');
  if (!bgCanvas) return;
  const bgCtx = bgCanvas.getContext('2d');
  if (!bgCtx) return;

  const bgCandies = [];
  const CANDY_EMOJIS = ['🍬', '🍭', '🍫', '🍡', '🧁', '🍩', '🍪', '🌈', '🍒', '🍓', '🫐', '🍊'];
  const NUM_CANDIES = 22;

  function resizeBgCanvas() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    bgCandies.forEach((c) => {
      c.x = Math.min(c.x, bgCanvas.width - 10);
      c.y = Math.min(c.y, bgCanvas.height - 10);
    });
  }

  function initBgCandies() {
    bgCandies.length = 0;
    for (let i = 0; i < NUM_CANDIES; i++) {
      bgCandies.push({
        x: Math.random() * bgCanvas.width,
        y: Math.random() * bgCanvas.height,
        vx: (Math.random() - 0.5) * 1.1,
        vy: (Math.random() - 0.5) * 1.1,
        emoji: CANDY_EMOJIS[Math.floor(Math.random() * CANDY_EMOJIS.length)],
        size: 26 + Math.floor(Math.random() * 16)
      });
    }
  }

  function updateBgCandies() {
    for (const c of bgCandies) {
      c.x += c.vx;
      c.y += c.vy;
      if (c.x < 15 || c.x > bgCanvas.width - 15) c.vx *= -0.96;
      if (c.y < 15 || c.y > bgCanvas.height - 15) c.vy *= -0.96;
      c.x = Math.min(Math.max(c.x, 8), bgCanvas.width - 8);
      c.y = Math.min(Math.max(c.y, 8), bgCanvas.height - 8);
      if (Math.random() < 0.008) {
        c.vx += (Math.random() - 0.5) * 0.18;
        c.vy += (Math.random() - 0.5) * 0.18;
      }
      const speed = Math.hypot(c.vx, c.vy);
      if (speed > 2.3) {
        c.vx *= 0.96;
        c.vy *= 0.96;
      }
    }
  }

  function drawBackgroundScene() {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    const grad = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
    grad.addColorStop(0, '#b8e2fc');
    grad.addColorStop(0.5, '#f9e7b3');
    grad.addColorStop(1, '#f5d99b');
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    bgCtx.save();
    bgCtx.shadowBlur = 0;
    const rainbowY = bgCanvas.height * 0.15;
    const rainbowX = bgCanvas.width * 0.12;
    const rainbowColors = ['#ff5e5e', '#ffb347', '#ffe066', '#8cd98c', '#66b3ff', '#b983ff'];
    for (let i = 0; i < 6; i++) {
      bgCtx.beginPath();
      bgCtx.arc(rainbowX, rainbowY, 180 + i * 18, 0.1, Math.PI - 0.1, false);
      bgCtx.strokeStyle = rainbowColors[i];
      bgCtx.lineWidth = 16;
      bgCtx.stroke();
    }

    bgCtx.fillStyle = '#ffffffd0';
    bgCtx.shadowColor = '#cce0ff';
    bgCtx.shadowBlur = 20;
    bgCtx.beginPath();
    bgCtx.arc(bgCanvas.width * 0.1, bgCanvas.height * 0.12, 50, 0, 2 * Math.PI);
    bgCtx.arc(bgCanvas.width * 0.17, bgCanvas.height * 0.09, 45, 0, 2 * Math.PI);
    bgCtx.arc(bgCanvas.width * 0.23, bgCanvas.height * 0.13, 48, 0, 2 * Math.PI);
    bgCtx.fill();
    bgCtx.beginPath();
    bgCtx.arc(bgCanvas.width * 0.82, bgCanvas.height * 0.18, 55, 0, 2 * Math.PI);
    bgCtx.arc(bgCanvas.width * 0.9, bgCanvas.height * 0.13, 45, 0, 2 * Math.PI);
    bgCtx.arc(bgCanvas.width * 0.95, bgCanvas.height * 0.19, 50, 0, 2 * Math.PI);
    bgCtx.fill();
    bgCtx.shadowBlur = 0;
    bgCtx.restore();

    bgCtx.textAlign = 'center';
    bgCtx.textBaseline = 'middle';
    bgCtx.shadowColor = '#ffb86b';
    bgCtx.shadowBlur = 16;
    for (const c of bgCandies) {
      bgCtx.font = `bold ${c.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      bgCtx.fillStyle = '#fff9e6';
      bgCtx.fillText(c.emoji, c.x, c.y);
    }
    bgCtx.shadowBlur = 0;

    bgCtx.fillStyle = '#fffbe3';
    bgCtx.shadowBlur = 12;
    bgCtx.shadowColor = '#f3c26b';
    for (let i = 0; i < 8; i++) {
      bgCtx.beginPath();
      bgCtx.arc(40 + i * 110, bgCanvas.height - 40, 5, 0, 2 * Math.PI);
      bgCtx.fill();
    }
    bgCtx.shadowBlur = 0;
  }

  function bgAnimationLoop() {
    updateBgCandies();
    drawBackgroundScene();
    requestAnimationFrame(bgAnimationLoop);
  }

  window.addEventListener('resize', resizeBgCanvas);
  resizeBgCanvas();
  initBgCandies();
  bgAnimationLoop();
})();

