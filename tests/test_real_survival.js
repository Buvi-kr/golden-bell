'use strict';
const { io } = require('socket.io-client');
const XLSX = require('xlsx');
const path = require('path');

const SERVER_URL = 'http://localhost:3000';
const WAIT = ms => new Promise(r => setTimeout(r, ms));

let passedAsserts = 0;
let totalAsserts = 0;

function assert(condition, message) {
  totalAsserts++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedAsserts++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// 엑셀에서 정답 추출기
function getCorrectAnswers() {
  const xlsxPath = path.join(__dirname, '../questions.xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  return rows.map((row) => {
    let type = (row['유형'] || row['type'] || '').toLowerCase().trim();
    if (!['choice', 'ox', 'short'].includes(type)) {
      if (row['보기1'] === 'O' && row['보기2'] === 'X') type = 'ox';
      else if (!row['보기1']) type = 'short';
      else type = 'choice';
    }

    if (type === 'short') {
      return { type, payload: { text: String(row['정답'] || '').split(',')[0].trim() } };
    } else {
      let idx = type === 'ox' && /^[oxOX]$/i.test(String(row['정답'])) 
        ? (String(row['정답']).toUpperCase() === 'O' ? 0 : 1)
        : parseInt(row['정답'] || 1) - 1;
      return { type, payload: { choice: Math.max(0, idx) } };
    }
  });
}

