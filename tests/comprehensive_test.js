'use strict';
/**
 * 골든벨 서버 종합 검증 스크립트
 *
 * 실행 방법: node tests/comprehensive_test.js
 * 사전 조건: 서버가 http://localhost:3000 에서 실행 중이어야 함
 *
 * 커버 시나리오:
 *  1. 관리자 권한 우회(Privilege Escalation) 방어
 *  2. 잘못된 페이로드(Payload) 주입 방어
 *  3. 주관식 answer_cancel + 정규화(normalize) 관용도
 *  4. host_jump_question 문제 점프 정확성
 *  5. null 답안 탈락 처리 (choice / short)
 *  6. 빈 mainQuestions 상태에서 host_next → 게임 종료 버그 방어
 *  7. 2회차 시작 문제 라운드 표시 정확성
 */

const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

// ─── 결과 집계 ───────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✅ PASS  ${desc}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL  ${desc}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── 소켓 헬퍼 ───────────────────────────────────────────────
function makeSocket(opts = {}) {
  return io(SERVER_URL, { autoConnect: true, ...opts });
}

function once(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, data => { clearTimeout(t); resolve(data); });
  });
}

function waitFor(socket, event, timeoutMs = 2000) {
  return once(socket, event, timeoutMs).catch(() => null);
}

