# 골든벨 서버 전수 검증 테스트 시나리오 및 체크리스트

이 문서는 골든벨 서버(`server.js`)가 수백 명의 동시 접속과 다양한 예외 상황에서도 안정적으로 동작하는지 확인하기 위한 전수 검증 테스트 항목들을 정리합니다.
진행자, 참가자, 서버 로직, 인프라 등 모든 영역의 엣지 케이스들을 다룹니다.

---

## 1. 전수 검증 변수 리스트 (State Variables)
테스트 시 서버와 클라이언트의 메모리에 저장되는 다음 변수들이 모든 상황에서 정합성을 유지하는지 확인합니다.

- **서버 전역 상태 (`state` 객체)**: 
  - `phase`: LOBBY, QUESTION, REVEAL, GAMEOVER 등 현재 진행 상태 전환
  - `questionIndex`: 현재 문제 인덱스
  - `comingback`: 부활전 진행 여부 (boolean)
  - `answersClosed`: 스레드 경합(Time-up) 시 답안 제출 차단 여부
  - `timerPaused`: 타이머의 일시정지 상태
  - `qrPopupVisible`: 진행자 화면에서 QR 팝업이 떠있는지 여부
- **유저 데이터 (`p` 객체)**: 
  - `sid` (소켓ID), `uid` (고유ID - 세션 복구용)
  - `name` (참가자 이름)
  - `eliminated` (탈락 여부)
  - `answer` (객관식 번호), `answerText` (주관식/단답형 텍스트)
  - `answeredAt` (제출 시각)
- **인프라 변수**: 
  - `cfUrl` (Cloudflare 터널 주소 갱신 상태)
  - `prevCpu` / `totalmem` (서버 자원 소모율 파악)
  - `session.json` (복구 데이터)

---

## 2. 상황별 전수 검증 시나리오 (Edge Case Scenarios)

### 시나리오 1: 입장 및 세션 복구 (Lobby & Session)
1. **공백 및 특수문자 이름**: 
   - 이름에 공백만 입력하거나, HTML 태그(`<b>`, `<script>`)를 넣어 `join` 요청 시 서버에서 `trimmed` 처리 및 XSS 방지가 되는지 확인.
2. **동일 닉네임 중복 접속 (Race Condition)**: 
   - 서로 다른 `uid`를 가진 두 가상 유저가 동일한 `name`으로 동시에 접속 시 서버가 하나를 쳐내고 `join_error`를 정확히 던지는지 확인.
3. **강제 재접속 및 세션 복구**: 
   - 게임 도중 브라우저를 새로고침하거나 인터넷이 끊겼을 때, 30분 이내에 `session_restore`를 통해 기존의 `eliminated` 상태(생존/탈락) 및 제출했던 답을 100% 복구하는지 확인.
4. **시작 후 신규 진입 시도**: 
   - `phase`가 LOBBY가 아닐 때 신규 유저가 `join` 시도 시 거부되는지, 단 기존 접속 이력이 있는(Ghost에 기록된) 유저는 재입장이 가능한지 확인.

### 시나리오 2: 문제 진행 및 답변 제출 (Question Logic)
1. **초단위 레이스 컨디션 (Time-up Race)**: 
   - 타이머가 0초가 되는 순간(`time_up`)과 거의 동시에 `answer` 이벤트 전송 시, 서버의 `answersClosed` 플래그에 의해 정확히 차단되어 무효 처리되는지 확인.
2. **답변 수정 노이즈 (Flooding)**: 
   - 한 유저가 1초에 10회 이상 `answer`를 연타하여 변경할 때, 서버 로그에 최종 값만 올바르게 반영되고 DB나 이벤트 큐에 부하가 없는지 (Throttle/Debounce 로직 점검).
3. **단답형 관용 처리 (Lenient Matching)**: 
   - 정답이 "천상열차분야지도"일 때, 유저가 " 천상열차분야지도 ", "천상 열차 분야 지도" 등 공백이나 기호를 섞어 보내도 정규화(Normalize) 로직이 이를 정답 처리하는지 확인.
4. **주관식 채점 정합성 (Manual Grading)**: 
   - 진행자가 300명의 주관식 답변 중 150명을 선택하여 `passedNames`로 보낼 때, 명단에 없는 150명이 즉시 `eliminated: true`로 변하고 각 소켓으로 `eliminated` 이벤트가 정상 분배되는지 확인.

### 시나리오 3: 패자부활전 및 권한 격리 (Comeback Mode)
1. **생존자 답변 차단 (Ghost Input)**: 
   - `comingback: true` 상태에서 현재 생존자(`eliminated: false`)가 악의적으로 `answer`를 보냈을 때, 서버 로직이 이를 완벽히 무시하는지 확인 (`if (state.comingback && !p.eliminated) return`).