async function runRealSurvivalScenario() {
  console.log("=================================================================");
  console.log("  ⚔️ 스피드 골든벨 100인 배틀로얄 실전 테스트 (Real-time)");
  console.log("  [15초 타이머 원본 / 각종 악성 봇 포함 / 1:1 골든벨 데스매치]");
  console.log("=================================================================\n");
  console.log("  ⏳ 실시간(1문제당 약 18초)으로 진행되므로 약 5~6분 소요됩니다...\n");

  const answers = getCorrectAnswers();
  const host = io(SERVER_URL, { forceNew: true });
  await WAIT(500);

  host.emit('host_reset');
  await WAIT(1000);

  // ---------------------------------------------------------
  // [1] 100명 봇 군단 생성 및 데스 시나리오 분배
  // ---------------------------------------------------------
  const bots = [];
  
  // 끝까지 살아남을 2명
  bots.push({ s: io(SERVER_URL, { forceNew: true }), name: '👑주인공', uid: 'u-hero', deathRound: -1 });
  bots.push({ s: io(SERVER_URL, { forceNew: true }), name: '😈라이벌', uid: 'u-rival', deathRound: -1 });

  // 98명을 1~15라운드 동안 분산해서 죽임 (한 라운드에 약 6~7명씩)
  const deathDistribution = [];
  for(let r = 0; r < 15; r++) {
    const dieCount = (r === 14) ? 8 : 6; // 1~14라: 6명씩(84명), 15라: 14명(14명) -> 총 98명
    for(let i = 0; i < (r >= 13 ? 10 : 6); i++) deathDistribution.push(r);
  }
  
  const deathTypes = ['timeout', 'wrong', 'disconnect', 'malicious', 'spam'];
  
  for (let i = 2; i < 100; i++) {
    const botRound = deathDistribution[i - 2];
    const botType = deathTypes[i % deathTypes.length];
    
    bots.push({
      s: io(SERVER_URL, { transports: ['websocket'], forceNew: true }),
      name: `희생양_${i+1}(${botType})`,
      uid: `u-bot-${i+1}`,
      deathRound: botRound,
      deathType: botType,
      isDead: false
    });
  }

  // 봇 전원 접속
  bots.forEach(b => b.s.emit('join', { name: b.name, uid: b.uid }));
  await WAIT(2000);
  console.log("  ✅ 100명 접속 완료. 데스매치를 시작합니다.");

  host.emit('host_start');
  await WAIT(5500); // 5초 카운트다운

  // ---------------------------------------------------------
  // [2] 1~15번 문제 진행 (실시간 대기)
  // ---------------------------------------------------------
  let currentSurvivors = 100;

  for (let qIdx = 0; qIdx < 15; qIdx++) {
    const qNum = qIdx + 1;
    const ansData = answers[qIdx] || { type: 'choice', payload: { choice: 0 } };
    
    // 오답용 페이로드 생성
    const wrongPayload = ansData.type === 'short' 
      ? { text: '오답입니다' } 
      : { choice: ansData.payload.choice === 0 ? 1 : 0 };
    
    // 악성 페이로드
    const maliciousPayloads = [
      { choice: { evil: 1 } }, 
      { text: '<script>alert(1)</script>' }, 
      { choice: [1, 2] },
      { text: '     ' } // 빈칸
    ];

    console.log(`\n▶ [Q${qNum}] 출제 완료! 봇들이 각자의 운명대로 행동합니다...`);
    let dieInThisRound = 0;

    bots.forEach(b => {
      if (b.isDead) return;

      if (b.deathRound === qIdx) {
        b.isDead = true;
        dieInThisRound++;
        
        switch (b.deathType) {
          case 'timeout':
            // 아무것도 안함
            break;
          case 'wrong':
            b.s.emit('answer', wrongPayload);
            break;
          case 'disconnect':
            b.s.disconnect(); // 답 안 적고 런
            break;
          case 'malicious':
            const mal = maliciousPayloads[Math.floor(Math.random() * maliciousPayloads.length)];
            b.s.emit('answer', mal);
            break;
          case 'spam':
            for(let i=0; i<10; i++) b.s.emit('answer', ansData.payload);
            b.s.emit('answer', wrongPayload); // 마지막에 오답 전송
            break;
        }
      } else {
        // 생존자들은 무조건 정답
        b.s.emit('answer', ansData.payload);
      }
    });

    console.log(`  ... 실시간 대기 중 (15초 문제 + 3초 공개 대기) ...`);
    
    // 정답 공개 이벤트 대기 (서버 타임아웃 15초를 실제로 기다림)
    const revealData = await new Promise(r => host.once('reveal', r));
    
    currentSurvivors -= dieInThisRound;
    console.log(`  ✅ [Q${qNum} 결과] 예정된 탈락자: ${dieInThisRound}명 | 실제 생존자: ${revealData.survivorCount}명`);
    assert(revealData.survivorCount === currentSurvivors, `Q${qNum} 생존자 수가 계획대로 줄어들었습니다.`);

    await WAIT(1000);
    if (qNum < 15) {
      host.emit('host_next');
      await WAIT(500);
    }
  }

  // ---------------------------------------------------------
  // [3] 골든벨 진입 (1:1 듀얼)
  // ---------------------------------------------------------
  console.log("\n=================================================================");
  console.log(`  🏆 정규 라운드 종료! 생존자: ${currentSurvivors}명 (주인공 vs 라이벌)`);
  console.log("  🔔 골든벨 라운드(Q76~)로 진입합니다!");
  console.log("=================================================================\n");

  assert(currentSurvivors === 2, "정확히 2명만 골든벨에 진출함");

  host.emit('host_goldenbell');
  await WAIT(1000); 

  // --- Q76 (골든벨 1번) ---
  console.log(`▶ [골든벨 1번(Q76)] 주인공과 라이벌 모두 정답 제출!`);
  let gb1_ans = answers[75] || { type: 'choice', payload: { choice: 0 } };
  
  bots[0].s.emit('answer', gb1_ans.payload); // 주인공 정답
  bots[1].s.emit('answer', gb1_ans.payload); // 라이벌 정답
  
  let gb1_reveal = await new Promise(r => host.once('reveal', r));
  assert(gb1_reveal.survivorCount === 2, "골든벨 1번 두 명 모두 생존");
  await WAIT(1000);

  host.emit('host_next');
  await WAIT(500);

  // --- Q77 (골든벨 2번) ---
  console.log(`\n▶ [골든벨 2번(Q77)] 라이벌의 치명적 실수!`);
  let gb2_ans = answers[76] || { type: 'short', payload: { text: '정답' } };
  let wrong_gb2 = gb2_ans.type === 'short' ? { text: '아차차' } : { choice: 99 };
  
  bots[0].s.emit('answer', gb2_ans.payload); // 주인공 정답
  bots[1].s.emit('answer', wrong_gb2);       // 라이벌 오답

  let gb2_reveal = await new Promise(r => host.once('reveal', r));
  assert(gb2_reveal.survivorCount === 1, "라이벌 탈락, 주인공 단독 생존!");

  // 1명 생존 시 자동 게임오버 
  let gameOverData = await new Promise(r => host.once('game_over', r));
  assert(gameOverData.winners.includes('👑주인공'), "주인공이 골든벨 최종 우승자로 등극!");

  bots.forEach(b => b.s.disconnect());
  host.disconnect();

  console.log("\n=================================================================");
  console.log(`  🎯 극한 실전 테스트 종료: 총 ${totalAsserts}개 중 ${passedAsserts}개 통과`);
  console.log("=================================================================\n");
  process.exit(passedAsserts === totalAsserts ? 0 : 1);
}

runRealSurvivalScenario().catch(err => {
  console.error("테스트 실행 중 치명적 오류:", err);
  process.exit(1);
});