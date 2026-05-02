'use strict';
const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const WAIT = ms => new Promise(r => setTimeout(r, ms));

let totalAsserts = 0;
let passedAsserts = 0;

function assert(condition, message) {
  totalAsserts++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedAsserts++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function run() {
  console.log("=================================================================");
  console.log("  🏆 스피드 골든벨 V5.0 최신 통합 자동화 테스트 (test_all.js)");
  console.log("  (현재 서버 로직 및 삭제된 기능(패자부활전)을 반영한 최신판)");
  console.log("=================================================================\n");

  const host = io(SERVER_URL);
  await WAIT(500);

  // ---------------------------------------------------------
  console.log("▶ [시나리오 1] 서버 초기화 및 보안/기본 검증 (XSS, 공백, 중복, 세션 복구)");
  // ---------------------------------------------------------
  host.emit('host_reset');
  await WAIT(1000);

  const p1 = io(SERVER_URL);
  const p2 = io(SERVER_URL);
  await WAIT(500);

  // XSS 방어
  let p1Name = "";
  p1.once('joined', d => p1Name = d.name);
  p1.emit('join', { name: '<script>alert(1)</script>', uid: 'u-1' });
  await WAIT(500);
  assert(p1Name === '&lt;script&gt;alert(', 'XSS 스크립트 문자열이 이스케이프/절삭 처리됨');

  // 공백 이름 차단
  let blankErr = null;
  p2.once('join_error', e => blankErr = e);
  p2.emit('join', { name: '   ', uid: 'u-2' });
  await WAIT(500);
  assert(blankErr !== null, '공백 닉네임 가입 차단');

  // 정상 가입 및 중복 접속 차단
  p2.emit('join', { name: '정상유저', uid: 'u-2' });
  await WAIT(500);
  
  const p3 = io(SERVER_URL);
  let dupErr = null;
  p3.once('join_error', e => dupErr = e);
  p3.emit('join', { name: '정상유저', uid: 'u-3' });
  await WAIT(500);
  assert(dupErr === '이미 사용 중인 이름입니다.', '동일 닉네임 중복 가입 차단');

  // 세션 복구(session_restore) 테스트
  p2.disconnect();
  await WAIT(1000);
  const p2_re = io(SERVER_URL);
  let restored = false;
  p2_re.once('session_restored', () => restored = true);
  p2_re.emit('session_restore', { uid: 'u-2' });
  await WAIT(500);
  assert(restored, '연결이 끊긴 유저가 30분 내 session_restore 시 정상 복구됨');

  p1.disconnect(); p2_re.disconnect(); p3.disconnect();
  await WAIT(1000);

  // ---------------------------------------------------------
  console.log("\n▶ [시나리오 2] 악성 봇 부대 게임 진행 (연타, 권한 격리 검증)");
  // ---------------------------------------------------------
  host.emit('host_reset');
  await WAIT(1000);

  const bots = {
    normal: { s: io(SERVER_URL), uid: 'b-normal', name: '일반봇' },
    spammer: { s: io(SERVER_URL), uid: 'b-spammer', name: '연타충' },
    zombie: { s: io(SERVER_URL), uid: 'b-zombie', name: '좀비봇' }
  };
  Object.values(bots).forEach(b => b.s.emit('join', { name: b.name, uid: b.uid }));
  await WAIT(1000);

  host.emit('host_start'); // 1번 문제부터 시작
  await WAIT(6000); // 카운트다운(5초) + 여유(1초)

  // 연타충 공격 (서버 과부하 방어 테스트)
  for(let i = 0; i < 10; i++) {
    bots.spammer.s.emit('answer', { choice: i % 2 });
    await WAIT(50);
  }
  bots.spammer.s.emit('answer', { choice: 0 }); // 최종 정답 전송

  // 일반봇 정답 (O)
  bots.normal.s.emit('answer', { choice: 0 });
  // 좀비봇 오답 (X)
  bots.zombie.s.emit('answer', { choice: 1 });

  console.log("  ... 타이머 대기 중 (약 15초 소요) ...");
  await new Promise(r => host.once('reveal', r)); // 정답공개 대기
  await WAIT(1000);

  // 다음 문제로 (좀비봇은 이미 탈락한 상태)
  host.emit('host_next');
  await WAIT(6000);
  
  bots.zombie.s.emit('answer', { choice: 0 }); // 죽은 봇이 정답 전송 시도
  bots.normal.s.emit('answer', { choice: 0 }); // 산 봇이 정답 전송 시도

  let zombieAck = false;
  bots.zombie.s.once('answer_ok', () => zombieAck = true);
  await WAIT(1000);
  assert(!zombieAck, '탈락한 봇(좀비봇)이 다음 문제에서 답을 보내도 무시됨 (권한 격리)');

  Object.values(bots).forEach(b => b.s.disconnect());
  await WAIT(1000);

  // ---------------------------------------------------------
  console.log("\n▶ [시나리오 3] 200명 동시 접속 스트레스 테스트");
  // ---------------------------------------------------------
  host.emit('host_reset');
  await WAIT(1000);

  const STRESS_COUNT = 200;
  const stressClients = [];
  let joinedCount = 0;
  
  for(let i = 0; i < STRESS_COUNT; i++) {
    const s = io(SERVER_URL, { transports: ['websocket'] });
    s.once('joined', () => joinedCount++);
    s.on('connect', () => {
      s.emit('join', { name: `S_${i}`, uid: `u-stress-${i}` });
    });
    stressClients.push(s);
    if(i % 50 === 0) await WAIT(100); // 부하 조절
  }

  await WAIT(2000);
  assert(joinedCount === STRESS_COUNT, `200명 동시 소켓 연결 및 Join 완료 (${joinedCount}/${STRESS_COUNT})`);

  host.emit('host_start');
  await WAIT(6000);

  let ackCount = 0;
  stressClients.forEach(s => {
    s.once('answer_ok', () => ackCount++);
    s.emit('answer', { choice: 0 });
  });

  await WAIT(3000);
  assert(ackCount === STRESS_COUNT, `200명의 답변(Race Condition)이 유실이나 타임아웃 없이 100% 처리됨 (${ackCount}/${STRESS_COUNT})`);

  stressClients.forEach(s => s.disconnect());
  host.disconnect();

  console.log("\n=================================================================");
  console.log(`  🎯 전체 테스트 종료: 총 ${totalAsserts}개 중 ${passedAsserts}개 통과`);
  console.log("=================================================================\n");
  
  process.exit(passedAsserts === totalAsserts ? 0 : 1);
}

run().catch(err => {
  console.error("테스트 실행 중 치명적 오류:", err);
  process.exit(1);
});
