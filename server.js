// Speed Golden Bell Quiz Server v6.0
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
const GOLDEN_BELL_START = 75;   // 0-indexed: Q76 = index 75부터 골든벨 구간

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

  // 한글 유형 매핑
  const TYPE_MAP = {
    '객관식': 'choice', '선택형': 'choice',
    '오엑스': 'ox', 'ox': 'ox', 'o/x': 'ox', 'o x': 'ox',
    '단답형': 'short', '주관식': 'short', '서술형': 'short',
    'essay': 'short',
    'comeback': 'comeback', '패자부활': 'comeback',  // 후속 필터에서 제외됨
  };
  let type = TYPE_MAP[rawType] || rawType;
  if (!type) {
    if (choices.length === 2 && choices[0].toUpperCase() === 'O' && choices[1].toUpperCase() === 'X') type = 'ox';
    else if (choices.length === 0) type = 'short';
    else type = 'choice';
  }
  if (!['choice', 'ox', 'short', 'comeback'].includes(type)) {
    log(`Q${i + 1} 알 수 없는 유형 "${rawType}" → choice 처리`, 'WARN');
    type = 'choice';
  }

  const q = {
    id:        i + 1,
    question:  String(row['문제'] || row['question'] || ''),
    choices,
    timeLimit: QUESTION_TIME,
    type,
    answer:    null,
    correctAnswers: null,
  };

  if (type === 'comeback') {
    // 후속 필터에서 제외되므로 정답 파싱 스킵
    return q;
  }
  if (type === 'short') {
    const raw = String(row['정답'] || row['answer'] || '');
    q.correctAnswers = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!q.correctAnswers.length) {
      log(`Q${i + 1} (단답형) 정답이 비어있음 — 이 문제는 모든 답이 오답 처리됨`, 'WARN');
    }
  } else {
    // OX 정답이 "O"/"X" 텍스트로 들어온 경우 처리
    const rawAns = row['정답'] != null ? String(row['정답']).trim() : '';
    let parsed;
    if (type === 'ox' && /^[oxOX]$/i.test(rawAns)) {
      parsed = rawAns.toUpperCase() === 'O' ? 1 : 2; // 1-indexed (O=1, X=2)
    } else {
      parsed = parseInt(rawAns || row['answer'] || 1);
    }
    if (!Number.isFinite(parsed)) {
      log(`Q${i + 1} 정답 파싱 실패 ("${rawAns}") → 1번으로 fallback`, 'WARN');
      parsed = 1;
    }
    q.answer = parsed - 1;
    // 인덱스 범위 검증
    if (q.answer < 0 || q.answer >= choices.length) {
      log(`Q${i + 1} 정답 인덱스 ${q.answer + 1}가 보기 범위(1~${choices.length})를 벗어남 → 1번으로 클램핑`, 'WARN');
      q.answer = 0;
    }
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
  displayMode:   'promo',
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
  pendingStartIndex: 0,  // 0 = Q1부터, N = QN부터 시작
  lastEliminatedStats:    [],
  lastEliminatedNoAnswer: 0,
  outdoorMode:            false,
};

function cq() { return state.mainQuestions[state.questionIndex]; }

function survivors()   { return [...state.players.values()].filter(p => !p.eliminated); }
// 끊긴 채로 살아있는 ghost 포함한 총 생존자 수 (UI 표시용)
function totalAliveCount() {
  let n = 0;
  for (const p of state.players.values())      if (!p.eliminated) n++;
  for (const g of state.ghostPlayers.values()) if (!g.eliminated) n++;
  return n;
}

