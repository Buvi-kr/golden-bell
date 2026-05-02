# ⚡ Speed Golden Bell v6 — 종합 개선 계획

**기반 데이터**: 2026-04-18 실전 운영 로그 (33명 참여, 9문제 진행, 터널 끊김으로 중단)

---

## 🔴 실전 운영에서 확인된 치명 이슈

| # | 증상 | 근거 (로그) | 영향 |
|---|------|-------------|------|
| A | Cloudflare 터널 10분 후 QUIC 연결 끊김 | 07:37:47 동시 disconnect 9건 + `failed to dial to edge with quic: timeout` 반복 | 전원 이탈 = 행사 중단 |
| B | 동일 닉네임 재접속 빈발 (엉덩이 6회) | 07:29:15 ~ 07:31:17 | 네트워크 불안정 + ghost 복구는 작동 |
| C | 탈락자 선택 통계 미수집 | `Reveal [ox]: survived 30, out 3` 만 있음 | 누가/무엇을 골라 틀렸는지 시각화 불가 |
| D | 자동 미답 탈락 정상 작동 여부 불명확 | 로그에 "timeout elimination" 항목 없음 | Edge case 실제 검증 필요 |

---

## 📋 우선순위 매트릭스

### 🔴 Priority 1 — 안정성 (행사 중단 방지)
1. **Cloudflare 터널 이중화 + 자동 재연결 감지**
2. **탈락 처리 로직 전면 검증 & 버그 수정**
3. **소켓 재접속 시 상태 동기화 강화**
4. **자동 미답 탈락 확정 구현**

### 🟠 Priority 2 — UX (3840x1080 초광폭 대응)
5. **레이아웃 대대적 재설계 (display.html)**
6. **생존/탈락 카운터 대형 상단 배치**
7. **중앙 대형 타이머 (타임어택 느낌)**
8. **고대비 야외 테마**

### 🟡 Priority 3 — 재미 요소
9. **탈락자 선택 통계 시각화 (막대/파이)**
10. **정답 공개 팝업 vs 해골 연출 충돌 해결**
11. **보상 안내 상시 표시**
12. **문제 구성 전략 (단답형 유동 투입)**

---

## 🏗️ Priority 1 — 안정성 구현 상세

### 1-A. Cloudflare 터널 이중화
**문제**: `trycloudflare.com` 무계정 터널은 SLA 없음. QUIC 10분 타임아웃 관찰됨.

**해결**:
```
start.bat 개선:
  1) named tunnel 우선 시도 (사전 설정 config.yml)
  2) 실패 시 localtunnel (localtunnel.me) 폴백
  3) 그것도 실패 시 ngrok 폴백
host.html:
  - tunnel URL 변경 감지 → QR 자동 재생성
  - 10초마다 /api/health 핑 → 끊김 시 빨간 배너
```

**파일**: `start.bat`, `server.js` (`/api/health` 신규), `host.html` (헬스체크 polling)

---

### 1-B. 탈락 처리 로직 검증
**검토 항목**:
```javascript
_doReveal() 내부:
  [ ] short 타입: correctAnswers 정규화 (trim, toLowerCase, 공백 제거) 완성도
  [ ] answer=null 인 참여자 = 자동 탈락 (미답)
  [ ] disconnect 중인 ghost = 자동 탈락? (정책 명확화 필요)
  [ ] 이미 탈락한 사람에게 다시 eliminated emit 방지
  [ ] newElim.sid 가 null/undefined 일 때 emit 안전성
```

**테스트 케이스 (자동화)**:
- 30명 중 15명 미답 → 15명 탈락 확인
- short 정답 "에베레스트" vs 입력 "에베 레스트" (공백) → 탈락? 생존? 정책 결정
- disconnect → 타이머 종료 → 자동 탈락 처리되는지

---

### 1-C. 재접속 견고성
**현재**: ghost → 같은 닉네임 입력 시 복구 (30분 이내)

