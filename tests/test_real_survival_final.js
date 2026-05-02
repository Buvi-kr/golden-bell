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
  console.log("  📊 [차트/통계 검증] 스피드 골든벨 100인 배틀로얄 최종 시뮬레이션");
  console.log("  - 차트 다형성 확보: 오답 분산 입력 및 5라운드 30명 대량 탈락 트리거");
  console.log("  - 통계 정합성: 총원 고정, 생존/탈락 수치 누적 100% 매칭 검증");
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

  bots.push({ s: io(SERVER_URL, { forceNew: true }), name: '👑최종우승자', uid: 'u-hero', deathRound: -1 });
  bots.push({ s: io(SERVER_URL, { forceNew: true }), name: '😈마지막도전자', uid: 'u-rival', deathRound: -1 });

  // 탈락자 98명 분배 (5번 문제에서 30명 대량 탈락 설계)
  const deathDistribution = [];
  for (let r = 0; r < 15; r++) {
    let dieCount = 0;
    if (r === 4) dieCount = 30; // Q5: 대량 탈락 라운드!
    else if (r === 14) dieCount = 18; // Q15: 마지막 라운드
    else dieCount = Math.floor((98 - 48) / 13) + (r < 11 ? 1 : 0); // 나머지 분배 (약 3~4명)

    for (let i = 0; i < dieCount; i++) deathDistribution.push(r);
  }

  const deathTypes = ['timeout', 'wrong', 'wrong', 'wrong', 'disconnect', 'malicious', 'spam'];

  for (let i = 2; i < 100; i++) {
    const botRound = deathDistribution[i - 2];
    const botType = deathTypes[i % deathTypes.length];

    bots.push({
      s: io(SERVER_URL, { transports: ['websocket'], forceNew: true }),
      name: `T_${i + 1}(${botType})`,
      uid: `u-bot-${i + 1}`,
      deathRound: botRound,
      deathType: botType,
      isDead: false
    });
  }

  bots.forEach(b => b.s.emit('join', { name: b.name, uid: b.uid }));
  await WAIT(2000);
  console.log("  ✅ 100개 세션 동시 접속 완료.\n");

  host.emit('host_start');
  await WAIT(5500);

  let currentSurvivors = 100;
  const TOTAL_PLAYERS = 100;

  for (let qIdx = 0; qIdx < 15; qIdx++) {
    const qNum = qIdx + 1;
    const ansData = answers[qIdx] || { type: 'choice', numChoices: 4, payload: { choice: 0 } };

    const maliciousPayloads = [
      { choice: null }, { text: undefined }, { text: '\n\n\t ' },
      { choice: { evil: 1 } }, { choice: [1, 2] }, { text: '<script>alert(1)</script>' }
    ];

    console.log(`▶ [Q${qNum}] 문제 출제 중... ${qNum === 5 ? '🔥(경고: 대량 탈락 예정 구간)' : ''}`);
    let dieInThisRound = 0;

    bots.forEach(b => {
      if (b.isDead) return;

      if (b.deathRound === qIdx) {
        b.isDead = true;
        dieInThisRound++;

        switch (b.deathType) {
          case 'timeout':
            break; // 무응답
          case 'wrong':
            // 오답을 골고루 퍼트림
            if (ansData.type === 'short') {
              b.s.emit('answer', { text: `오답_${Math.random().toString(36).substring(7)}` });
            } else {
              const wrongIdx = getRandomWrongChoice(ansData.payload.choice, ansData.numChoices);
              b.s.emit('answer', { choice: wrongIdx });
            }
            break;
          case 'disconnect':
            b.s.disconnect();
            break;
          case 'malicious':
            b.s.emit('answer', maliciousPayloads[Math.floor(Math.random() * maliciousPayloads.length)]);
            break;
          case 'spam':
            for (let i = 0; i < 50; i++) b.s.emit('answer', ansData.payload); // 정답 연타하다가
            if (ansData.type !== 'short') {
              b.s.emit('answer', { choice: getRandomWrongChoice(ansData.payload.choice, ansData.numChoices) }); // 막판에 오답 전송
            } else {
              b.s.emit('answer', { text: '스팸오답' });
            }
            break;
        }
      } else {
        b.s.emit('answer', ansData.payload);
      }
    });

    const revealData = await new Promise(r => host.once('reveal', r));
    currentSurvivors -= dieInThisRound;

    // 차트 및 인원 집계 영수증 출력
    console.log(`  🧾 [Q${qNum} 결과 요약]`);
    console.log(`     - 총 인원: ${TOTAL_PLAYERS}명 (디스커넥트 발생해도 고정됨)`);
    console.log(`     - 생존자 : ${revealData.survivorCount}명`);
    console.log(`     - 탈락자 : ${TOTAL_PLAYERS - revealData.survivorCount}명 (이번 라운드 신규 탈락: ${dieInThisRound}명)`);

    if (ansData.type !== 'short' && revealData.stats) {
      console.log(`     - 📈 [차트 데이터 분포]`);
      console.log(`         > 생존자 픽 : [ ${revealData.stats.join(', ')} ]`);
      console.log(`         > 탈락자 픽 : [ ${revealData.eliminatedStats.join(', ')} ]`);
    } else if (ansData.type === 'short') {
      console.log(`     - 📝 [주관식] 미답변(Timeout) 탈락자: ${revealData.eliminatedNoAnswer}명`);
    }

    assert(revealData.survivorCount === currentSurvivors, `Q${qNum} 생존/탈락/고스트 합산 로직 오차율 0% 검증 완료.\n`);

    await WAIT(1000);
    if (qNum < 15) {
      host.emit('host_next');
      await WAIT(500);
    }
  }

  // ---------------------------------------------------------
  // [3] 골든벨 진입 (1:1 듀얼)
  // ---------------------------------------------------------
  console.log("=================================================================");
  console.log(`  🏆 정규 15라운드 완주! 최종 진출자: ${currentSurvivors}명`);
  console.log("  🔔 골든벨 구간(Q76~)으로 즉시 전환합니다.");
  console.log("=================================================================\n");

  host.emit('host_goldenbell');
  await WAIT(1000);

  let gb1_ans = answers[75] || { type: 'choice', numChoices: 4, payload: { choice: 0 } };
  bots[0].s.emit('answer', gb1_ans.payload);
  bots[1].s.emit('answer', gb1_ans.payload);

  await new Promise(r => host.once('reveal', r));
  await WAIT(1000);

  host.emit('host_next');
  await WAIT(500);

  let gb2_ans = answers[76] || { type: 'short', payload: { text: '정답' } };
  let wrong_gb2 = gb2_ans.type === 'short' ? { text: '오답' } : { choice: getRandomWrongChoice(0, 4) };

  bots[0].s.emit('answer', gb2_ans.payload);
  bots[1].s.emit('answer', wrong_gb2);

  await new Promise(r => host.once('reveal', r));
  let gameOverData = await new Promise(r => host.once('game_over', r));

  console.log(`\n  🎉 [최종 우승자 결정] : ${gameOverData.winners.join(', ')}`);

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