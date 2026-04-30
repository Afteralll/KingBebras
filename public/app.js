const $ = (sel) => document.querySelector(sel);

const state = {
  me: null,
  tasks: [],
  attemptId: null,
  activeTask: null,
  resultsByTaskId: {},
  examEndsAt: null,
  generatedCredentials: [],
  teacherResultsPreview: '',
  teacherCredentialsLoaded: false
};

let translateScriptLoading = false;
let translateReady = false;
let timerIntervalId = null;
const EXAM_DURATION_MS = 45 * 60 * 1000;

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

async function translatePageTo(lang) {
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
    me.textContent = 'Not logged in';
    show($('#logoutBtn'), false);
    show($('#authCard'), true);
    show($('#sessionCard'), false);
    show($('#teacherCard'), false);
    show($('#taskCard'), false);
    show($('#examTimer'), false);
    renderExamControls();
    return;
  }
  me.textContent = `Logged in as ${state.me.username}${state.me.role ? ` (${state.me.role})` : ''}`;
  show($('#logoutBtn'), true);
  show($('#authCard'), false);
  const isTeacher = state.me.role === 'teacher';
  show($('#teacherCard'), isTeacher);
  show($('#sessionCard'), !isTeacher);
  show($('#taskCard'), !isTeacher && Boolean(state.activeTask));
  show($('#examTimer'), !isTeacher && Boolean(state.examEndsAt));
  renderExamControls();
}

function renderGeneratedCredentials() {
  const output = $('#generatedCredentials');
  if (!output) return;
  if (!state.generatedCredentials.length) {
    output.value = '';
    return;
  }
  output.value = state.generatedCredentials
    .map((r, idx) => {
      const createdAt = r.createdAt ? ` | created: ${r.createdAt}` : '';
      return `${idx + 1}. ${r.name} | ${r.username} | ${r.password}${createdAt}`;
    })
    .join('\n');
}

function renderTeacherResultsPreview() {
  const el = $('#teacherResults');
  if (!el) return;
  el.value = state.teacherResultsPreview ?? '';
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
      status.textContent = 'Game finished';
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
    setAlert($('#sessionMsg'), 'bad', 'Start the exam first.');
    return;
  }
  if (state.resultsByTaskId?.[task.id]) {
    setAlert($('#sessionMsg'), 'bad', 'This game is already finished.');
    return;
  }
  state.activeTask = task;
  $('#taskTitle').textContent = task.title;
  $('#taskMeta').textContent = `Task id: ${task.id}${task.category ? ` • Difficulty ${task.category}` : ''} • Max score: ${task.maxScore ?? 100}`;
  const frame = $('#taskFrame');
  frame.src = task.url ?? `/tasks/${task.id}/index.html`;
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
          setAlert($('#sessionMsg'), 'ok', 'Exam resumed. Timer continued from your original start time.');
        }
      }
      const { tasks: attemptTasks } = await api(`/api/attempts/${state.attemptId}/tasks`);
      for (const row of attemptTasks) {
        if (!row?.finishedAt) continue;
        state.resultsByTaskId[row.taskId] = { finished: true, backendScore: row.finalScore };
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
    setAlert($('#sessionMsg'), 'bad', 'Teacher accounts cannot start student exams.');
    return;
  }
  if (state.attemptId) {
    setAlert($('#sessionMsg'), 'bad', 'Exam already started for this account.');
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
  setAlert($('#sessionMsg'), 'ok', 'Exam started. Timer is now fixed and cannot be restarted.');
}

function getGameDisplayScore(payload) {
  const raw =
    payload?.finalScore ??
    payload?.finalScoreValue ??
    payload?.totalScore ??
    payload?.score ??
    null;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
}

async function finishTask(gamePayload = null) {
  if (!state.activeTask || !state.attemptId) return;
  const taskId = state.activeTask.id;
  const res = await api('/api/tasks/finish', {
    method: 'POST',
    body: JSON.stringify({
      attemptId: state.attemptId,
      taskId,
      finalAnswer: null,
      gamePayload: gamePayload ?? null
    })
  });
  state.resultsByTaskId[taskId] = {
    backendScore: res.finalScore,
    finished: true
  };
  renderTasks();
  setAlert($('#taskMsg'), 'ok', 'Game finished.');
  closeTaskFrame();
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
          backendScore: res.finalScore,
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

  setAlert($('#sessionMsg'), 'ok', auto ? 'Time is up. Challenge submitted automatically.' : 'Challenge submitted.');
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
    setAlert($('#authMsg'), 'bad', `Login failed: ${e.json?.error ?? 'unknown'}`);
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
    setAlert($('#authMsg'), 'ok', 'Registered. Now click Login.');
  } catch (e) {
    setAlert($('#authMsg'), 'bad', `Register failed: ${e.json?.error ?? 'unknown'}`);
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
      setAlert($('#sessionMsg'), 'bad', 'You already completed your only attempt.');
      return;
    }
    setAlert($('#sessionMsg'), 'bad', `Could not start exam: ${err}`);
  }
});