**강화**:
```javascript
// participant.html
- localStorage에 { name, token, joinedAt } 저장
- 재접속 시 token 으로 자동 복구 (닉네임 재입력 불필요)
- Socket.IO reconnection: { attempts: Infinity, delay: 1000, delayMax: 5000 }

// server.js
- state.players 에 token 필드 추가 (crypto.randomUUID)
- 'rejoin' 이벤트: { token } → players.find 후 socket 재바인딩
- ghost 복구 성공 시 eliminated/survived 상태 정확히 복원
```

---

### 1-D. 자동 미답 탈락
**현재 `_onTimeUp` → `_doReveal`** 흐름에서:
```javascript
// _doReveal() 내부에 추가 보장
for (const p of state.players.values()) {
  if (p.eliminated) continue;
  if (p.answer === null && p.answerText === null) {
    p.eliminated = true;
    p.eliminatedAt = state.questionIndex;
    p.eliminatedReason = 'timeout'; // 사유 기록
    newElim.push({ name: p.name, sid: p.socketId });
  }
}
```

**로그 강화**: `[EVENT] Eliminated (timeout): 김철수, 이영희 (3 명)`

---

## 🎨 Priority 2 — 초광폭 UI 재설계

### 2-A. 3840x1080 전용 레이아웃 (display.html)

```
┌─────────────────────────────────────────────────────────────────┐
│  (10% 여백 — 시각적 숨통)                                        │
├─────────────────────────────────────────────────────────────────┤
│  🟢 생존 127명       ⏱ 15        💀 탈락 173명    ⚡스피드 골든벨│ ← 20% 대형 카운터
├───────────────┬─────────────────────────────┬───────────────────┤
│               │                             │                   │
│ 📋 현재 문제   │  ① 서울  ② 부산            │ 📊 탈락자 선택    │
│               │  ③ 대구  ④ 인천            │    통계           │
│ [큰 글씨]     │                             │                   │
│ 대한민국      │  [대형 박스 + 스프레드]     │ ① ▓▓ 12          │
│ 수도는?       │                             │ ② ▓▓▓▓▓ 45       │
│               │                             │ ③ ▓ 3            │
│               │                             │ ④ ▓▓ 8           │
│               │                             │                   │
│               │                             │ 🎁 1~20등 상품    │
│               │                             │ 🏆 1등 특별 상품  │
└───────────────┴─────────────────────────────┴───────────────────┘
  좌 25%            중 50%                       우 25%
```

**CSS 전략**:
```css
@media (min-aspect-ratio: 2/1) {
  #sQuestion { display: grid; grid-template-columns: 25% 50% 25%; }
  .counter-bar { height: 20vh; font-size: clamp(80px, 9vw, 180px); }
  .timer-central { position: fixed; top: 5vh; left: 50%; transform: translateX(-50%); font-size: 120px; }
}
```

### 2-B. 스프레드 애니메이션
```css
@keyframes spreadIn {
  0%   { transform: scale(0.3); opacity: 0; }
  60%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); }
}
.choice-box { animation: spreadIn .6s cubic-bezier(.25,.85,.35,1.05) both; }
.choice-box:nth-child(1){animation-delay:.0s}
.choice-box:nth-child(2){animation-delay:.1s}
.choice-box:nth-child(3){animation-delay:.2s}
.choice-box:nth-child(4){animation-delay:.3s}
```

### 2-C. 고대비 야외 테마
```css
:root {
  --bg: #000;           /* 순검정 */
  --t1: #fff;           /* 순백 */
  --orange: #ff6a00;    /* 채도 업 */
  --gold: #ffd000;      /* 채도 업 */
  --success: #00ff88;
  --danger: #ff2a5d;
}
/* 본문 폰트 800+ weight, letter-spacing, text-shadow 로 햇빛 대응 */
.q-text { font-weight: 900; text-shadow: 0 2px 8px rgba(0,0,0,.9); }
```

토글 버튼 host.html 에: `[☀️ 야외모드]` → `body.classList.toggle('outdoor')`

---

## 📊 Priority 3 — 탈락자 통계 시각화

### 3-A. 서버 측 통계 수집
```javascript
// server.js - _doReveal 내부
const eliminatedStats = {};
if (q.type === 'choice' || q.type === 'ox') {
  for (const p of state.players.values()) {
    if (p.eliminatedAt === state.questionIndex) {
      const key = p.answer ?? 'null';
      eliminatedStats[key] = (eliminatedStats[key] || 0) + 1;
    }
  }
}
io.emit('reveal', { ..., eliminatedStats });
```