// ══════════════════════════════════════════════════════════════
//  단답형 채점 (합리적 모드)
//   ① 완전 일치  ② 입력이 정답 포함 (문장형 OK)  ③ 4자+ 오타 1, 8자+ 오타 2
// ══════════════════════════════════════════════════════════════
function normalizeAnswer(s) {
  return String(s || '').toLowerCase().normalize('NFC').replace(/[\s\.,\!\?]/g, '');
}
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (Math.abs(m - n) > 3) return 999; // early exit
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}
function isShortCorrect(given, correctAnswers) {
  const g = normalizeAnswer(given);
  if (!g) return false;
  return (correctAnswers || []).some(a => {
    const n = normalizeAnswer(a);
    if (!n) return false;
    if (g === n) return true;          // ① 완전 일치
    if (g.includes(n)) return true;    // ② "정답은 mars 입니다" 같은 문장형
    if (n.length >= 4) {               // ③ 오타 허용 (4자 이상 정답만)
      const allowed = n.length >= 8 ? 2 : 1;
      if (levenshtein(g, n) <= allowed) return true;
    }
    return false;
  });
}

function roundInfo(idx) {
  return { round: Math.floor(idx / 15) + 1, qInRound: (idx % 15) + 1 };
}

// 골든벨 포함 문제 메타 반환 (round/qInRound 또는 goldenBellNum)
function questionMeta(idx) {
  if (idx >= GOLDEN_BELL_START) {
    return { isGoldenBell: true, goldenBellNum: idx - GOLDEN_BELL_START + 1, round: null, qInRound: null };
  }
  const { round, qInRound } = roundInfo(idx);
  return { isGoldenBell: false, goldenBellNum: null, round, qInRound };
}

const MAX_GAME_LOG = 500;
function addGameLog(msg) {
  const entry = { ts: new Date().toISOString(), msg };
  state.gameLog.push(entry);
  if (state.gameLog.length > MAX_GAME_LOG) state.gameLog.splice(0, state.gameLog.length - MAX_GAME_LOG);
  io.emit('game_log', entry);
  log(`[EVENT] ${msg}`);
}

function getAnswerStats() {
  const q = cq(); if (!q || !q.choices.length) return [];
  const stats = new Array(q.choices.length).fill(0);
  // 연결된 생존자 + 이번 문제에 답하고 살아있는 유령
  for (const p of survivors()) if (p.answer !== null && stats[p.answer] !== undefined) stats[p.answer]++;
  for (const g of state.ghostPlayers.values()) {
    if (g.eliminated) continue;
    if (g.answeredAtIndex === state.questionIndex && g.answer !== null && stats[g.answer] !== undefined) stats[g.answer]++;
  }
  return stats;
}

function getTextAnswers() {
  return survivors().filter(p => p.answerText !== null).map(p => ({ name: p.name, text: p.answerText }));
}

function buildStateFor(sid) {
  const p = state.players.get(sid); if (!p) return null;
  const q = cq();
  const meta = state.questionIndex >= 0 ? questionMeta(state.questionIndex) : { isGoldenBell: false, goldenBellNum: null, round: null, qInRound: null };
  const totalAll = state.players.size + state.ghostPlayers.size;
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  totalAliveCount(),     // 끊긴 ghost 포함
    totalPlayers:   totalAll,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    answersClosed:  state.answersClosed,
    eliminated:     p.eliminated,
    eliminatedAtQuestion: p.eliminatedAtQuestion,
    eliminatedReason:     p.eliminatedReason,
    eliminatedAt:         p.eliminatedAt,
    name:           p.name,
    alreadyAnswered: p.answer !== null || p.answerText !== null,
    myAnswer:       p.answer,
    myAnswerText:   p.answerText,
    ...meta,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats:       state.phase === 'REVEAL' ? getAnswerStats() : null,
    eliminatedStats:   state.phase === 'REVEAL' ? (state.lastEliminatedStats || []) : null,
    eliminatedNoAnswer:state.phase === 'REVEAL' ? (state.lastEliminatedNoAnswer || 0) : null,
  };
}

