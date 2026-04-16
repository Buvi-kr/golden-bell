// Speed Golden Bell Quiz Server v5.0
'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const XLSX    = require('xlsx');
const QRCode  = require('qrcode');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const SERVER_START_TIME = new Date().toISOString();
const QUESTION_TIME     = 15;   // 전 문제 15초 고정
const REVEAL_DELAY      = 3000; // ms: 답변 마감 후 정답 공개까지 카운트다운

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
  // essay 타입은 short로 강제 전환
  if (type === 'essay') type = 'short';

  const q = {
    id:        i + 1,
    question:  String(row['문제'] || row['question'] || ''),
    choices,
    timeLimit: QUESTION_TIME,
    type,
    answer:    null,
    correctAnswers: null,
  };

  if (type === 'short') {
    const raw = String(row['정답'] || row['answer'] || '');
    q.correctAnswers = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  } else {
    q.answer = parseInt(row['정답'] || row['answer'] || 1) - 1;
  }

  return q;
}

function loadQuestions() {
  const xlsxPath = path.join(__dirname, 'questions.xlsx');
  const jsonPath = path.join(__dirname, 'questions.json');
  let mainQ = [];

  if (fs.existsSync(xlsxPath)) {
    try {
      const wb   = XLSX.readFile(xlsxPath);
      const all1 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
                     .map((r, i) => parseRow(r, i)).filter(q => q.question);
      mainQ = all1.filter(q => q.type !== 'comeback');
      log(`Excel loaded: ${mainQ.length} questions`);
    } catch (e) { log(`Excel load failed: ${e.message}`, 'WARN'); }
  }

  if (!mainQ.length && fs.existsSync(jsonPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      mainQ = d.main || [];
      log(`JSON loaded: ${mainQ.length} questions`);
    } catch (e) { log(`JSON load failed: ${e.message}`, 'WARN'); }
  }

  // 모든 문제 timeLimit 강제 15초
  mainQ.forEach(q => { q.timeLimit = QUESTION_TIME; });

  if (!mainQ.length) {
    log('Using sample questions', 'WARN');
    mainQ = [
      { id:1, question:'대한민국의 수도는?',     choices:['서울','부산','대구','인천'], answer:0, timeLimit:QUESTION_TIME, type:'choice', correctAnswers:null },
      { id:2, question:'1 + 1 = 3 이다',         choices:['O','X'],                    answer:1, timeLimit:QUESTION_TIME, type:'ox',     correctAnswers:null },
      { id:3, question:'세계에서 가장 높은 산은?', choices:[], answer:null,             timeLimit:QUESTION_TIME, type:'short', correctAnswers:['에베레스트','everest'] },
    ];
  }
  return mainQ;
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
    let phase = d.phase || 'LOBBY';
    if (phase === 'QUESTION') {
      phase = 'REVEAL';
      log('Session was QUESTION → forcing REVEAL on restore', 'WARN');
    }
    state.phase         = phase;
    state.questionIndex = d.questionIndex ?? -1;
    state.mainQuestions = d.mainQuestions || [];
    state.answersClosed = true;
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
  answersClosed: false,
  players:       new Map(),
  ghostPlayers:  new Map(),
  timerInterval: null,
  timerPaused:   false,
  timerOnEnd:    null,
  timeLeft:      0,
  currentTimeLimit: 0,
  gameLog:       [],
  qrPopupVisible: false,
};

function cq() { return state.mainQuestions[state.questionIndex]; }

function survivors()   { return [...state.players.values()].filter(p => !p.eliminated); }

function roundInfo(idx) {
  return { round: Math.floor(idx / 15) + 1, qInRound: (idx % 15) + 1 };
}

function addGameLog(msg) {
  const entry = { ts: new Date().toISOString(), msg };
  state.gameLog.push(entry);
  io.emit('game_log', entry);
  log(`[EVENT] ${msg}`);
}

function getAnswerStats() {
  const q = cq(); if (!q || !q.choices.length) return [];
  const stats = new Array(q.choices.length).fill(0);
  for (const p of survivors()) if (p.answer !== null && stats[p.answer] !== undefined) stats[p.answer]++;
  return stats;
}

function getTextAnswers() {
  return survivors().filter(p => p.answerText !== null).map(p => ({ name: p.name, text: p.answerText }));
}

function buildStateFor(sid) {
  const p = state.players.get(sid); if (!p) return null;
  const q = cq();
  const { round, qInRound } = state.questionIndex >= 0 ? roundInfo(state.questionIndex) : { round: 0, qInRound: 0 };
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  survivors().length,
    totalPlayers:   state.players.size,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    answersClosed:  state.answersClosed,
    eliminated:     p.eliminated,
    eliminatedAtQuestion: p.eliminatedAtQuestion,
    name:           p.name,
    alreadyAnswered: p.answer !== null || p.answerText !== null,
    myAnswer:       p.answer,
    myAnswerText:   p.answerText,
    round, qInRound,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats: state.phase === 'REVEAL' ? getAnswerStats() : null,
  };
}

