'use strict';
const { io } = require('socket.io-client');
const XLSX = require('xlsx');
const path = require('path');

const SERVER_URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

function getCorrectAnswers() {
  const xlsxPath = path.join(__dirname, '../questions.xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  return rows.map((row) => {
    const rawType = (row['유형'] || row['type'] || '').toLowerCase().trim();
    let type = rawType;
    if (!['choice', 'ox', 'short'].includes(type)) {
      if (row['보기1'] === 'O' && row['보기2'] === 'X') type = 'ox';
      else if (!row['보기1']) type = 'short';
      else type = 'choice';
    }

    if (type === 'short') {
      const ans = String(row['정답'] || '').split(',')[0].trim();
      return { type, answerText: ans };
    } else {
      let idx;
      if (type === 'ox' && /^[oxOX]$/i.test(String(row['정답']))) {
        idx = String(row['정답']).toUpperCase() === 'O' ? 0 : 1;
      } else {
        idx = parseInt(row['정답'] || 1) - 1;
      }
      return { type, answerIdx: Math.max(0, idx) };
    }
  });
}

async function runExtremeTest() {
  console.log('=====================================================');
  console.log('  🌪️ 1회차(15문제) 극한 엣지 케이스 스트레스 테스트');
  console.log('=====================================================\n');

  const answers = getCorrectAnswers().slice(0, 15); // 1회차 15문제만 추출
  const host = io(SERVER_URL);
  await wait(500);
  
  host.emit('host_reset');
  await wait(1000);

  // 9명의 빌런 봇 세팅
  const bots = {
    ace:     { s: io(SERVER_URL), name: '에이스봇', uid: 'u-ace' },
    spammer: { s: io(SERVER_URL), name: '연타충봇', uid: 'u-spammer' },
    hacker:  { s: io(SERVER_URL), name: '해커봇',   uid: 'u-hacker' },
    late:    { s: io(SERVER_URL), name: '지각생봇', uid: 'u-late' },
    zombie:  { s: io(SERVER_URL), name: '좀비봇',   uid: 'u-zombie' },
    flicker: { s: io(SERVER_URL), name: '깜빡이봇', uid: 'u-flicker' },
    typo:    { s: io(SERVER_URL), name: '오타쟁이', uid: 'u-typo' },
    blank:   { s: io(SERVER_URL), name: '백지봇',   uid: 'u-blank' },
    lag:     { s: io(SERVER_URL), name: '미련봇',   uid: 'u-lag' }
  };

  for (const key in bots) {
    bots[key].s.emit('join', { name: bots[key].name, uid: bots[key].uid });
  }
  await wait(1000);
  console.log('✅ 9인의 봇 부대 입장 완료. 게임 시작!');
  
  host.emit('host_start');
  await wait(5500); // 카운트다운

  for (let i = 0; i < 15; i++) {
    const currentQ = i + 1;
    const ans = answers[i] || { type: 'choice', answerIdx: 0 };
    console.log(`\n▶ [Q${currentQ}] 유형: ${ans.type} | 정답: ${ans.type === 'short' ? ans.answerText : ans.answerIdx}`);

    // 1. 에이스봇: 깔끔하게 정답 1회 제출
    bots.ace.s.emit('answer', ans.type === 'short' ? { text: ans.answerText } : { choice: ans.answerIdx });

    // 2. 연타충봇: 0.1초 간격으로 오답과 정답을 마구잡이로 전송 (마지막은 정답)
    let spamCount = 0;
    const spamInterval = setInterval(() => {
      spamCount++;
      const isCorrect = (spamCount === 10); // 10번째(마지막)에 정답
      if (ans.type === 'short') {
        bots.spammer.s.emit('answer', { text: isCorrect ? ans.answerText : '아무말' });
      } else {
        bots.spammer.s.emit('answer', { choice: isCorrect ? ans.answerIdx : (ans.answerIdx === 0 ? 1 : 0) });
      }
      if (spamCount >= 10) clearInterval(spamInterval);
    }, 100);

    // 3. 해커봇: 이상한 타입의 페이로드 전송
    bots.hacker.s.emit('answer', { choice: { malicious: 'object' } });
    bots.hacker.s.emit('answer', { choice: [1, 2, 3] });
    bots.hacker.s.emit('answer', { text: '<script>alert("XSS")</script>' });

    // 4. 깜빡이봇: 재접속 테스트
    bots.flicker.s.disconnect();
    setTimeout(() => {
      bots.flicker.s = io(SERVER_URL);
      bots.flicker.s.emit('session_restore', { uid: bots.flicker.uid });
      setTimeout(() => {
        bots.flicker.s.emit('answer', ans.type === 'short' ? { text: ans.answerText } : { choice: ans.answerIdx });
      }, 300);
    }, 1000);

    // 5. 오타쟁이/백지봇 (단답형일 때만 활약, 아닐 땐 정답 제출)
    if (ans.type === 'short') {
      bots.typo.s.emit('answer', { text: ` ${ans.answerText} . ! ` }); // 공백, 기호 추가
      bots.blank.s.emit('answer', { text: '      ' }); // 빈 문자열
    } else {
      bots.typo.s.emit('answer', { choice: ans.answerIdx });
      bots.blank.s.emit('answer', { choice: ans.answerIdx });
    }

    // 6. 좀비봇: 1번 문제에서 일부러 틀려서 탈락한 후, 계속 정답을 보냄
    if (currentQ === 1) {
      bots.zombie.s.emit('answer', ans.type === 'short' ? { text: '틀린답' } : { choice: 99 });
    } else {
      bots.zombie.s.emit('answer', ans.type === 'short' ? { text: ans.answerText } : { choice: ans.answerIdx });
    }

    // 7. 지각생봇: 타이머 종료 직후 제출 대기
    let lateSent = false;
    bots.late.s.once('time_up', () => {
      bots.late.s.emit('answer', ans.type === 'short' ? { text: ans.answerText } : { choice: ans.answerIdx });
      lateSent = true;
    });

    // 정답 공개 대기
    await new Promise(resolve => {
      host.once('reveal', (data) => {
        console.log(`   ✅ [Q${currentQ} 채점 완료] 생존자: ${data.survivorCount}명`);
        
        // --- 엣지 케이스 검증 ---
        const elims = data.eliminated || [];
        
        if (currentQ === 1) {
          const zombieElim = elims.find(e => e.name === '좀비봇');
          if (zombieElim) console.log(`   👉 좀비봇 오답으로 정상 탈락`);
        } else {
          // 좀비봇이 정답을 보냈어도 권한 격리로 인해 생존자로 부활하지 않았는지 체크
          if (data.survivors && data.survivors.includes('좀비봇')) {
            console.log(`   ❌ FAIL: 좀비봇이 죽은 상태에서 답을 냈는데 부활함!`);
          }
        }

        if (lateSent) {
          const lateElim = elims.find(e => e.name === '지각생봇');
          if (lateElim) console.log(`   👉 지각생봇 time_up 이후 제출 정상 차단 (탈락)`);
        }

        if (ans.type === 'short') {
          const typoSurv = data.survivors && data.survivors.includes('오타쟁이');
          if (typoSurv) console.log(`   👉 오타쟁이봇 공백/기호 무시하고 정답 인정됨 (정규화 성공)`);
          
          const blankElim = elims.find(e => e.name === '백지봇');
          if (blankElim) console.log(`   👉 백지봇 빈 문자열 제출 정상 탈락`);
        }

        resolve();
      });
    });

    await wait(1000);
    if (currentQ < 15) {
      host.emit('host_next');
      await wait(500);
    }
  }

  console.log('\n=====================================================');
  console.log('  🎯 1회차(15문제) 하드코어 엣지 케이스 시뮬레이션 완료');
  console.log('=====================================================');
  process.exit(0);
}

runExtremeTest().catch(console.error);