2. **부활전 문제 고갈**: 
   - `comebackPool`의 모든 문제를 소진했을 때 진행자가 다시 `host_comeback`을 누르면 `comeback_error`가 발생하는지 확인.
3. **부활 직후 상태 정합성**: 
   - 부활한 유저가 다음 문제(`host_next`)에서 즉시 생존자 명단(survivors)에 포함되어 다시 문제를 풀 수 있고 화면이 전환되는지 확인.

### 시나리오 4: 인프라 및 장애 복구 (Infrastructure)
1. **Cloudflare 터널 단절**: 
   - 터널 URL이 변경되었음을 `cloudflare.log`를 통해 감지하고 `host.html`과 `display.html`에서 `cf_url` 이벤트를 받아 QR 코드를 즉시 갱신하는지 확인.
2. **서버 프로세스 강제 종료 (SIGINT)**: 
   - 게임 중 Node.js 서버를 강제 종료(Ctrl+C) 후 재실행했을 때, `session.json`을 성공적으로 읽어 `questionIndex`, `phase`, 유저들의 생존 상태가 이전과 100% 동일하게 유지되는지 확인.
3. **대역폭 포화 한계 (Socket Broadcast Limit)**: 
   - 300명이 동시에 지속적으로 `answer`를 제출하여 `answer_progress`가 브로드캐스트될 때 메시지 누락이나 소켓 접속 끊김(Ping timeout)이 발생하는지 점검.

---

## 3. 안티그래비티 추가 제안 테스트 시나리오 (Advanced / Security)

1. **상태 전환 악용 테스트 (State Bypass)**
   - `phase`가 QUESTION이 아닌 상태 (LOBBY, REVEAL, GAMEOVER)에서 `answer` 제출 시 서버가 철저히 무시하는지 확인.
2. **잘못된 데이터 형식 전송 (Payload Validation)**
   - 클라이언트가 `answer` 이벤트의 payload로 문자열이나 숫자가 아닌 `Array`, `Object`, 특수 객체를 보냈을 때 서버가 크래시되지 않는지 확인.
3. **비인가 관리자 이벤트 호출 (Auth / Privilege Escalation)**
   - 일반 클라이언트나 인증되지 않은 스크립트가 `host_start`, `host_next`, `host_comeback` 등의 이벤트를 강제로 발생시켰을 때 현재는 구분이 명확하지 않은데, 이에 따른 위험성 및 관리자용 커넥션과 참가자용 커넥션 분리 고려 여부. (현재 `server.js` 에서는 제한 없이 수신하므로, 누군가 고의로 문제를 넘길 수 있습니다.)
4. **비정상적인 단답형/주관식 XSS 공격**
   - 참가자가 답변으로 엄청난 길이의 텍스트(예: 1MB 문자열)나 악의적인 스크립트를 보냈을 때 `substring` 또는 안전 처리(`slice(0, 200)`) 및 이스케이프가 완전히 먹히는지 확인.

---

## 4. 모니터링 및 성능 점검 체크리스트
- [ ] **참여자 수 일치**: `state.players.size == io.engine.clientsCount` 가 항시 성립하는지 (유령 소켓, 끊긴 소켓 정리).
- [ ] **메모리 누수 측정**: 20문제 이상 연속으로 진행하고 복수의 패자부활전을 거쳐도 Node.js `RSS` 메모리 사용량이 초기 대비 급증(20% 이상) 하지 않는지.
- [ ] **파일 I/O 병목 확인**: `server.log` 및 `session.json` 저장이 동시에 잦은 빈도로 일어날 때 (예: 1초 만에 300번의 로깅) `writeFileSync` 혹은 파싱 병목으로 서버 틱이 지연되지 않는지. (현재 동기 파일 I/O 개선 고려)
- [ ] **타이머 오차 (Timer Drift)**: 브라우저가 백그라운드로 내려갔을 때의 `setInterval` 지연 현상을 서버의 타임스탬프(`Date.now()`) 기반으로 보정하는지.
- [ ] **엑셀 핫 리로드 기능**: `questions.xlsx`를 수정하고 게임 도중에 `host_reload_questions`를 눌렀을 때 메모리의 `mainQuestions` 배열만 깔끔하게 갱신되고 게임 진행 인덱스(`questionIndex`)는 꼬이지 않는지.

---

## 5. 자동화 테스트 스크립트 실행 방법

동봉된 `test.js` 스크립트를 사용하여 핵심 시나리오들을 자동 검증할 수 있습니다.

**실행 방법:**
1. 프로젝트 폴더 내에서 터미널을 열고 `socket.io-client` 설치:
   ```bash
   npm install socket.io-client
   ```
2. 골든벨 서버 실행:
   ```bash
   npm start
   ```
3. 새 터미널을 열고 테스트 스크립트 실행:
   ```bash
   node test.js
   ```
4. `test.js` 가 남긴 로그를 통해 레이스 컨디션 및 엣지 케이스들의 통과 여부 확인.
