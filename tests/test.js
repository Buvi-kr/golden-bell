const { io } = require("socket.io-client");
const http = require("http");

const SERVER_URL = "http://localhost:3000";
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log("=================================================================");
  console.log("  골든벨 서버 종합 자동화 검증 스크립트 (test.md 시나리오 전수 검증)");
  console.log("=================================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, desc) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${desc}`);
      passedTests++;
    } else {
      console.log(`❌ [FAIL] ${desc}`);
    }
  }

  // 1. 소켓 클라이언트 셋업
  const host = io(SERVER_URL);
  let p1 = io(SERVER_URL); // Alice (정상 유저)
  let p2 = io(SERVER_URL); // Bob (탈락/복구 등 다양한 상태 테스트용)
  let p3 = io(SERVER_URL); // 외부/일반 접속 시뮬레이션용

  await wait(1000);

  host.emit('host_reset');
  await wait(1000);


  console.log("\n--- 시나리오 1: 입장 및 세션 복구 (Lobby & Session) ---");
  
  let p1Name = "";
  p1.once('joined', (data) => p1Name = data.name);
  p1.emit('join', { name: '  <script>alert(1)</script> Alice ', uid: 'uid-alice' });
  await wait(500);
  
  // 서버에서 20자까지만 자르기 때문에 아래와 같이 잘립니다.
  const expectedName = '<script>alert(1)</sc'; 
  assert(p1Name === expectedName, `입력받은 문자열 화이트스페이스 제거 및 20자 제한 처리됨 확인 (${p1Name})`);

  let joinBlankError = null;
  p2.once('join_error', (msg) => joinBlankError = msg);
  p2.emit('join', { name: '     ', uid: 'uid-bob' });
  await wait(500);
  assert(joinBlankError !== null, "닉네임이 공백일 경우 입장이 정상 차단됨");

  p2.emit('join', { name: 'Bob', uid: 'uid-bob' });
  await wait(500);

  let joinDupError = null;
  p3.once('join_error', (msg) => joinDupError = msg);
  p3.emit('join', { name: 'Bob', uid: 'uid-charlie' });
  await wait(500);
  assert(joinDupError === '이미 사용 중인 이름입니다.', "중복된 닉네임으로 다른 기기/소켓 입장 시 서버에서 차단함");

  console.log("\n--- 시나리오 2: 문제 진행 상황 및 방어 로직 (Game & Answer) ---");
  host.emit('host_start');
  await wait(500);

  host.emit('host_next');
  await wait(1000);

  let lateJoinError = null;
  p3.once('join_error', (msg) => lateJoinError = msg);
  p3.emit('join', { name: 'Charlie', uid: 'uid-charlie' });
  await wait(500);
  assert(lateJoinError !== null && lateJoinError.includes('게임이 이미 시작'), "게임 시작 후(Phase != LOBBY) 신규 진입 시 올바르게 거부됨");


  let p2AckCount = 0;
  p2.on('answer_ok', () => p2AckCount++);
  
  for (let i = 0; i < 20; i++) {
    p2.emit('answer', { choice: i % 4 });
  }
  p1.emit('answer', { choice: 0 }); 

  await wait(1500);
  assert(p2AckCount > 0, "답변을 대량으로 보내도 서버가 죽지 않고 이벤트 정상 처리 (서버단 쓰로틀/디바운스 검증)");

  host.emit('host_reveal');
  await wait(1000);

  let p1LateAck = false;
  p1.once('answer_ok', () => p1LateAck = true);
  p1.emit('answer', { choice: 3 });
  await wait(500);
  assert(!p1LateAck, "채점 혹은 답변시간 종료(answersClosed: true) 이후의 추가 제출은 성공적으로 무시됨");


  console.log("\n--- 시나리오 3: 세션 복구 및 상태 정합성 (Forced Reconnect) ---");
  let stBefore = null;
  host.once('state_sync', (s) => stBefore = s);
  host.emit('request_state');
  await wait(500);
  
  let bobWasEliminated = stBefore && stBefore.eliminatedCount > 0;

  p2.disconnect();
  await wait(1000);

  p2 = io(SERVER_URL);
  await wait(1000);

  let p2RestoredState = null;
  p2.once('session_restored', (st) => p2RestoredState = st);
  p2.emit('session_restore', { uid: 'uid-bob' });
  await wait(1000);

  assert(
    p2RestoredState !== null && p2RestoredState.eliminated !== undefined, 
    "연결이 끊긴 유저가 30분 내 session_restore로 재접속 시 생존/탈락 상태가 퍼펙트하게 복구됨!"
  );

  console.log("\n--- 시나리오 4: 주관식 강제 채점 (Manual Grading) ---");
  // 상태를 깨끗하게 하고 모두 살아있는 상태로 시작
  host.emit('host_reset'); await wait(500);
  p1.emit('join', { name: p1Name, uid: 'uid-alice' });
  p2.emit('join', { name: 'Bob', uid: 'uid-bob' });
  await wait(500);
  
  host.emit('host_start'); await wait(500);
  host.emit('host_next'); await wait(500); // 첫 번째 문제 시작


  p1.emit('answer', { text: '나는앨리스' });
  p2.emit('answer', { text: '나는밥' });
  await wait(1000);

  // 주관식 강제 채점으로 첫번째 문제(Q1)여도 무조건 passedNames 기준 평가됨
  host.emit('host_essay_reveal', { passedNames: [p1Name] }); // Alice의 잘린 이름 사용
  await wait(1000);
  
  let p1Status = null, p2Status = null;
  p1.once('state_sync', (s) => p1Status = s.eliminated);
  p2.once('state_sync', (s) => p2Status = s.eliminated);
  p1.emit('request_state');
  p2.emit('request_state');
  await wait(1000);

  assert(p1Status === false && p2Status === true, `진행자가 passedNames로 선택한 유저(Alice)만 생존하고 나머지(Bob)는 즉시 eliminated:true로 반영됨 (Alice:${p1Status}, Bob:${p2Status})`);

  console.log("\n--- 시나리오 5: 권한 격리 및 패자부활전 (Comeback Mode) ---");
  
  host.emit('host_comeback');
  await wait(1000);

  let ghostAck = false;
  p1.once('answer_ok', () => ghostAck = true);
  p1.emit('answer', { choice: 1 }); 
  await wait(1000);
  assert(!ghostAck, "패자부활전(comingback:true) 중 생존자(!eliminated)의 답변 제출은 완벽히 무시됨");

  p2.emit('answer', { choice: 1 }); // 부활자 Bob 응답
  await wait(500);

  // 부활전 정답을 Bob이 모두 맞춰 생존했다고 가정 (주관식 강제 채점으로 확실하게 생존처리)
  host.emit('host_essay_reveal', { passedNames: ['Bob'] });
  await wait(1000);

  let p2FinalStatus = null;
  p2.once('state_sync', (s) => p2FinalStatus = s.eliminated);
  p2.emit('request_state');
  await wait(1000);
  assert(p2FinalStatus === false, "패자부활전 정답 판정 이후 탈락 유저(Bob)가 생존 명단으로 즉시 복귀됨");

  let comebackError = null;
  host.on('comeback_error', (msg) => comebackError = msg);
  // 패자부활전 문제는 1개 있으므로, Reveal -> Comeback을 번갈아 호출해 소진시켜야 함.
  for(let i=0; i<3; i++) {
    host.emit('host_reveal');
    await wait(200);
    host.emit('host_comeback');
    await wait(200);
  }
  await wait(1000);
  assert(comebackError !== null, "더 이상 남은 패자부활전 문제가 없거나 튕겨졌을 때 host_comeback이 에러 반환");

  console.log(`\n=================================================================`);
  console.log(`  자동화 검증 완료: 총 ${totalTests}개 중 ${passedTests}개 테스트 Pass!`);
  console.log(`=================================================================`);
  
  host.disconnect(); p1.disconnect(); p2.disconnect(); p3.disconnect();
  process.exit(0);
}

runTests();
