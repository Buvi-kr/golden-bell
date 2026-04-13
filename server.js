// Golden Bell Quiz Server v4.0
'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const XLSX    = require('xlsx');
const QRCode  = require('qrcode');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout:       90000,
  pingInterval:      30000,
  maxHttpBufferSize: 2e6,
  transports: ['websocket', 'polling'],
});
app.use(express.static('public'));
app.use(express.json());

// ══════════════════════════════════════════════════════════════
//  LOGGING
// ══════════════════════════════════════════════════════════════
const LOG_PATH = path.join(__dirname, 'server.log');
const logSubs  = new Set();
const monSubs  = new Set();

function log(msg, level = 'INFO') {
  const ts   = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
  for (const r of logSubs) { try { r.write(`data: ${JSON.stringify(line)}\n\n`); } catch {} }
}

// ══════════════════════════════════════════════════════════════
//  QUESTION LOADING
// ══════════════════════════════════════════════════════════════
function parseRow(row, i) {
  const rawType = (row['유형'] || row['type'] || '').toLowerCase().trim();
  const choices = [
    row['보기1'] || row['A'] || '',
    row['보기2'] || row['B'] || '',
    row['보기3'] || row['C'] || '',
    row['보기4'] || row['D'] || '',
  ].filter(Boolean);

  let type = rawType;
  if (!type) {
    if (choices.length === 2 && choices[0].toUpperCase() === 'O' && choices[1].toUpperCase() === 'X') type = 'ox';
    else if (choices.length === 0) type = 'short';
    else type = 'choice';
  }

  const q = {
    id:        i + 1,
    question:  String(row['문제'] || row['question'] || ''),
    choices,
    timeLimit: parseInt(row['제한시간'] || row['time'] || 20) || 20,
    type,
    answer:    null,
    correctAnswers: null,
  };

  if (type === 'short') {
    const raw = String(row['정답'] || row['answer'] || '');
    q.correctAnswers = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else if (type === 'essay') {
    q.correctAnswers = [];
  } else {
    q.answer = parseInt(row['정답'] || row['answer'] || 1) - 1;
  }

  return q;
}

function loadQuestions() {
  const xlsxPath = path.join(__dirname, 'questions.xlsx');
  const jsonPath = path.join(__dirname, 'questions.json');
  let mainQ = [], cbQ = [];

  if (fs.existsSync(xlsxPath)) {
    try {
      const wb   = XLSX.readFile(xlsxPath);
      const all1 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
                     .map((r, i) => parseRow(r, i)).filter(q => q.question);
      mainQ = all1.filter(q => q.type !== 'comeback');
      cbQ   = all1.filter(q => q.type === 'comeback');
      if (wb.SheetNames[1]) {
        const cb2 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]])
                      .map((r, i) => ({ ...parseRow(r, i) })).filter(q => q.question);
        cbQ = [...cbQ, ...cb2];
      }
      log(`Excel loaded: main=${mainQ.length}, comeback=${cbQ.length}`);
    } catch (e) { log(`Excel load failed: ${e.message}`, 'WARN'); }
  }

  if (!mainQ.length && fs.existsSync(jsonPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      mainQ = d.main  || d.filter?.(q => q.type !== 'comeback') || [];
      cbQ   = d.comeback || d.filter?.(q => q.type === 'comeback') || [];
      log(`JSON loaded: main=${mainQ.length}, comeback=${cbQ.length}`);
    } catch (e) { log(`JSON load failed: ${e.message}`, 'WARN'); }
  }

  if (!mainQ.length) {
    log('Using sample questions', 'WARN');
    mainQ = [
      { id:1, question:'대한민국의 수도는?', choices:['서울','부산','대구','인천'], answer:0, timeLimit:20, type:'choice', correctAnswers:null },
      { id:2, question:'1 + 1 = 3 이다',     choices:['O','X'],                    answer:1, timeLimit:15, type:'ox',     correctAnswers:null },
      { id:3, question:'세계에서 가장 높은 산은? (단답형)', choices:[], answer:null, timeLimit:25, type:'short', correctAnswers:['에베레스트','everest'] },
      { id:4, question:'골든벨 소감을 한 문장으로 (주관식)', choices:[], answer:null, timeLimit:60, type:'essay', correctAnswers:[] },
    ];
    cbQ = [
      { id:101, question:'[패자부활] 한국의 화폐 단위는?', choices:['달러','원','엔','위안'], answer:1, timeLimit:20, type:'choice', correctAnswers:null },
    ];
  }
  return { mainQ, cbQ };
}