function buildGenericState() {
  const q    = cq();
  const surv = totalAliveCount();
  const meta = state.questionIndex >= 0 ? questionMeta(state.questionIndex) : { isGoldenBell: false, goldenBellNum: null, round: null, qInRound: null };
  const totalAll = state.players.size + state.ghostPlayers.size;
  return {
    phase:          state.phase,
    questionIndex:  state.questionIndex,
    totalQuestions: state.mainQuestions.length,
    survivorCount:  surv,
    eliminatedCount: totalAll - surv,
    totalPlayers:   totalAll,
    timeLeft:       state.timeLeft,
    timeLimit:      state.currentTimeLimit,
    answersClosed:  state.answersClosed,
    ...meta,
    question: q && (state.phase === 'QUESTION' || state.phase === 'REVEAL') ? {
      id: q.id, question: q.question, choices: q.choices,
      timeLimit: q.timeLimit, type: q.type,
      answer:         state.phase === 'REVEAL' ? q.answer         : undefined,
      correctAnswers: state.phase === 'REVEAL' ? q.correctAnswers : undefined,
    } : null,
    answerStats:       state.phase === 'REVEAL' ? getAnswerStats() : null,
    eliminatedStats:   state.phase === 'REVEAL' ? (state.lastEliminatedStats || []) : null,
    eliminatedNoAnswer:state.phase === 'REVEAL' ? (state.lastEliminatedNoAnswer || 0) : null,
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
//  GHOST CLEANUP — 5분마다 30분 초과 ghost 자동 삭제 (메모리 누수 방지)
// ══════════════════════════════════════════════════════════════
setInterval(() => {
  const LIMIT = 30 * 60 * 1000;
  let purged = 0;
  for (const [uid, g] of state.ghostPlayers) {
    if (Date.now() - g.disconnectedAt > LIMIT) {
      state.ghostPlayers.delete(uid);
      purged++;
    }
  }
  if (purged > 0) log(`Ghost cleanup: ${purged} expired ghosts removed (${state.ghostPlayers.size} remaining)`);
}, 5 * 60 * 1000);

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
let cfUrl = '', cfLastSize = 0, _tunnelLastOk = Date.now();

function parseCfLog() {
  if (!fs.existsSync(CF_LOG)) return;
  try {
    // /g 로 모든 URL 찾고 가장 마지막 것 사용 (watchdog 재시작 시 새 URL 반영)
    const matches = fs.readFileSync(CF_LOG, 'utf8').match(/https:\/\/[\w-]+\.trycloudflare\.com/g);
    if (matches && matches.length) {
      const latest = matches[matches.length - 1];
      if (latest !== cfUrl) {
        cfUrl = latest;
        log(`Tunnel URL: ${cfUrl}`);
        io.emit('cf_url', { url: cfUrl });
      }
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
          buf.toString().split('\n').filter(Boolean).forEach(l => {
            log(`[CF] ${l}`);
            // "Registered tunnel connection" 또는 일반 INF 라인 = 터널 살아있음
            if (/Registered tunnel connection|INF Tunnel/.test(l)) _tunnelLastOk = Date.now();
          });
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
  const totalAll = state.players.size + state.ghostPlayers.size;
  res.json({ phase: state.phase, players: totalAll, survivors: totalAliveCount(),
    questions: state.mainQuestions.length, cfUrl, uptime: process.uptime() });
});

// 헬스체크 — 터널/서버 정상 여부 감시용 (host.html 이 polling)
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    ts: Date.now(),
    uptime: process.uptime(),
    phase: state.phase,
    players: state.players.size + state.ghostPlayers.size,
    sockets: io.engine.clientsCount,
    memMB: Math.round(mem.rss / 1024 / 1024),
    cfUrl,
    cfAlive: cfUrl ? (Date.now() - _tunnelLastOk < 120000) : false,
  });
});
// _tunnelLastOk 는 watchCfLog 내부 ("Registered tunnel connection" / "INF Tunnel" 라인)에서 갱신

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
  socket.emit('display_mode', { mode: state.displayMode || 'promo' });
  if (cfUrl) socket.emit('cf_url', { url: cfUrl });
  socket.emit('game_log_history', state.gameLog.slice(-100));
  if (state.outdoorMode) socket.emit('outdoor_mode', { on: true });

  const allPlayers = [];
  for (const p of state.players.values()) allPlayers.push({ name: p.name, eliminated: p.eliminated });
  for (const g of state.ghostPlayers.values()) allPlayers.push({ name: g.name, eliminated: g.eliminated });
  socket.emit('player_list', allPlayers);

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
      // 같은 문제 내 재접속이면 답변 보존, 그 외에는 클리어
      const sameQ = ghost.answeredAtIndex === state.questionIndex && state.phase === 'QUESTION';
      const restored = sameQ
        ? { ...ghost }
        : { ...ghost, answer: null, answerText: null, answeredAt: null, answeredAtIndex: null };
      state.players.set(socket.id, restored);
      socket.join('players');
      socket.emit('session_restored', buildStateFor(socket.id));
      const totalAllRestore = state.players.size + state.ghostPlayers.size;
      io.emit('player_joined', { name: ghost.name, total: totalAllRestore, survivors: totalAliveCount() });
      log(`Session restored: ${ghost.name}`);
      saveSession(); return;
    }

    for (const [sid, p] of state.players) {
      if (p.uid === uid) {
        state.players.delete(sid);
        // 같은 문제 내 다른 탭/소켓이면 답변 보존
        const sameQ = p.answeredAtIndex === state.questionIndex && state.phase === 'QUESTION';
        state.players.set(socket.id, sameQ
          ? { ...p }
          : { ...p, answer: null, answerText: null, answeredAt: null, answeredAtIndex: null });
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
        const totalAllRejoin = state.players.size + state.ghostPlayers.size;
        io.emit('player_joined', { name: ghost.name, total: totalAllRejoin, survivors: totalAliveCount() });
        log(`Rejoin by name: ${ghost.name}`);
        saveSession(); return;
      }
      socket.emit('join_error', '게임이 이미 시작되었습니다. 같은 닉네임으로 재입장 가능합니다.'); return;
    }

    for (const p of state.players.values()) {
      if (p.name === trimmed) { socket.emit('join_error', '이미 사용 중인 이름입니다.'); return; }
    }
    // uid가 없거나 빈 문자열이면 서버에서 생성 (ghost key 충돌 방지)
    const safeUid = (typeof uid === 'string' && uid.length > 0)
      ? uid
      : `srv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    state.players.set(socket.id, { name: trimmed, uid: safeUid, eliminated: false, answer: null, answerText: null, answeredAt: null });
    socket.join('players');
    socket.emit('joined', { name: trimmed, uid: safeUid });
    const totalAllJoin = state.players.size + state.ghostPlayers.size;
    io.emit('player_joined', { name: trimmed, total: totalAllJoin, survivors: totalAliveCount() });
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
      p.answerText = safe; p.answeredAt = now; p.answeredAtIndex = state.questionIndex;
      socket.emit('answer_ok', { text: safe, changed: !isFirst });
      io.emit('text_answer_in', { sid: socket.id, name: p.name, text: safe });
    } else {
      if (typeof choice !== 'number') return;
      if (p.answer === choice && p.answeredAt && now - p.answeredAt < 1500) return;
      const isFirst = p.answer === null;
      p.answer = choice; p.answeredAt = now; p.answeredAtIndex = state.questionIndex;
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

    p.answerText = null; p.answeredAt = null; p.answeredAtIndex = null;
    socket.emit('answer_cancelled');
    io.emit('text_answer_cancelled', { sid: socket.id, name: p.name });

    const answered = survivors().filter(pl => pl.answer !== null || pl.answerText !== null).length;
    io.emit('answer_progress', { answered, total: survivors().length });
  });

  // ── Host: Start game ─────────────────────────────────────
  socket.on('host_start', () => {
    if (!isAdmin(socket)) return;
    state.displayMode = 'lobby';
    io.emit('display_mode', { mode: 'lobby' });
    const mainQ = loadQuestions();
    state.mainQuestions = mainQ;
    // pendingStartIndex가 설정돼 있으면 그 문제부터 시작 (실제 문제 수로 클램핑)
    const rawPending = state.pendingStartIndex;
    const pending = rawPending > 0 ? Math.min(rawPending, mainQ.length) : 0;
    if (rawPending > mainQ.length && rawPending > 0) {
      log(`pendingStartIndex(${rawPending}) > 문제 수(${mainQ.length}), Q${mainQ.length}로 클램핑`, 'WARN');
    }
    state.questionIndex = pending > 1 ? pending - 2 : -1;
    state.pendingStartIndex = 0;
    state.phase = 'LOBBY';
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

  // ── Host: 골든벨 돌입 ──────────────────────────────────────
  // 조건: REVEAL 상태 + 15문제 블록 완료 + 아직 골든벨 미진입 + Q76 이후 문제 존재
  socket.on('host_goldenbell', () => {
    if (!isAdmin(socket)) return;
    if (state.phase !== 'REVEAL') return;
    if (((state.questionIndex + 1) % 15) !== 0) {
      socket.emit('goldenbell_error', '15문제 단위로 완료된 후에만 골든벨에 진입할 수 있습니다.');
      return;
    }
    if (state.questionIndex >= GOLDEN_BELL_START) {
      socket.emit('goldenbell_error', '이미 골든벨 구간입니다.');
      return;
    }
    if (state.mainQuestions.length <= GOLDEN_BELL_START) {
      socket.emit('goldenbell_error', `골든벨 문제(Q${GOLDEN_BELL_START + 1} 이후)가 없습니다.`);
      return;
    }
    // 서버측 생존자 검증 (클라이언트 우회 차단)
    const survCount = survivors().length;
    if (survCount < 2) {
      socket.emit('goldenbell_error', `생존자 ${survCount}명 — 골든벨은 2명 이상일 때만 가능합니다.`);
      return;
    }
    // questionIndex를 GOLDEN_BELL_START-1 로 설정 → _doNextQuestion()이 GOLDEN_BELL_START로 올림
    state.questionIndex = GOLDEN_BELL_START - 1;
    addGameLog(`🔔 골든벨 돌입! (Q${GOLDEN_BELL_START + 1}부터 시작, 생존 ${survCount}명)`);
    _doNextQuestion();
  });

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

  socket.on('host_display_mode', ({ mode }) => {
    if (!isAdmin(socket)) return;
    state.displayMode = mode;
    io.emit('display_mode', { mode });
    log(`Display mode changed: ${mode}`);
  });

  socket.on('host_reset', () => {
    if (!isAdmin(socket)) return;
    clearInterval(state.timerInterval);
    Object.assign(state, { phase:'LOBBY', displayMode:'promo', questionIndex:-1,
      answersClosed:false, timeLeft:0, currentTimeLimit:0, gameLog:[] });
    state.players.clear(); state.ghostPlayers.clear();
    state.mainQuestions = [];
    try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
    io.emit('reset'); broadcastState(); 
    io.emit('display_mode', { mode: 'promo' });
    log('Game reset');
  });

  socket.on('host_outdoor', ({ on }) => {
    if (!isAdmin(socket)) return;
    state.outdoorMode = !!on;
    io.emit('outdoor_mode', { on: state.outdoorMode });
    log(`Outdoor mode: ${state.outdoorMode ? 'ON' : 'OFF'}`);
  });

  socket.on('host_reload_questions', () => {
    if (!isAdmin(socket)) return;
    const mainQ = loadQuestions();
    state.mainQuestions = mainQ;
    socket.emit('questions_reloaded', { main: mainQ.length });
  });

  // ── Host: 문제 지정 (로비: 시작 문제 예약 / 진행중: 다음 문제 점프) ──
  socket.on('host_jump_question', ({ targetQ }) => {
    if (!isAdmin(socket)) return;
    // LOBBY 시점에는 mainQuestions가 비어있을 수 있음 → 75 기본값 사용
    // 실제 클램핑은 host_start에서 mainQ.length 기준으로 수행됨
    const max = state.mainQuestions.length || 75;
    const n   = Math.max(1, Math.min(Math.round(targetQ), max));

    if (state.phase === 'LOBBY') {
      state.pendingStartIndex = n;
      socket.emit('question_jump_set', { targetQ: n, phase: 'LOBBY' });
      log(`Pending start index set: Q${n}`);
    } else if (state.phase === 'REVEAL') {
      // _doNextQuestion()에서 ++ 하므로 n-2 세팅 후 즉시 실행
      state.questionIndex = n - 2;
      socket.emit('question_jump_set', { targetQ: n, phase: 'REVEAL' });
      log(`Jumped directly to Q${n}`);
      _doNextQuestion(); // 바로 해당 문제 시작
    } else {
      socket.emit('question_jump_set', { targetQ: null, phase: state.phase, error: '이 상태에서는 지정 불가' });
    }
  });

  socket.on('disconnect', () => {
    const p = state.players.get(socket.id);
    if (p) {
      // ─── QUESTION 단계 disconnect → 즉시 정답 검증 후 탈락 판정 (탈락 회피 방지) ───
      if (state.phase === 'QUESTION' && !p.eliminated) {
        const q = cq();
        if (q) {
          let hasAnswered = false, isCorrect = false;
          if (q.type === 'short') {
            hasAnswered = typeof p.answerText === 'string' && p.answerText.length > 0;
            if (hasAnswered) isCorrect = isShortCorrect(p.answerText, q.correctAnswers);
          } else {
            hasAnswered = p.answer !== null && p.answer !== undefined && Number.isFinite(p.answer);
            if (hasAnswered) isCorrect = p.answer === q.answer;
          }
          if (!hasAnswered) {
            p.eliminated = true;
            p.eliminatedAtQuestion = state.questionIndex + 1;
            p.eliminatedReason = 'disconnect';
            addGameLog(`💀 ${p.name} 답변 전 끊김 → 탈락`);
          } else if (!isCorrect) {
            p.eliminated = true;
            p.eliminatedAtQuestion = state.questionIndex + 1;
            p.eliminatedReason = 'wrong';
            addGameLog(`💀 ${p.name} 오답 후 끊김 → 탈락`);
          }
          // 정답 후 끊김 → 살아있음 유지 (재접속 시 그대로 alive)
        }
      }

      // uid 안전장치 (없으면 즉석 생성 — 충돌 방지)
      const ghostKey = (typeof p.uid === 'string' && p.uid.length > 0)
        ? p.uid
        : `srv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      state.ghostPlayers.set(ghostKey, { ...p, uid: ghostKey, disconnectedAt: Date.now() });
      state.players.delete(socket.id);
      io.emit('player_left', { name: p.name, total: state.players.size + state.ghostPlayers.size });
      const tag = p.eliminatedReason === 'disconnect' ? ' (미답 탈락)'
                : p.eliminatedReason === 'wrong'      ? ' (오답 탈락)'
                : ' (ghost 저장)';
      log(`Disconnected: ${p.name}${tag}`);
      saveSession();
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════
function _doNextQuestion() {
  if (state.phase !== 'LOBBY' && state.phase !== 'REVEAL') return;
  if (!state.mainQuestions.length) {
    log('_doNextQuestion: mainQuestions empty, ignoring', 'WARN');
    return;
  }
  state.questionIndex++;
  if (state.questionIndex >= state.mainQuestions.length) { _endGame(); return; }

  for (const p of state.players.values()) { p.answer = null; p.answerText = null; p.answeredAt = null; p.answeredAtIndex = null; }
  // 유령 플레이어의 이전 답안도 초기화 (이전 문제 답이 다음 reveal에 영향 주지 않도록)
  for (const g of state.ghostPlayers.values()) { g.answer = null; g.answerText = null; g.answeredAt = null; g.answeredAtIndex = null; }
  state.phase = 'QUESTION'; state.answersClosed = false;

  const q = state.mainQuestions[state.questionIndex];
  const meta = questionMeta(state.questionIndex);
  const logLabel = meta.isGoldenBell
    ? `[골든벨 ${meta.goldenBellNum}번]`
    : `[${meta.round}회차-${meta.qInRound}번]`;

  io.emit('question', {
    index: state.questionIndex, total: state.mainQuestions.length,
    question: q.question, choices: q.choices, type: q.type,
    timeLimit: QUESTION_TIME, ...meta,
  });
  startTimer(QUESTION_TIME, () => _onTimeUp(q));
  broadcastState();
  addGameLog(`${logLabel} Q${state.questionIndex + 1}: ${q.question}`);
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

  // 탈락자 선택 통계 (choice/ox 기준)
  const eliminatedStats = q.choices && q.choices.length
    ? new Array(q.choices.length).fill(0)
    : [];
  let eliminatedNoAnswer = 0; // 미답으로 탈락한 인원수

  // sid 역인덱스 (O(n²) → O(n))
  const sidByPlayer = new Map();
  for (const [sid, pl] of state.players) sidByPlayer.set(pl, sid);

  // ─── ① 연결된 생존자 채점 ─────────────────────────
  for (const p of pool) {
    let ok = false;
    let reason = 'wrong';
    if (q.type === 'short') {
      if (!p.answerText) {
        // 🔒 미답 = 자동 탈락
        ok = false; reason = 'timeout';
      } else {
        ok = isShortCorrect(p.answerText, q.correctAnswers);
      }
    } else {
      if (p.answer === null || p.answer === undefined || !Number.isFinite(p.answer)) {
        ok = false; reason = 'timeout';
      } else {
        ok = p.answer === q.answer;
      }
    }
    const sid = sidByPlayer.get(p);
    if (ok) {
      correct.push(p.name);
    } else {
      p.eliminated = true;
      p.eliminatedAtQuestion = state.questionIndex + 1;
      p.eliminatedReason     = reason;
      p.eliminatedAt         = new Date().toISOString();
      newElim.push({ name: p.name, sid, reason, choice: p.answer, text: p.answerText });

      // 통계 집계
      if (reason === 'timeout') eliminatedNoAnswer++;
      else if ((q.type === 'choice' || q.type === 'ox')
               && typeof p.answer === 'number'
               && eliminatedStats[p.answer] !== undefined) {
        eliminatedStats[p.answer]++;
      }
    }
  }

  // ─── ② 유령 플레이어 채점 (Bug A/B 수정) ──────────
  // 살아있는 유령 = 끊김 직전 정답 OR 그 이전 회차 정답자
  // 이 라운드에 답을 못한 유령은 timeout 탈락, 답했으면 채점하여 생존 가산
  for (const g of state.ghostPlayers.values()) {
    if (g.eliminated) continue;

    const answeredThisQ = g.answeredAtIndex === state.questionIndex;
    let gOk = false;
    let gReason = 'timeout';

    if (!answeredThisQ) {
      // 이번 문제에 답할 기회 없었음 → 미답 탈락
      gOk = false; gReason = 'timeout';
    } else if (q.type === 'short') {
      if (!g.answerText) { gOk = false; gReason = 'timeout'; }
      else { gOk = isShortCorrect(g.answerText, q.correctAnswers); gReason = gOk ? 'wrong' : 'wrong'; }
    } else {
      if (g.answer === null || g.answer === undefined || !Number.isFinite(g.answer)) {
        gOk = false; gReason = 'timeout';
      } else {
        gOk = g.answer === q.answer;
        gReason = 'wrong';
      }
    }

    if (gOk) {
      // 정답 — 끊김 상태에서도 생존 인정
      correct.push(g.name);
    } else {
      g.eliminated            = true;
      g.eliminatedAtQuestion  = state.questionIndex + 1;
      g.eliminatedReason      = gReason;
      g.eliminatedAt          = new Date().toISOString();
      addGameLog(`💀 ${g.name} (끊김 상태, ${gReason === 'timeout' ? '미답' : '오답'}) → 탈락`);
      // 유령은 newElim에 추가 안 함 (sid 없어 individual emit 불가)
      // 통계 집계
      if (gReason === 'timeout') eliminatedNoAnswer++;
      else if ((q.type === 'choice' || q.type === 'ox')
               && typeof g.answer === 'number'
               && eliminatedStats[g.answer] !== undefined) {
        eliminatedStats[g.answer]++;
      }
    }
  }

  state.phase = 'REVEAL';
  // 현재 회차 통계 state에 보관 (재접속 시 복원용)
  state.lastEliminatedStats    = eliminatedStats;
  state.lastEliminatedNoAnswer = eliminatedNoAnswer;

  const payload = {
    correctAnswer:  q.answer,
    correctAnswers: q.correctAnswers,
    stats:          getAnswerStats(),   // 생존자 선택 분포
    eliminatedStats,                    // 탈락자 선택 분포
    eliminatedNoAnswer,                 // 미답 탈락자 수
    type:           q.type,
  };

  io.emit('reveal', { ...payload,
    eliminated: newElim.map(e => ({ name: e.name, reason: e.reason })),
    survivors: correct, survivorCount: correct.length });

  // 각 탈락자에게 서버 시간 + 사유 전송
  const elimMeta = questionMeta(state.questionIndex);
  for (const { sid, reason } of newElim) {
    if (sid) io.to(sid).emit('eliminated', {
      eliminatedAtQuestion: state.questionIndex + 1,
      isGoldenBell:  elimMeta.isGoldenBell,
      goldenBellNum: elimMeta.goldenBellNum,
      serverStartTime:      SERVER_START_TIME,
      serverEliminatedTime: new Date().toISOString(),
      reason,
    });
  }

  addGameLog(`Reveal [${q.type}]: survived ${correct.length}, out ${newElim.length}`
    + (eliminatedNoAnswer ? ` (미답 ${eliminatedNoAnswer})` : ''));
  if (newElim.length) {
    const names = newElim.map(e => e.reason === 'timeout' ? `${e.name}(미답)` : e.name).join(', ');
    addGameLog(`탈락: ${names}`);
  }
  broadcastState(); saveSession();

  // 자동 종료 조건:
  // (a) 전원 탈락 — 즉시 GAMEOVER
  // (b) 골든벨 구간에서 생존자 1명 이하 — 즉시 GAMEOVER (우승 또는 전원 탈락)
  if (correct.length === 0) {
    setTimeout(() => { if (state.phase === 'REVEAL') _endGame(); }, 1500);
  } else if (state.questionIndex >= GOLDEN_BELL_START && correct.length === 1) {
    setTimeout(() => { if (state.phase === 'REVEAL') _endGame(); }, 1500);
  }
}

function _endGame() {
  // 우승자 = 연결된 생존자 + 살아있는 유령 (Bug B: 정답 후 끊긴 사람 우승 인정)
  const aliveConnected = survivors().map(p => p.name);
  const aliveGhosts    = [...state.ghostPlayers.values()].filter(g => !g.eliminated).map(g => g.name);
  const winners        = [...new Set([...aliveConnected, ...aliveGhosts])];
  const allEliminated  = winners.length === 0;
  state.phase = 'GAMEOVER';
  io.emit('game_over', { winners, allEliminated });
  broadcastState();
  addGameLog(`Game over - ${allEliminated ? '전원 탈락' : 'winners: ' + winners.join(', ')}`
    + (aliveGhosts.length ? ` (끊김 우승자 ${aliveGhosts.length}명 포함)` : ''));
  try { if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH); } catch {}
}

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('='.repeat(52));
  log(`  Speed Golden Bell Server v6.0  |  Port: ${PORT}`);
  log('='.repeat(52));
  log(`  Host:        http://localhost:${PORT}/host.html`);
  log(`  Display:     http://localhost:${PORT}/display.html`);
  log(`  Participant: http://localhost:${PORT}/participant.html`);
  log('='.repeat(52));
  loadSession();
});
