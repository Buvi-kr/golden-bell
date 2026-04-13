const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3000";
const NUM_PLAYERS = 300;
const BATCH_SIZE = 50; // Connect in batches to avoid OS port exhaustion warnings
const WAIT_MS = (ms) => new Promise(r => setTimeout(r, ms));

async function runStressTest() {
  console.log("=================================================================");
  console.log(`  골든벨 서버 극한 동접 및 부하 테스트 (목표: ${NUM_PLAYERS}명)`);
  console.log("=================================================================\n");

  const clients = [];
  let connectedCount = 0;
  let joinedCount = 0;
  
  // 1. 호스트 소켓 셋업 (Admin)
  const host = io(SERVER_URL);
  await WAIT_MS(500);
  
  // 서버 초기화
  host.emit('host_reset');
  await WAIT_MS(1000);

  console.log(`[1단계] ${NUM_PLAYERS}명의 클라이언트 동시 연결 시도...`);
  
  // Connect players in batches
  for (let i = 0; i < NUM_PLAYERS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < NUM_PLAYERS; j++) {
      const idx = i + j + 1;
      const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
      
      socket.on('connect', () => connectedCount++);
      socket.on('disconnect', () => connectedCount--);
      
      // Join immediately after connect
      socket.once('joined', () => joinedCount++);
      socket.once('connect', () => {
        socket.emit('join', { name: `Player_${idx}`, uid: `uid-stress-${idx}` });
      });

      batch.push(socket);
      clients.push({ id: idx, socket });
    }
    await WAIT_MS(200); // 200ms delay between batches
  }

  // 연결 안정화 대기
  let waitLoops = 0;
  while (joinedCount < NUM_PLAYERS && waitLoops < 30) {
    await WAIT_MS(1000);
    waitLoops++;
  }
  
  console.log(`=> 현재 활성 연결: ${connectedCount} 명, 완료된 Join: ${joinedCount} 명`);
  
  if (joinedCount < NUM_PLAYERS) {
    console.log(`⚠️ 일부 소켓이 참가하지 못했습니다. (연결: ${connectedCount}, 참가: ${joinedCount}/${NUM_PLAYERS})`);
  } else {
    console.log(`✅ ${NUM_PLAYERS}명 전원 소켓 연결 및 Join 완료!`);
  }

  console.log("\n[2단계] 게임 시작 및 질문 전송 (300명 브로드캐스팅 부하)");
  const memBefore = process.memoryUsage().rss / 1024 / 1024;
  
  host.emit('host_start');
  await WAIT_MS(1000);
  
  host.emit('host_next'); // 1번 문제로
  await WAIT_MS(1000);

  console.log(`\n[3단계] 300명이 동시에(1초 내) 답변 전송 시도...`);
  let answersAcknowledged = 0;
  
  clients.forEach(c => {
    c.socket.once('answer_ok', () => { answersAcknowledged++; });
  });

  const startTime = Date.now();
  // Spam answers with slight network jitter
  clients.forEach(c => {
    setTimeout(() => {
      c.socket.emit('answer', { choice: Math.floor(Math.random() * 4) });
    }, Math.random() * 500); // 0~500ms 안에 전부 쏜다
  });

  // 답변 처리가 다 될 때까지 주기적으로 확인
  let checkingCount = 0;
  while (answersAcknowledged < NUM_PLAYERS && checkingCount < 20) {
    await WAIT_MS(500);
    checkingCount++;
  }

  const endTime = Date.now();
  console.log(`=> 서버가 ${answersAcknowledged}명의 답변을 처리 완료. (소요: ${endTime - startTime}ms)`);
  
  if (answersAcknowledged === NUM_PLAYERS) {
     console.log("✅ 300명의 동시다발적 답변(Race Condition)이 이벤트 누락이나 서버 타임아웃 없이 전수 처리되었습니다.");
  } else {
     console.log(`❌ 답변 유실 발생! (${NUM_PLAYERS - answersAcknowledged}개 누락)`);
  }

  host.emit('host_reveal');
  await WAIT_MS(1000);

  const memAfter = process.memoryUsage().rss / 1024 / 1024;
  console.log(`\n[4단계] 시스템 리소스 변화 모니터링 (클라이언트 스크립트 측 메모리)`);
  console.log(`클라이언트 스크립트 메모리 소모량: ${memBefore.toFixed(2)} MB -> ${memAfter.toFixed(2)} MB`);
  
  console.log(`\n[최종 점검] 서버 렉, Ping Timeout으로 떨어져 나간 클라이언트가 있는지 검사...`);
  if (connectedCount === NUM_PLAYERS) {
    console.log("✅ 300명 전원이 무사히 연결을 유지하고 있습니다.");
  } else {
    console.log(`❌ 유지 실패. 일부 연결이 단절되었습니다. (현재 연결: ${connectedCount})`);
  }

  console.log("\n테스트 종료. 소켓 연결 해제 중...");
  clients.forEach(c => c.socket.disconnect());
  host.disconnect();
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

runStressTest();