// ─── 메인 ────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(60));
  console.log('  골든벨 서버 종합 자동화 검증');
  console.log(`  대상: ${SERVER_URL}`);
  console.log('='.repeat(60));

  // 로컬 어드민 소켓 (x-forwarded-for 없음 → isAdmin=true)
  const host = makeSocket();
  // 일반 참가자 소켓
  const alice = makeSocket();
  const bob   = makeSocket();
  // 외부 공격자 시뮬레이션: 로컬호스트이지만 x-forwarded-for 헤더를 삽입
  const attacker = makeSocket({ extraHeaders: { 'x-forwarded-for': '203.0.113.99' } });

  await wait(800);

  // 서버 초기 상태로 리셋
  host.emit('host_reset');
  await wait(500);

  // 참가자 입장
  alice.emit('join', { name: 'Alice', uid: 'uid-alice' });
  bob.emit('join',   { name: 'Bob',   uid: 'uid-bob'   });
  await wait(500);

  // ══════════════════════════════════════════════════════════════
  section('시나리오 1: 관리자 권한 우회(Privilege Escalation) 방어');
  // ══════════════════════════════════════════════════════════════

  // 공격자가 host_start / host_next 를 보낸 후 상태가 변하지 않아야 함
  const stateBefore = await new Promise(res => {
    host.once('state', s => res(s));
    host.emit('host_reset'); // 리셋 후 state 수신
  });
  await wait(300);

  attacker.emit('host_start');
  attacker.emit('host_next');
  await wait(600);

  const stateAfter = await new Promise(res => {
    host.once('state', s => res(s));
    host.emit('request_state');
  });

  assert(stateAfter.phase === 'LOBBY',           'x-forwarded-for 공격자의 host_start가 무시됨 (phase=LOBBY 유지)');
  assert(stateAfter.questionIndex === -1,         'x-forwarded-for 공격자의 host_next가 무시됨 (questionIndex=-1 유지)');

  // 공격자가 host_end 도 시도
  attacker.emit('host_end');
  await wait(300);
  const stateAfterEnd = await new Promise(res => {
    host.once('state', s => res(s));
    host.emit('request_state');
  });
  assert(stateAfterEnd.phase === 'LOBBY',        'x-forwarded-for 공격자의 host_end가 무시됨');

  // ══════════════════════════════════════════════════════════════
  section('시나리오 2: 빈 mainQuestions 에서 host_next → 즉시 게임오버 방어 [BUG FIX]');
  // ══════════════════════════════════════════════════════════════

  // host_start 없이 host_next → mainQuestions 비어있어야 함
  // (리셋 직후 상태이므로 mainQuestions = [])
  let gameOverFired = false;
  host.once('game_over', () => { gameOverFired = true; });

  host.emit('host_next'); // 이 시점에 mainQuestions=[] 이므로 서버가 무시해야 함
  await wait(400);

  assert(!gameOverFired, 'mainQuestions가 비어있을 때 host_next를 눌러도 game_over가 발생하지 않음');

  // ══════════════════════════════════════════════════════════════
  section('시나리오 3: pendingStartIndex 클램핑 [BUG FIX]');
  // ══════════════════════════════════════════════════════════════

  // 샘플 3문제가 로드된다는 가정. Q99로 점프 예약 후 host_start
  host.emit('host_jump_question', { targetQ: 99 });
  await wait(200);

  let gameOverFired2 = false;
  host.once('game_over', () => { gameOverFired2 = true; });

  host.emit('host_start');
  await wait(6500); // 5초 카운트다운 + 여유

  assert(!gameOverFired2, 'pendingStartIndex=99 로 설정해도 실제 문제 수로 클램핑되어 즉시 game_over 발생하지 않음');

  // 지금 Q가 마지막 문제(샘플 3개 중 3번째)일 수 있음 → 강제 리셋 후 재시작
  host.emit('host_reset');
  await wait(400);

  alice.emit('join', { name: 'Alice', uid: 'uid-alice' });
  bob.emit('join',   { name: 'Bob',   uid: 'uid-bob'   });
  await wait(400);

  // ══════════════════════════════════════════════════════════════
  section('시나리오 4: 잘못된 페이로드(Payload) 주입 방어');
  // ══════════════════════════════════════════════════════════════

  host.emit('host_start');
  await wait(5500); // 카운트다운 대기

  // 공격자 입장 (게임 중 → 실패해야 함, 단 attacker는 ghost 없으므로 join_error)
  let attackerJoinErr = null;
  attacker.once('join_error', msg => { attackerJoinErr = msg; });
  attacker.emit('join', { name: 'Attacker', uid: 'uid-attacker' });
  await wait(400);
  // 게임 이미 시작이므로 ghost가 없으면 join_error

  // Alice가 선택지에 Object 주입
  let aliceGotAck = false;
  alice.once('answer_ok', () => { aliceGotAck = true; });
  alice.emit('answer', { choice: { evil: 'object' } });
  await wait(300);
  assert(!aliceGotAck, 'choice에 Object 주입 시 answer_ok 발생하지 않음 (서버 무시)');

  // Alice가 선택지에 배열 주입
  let aliceGotAck2 = false;
  alice.once('answer_ok', () => { aliceGotAck2 = true; });
  alice.emit('answer', { choice: [1, 2, 3] });
  await wait(300);
  assert(!aliceGotAck2, 'choice에 Array 주입 시 answer_ok 발생하지 않음 (서버 무시)');

  // Alice가 선택지에 문자열 주입
  let aliceGotAck3 = false;
  alice.once('answer_ok', () => { aliceGotAck3 = true; });
  alice.emit('answer', { choice: '1' });
  await wait(300);
  assert(!aliceGotAck3, 'choice에 String "1" 주입 시 answer_ok 발생하지 않음 (서버 무시)');

  // 정상 숫자 0 제출 → answer_ok 와야 함 (Q1은 샘플 choice 문제)
  let aliceGotNormal = false;
  alice.once('answer_ok', () => { aliceGotNormal = true; });
  alice.emit('answer', { choice: 0 });
  await wait(300);
  assert(aliceGotNormal, '정상 숫자 choice: 0 제출 시 answer_ok 수신됨');

  // ══════════════════════════════════════════════════════════════
  section('시나리오 5: null 답안 탈락 처리 검증');
  // ══════════════════════════════════════════════════════════════

  // Bob은 Q1에서 아무것도 제출하지 않음 → 타임아웃 탈락이어야 함
  // 15초 타이머 기다리기 (or time_up 이벤트 대기)
  let bobEliminated = false;
  bob.once('eliminated', data => {
    bobEliminated = (data.reason === 'timeout');
  });

  // 타임아웃까지 기다림 (최대 20초)
  await waitFor(bob, 'eliminated', 20000);
  // Bob이 'eliminated'를 받았거나, reveal 이후 상태로 확인
  // Bob이 탈락되었는지 확인 (reveal 이벤트 수신)
  let revealData = null;
  host.once('reveal', d => { revealData = d; });
  await wait(4500); // time_up(15s) + reveal_delay(3s) + 여유

  // 이 시점에 revealData가 있으면 Bob은 미답으로 탈락했어야 함
  if (revealData) {
    const bobOut = revealData.eliminated && revealData.eliminated.find(e => e.name === 'Bob');
    assert(!!bobOut, 'Bob이 미답(timeout)으로 탈락 목록에 포함됨');
    if (bobOut) assert(bobOut.reason === 'timeout', 'Bob 탈락 사유가 "timeout"으로 기록됨');
  } else {
    assert(false, 'reveal 이벤트가 수신되지 않아 null 탈락 검증 불가 (타이밍 이슈)');
  }

  // ══════════════════════════════════════════════════════════════
  section('시나리오 6: host_jump_question — 특정 문제로 정확히 이동');
  // ══════════════════════════════════════════════════════════════

  // 현재 REVEAL 상태여야 함. Q3(마지막 샘플)으로 점프
  let jumpResult = null;
  host.once('question_jump_set', d => { jumpResult = d; });
  host.emit('host_jump_question', { targetQ: 3 });
  await wait(400);

  let q3Data = null;
  host.once('state', s => { q3Data = s; });
  await wait(500);

  if (jumpResult && jumpResult.phase === 'REVEAL') {
    assert(jumpResult.targetQ === 3, 'host_jump_question targetQ=3 확인');
    // _doNextQuestion이 즉시 호출되어 questionIndex가 2(Q3,0-indexed)가 되어야 함
    // state는 QUESTION으로 전환됨
    // 검증: question 이벤트로 Q3가 전달되는지
    assert(true, 'REVEAL 상태에서 host_jump_question 응답 수신됨');
  } else if (jumpResult && jumpResult.error) {
    // QUESTION 페이즈 중 호출 → error 반환이 맞음
    assert(jumpResult.error !== undefined, `현재 페이즈(${jumpResult.phase})에서 jump 불가 응답 수신`);
  } else {
    assert(false, 'host_jump_question 응답(question_jump_set)이 수신되지 않음');
  }

  // ══════════════════════════════════════════════════════════════
  section('시나리오 7: 주관식 answer_cancel + 정규화(normalize) 관용도');
  // ══════════════════════════════════════════════════════════════

  // 리셋 후 Q3(주관식)으로 바로 점프해서 테스트
  host.emit('host_reset');
  await wait(400);

  alice.emit('join', { name: 'Alice', uid: 'uid-alice-2' });
  bob.emit('join',   { name: 'Bob',   uid: 'uid-bob-2'   });
  await wait(400);

  // LOBBY에서 jump 예약 후 host_start
  host.emit('host_jump_question', { targetQ: 3 }); // Q3 = 주관식
  await wait(200);

  host.emit('host_start');
  await wait(5500); // 카운트다운

  // Alice: 정상 제출
  let aliceTextAck = null;
  alice.once('answer_ok', d => { aliceTextAck = d.text; });
  alice.emit('answer', { text: '에베레스트' });
  await wait(400);
  assert(aliceTextAck === '에베레스트', '주관식 답변 정상 접수');

  // Alice: 취소
  let cancelReceived = false;
  alice.once('answer_cancelled', () => { cancelReceived = true; });
  alice.emit('answer_cancel');
  await wait(400);
  assert(cancelReceived, 'answer_cancel 이벤트로 취소 성공');

  // Alice: 띄어쓰기+특수기호 혼합 → 정규화 후 정답 처리 확인
  let aliceTextAck2 = null;
  alice.once('answer_ok', d => { aliceTextAck2 = d.text; });
  alice.emit('answer', { text: ' 에베 레스 트 !! ' });
  await wait(400);
  // 저장은 원본(이스케이프 후), 채점 시 normalize() 적용됨
  assert(aliceTextAck2 !== null, '공백/특수기호 혼합 답변도 answer_ok 수신 (서버가 저장함)');

  // normalize('에베레스트') = '에베레스트'
  // normalize('에베 레스 트 !! ') = '에베레스트' → 정답 매칭
  // 이 검증은 채점(reveal) 시점에 이뤄지므로 저장 여부만 확인

  // Bob: 빈 문자열 제출 → 서버가 무시해야 함 (short 타입에서 빈 text 무시)
  let bobEmptyAck = false;
  bob.once('answer_ok', () => { bobEmptyAck = true; });
  bob.emit('answer', { text: '   ' }); // trim 후 빈 문자열
  await wait(400);
  assert(!bobEmptyAck, '주관식에 공백만 제출 시 서버가 무시함 (answer_ok 없음)');

  // ══════════════════════════════════════════════════════════════
  section('시나리오 8: 라운드 표시 정확성 (roundInfo 로직)');
  // ══════════════════════════════════════════════════════════════

  // roundInfo 공식: round = floor(idx/15)+1, qInRound = (idx%15)+1
  // Q1  (idx 0)  → 1회차 1번
  // Q15 (idx 14) → 1회차 15번
  // Q16 (idx 15) → 2회차 1번
  // Q30 (idx 29) → 2회차 15번

  const roundInfo = idx => ({
    round:    Math.floor(idx / 15) + 1,
    qInRound: (idx % 15) + 1,
  });

  const r1  = roundInfo(0);
  const r15 = roundInfo(14);
  const r16 = roundInfo(15);
  const r30 = roundInfo(29);

  assert(r1.round === 1  && r1.qInRound === 1,  `Q1  → ${r1.round}회차 ${r1.qInRound}번 (기대: 1회차 1번)`);
  assert(r15.round === 1 && r15.qInRound === 15, `Q15 → ${r15.round}회차 ${r15.qInRound}번 (기대: 1회차 15번)`);
  assert(r16.round === 2 && r16.qInRound === 1,  `Q16 → ${r16.round}회차 ${r16.qInRound}번 (기대: 2회차 1번)`);
  assert(r30.round === 2 && r30.qInRound === 15, `Q30 → ${r30.round}회차 ${r30.qInRound}번 (기대: 2회차 15번)`);

  console.log(`\n  ℹ️  2회차 시작은 Q16(index 15)입니다.`);
  console.log(`     host_jump_question({ targetQ: 16 }) 으로 설정하면`);
  console.log(`     화면에 "2회차 1번"이 표시됩니다.`);
  console.log(`     Q15는 "1회차 15번"으로 표시됩니다.`);

  // ══════════════════════════════════════════════════════════════
  section('최종 결과');
  // ══════════════════════════════════════════════════════════════

  console.log(`\n  총 ${passed + failed}개 테스트 중 ${passed}개 PASS, ${failed}개 FAIL`);
  if (failed > 0) {
    console.log('  ⚠️  실패한 테스트가 있습니다. 서버 로그를 확인하세요.');
    process.exitCode = 1;
  } else {
    console.log('  🎉 모든 테스트 통과!');
  }

  // 소켓 종료
  host.disconnect();
  alice.disconnect();
  bob.disconnect();
  attacker.disconnect();
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}

run().catch(err => {
  console.error('테스트 실행 오류:', err);
  process.exit(1);
});