// ══════════════════════════════════════════════════════════════
//  SESSION
// ══════════════════════════════════════════════════════════════
const SESSION_PATH = path.join(__dirname, 'session.json');

function saveSession() {
  try {
    fs.writeFileSync(SESSION_PATH, JSON.stringify({
      phase:         state.phase,
      questionIndex: state.questionIndex,
      mainQuestions: state.mainQuestions,
      comebackPool:  state.comebackPool,
      currentCB:     state.currentCB,
      comingback:    state.comingback,
      answersClosed: state.answersClosed,
      gameLog:       state.gameLog,
      players: [...state.players.entries()].map(([sid, p]) => ({ sid, ...p })),
      ghosts:  [...state.ghostPlayers.entries()].map(([uid, g]) => ({ uid, ...g })),
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) { log(`Session save failed: ${e.message}`, 'WARN'); }
}

function loadSession() {
  if (!fs.existsSync(SESSION_PATH)) return false;
  try {
    const d = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (Date.now() - new Date(d.savedAt).getTime() > 20 * 60 * 1000) {
      log('Session expired (>20 min), skipping');
      return false;
    }
    // FIX: if session was mid-question, force to REVEAL (timer can't be restored)
    let phase = d.phase || 'LOBBY';
    if (phase === 'QUESTION') {
      phase = 'REVEAL';
      log('Session was QUESTION → forcing REVEAL on restore', 'WARN');
    }
    state.phase         = phase;
    state.questionIndex = d.questionIndex ?? -1;
    state.mainQuestions = d.mainQuestions || [];
    state.comebackPool  = d.comebackPool  || [];
    state.currentCB     = d.currentCB     || null;
    state.comingback    = d.comingback    || false;
    state.answersClosed = true;  // always lock after restart
    state.gameLog       = d.gameLog || [];
    state.players = new Map(
      (d.players || []).map(({ sid, ...p }) => [sid, { ...p, answer: null, answerText: null, answeredAt: null }])
    );
    state.ghostPlayers = new Map(
      (d.ghosts || []).map(({ uid, ...g }) => [uid, g])
    );
    log(`Session restored: ${state.players.size} players, Q${state.questionIndex + 1}, phase=${state.phase}`);
    return true;
  } catch (e) { log(`Session restore failed: ${e.message}`, 'WARN'); return false; }
}

// ══════════════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════════════
const state = {
  phase:         'LOBBY',
  questionIndex: -1,
  mainQuestions: [],
  comebackPool:  [],
  currentCB:     null,
  comingback:    false,
  answersClosed: false,
  players:       new Map(),
  ghostPlayers:  new Map(),
  timerInterval: null,
  timerPaused:   false,
  timerOnEnd:    null,       // stored callback for resume after pause
  timeLeft:      0,
  currentTimeLimit: 0,
  gameLog:       [],
  qrPopupVisible: false,
};

function cq() {
  return (state.comingback && state.currentCB)
    ? state.currentCB
    : state.mainQuestions[state.questionIndex];
}
function survivors()   { return [...state.players.values()].filter(p => !p.eliminated); }
function eliminatedP() { return [...state.players.values()].filter(p =>  p.eliminated); }

function addGameLog(msg) {
  const entry = { ts: new Date().toISOString(), msg };
  state.gameLog.push(entry);
  io.emit('game_log', entry);
  log(`[EVENT] ${msg}`);
}

function getAnswerStats() {
  const q = cq(); if (!q || !q.choices.length) return [];
  const stats = new Array(q.choices.length).fill(0);
  const pool  = state.comingback ? eliminatedP() : survivors();
  for (const p of pool) if (p.answer !== null && stats[p.answer] !== undefined) stats[p.answer]++;
  return stats;
}

function getTextAnswers() {
  const pool = state.comingback ? eliminatedP() : survivors();
  return pool.filter(p => p.answerText !== null).map(p => ({ name: p.name, text: p.answerText }));
}

// Full state for a specific player (for session restore / state_sync)
function buildStateFor(sid) {
  const p = state.players.get(sid); if (!p) return null;
  const q = cq();
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  survivors().length,
    totalPlayers:   state.players.size,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    comingback:     state.comingback,
    answersClosed:  state.answersClosed,
    eliminated:     p.eliminated,
    name:           p.name,
    alreadyAnswered: p.answer !== null || p.answerText !== null,
    myAnswer:       p.answer,
    myAnswerText:   p.answerText,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats: state.phase === 'REVEAL' ? getAnswerStats() : null,
  };
}

// Broadcast state to everyone
function broadcastState() {
  const q    = cq();
  const surv = survivors().length;
  io.emit('state', {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  surv,
    eliminatedCount: state.players.size - surv,
    totalPlayers:   state.players.size,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    comingback:     state.comingback,
    answersClosed:  state.answersClosed,
    comebackPoolLeft: state.comebackPool.length,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats: state.phase === 'REVEAL' ? getAnswerStats() : null,
  });
}

function buildGenericState() {
  const q    = cq();
  const surv = survivors().length;
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  surv,
    eliminatedCount: state.players.size - surv,
    totalPlayers:   state.players.size,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    comingback:     state.comingback,
    answersClosed:  state.answersClosed,
    comebackPoolLeft: state.comebackPool.length,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats: state.phase === 'REVEAL' ? getAnswerStats() : null,
  };
}

function startTimer(duration, onEnd) {
  clearInterval(state.timerInterval);
  state.answersClosed    = false;
  state.timerPaused      = false;
  state.timerOnEnd       = onEnd;
  state.timeLeft         = duration;
  state.currentTimeLimit = duration;
  io.emit('timer', { timeLeft: duration, timeLimit: duration, paused: false });
  state.timerInterval = setInterval(() => {
    if (state.timerPaused) return;          // skip tick while paused
    state.timeLeft = Math.max(0, state.timeLeft - 1);
    io.emit('timer', { timeLeft: state.timeLeft, timeLimit: duration, paused: false });
    if (state.timeLeft <= 0) { clearInterval(state.timerInterval); onEnd(); }
  }, 1000);
}

// ══════════════════════════════════════════════════════════════
//  MONITORING
// ══════════════════════════════════════════════════════════════
let prevCpu = os.cpus();
function getCpuUsage() {
  const cpus = os.cpus(); let idle = 0, total = 0;
  cpus.forEach((c, i) => {
    const p = prevCpu[i] || c;
    for (const t in c.times) total += c.times[t] - (p.times[t] || 0);
    idle += c.times.idle - (p.times.idle || 0);
  });
  prevCpu = cpus;
  return total ? Math.round((1 - idle / total) * 100) : 0;
}
setInterval(() => {
  if (!monSubs.size) return;
  const tot = os.totalmem(), free = os.freemem();
  const pl = JSON.stringify({
    cpu: getCpuUsage(), memUsed: Math.round(((tot - free) / tot) * 100),
    sockets: io.engine.clientsCount, survivors: survivors().length, totalPlayers: state.players.size,
  });
  for (const r of monSubs) { try { r.write(`data: ${pl}\n\n`); } catch {} }
}, 3000);

// ══════════════════════════════════════════════════════════════
//  CLOUDFLARE LOG WATCHER
// ══════════════════════════════════════════════════════════════
const CF_LOG = path.join(__dirname, 'cloudflare.log');
let cfUrl = '', cfLastSize = 0;

function parseCfLog() {
  if (!fs.existsSync(CF_LOG)) return;
  try {
    const m = fs.readFileSync(CF_LOG, 'utf8').match(/https:\/\/[\w-]+\.trycloudflare\.com/);
    if (m && m[0] !== cfUrl) {
      cfUrl = m[0]; log(`Tunnel URL: ${cfUrl}`); io.emit('cf_url', { url: cfUrl });
    }
  } catch {}
}
function watchCfLog() {
  parseCfLog();
  try {
    fs.watch(CF_LOG, () => {
      parseCfLog();
      try {
        const stat = fs.statSync(CF_LOG);
        if (stat.size > cfLastSize) {
          const fd = fs.openSync(CF_LOG, 'r'), buf = Buffer.alloc(stat.size - cfLastSize);
          fs.readSync(fd, buf, 0, buf.length, cfLastSize); fs.closeSync(fd);
          buf.toString().split('\n').filter(Boolean).forEach(l => log(`[CF] ${l}`));
          cfLastSize = stat.size;
        }
      } catch {}
    });
  } catch { setTimeout(watchCfLog, 2000); }
}
watchCfLog();

// ══════════════════════════════════════════════════════════════
//  REST API
// ══════════════════════════════════════════════════════════════
app.get('/api/qr', async (req, res) => {
  const url = req.query.url || `http://localhost:${PORT}`;
  try { res.json({ qr: await QRCode.toDataURL(url, { width: 320, margin: 2 }), url }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', (req, res) => {
  res.json({ phase: state.phase, players: state.players.size, survivors: survivors().length,
    questions: state.mainQuestions.length, cfUrl, uptime: process.uptime(),
    comebackPoolLeft: state.comebackPool.length });
});

app.get('/api/gamelog', (req, res) => res.json(state.gameLog));

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try { if (fs.existsSync(LOG_PATH)) fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').slice(-60).forEach(l => res.write(`data: ${JSON.stringify(l)}\n\n`)); } catch {}
  logSubs.add(res); req.on('close', () => logSubs.delete(res));
});

app.get('/api/monitor/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  monSubs.add(res); req.on('close', () => monSubs.delete(res));
});


function isAdmin(socket) {
  const ip = socket.handshake.address;
  const isLocal = (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
  const hasForwarded = !!socket.handshake.headers['x-forwarded-for'];
  return isLocal && !hasForwarded;
}

// ══════════════════════════════════════════════════════════════
//  SOCKET.IO
// ══════════════════════════════════════════════════════════════
io.on('connection', socket => {
  log(`Connected: ${socket.id}`);

  // Send current state
  socket.emit('state', buildGenericState());
  if (cfUrl) socket.emit('cf_url', { url: cfUrl });
  socket.emit('game_log_history', state.gameLog.slice(-100));

  // FIX: Send full player list on connect (host refresh fix)
  socket.emit('player_list', [...state.players.values()].map(p => ({
    name: p.name, eliminated: p.eliminated,
  })));

  // ── Background sync ─────────────────────────────────────
  socket.on('request_state', () => {
    const ps = buildStateFor(socket.id);
    socket.emit('state_sync', ps || buildGenericState());
  });

  // ── Session restore ──────────────────────────────────────
  socket.on('session_restore', ({ uid }) => {
    if (!uid) { socket.emit('session_not_found'); return; }

    const ghost = state.ghostPlayers.get(uid);
    if (ghost) {
      if (Date.now() - ghost.disconnectedAt > 30 * 60 * 1000) {
        state.ghostPlayers.delete(uid); socket.emit('session_expired'); return;
      }
      state.ghostPlayers.delete(uid);
      state.players.set(socket.id, { ...ghost, answer: null, answerText: null, answeredAt: null });
      socket.join('players');
      socket.emit('session_restored', buildStateFor(socket.id));
      io.emit('player_joined', { name: ghost.name, total: state.players.size, survivors: survivors().length });
      log(`Session restored: ${ghost.name}`);
      saveSession(); return;
    }

    for (const [sid, p] of state.players) {
      if (p.uid === uid) {
        state.players.delete(sid);
        state.players.set(socket.id, { ...p, answer: null, answerText: null, answeredAt: null });
        socket.join('players');
        socket.emit('session_restored', buildStateFor(socket.id));
        log(`Session switched: ${p.name}`);
        return;
      }
    }
    socket.emit('session_not_found');
  });

  // ── Join ─────────────────────────────────────────────────
  socket.on('join', ({ name, uid }) => {
    // FIX: Strong name validation
    const safeName = (typeof name === 'string' ? name : '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const trimmed = safeName.trim().slice(0, 20);
    if (!trimmed) { socket.emit('join_error', '이름을 입력해주세요.'); return; }

    if (state.phase !== 'LOBBY') {
      // Try ghost rejoin by UID or exact name
      let ghostEntry = null;
      for (const [gUid, ghost] of state.ghostPlayers) {
        if (gUid === uid || ghost.name === trimmed) { ghostEntry = { gUid, ghost }; break; }
      }
      if (ghostEntry) {
        const { gUid, ghost } = ghostEntry;
        if (Date.now() - ghost.disconnectedAt > 30 * 60 * 1000) {
          state.ghostPlayers.delete(gUid);
          socket.emit('join_error', '세션이 만료되었습니다 (30분 초과).'); return;
        }
        state.ghostPlayers.delete(gUid);
        state.players.set(socket.id, { ...ghost, uid, answer: null, answerText: null, answeredAt: null });
        socket.join('players');
        socket.emit('session_restored', buildStateFor(socket.id));
        io.emit('player_joined', { name: ghost.name, total: state.players.size, survivors: survivors().length });
        log(`Rejoin by name: ${ghost.name}`);
        saveSession(); return;
      }
      socket.emit('join_error', '게임이 이미 시작되었습니다. 같은 닉네임으로 재입장 가능합니다.'); return;
    }

    for (const p of state.players.values()) {
      if (p.name === trimmed) { socket.emit('join_error', '이미 사용 중인 이름입니다.'); return; }
    }
    state.players.set(socket.id, { name: trimmed, uid, eliminated: false, answer: null, answerText: null, answeredAt: null });
    socket.join('players');
    socket.emit('joined', { name: trimmed });
    io.emit('player_joined', { name: trimmed, total: state.players.size, survivors: state.players.size });
    addGameLog(`Join: ${trimmed} (total: ${state.players.size})`);
    saveSession();
  });

  // ── Answer (with rate-limit & answersClosed guard) ───────
  socket.on('answer', ({ choice, text }) => {
    const p = state.players.get(socket.id);
    if (!p || state.phase !== 'QUESTION') return;
    if (state.answersClosed) return;
    if (state.comingback && !p.eliminated) return;
    if (!state.comingback &&  p.eliminated) return;

    const q = cq(); if (!q) return;
    const now = Date.now();

    if (q.type === 'short' || q.type === 'essay') {
      const raw = (typeof text === 'string' ? text : '').trim();
      if (!raw) return;
      // XSS prevention: escape HTML tags
      const safe = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 200);
      const isFirst = p.answerText === null;
      p.answerText = safe; p.answeredAt = now;
      socket.emit('answer_ok', { text: safe, changed: !isFirst });
      io.emit('text_answer_in', { sid: socket.id, name: p.name, text: safe });
    } else {
      if (typeof choice !== 'number') return;
      if (p.answer === choice && p.answeredAt && now - p.answeredAt < 1500) return;
      const isFirst = p.answer === null;
      p.answer = choice; p.answeredAt = now;
      socket.emit('answer_ok', { choice, changed: !isFirst });
    }

    const pool     = state.comingback ? eliminatedP() : survivors();
    const answered = pool.filter(pl => pl.answer !== null || pl.answerText !== null).length;
    io.emit('answer_progress', { answered, total: pool.length });
  });

  // ── Answer cancel (essay / short only, before answersClosed) ─
  socket.on('answer_cancel', () => {
    const p = state.players.get(socket.id);
    if (!p || state.phase !== 'QUESTION' || state.answersClosed) return;
    const q = cq(); if (!q || (q.type !== 'essay' && q.type !== 'short')) return;

    p.answerText = null; p.answeredAt = null;
    socket.emit('answer_cancelled');
    io.emit('text_answer_cancelled', { sid: socket.id, name: p.name });

    const pool    = state.comingback ? eliminatedP() : survivors();
    const answered = pool.filter(pl => pl.answer !== null || pl.answerText !== null).length;
    io.emit('answer_progress', { answered, total: pool.length });
  });

  // ── Host: Start game ─────────────────────────────────────
  socket.on('host_start', () => {
    if (!isAdmin(socket)) return; /* host_start */
    const { mainQ, cbQ } = loadQuestions();
    state.mainQuestions = mainQ; state.comebackPool = cbQ;
    state.questionIndex = -1; state.phase = 'LOBBY';
    state.comingback = false; state.currentCB = null;
    state.answersClosed = false; state.gameLog = [];
    state.ghostPlayers.clear();
    for (const p of state.players.values()) { p.eliminated = false; p.answer = null; p.answerText = null; }
    io.emit('game_started', { total: mainQ.length, cbPool: cbQ.length });
    broadcastState();
    addGameLog(`Game started: ${state.players.size} players, ${mainQ.length} Qs, ${cbQ.length} comeback Qs`);
    saveSession();
  });

  // ── Host: Next question ──────────────────────────────────
  socket.on('host_next', () => {
    if (!isAdmin(socket)) return; /* host_next */
    if (state.phase !== 'LOBBY' && state.phase !== 'REVEAL') return;
    state.questionIndex++;
    if (state.questionIndex >= state.mainQuestions.length) { _endGame(); return; }

    for (const p of state.players.values()) { p.answer = null; p.answerText = null; p.answeredAt = null; }
    state.phase = 'QUESTION'; state.comingback = false;
    state.currentCB = null; state.answersClosed = false;

    const q = state.mainQuestions[state.questionIndex];
    io.emit('question', {
      index: state.questionIndex, total: state.mainQuestions.length,
      question: q.question, choices: q.choices, type: q.type,
      timeLimit: q.timeLimit, isComeback: false,
    });
    startTimer(q.timeLimit, () => _onTimeUp(q));
    broadcastState();
    addGameLog(`Q${state.questionIndex + 1}/${state.mainQuestions.length}: ${q.question}`);
    saveSession();
  });

  // ── Host: Reveal answer ──────────────────────────────────
  socket.on('host_reveal', () => {
    if (!isAdmin(socket)) return; /* host_reveal */
    if (state.phase !== 'QUESTION') return;
    const q = cq();
    if (q && q.type === 'essay') {
      // Essay needs manual grading — make sure answers are locked first
      if (!state.answersClosed) {
        clearInterval(state.timerInterval);
        state.answersClosed = true;
        io.emit('time_up');
        io.emit('answers_locked', { type: 'essay', answers: getTextAnswers() });
      }
      socket.emit('essay_need_manual');
      return;
    }
    _doReveal();
  });

  // ── Host: Essay manual grading ───────────────────────────
  socket.on('host_essay_reveal', ({ passedNames }) => {
    if (!isAdmin(socket)) return; /* host_essay_reveal */
    if (state.phase !== 'QUESTION') return;
    clearInterval(state.timerInterval);
    state.answersClosed = true;

    const passSet = new Set(passedNames || []);
    const pool    = state.comingback ? eliminatedP() : survivors();
    const revived = [], failElim = [];

    for (const [sid, p] of state.players) {
      if (!pool.includes(p)) continue;
      if (passSet.has(p.name)) {
        if (state.comingback) p.eliminated = false;
        revived.push(p.name);
      } else {
        if (!state.comingback) p.eliminated = true;
        failElim.push({ name: p.name, sid });
      }
    }

    state.phase = 'REVEAL';
    if (state.comingback) {
      state.comingback = false; state.currentCB = null;
      io.emit('comeback_result', { type:'essay', revived, stillElim: failElim.map(e=>e.name), survivorCount: survivors().length });
      addGameLog(`Essay comeback: revived ${revived.length}`);
    } else {
      io.emit('reveal', { type:'essay', eliminated: failElim.map(e=>e.name), survivors: revived, survivorCount: revived.length, correctAnswer: null, correctAnswers: null, stats: [] });
      for (const { sid } of failElim) if (sid) io.to(sid).emit('eliminated');
      addGameLog(`Essay reveal: passed ${revived.length}, out ${failElim.length}`);
    }
    broadcastState(); saveSession();
  });

  // ── Host: Comeback ───────────────────────────────────────
  socket.on('host_comeback', () => {
    if (!isAdmin(socket)) return; /* host_comeback */
    if (state.phase !== 'REVEAL') return;
    if (!eliminatedP().length) { socket.emit('comeback_error', 'No eliminated players.'); return; }
    if (!state.comebackPool.length) { socket.emit('comeback_error', 'No comeback questions available.\nAdd questions to Excel Sheet2.'); return; }

    state.currentCB = state.comebackPool.shift();
    for (const p of state.players.values()) { p.answer = null; p.answerText = null; p.answeredAt = null; }
    state.phase = 'QUESTION'; state.comingback = true; state.answersClosed = false;

    const q = state.currentCB;
    io.emit('question', {
      index: state.questionIndex, total: state.mainQuestions.length,
      question: q.question, choices: q.choices, type: q.type,
      timeLimit: q.timeLimit, isComeback: true,
    });
    io.emit('comeback_start', { count: eliminatedP().length, cbPoolLeft: state.comebackPool.length });
    startTimer(q.timeLimit, () => _onTimeUp(q));
    broadcastState();
    addGameLog(`Comeback: ${eliminatedP().length} challengers, ${state.comebackPool.length} Qs left`);
  });

  socket.on('host_end', () => { if(!isAdmin(socket)) return; _endGame(); });

  // ── Host: Timer pause / resume ─────────────────────────
  socket.on('host_pause_timer', () => {
    if (!isAdmin(socket)) return; /* host_pause_timer */
    if (state.phase !== 'QUESTION' || state.timerPaused || state.answersClosed) return;
    state.timerPaused = true;
    io.emit('timer_paused', { timeLeft: state.timeLeft, timeLimit: state.currentTimeLimit });
    log(`Timer paused at ${state.timeLeft}s`);
  });

  socket.on('host_resume_timer', () => {
    if (!isAdmin(socket)) return; /* host_resume_timer */
    if (state.phase !== 'QUESTION' || !state.timerPaused) return;
    state.timerPaused = false;
    io.emit('timer_resumed', { timeLeft: state.timeLeft, timeLimit: state.currentTimeLimit });
    log(`Timer resumed at ${state.timeLeft}s`);
  });

  // ── Host: QR popup on display ──────────────────────────
  socket.on('host_qr_show', () => {
    if (!isAdmin(socket)) return; /* host_qr_show */
    state.qrPopupVisible = true;
    io.emit('show_qr_popup');
    log('QR popup shown');
  });

  socket.on('host_qr_hide', () => {
    if (!isAdmin(socket)) return; /* host_qr_hide */
    state.qrPopupVisible = false;
    io.emit('hide_qr_popup');
    log('QR popup hidden');
  });

  socket.on('host_reset', () => {
    if (!isAdmin(socket)) return; /* host_reset */
    clearInterval(state.timerInterval);
    Object.assign(state, { phase:'LOBBY', questionIndex:-1, comingback:false, currentCB:null,
      answersClosed:false, timeLeft:0, currentTimeLimit:0, gameLog:[] });
    state.players.clear(); state.ghostPlayers.clear();
    state.mainQuestions = []; state.comebackPool = [];
    try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
    io.emit('reset'); broadcastState(); log('Game reset');
  });

  socket.on('host_reload_questions', () => {
    if (!isAdmin(socket)) return; /* host_reload_questions */
    const { mainQ, cbQ } = loadQuestions();
    state.mainQuestions = mainQ; state.comebackPool = cbQ;
    socket.emit('questions_reloaded', { main: mainQ.length, comeback: cbQ.length });
  });

  socket.on('disconnect', () => {
    const p = state.players.get(socket.id);
    if (p) {
      state.ghostPlayers.set(p.uid, { ...p, disconnectedAt: Date.now() });
      state.players.delete(socket.id);
      io.emit('player_left', { name: p.name, total: state.players.size });
      log(`Disconnected (ghost saved): ${p.name}`);
      saveSession();
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════
function _onTimeUp(q) {
  state.answersClosed = true;
  io.emit('time_up');

  if (q.type === 'essay') {
    const answers = getTextAnswers();
    io.emit('answers_locked', { type: 'essay', answers });
    log(`Essay locked: ${answers.length} submitted`);
  } else if (q.type === 'short') {
    const answers = getTextAnswers();
    io.emit('answers_locked', { type: 'short', answers });
  } else {
    io.emit('answers_locked', { type: q.type, answers: [] });
  }
}

function _doReveal() {
  clearInterval(state.timerInterval);
  state.answersClosed = true;

  const q        = cq();
  const pool     = state.comingback ? eliminatedP() : survivors();
  const newElim  = [], correct = [];

  for (const p of pool) {
    let ok = false;
    if (q.type === 'short') {
      // Lenient matching: strip spaces, punctuation; lowercase both sides
      const normalize = s => s.toLowerCase().replace(/[\s\.,\!\?]/g, '');
      const given = normalize(p.answerText || '');
      ok = (q.correctAnswers || []).some(a => {
        const norm = normalize(a);
        return given.includes(norm) || norm.includes(given);
      });
    } else {
      ok = p.answer === q.answer;
    }
    const sid = [...state.players.entries()].find(([, pl]) => pl === p)?.[0];
    if (ok) {
      if (state.comingback) p.eliminated = false;
      correct.push(p.name);
    } else {
      if (!state.comingback) p.eliminated = true;
      newElim.push({ name: p.name, sid });
    }
  }

  state.phase = 'REVEAL';
  const payload = { correctAnswer: q.answer, correctAnswers: q.correctAnswers, stats: getAnswerStats(), type: q.type };

  if (state.comingback) {
    state.comingback = false; state.currentCB = null;
    io.emit('comeback_result', { ...payload, revived: correct, stillElim: newElim.map(e => e.name), survivorCount: survivors().length });
    addGameLog(`Comeback result: revived ${correct.length}`);
  } else {
    io.emit('reveal', { ...payload, eliminated: newElim.map(e => e.name), survivors: correct, survivorCount: correct.length });
    for (const { sid } of newElim) if (sid) io.to(sid).emit('eliminated');
    addGameLog(`Reveal [${q.type}]: survived ${correct.length}, out ${newElim.length}`);
  }
  broadcastState(); saveSession();
}

function _endGame() {
  const winners = survivors().map(p => p.name);
  state.phase   = 'GAMEOVER';
  io.emit('game_over', { winners }); broadcastState();
  addGameLog(`Game over - winner: ${winners.join(', ') || 'none'}`);
  try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
}

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('='.repeat(52));
  log(`  Golden Bell Quiz Server v4.0  |  Port: ${PORT}`);
  log('='.repeat(52));
  log(`  Host:        http://localhost:${PORT}/host.html`);
  log(`  Display:     http://localhost:${PORT}/display.html`);
  log(`  Participant: http://localhost:${PORT}/participant.html`);
  log('='.repeat(52));
  loadSession();
});