function buildGenericState() {
  const q    = cq();
  const surv = survivors().length;
  const { round, qInRound } = state.questionIndex >= 0 ? roundInfo(state.questionIndex) : { round: 0, qInRound: 0 };
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  surv,
    eliminatedCount: state.players.size - surv,
    totalPlayers:   state.players.size,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    answersClosed:  state.answersClosed,
    round, qInRound,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats: state.phase === 'REVEAL' ? getAnswerStats() : null,
  };
}

function broadcastState() {
  io.emit('state', buildGenericState());
}

function startTimer(duration, onEnd) {
  clearInterval(state.timerInterval);
  state.timerPaused      = false;
  state.timerOnEnd       = onEnd;
  state.timeLeft         = duration;
  state.currentTimeLimit = duration;
  io.emit('timer', { timeLeft: duration, timeLimit: duration, paused: false });
  state.timerInterval = setInterval(() => {
    if (state.timerPaused) return;
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
    questions: state.mainQuestions.length, cfUrl, uptime: process.uptime() });
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

  socket.emit('state', buildGenericState());
  if (cfUrl) socket.emit('cf_url', { url: cfUrl });
  socket.emit('game_log_history', state.gameLog.slice(-100));

  socket.emit('player_list', [...state.players.values()].map(p => ({
    name: p.name, eliminated: p.eliminated,
  })));

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
    const safeName = (typeof name === 'string' ? name : '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const trimmed = safeName.trim().slice(0, 20);
    if (!trimmed) { socket.emit('join_error', '이름을 입력해주세요.'); return; }

    if (state.phase !== 'LOBBY') {
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

  // ── Answer ───────────────────────────────────────────────
  socket.on('answer', ({ choice, text }) => {
    const p = state.players.get(socket.id);
    if (!p || state.phase !== 'QUESTION') return;
    if (state.answersClosed) return;
    if (p.eliminated) return;

    const q = cq(); if (!q) return;
    const now = Date.now();

    if (q.type === 'short') {
      const raw = (typeof text === 'string' ? text : '').trim();
      if (!raw) return;
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

    const answered = survivors().filter(pl => pl.answer !== null || pl.answerText !== null).length;
    io.emit('answer_progress', { answered, total: survivors().length });
  });

  // ── Answer cancel (short only, before answersClosed) ────
  socket.on('answer_cancel', () => {
    const p = state.players.get(socket.id);
    if (!p || state.phase !== 'QUESTION' || state.answersClosed) return;
    const q = cq(); if (!q || q.type !== 'short') return;

    p.answerText = null; p.answeredAt = null;
    socket.emit('answer_cancelled');
    io.emit('text_answer_cancelled', { sid: socket.id, name: p.name });

    const answered = survivors().filter(pl => pl.answer !== null || pl.answerText !== null).length;
    io.emit('answer_progress', { answered, total: survivors().length });
  });

  // ── Host: Start game ─────────────────────────────────────
  socket.on('host_start', () => {
    if (!isAdmin(socket)) return;
    const mainQ = loadQuestions();
    state.mainQuestions = mainQ;
    state.questionIndex = -1; state.phase = 'LOBBY';
    state.answersClosed = false; state.gameLog = [];
    state.ghostPlayers.clear();
    for (const p of state.players.values()) {
      p.eliminated = false; p.answer = null; p.answerText = null;
      delete p.eliminatedAtQuestion;
    }
    io.emit('game_started', { total: mainQ.length });
    broadcastState();
    addGameLog(`Game started: ${state.players.size} players, ${mainQ.length} Qs`);
    saveSession();

    // 5초 카운트다운 후 첫 문제 자동 시작
    io.emit('countdown', { from: 5, type: 'game_start' });
    setTimeout(() => { _doNextQuestion(); }, 5000);
  });

  // ── Host: Next question ──────────────────────────────────
  socket.on('host_next', () => {
    if (!isAdmin(socket)) return;
    _doNextQuestion();
  });

  socket.on('host_end', () => { if (!isAdmin(socket)) return; _endGame(); });

  // ── Host: Timer pause / resume ─────────────────────────
  socket.on('host_pause_timer', () => {
    if (!isAdmin(socket)) return;
    if (state.phase !== 'QUESTION' || state.timerPaused || state.answersClosed) return;
    state.timerPaused = true;
    io.emit('timer_paused', { timeLeft: state.timeLeft, timeLimit: state.currentTimeLimit });
    log(`Timer paused at ${state.timeLeft}s`);
  });

  socket.on('host_resume_timer', () => {
    if (!isAdmin(socket)) return;
    if (state.phase !== 'QUESTION' || !state.timerPaused) return;
    state.timerPaused = false;
    io.emit('timer_resumed', { timeLeft: state.timeLeft, timeLimit: state.currentTimeLimit });
    log(`Timer resumed at ${state.timeLeft}s`);
  });

  // ── Host: QR popup on display ──────────────────────────
  socket.on('host_qr_show', () => {
    if (!isAdmin(socket)) return;
    state.qrPopupVisible = true;
    io.emit('show_qr_popup');
    log('QR popup shown');
  });

  socket.on('host_qr_hide', () => {
    if (!isAdmin(socket)) return;
    state.qrPopupVisible = false;
    io.emit('hide_qr_popup');
    log('QR popup hidden');
  });

  socket.on('host_reset', () => {
    if (!isAdmin(socket)) return;
    clearInterval(state.timerInterval);
    Object.assign(state, { phase:'LOBBY', questionIndex:-1,
      answersClosed:false, timeLeft:0, currentTimeLimit:0, gameLog:[] });
    state.players.clear(); state.ghostPlayers.clear();
    state.mainQuestions = [];
    try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
    io.emit('reset'); broadcastState(); log('Game reset');
  });

  socket.on('host_reload_questions', () => {
    if (!isAdmin(socket)) return;
    const mainQ = loadQuestions();
    state.mainQuestions = mainQ;
    socket.emit('questions_reloaded', { main: mainQ.length });
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
function _doNextQuestion() {
  if (state.phase !== 'LOBBY' && state.phase !== 'REVEAL') return;
  state.questionIndex++;
  if (state.questionIndex >= state.mainQuestions.length) { _endGame(); return; }

  for (const p of state.players.values()) { p.answer = null; p.answerText = null; p.answeredAt = null; }
  state.phase = 'QUESTION'; state.answersClosed = false;

  const q = state.mainQuestions[state.questionIndex];
  const { round, qInRound } = roundInfo(state.questionIndex);

  io.emit('question', {
    index: state.questionIndex, total: state.mainQuestions.length,
    question: q.question, choices: q.choices, type: q.type,
    timeLimit: QUESTION_TIME, round, qInRound,
  });
  startTimer(QUESTION_TIME, () => _onTimeUp(q));
  broadcastState();
  addGameLog(`[${round}회차-${qInRound}번] Q${state.questionIndex + 1}: ${q.question}`);
  saveSession();
}

function _onTimeUp(q) {
  state.answersClosed = true;
  io.emit('time_up');

  if (q.type === 'short') {
    io.emit('answers_locked', { type: 'short', answers: getTextAnswers() });
  } else {
    io.emit('answers_locked', { type: q.type, answers: [] });
  }

  // 3초 카운트다운 후 자동 정답 공개
  io.emit('countdown', { from: 3, type: 'reveal' });
  setTimeout(() => { _doReveal(); }, REVEAL_DELAY);
}

function _doReveal() {
  if (state.phase !== 'QUESTION') return; // 중복 실행 방지

  clearInterval(state.timerInterval);
  state.answersClosed = true;

  const q       = cq();
  const pool    = survivors();
  const newElim = [], correct = [];

  for (const p of pool) {
    let ok = false;
    if (q.type === 'short') {
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
      correct.push(p.name);
    } else {
      p.eliminated = true;
      p.eliminatedAtQuestion = state.questionIndex + 1;
      newElim.push({ name: p.name, sid });
    }
  }

  state.phase = 'REVEAL';
  const payload = { correctAnswer: q.answer, correctAnswers: q.correctAnswers, stats: getAnswerStats(), type: q.type };

  io.emit('reveal', { ...payload, eliminated: newElim.map(e => e.name), survivors: correct, survivorCount: correct.length });

  // 각 탈락자에게 서버 시간 잠금 정보 전송
  for (const { sid } of newElim) {
    if (sid) io.to(sid).emit('eliminated', {
      eliminatedAtQuestion: state.questionIndex + 1,
      serverStartTime:      SERVER_START_TIME,
      serverEliminatedTime: new Date().toISOString(),
    });
  }

  addGameLog(`Reveal [${q.type}]: survived ${correct.length}, out ${newElim.length}`);
  broadcastState(); saveSession();
}

function _endGame() {
  const winners      = survivors().map(p => p.name);
  const allEliminated = winners.length === 0;
  state.phase = 'GAMEOVER';
  io.emit('game_over', { winners, allEliminated });
  broadcastState();
  addGameLog(`Game over - ${allEliminated ? '전원 탈락' : 'winners: ' + winners.join(', ')}`);
  try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
}

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('='.repeat(52));
  log(`  Speed Golden Bell Server v5.0  |  Port: ${PORT}`);
  log('='.repeat(52));
  log(`  Host:        http://localhost:${PORT}/host.html`);
  log(`  Display:     http://localhost:${PORT}/display.html`);
  log(`  Participant: http://localhost:${PORT}/participant.html`);
  log('='.repeat(52));
  loadSession();
});
