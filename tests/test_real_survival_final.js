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
    console.log(`  ✅ [PASS] ${message}`);
    passedAsserts++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

// 엑셀에서 정답 추출기
function getCorrectAnswers() {
  const xlsxPath = path.join(__dirname, '../questions.xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  return rows.map((row) => {
    let type = (row['유형'] || row['type'] || '').toLowerCase().trim();
    let numChoices = 4; // 기본 4지선다

    if (!['choice', 'ox', 'short'].includes(type)) {
      if (row['보기1'] === 'O' && row['보기2'] === 'X') type = 'ox';
      else if (!row['보기1']) type = 'short';
      else type = 'choice';
    }

    if (type === 'short') {
      return { type, numChoices: 0, payload: { text: String(row['정답'] || '').split(',')[0].trim() } };
    } else {
      let idx;
      if (type === 'ox' && /^[oxOX]$/i.test(String(row['정답']))) {
        idx = String(row['정답']).toUpperCase() === 'O' ? 0 : 1;
        numChoices = 2;
      } else {
        idx = parseInt(row['정답'] || 1) - 1;
        // 보기가 몇 개 있는지 대략 계산 (빈칸 제외)
        numChoices = [row['보기1'], row['보기2'], row['보기3'], row['보기4']].filter(Boolean).length || 4;
      }
      return { type, numChoices, payload: { choice: Math.max(0, idx) } };
    }
  });
}

// 오답을 골고루 퍼트리는 함수
function getRandomWrongChoice(correctIdx, numChoices) {
  if (numChoices <= 1) return 99; // 예외 처리
  let wrongIdx;
  do {
    wrongIdx = Math.floor(Math.random() * numChoices);
  } while (wrongIdx === correctIdx);
  return wrongIdx;
}