### 3-B. 디스플레이 우측 패널
```html
<div class="stats-panel">
  <h3>💀 탈락자 선택 분포</h3>
  <div class="bar-row" v-for="(cnt, idx) in eliminatedStats">
    <span class="choice-label">{{ ['①','②','③','④'][idx] }}</span>
    <div class="bar" :style="width: (cnt/max*100)+'%'"></div>
    <span class="count">{{ cnt }}명</span>
  </div>
</div>
```

---

## 🎬 연출 충돌 해결

### 현재 문제
정답 공개 팝업 `#ansRevealBox` 과 탈락자 해골 이미지가 같은 타이밍에 겹침.

### 해결: 시퀀스 분리
```
T+0.0s : 정답 공개 팝업 등장 (중앙, 2초간 스케일)
T+2.0s : 팝업 축소 → 우측 상단 고정
T+2.5s : 해골 이펙트 (참여자 본인 화면에만) + 탈락자 통계 패널 등장 (우측)
T+5.0s : 다음 문제 대기 상태 (host가 "다음 문제" 누를 때까지)
```

---

## 🏆 운영 전략 — questions.json 개편

### 난이도 곡선
```
1~3번  : OX 워밍업 (쉬운 상식)
4~6번  : OX 중급
7~9번  : 4지선다 중급
10번~  : 단답형 투입 시작 (생존자 ≤20명 시 우선 투입)
13~15번: 4지선다 고난도
```

### 보상 안내 (display.html 로비 화면)
```html
<div class="reward-notice">
  🎁 <strong>20등 이내</strong> 소정의 상품 증정<br>
  🏆 <strong>최종 1등(골든벨)</strong> 특별 상품!
</div>
```

---

## 🧪 검증 체크리스트

### 부하/안정성
- [ ] 100명 동시 접속 로컬 테스트 (artillery.io)
- [ ] 강제 disconnect/reconnect 10회 반복 → 상태 복구율 100%
- [ ] 터널 강제 종료 → 5초 내 감지 & 경고 표시
- [ ] 서버 재시작 → session.json 복구 정확도

### UX
- [ ] 3840x1080 실제 디스플레이 또는 devtools emulation 확인
- [ ] 야외모드 화면 밝기 85% 상태에서 5m 거리 가독성
- [ ] 중앙 타이머 8초↓ 주황, 5초↓ 빨강 전환 확인

### 게임 로직
- [ ] 미답자 자동 탈락 (30명 중 15명 미답 시나리오)
- [ ] short 공백/대소문자 정책 일관성
- [ ] 동일 닉네임 재접속 token 복구
- [ ] 전원 탈락 시 해골 화면 + 우승자 0 처리

---

## 📦 구현 순서 (추천)

```
Week 1 (안정성)
  Day 1-2: 탈락 로직 검증 + 자동 미답 탈락
  Day 3-4: 재접속 token 시스템
  Day 5  : 터널 이중화 + 헬스체크

Week 2 (UX)
  Day 1-2: display.html 3840x1080 그리드 레이아웃
  Day 3  : 스프레드 애니메이션 + 중앙 대형 타이머
  Day 4  : 야외 고대비 테마 토글
  Day 5  : 탈락자 통계 패널

Week 3 (마감)
  Day 1-2: 연출 시퀀스 재조정
  Day 3  : questions.json 실전 문제 투입 + 보상 안내
  Day 4  : 100명 부하 테스트
  Day 5  : 실전 리허설
```

---

## 🚨 당장 다음 push 에서 처리할 것 (TODO 즉시)

1. ✅ QR 코너 브라켓 대칭 (완료)
2. ⏳ **자동 미답 탈락 확정** (_doReveal 보강) — 다음 커밋
3. ⏳ **/api/health 엔드포인트** — 다음 커밋
4. ⏳ **탈락자 선택 통계 수집** (서버) — 다음 커밋
5. ⏳ **3840x1080 미디어쿼리 + 3단 그리드** — 다음 커밋