$('#endExamBtn')?.addEventListener('click', () => {
  endChallenge(false).catch(() => {
    setAlert($('#sessionMsg'), 'bad', 'Could not submit challenge right now.');
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
    setAlert($('#teacherMsg'), 'ok', `Created ${res.count ?? state.generatedCredentials.length} student accounts.`);
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', `Upload failed: ${e.json?.error ?? 'unknown'}`);
  }
});

async function refreshTeacherMarks() {
  const res = await api('/api/teacher/students/results');
  const lines = [];
  lines.push('Overall weighted total: A=22%, B=33%, C=55%');
  lines.push('='.repeat(90));
  for (const s of res.students ?? []) {
    const overall = Number.isFinite(s.overallWeightedPercent) ? `${s.overallWeightedPercent.toFixed(2)}%` : '—';
    const a = Number.isFinite(s.categoryPercents?.A) ? s.categoryPercents.A.toFixed(2) : '—';
    const b = Number.isFinite(s.categoryPercents?.B) ? s.categoryPercents.B.toFixed(2) : '—';
    const c = Number.isFinite(s.categoryPercents?.C) ? s.categoryPercents.C.toFixed(2) : '—';
    const status = s.finishedAt ? 'finished' : s.startedAt ? 'started' : 'not started';
    const name = (s.name || '').trim() || '(no name)';
    lines.push(`${name} | ${s.username} | ${status} | overall: ${overall} | A:${a}% B:${b}% C:${c}%`);
    const taskBreakdowns = s.taskBreakdowns ?? {};
    const taskScores = s.taskScores ?? {};
    for (const task of res.tasks ?? []) {
      const scoreRaw = taskScores[task.id];
      if (!Number.isFinite(scoreRaw)) continue;
      const bkd = taskBreakdowns[task.id] ?? {};
      const err = Number.isFinite(bkd.errorScore) ? Number(bkd.errorScore).toFixed(2) : '—';
      const tim = Number.isFinite(bkd.timeScore) ? Number(bkd.timeScore).toFixed(2) : '—';
      const clk = Number.isFinite(bkd.clickScore) ? Number(bkd.clickScore).toFixed(2) : '—';
      const drg = Number.isFinite(bkd.dragScore) ? Number(bkd.dragScore).toFixed(2) : '—';
      const formula = bkd.weightsText ?? 'error 60%, time 30%, click 10%';
      lines.push(
        `  - ${task.title} (${task.category}) | final=${Number(scoreRaw).toFixed(2)} | error=${err} time=${tim} click=${clk} drag=${drg} | formula: ${formula}`
      );
    }
    lines.push('-'.repeat(90));
  }
  state.teacherResultsPreview = lines.join('\n');
  renderTeacherResultsPreview();
}

$('#refreshResultsBtn')?.addEventListener('click', async () => {
  setAlert($('#teacherMsg'), 'ok', null);
  try {
    await refreshTeacherMarks();
    setAlert($('#teacherMsg'), 'ok', 'Marks refreshed.');
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', `Could not load marks: ${e.json?.error ?? 'unknown'}`);
  }
});

$('#refreshCredentialsBtn')?.addEventListener('click', async () => {
  setAlert($('#teacherMsg'), 'ok', null);
  try {
    await refreshTeacherCredentials();
    setAlert($('#teacherMsg'), 'ok', 'Credentials refreshed.');
  } catch (e) {
    setAlert($('#teacherMsg'), 'bad', `Could not load credentials: ${e.json?.error ?? 'unknown'}`);
  }
});

$('#downloadResultsBtn')?.addEventListener('click', () => {
  // Excel opens CSV files directly.
  window.location.href = '/api/teacher/students/results.csv';
});

$('#translateBtn')?.addEventListener('click', async () => {
  const lang = $('#translateLang')?.value ?? 'en';
  try {
    const ok = await translatePageTo(lang);
    if (!ok) {
      setAlert($('#taskMsg'), 'bad', 'Translator is not ready yet. Try again.');
    }
  } catch {
    setAlert($('#taskMsg'), 'bad', 'Could not load translator right now.');
  }
});

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