async function runRealSurvivalScenario() {
  console.log("=================================================================");
  console.log("  📊 [차트/통계 검증] 스피드 골든벨 100인 배틀로얄: 1회차 완벽 시뮬레이션");
  console.log("  - 1회차(1~20번) 단일 회차에서 최종 1인의 골든벨 달성자 배출 검증");
  console.log("  - 1~14번 문제 진행 중 악성유저(연타, 악성코드, 미접속 등) 포함 95명 탈락");
  console.log("  - 15번 문제에서 정확히 5명 생존, 이후 20번까지 순차적 탈락 검증");
  console.log("=================================================================\n");

  const answers = getCorrectAnswers();
  const host = io(SERVER_URL, { forceNew: true });
  await WAIT(500);

  host.emit('host_reset');
  await WAIT(1000);

  // ---------------------------------------------------------
  // [1] 100명 봇 군단 생성 및 데스 시나리오 분배
  // ---------------------------------------------------------
  const bots = [];

  // Q20(마지막)까지 생존하여 정답을 맞추는 최후의 1인
  bots.push({ s: io(SERVER_URL, { forceNew: true }), name: '👑골든벨우승자', uid: 'u-hero', deathRound: -1 });

  // 탈락자 99명 분배 설계
  // Q1~Q14: 95명 탈락 (Q15 시작시 딱 5명 생존 - 우승자 포함)
  // Q16~Q19: 각 1명씩 탈락하여 마지막 Q20에서는 최후의 1인(우승자)만 정답.
  
  // Q1~Q14 동안 95명 분배
  const deathDistribution = [];
  const earlyDropCount = 95;
  for (let i = 0; i < earlyDropCount; i++) {
    // 0~13 (Q1~Q14) 사이에 골고루 배치. 단, 초반에 많이 떨어지게 가중치.
    let dropRound = Math.floor(i / (earlyDropCount / 14)); 
    if (dropRound > 13) dropRound = 13;
    deathDistribution.push(dropRound);
  }

  // Q16~Q19(인덱스 15~18) 각 1명씩 분배 (총 4명)
  deathDistribution.push(15); // Q16에서 1명 탈락
  deathDistribution.push(16); // Q17에서 1명 탈락
  deathDistribution.push(17); // Q18에서 1명 탈락
  deathDistribution.push(18); // Q19에서 1명 탈락

  // 총 length 99 확인
  if (deathDistribution.length !== 99) {
    console.warn("분배 배열 길이 오류:", deathDistribution.length);
  }

  // 악성 행동 패턴 강제 할당
  const deathTypes = ['disconnect', 'malicious', 'spam', 'timeout', 'wrong', 'wrong'];

  for (let i = 0; i < 99; i++) {
    const botRound = deathDistribution[i];
    const botType = deathTypes[i % deathTypes.length];

    bots.push({
      s: io(SERVER_URL, { transports: ['websocket'], forceNew: true }),
      name: `T_${i + 2}(${botType})`,
      uid: `u-bot-${i + 2}`,
      deathRound: botRound,
      deathType: botType,
      isDead: false
    });
  }

  bots.forEach(b => b.s.emit('join', { name: b.name, uid: b.uid }));
  await WAIT(2000);
  console.log("  ✅ 100개 세션 동시 접속 완료 (악성 유저, 잠수 유저 포함).\n");

  host.emit('host_start');
  await WAIT(5500);

  let currentSurvivors = 100;
  const TOTAL_PLAYERS = 100;

  for (let qIdx = 0; qIdx < 20; qIdx++) {
    const qNum = qIdx + 1;
    const ansData = answers[qIdx] || { type: 'choice', numChoices: 4, payload: { choice: 0 } };

    const maliciousPayloads = [
      { choice: null }, { text: undefined }, { text: '\n\n\t ' },
      { choice: { evil: 1 } }, { choice: [1, 2] }, { text: '<script>alert(1)</script>' }
    ];

    console.log(`▶ [Q${qNum}] 문제 출제 중...`);
    let dieInThisRound = 0;

    bots.forEach(b => {
      if (b.isDead) return;

      if (b.deathRound === qIdx) {
        b.isDead = true;
        dieInThisRound++;

        switch (b.deathType) {
          case 'timeout':
            // 아무것도 안함 (잠수)
            break; 
          case 'wrong':
            // 일반 오답 (차트 다형성 확보)
            if (ansData.type === 'short') {
              b.s.emit('answer', { text: `잘모르겠음_${Math.random().toString(36).substring(7)}` });
            } else {
              const wrongIdx = getRandomWrongChoice(ansData.payload.choice, ansData.numChoices);
              b.s.emit('answer', { choice: wrongIdx });
            }
            break;
          case 'disconnect':
            // 연결 끊기 (소켓 이탈 방어 확인)
            b.s.disconnect();
            break;
          case 'malicious':
            // XSS 및 이상한 패킷 주입 시도
            b.s.emit('answer', maliciousPayloads[Math.floor(Math.random() * maliciousPayloads.length)]);
            break;
          case 'spam':
            // 정답 연타 공격하다가 막판에 오답 전송
            for (let i = 0; i < 30; i++) b.s.emit('answer', ansData.payload); 
            if (ansData.type !== 'short') {
              b.s.emit('answer', { choice: getRandomWrongChoice(ansData.payload.choice, ansData.numChoices) }); 
            } else {
              b.s.emit('answer', { text: '스팸오답도배중' });
            }
            break;
        }
      } else {
        // 생존자는 정답을 제출함
        b.s.emit('answer', ansData.payload);
      }
    });

    const revealData = await new Promise(r => host.once('reveal', r));
    currentSurvivors -= dieInThisRound;

    // 차트 및 인원 집계 영수증 출력
    console.log(`  🧾 [Q${qNum} 결과 요약]`);
    console.log(`     - 회차 정보: ${revealData.round}회차, ${revealData.qInRound}번째 문제`);
    console.log(`     - 총 인원: ${TOTAL_PLAYERS}명 (고정)`);
    console.log(`     - 생존자 : ${revealData.survivorCount}명`);
    console.log(`     - 탈락자 : ${TOTAL_PLAYERS - revealData.survivorCount}명 (이번 문제 신규 탈락: ${dieInThisRound}명)`);

    if (ansData.type !== 'short' && revealData.stats) {
      console.log(`     - 📈 [차트 데이터 분포]`);
      console.log(`         > 생존자 픽 : [ ${revealData.stats.join(', ')} ]`);
      console.log(`         > 탈락자 픽 : [ ${revealData.eliminatedStats.join(', ')} ]`);
    } else if (ansData.type === 'short') {
      console.log(`     - 📝 [주관식] 미답변(Timeout) 탈락자 포함: ${revealData.eliminatedNoAnswer}명`);
    }

    assert(revealData.survivorCount === currentSurvivors, `Q${qNum} 악성 패킷 및 연타 방어 후 생존/탈락 수치 100% 매칭.`);
    
    // 15번 문제일 때 생존자가 딱 5명인지 검증
    if (qNum === 15) {
      assert(currentSurvivors === 5, `Q15 통과 시 생존자 딱 5명 달성! (현재 ${currentSurvivors}명)`);
    }
    // 20번 문제일 때 최후의 1인인지 검증
    if (qNum === 20) {
      assert(currentSurvivors === 1, `Q20 최종 골든벨 우승자 1명 배출 성공! (현재 ${currentSurvivors}명)`);
    }

    await WAIT(1000);
    if (qNum < 20) {
      host.emit('host_next');
      await WAIT(500);
    }
  }

  console.log("=================================================================");
  console.log(`  🏆 1회차 완주 및 골든벨 우승자 탄생 완료!`);
  console.log("  🔔 우승화면(게임 종료) 전환을 위해 host_end 를 호출합니다.");
  console.log("=================================================================\n");

  host.emit('host_end');
  const gameOverData = await new Promise(r => host.once('game_over', r));
  console.log(`\n  🎉 [최종 우승자 결정] : ${gameOverData.winners.join(', ')}`);

  await WAIT(2000); // 우승 화면 연출을 볼 수 있도록 2초 대기

  bots.forEach(b => b.s.disconnect());
  host.disconnect();

  console.log("\n=================================================================");
  console.log(`  🎯 [보고서 데이터 추출용] 최종 검증 완료 (통과: ${passedAsserts} / 총: ${totalAsserts})`);
  console.log("=================================================================\n");
  process.exit(passedAsserts === totalAsserts ? 0 : 1);
}

runRealSurvivalScenario().catch(err => {
  console.error("테스트 실행 중 치명적 오류:", err);
  process.exit(1);
});