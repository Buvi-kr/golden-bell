# ⚡ 스피드 골든벨 v4

300명 동시접속 실시간 퀴즈 — 완전 자동 흐름, 5회차 × 15문제

---

## 📦 사전 준비

### 1. Node.js 설치
👉 https://nodejs.org → **LTS 버전** 다운로드 → 설치

```
node -v   ← 버전 숫자 나오면 성공
```

### 2. cloudflared 설치 (외부 접속용 터널)
👉 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
- Windows: `cloudflared-windows-amd64.msi` 다운로드 후 더블클릭
- Mac: `brew install cloudflared`

---

## 🚀 실행

### Windows
`start.bat` 더블클릭

### Mac / Linux
```bash
chmod +x start.sh && ./start.sh
```

서버가 켜지면 터미널에 이런 줄이 뜹니다:
```
https://xxxx-yyyy.trycloudflare.com
```
→ host.html이 자동으로 감지해서 QR코드를 갱신합니다.

---

## 🖥️ 화면 구성

| 화면 | URL | 역할 |
|------|-----|------|
| 진행자 패널 | `/host.html` | 문제 제어, QR, 모니터링, 로그 |
| 빔프로젝터 현황판 | `/display.html` | 대형 화면 송출 |
| 참여자 화면 | `/participant.html` | QR 스캔 후 스마트폰으로 접속 |

---

## 📋 게임 자동 흐름

```
[🚀 시작] 클릭
  → 5초 카운트다운 (5→4→3→2→1)
  → Q1 자동 출현 + 15초 타이머 시작
  → 15초 만료 → 답변 자동 마감
  → 3초 카운트다운 (3→2→1, "정답 공개!")
  → 정답 자동 공개 + 탈락자 처리

[▶ 다음 문제] 클릭
  → 다음 문제 즉시 출현 + 15초 타이머 시작
  → (위와 동일 반복)

[🏁 종료] 클릭
  → 🔔 우승자 화면 (생존자 있을 때)
  → 💀 전원 탈락 화면 (아무도 안 남았을 때)
```

> **정답 공개 버튼 없음** — 타이머 종료 후 모든 공개는 자동으로 진행됩니다.

---

## 🎮 진행 순서

```
1. start.bat 실행
2. host.html 열기 (터널 URL 자동 감지 & QR 생성)
3. display.html을 빔프로젝터에 띄우기
4. 참여자에게 QR 보여주기
5. [🚀 시작] → 자동으로 5초 후 Q1 출현
6. 15초 타이머 → 자동 마감 → 자동 정답 공개
7. [▶ 다음 문제] 클릭 반복
8. 마지막 생존자 = 🔔 골든벨!
```

---

## 📝 문제 유형 3가지

| 유형 | `type` 값 | 설명 |
|------|-----------|------|
| 객관식 | `choice` | 4지선다, `answer`: 0~3 (0-based 인덱스) |
| O/X | `ox` | 보기 `["O","X"]`, `answer`: 0(O) or 1(X) |
| 단답형 | `short` | 직접 타이핑, `correctAnswers`: `["서울","Seoul","SEOUL"]` 처럼 복수 정답 배열 |

> **모든 문제 제한시간 15초 고정** — `timeLimit` 필드 불필요

---

## 📊 문제 수정 방법

`questions.json` 직접 수정:

```json
{
  "main": [
    { "id": 1, "type": "choice", "question": "대한민국 수도는?",
      "choices": ["서울","부산","대구","인천"], "answer": 0 },
    { "id": 2, "type": "ox", "question": "독도는 우리 땅이다",
      "choices": ["O","X"], "answer": 0 },
    { "id": 3, "type": "short", "question": "세계에서 가장 높은 산은?",
      "choices": [], "correctAnswers": ["에베레스트","Everest"], "answer": null }
  ]
}
```

- 총 **75문제** (5회차 × 15문제) 구성 권장
- id 1~75 순서대로, `type`·`question`·`choices`·`answer` 채우면 됨
- 변경 후 서버 재시작하면 즉시 적용

---

## 🏆 회차 표시

host.html 상단에 현재 회차와 문제 번호가 표시됩니다:

```
📍 2회차 — 3번째 문제
```

- 1~15번: 1회차 / 16~30번: 2회차 / ... / 61~75번: 5회차

---

## 🚨 탈락자 화면

탈락 시 참여자 화면에 다음 정보가 잠금 표시됩니다:

```
서버 시작 시간: 2026-04-16 14:30:00
제 7번 문제에서 탈락하셨습니다.

아쉽게 탈락하셨습니다!
10분 이내로 안내 데스크에 방문하여 상품을 수령해 주세요.
```

---

## 📱 재접속 / 새로고침 처리

- 참여자가 앱을 내렸다가 다시 열면 → 자동으로 현재 게임 상태 동기화
- 새로고침 시 → 이전 닉네임으로 자동 재입장 시도
- 게임 도중 재입장이 안 될 경우 → **정확히 같은 닉네임** 입력하면 재입장 가능 (30분 이내)
- 서버 재시작 시 → `session.json` 파일로 20분 이내 세션 복구

---

## 🖥️ 서버 모니터링 (host.html 우측)

- **CPU / 메모리**: 80%/85% 초과 시 빨간색 경고
- **소켓 수**: 현재 연결된 접속자 수
- **서버 로그**: 실시간 스트리밍 (cloudflare 터널 URL 포함)
- **행사 로그**: 입장·문제·정답·탈락 타임스탬프 기록 → txt 다운로드

---

## ⚙️ 주요 상수 (server.js)

```js
const QUESTION_TIME = 15;      // 문제당 제한 시간 (초)
const REVEAL_DELAY  = 3000;    // 답변 마감 후 정답 공개까지 대기 (ms)
const PORT = process.env.PORT || 3000;
```

Ghost 플레이어 보존 시간 (기본 30분):
```js
if (Date.now() - ghost.disconnectedAt > 30 * 60 * 1000)
```

---

## 📁 파일 구조

```
golden-bell/
├── server.js                ← 핵심 서버
├── package.json
├── questions.json           ← 문제 파일 (직접 수정)
├── start.bat                ← Windows 실행
├── start.sh                 ← Mac/Linux 실행
├── session.json             ← 자동 생성 (세션 백업)
├── cloudflare.log           ← 자동 생성 (터널 로그)
├── server.log               ← 자동 생성 (서버 로그)
└── public/
    ├── host.html            ← 진행자 화면
    ├── display.html         ← 빔프로젝터 현황판
    └── participant.html     ← 참여자 스마트폰
```

---

## 🔧 문제 해결

| 증상 | 해결책 |
|------|--------|
| `node`를 찾을 수 없음 | Node.js 재설치 후 PC 재시작 |
| 포트 3000 사용 중 | 다른 서버 종료 or `PORT` 변경 |
| QR 스캔해도 안 열림 | cloudflare URL이 host.html에 표시됐는지 확인 |
| 문제가 안 바뀜 | 서버 재시작 |
| 재접속이 안 됨 | 정확히 같은 닉네임 입력, 30분 이내 재접속 |
| 300명 접속 끊김 | 유선 인터넷 또는 5GHz Wi-Fi 권장 |
| 터널이 10분마다 끊김 | start.bat의 Watchdog이 자동 재시작 (v6에서 해결) |

---

## 📦 패치노트

### v6.0 — 2026-04-18

#### 🔴 버그 수정
- **[치명] short 타입 미답자가 생존하던 버그 수정**
  - `normalize('') → includes(norm)` 이 항상 true 반환하는 문제 → 빈 문자열 early return 처리
- **[중요] Cloudflare 터널 재시작 시 구 URL 고착 버그 수정**
  - `parseCfLog()` 에서 `.match()` (non-global) 가 첫 번째 URL만 반환 → `/g` 플래그 + 마지막 매치 사용으로 재시작 후 자동 갱신

#### 🟢 신규 기능
- **Cloudflare Watchdog 자동 재시작** (`start.bat`)
  - 10분 QUIC 타임아웃으로 터널 죽으면 3초 후 자동 재시작
  - 서버·host.html·display.html 이 새 URL 자동 감지 및 QR 갱신
- **탈락자 선택 통계 수집 및 시각화** (`server.js` + `display.html`)
  - 문제마다 탈락자가 선택한 보기 분포 집계 (`eliminatedStats[]`)
  - 미답 탈락자(`eliminatedReason: 'timeout'`) 별도 카운트
  - 3840×1080 우측 패널에 막대그래프 표시
- **3840×1080 초광폭 레이아웃** (`display.html`)
  - 상단 10% 여백 + 20vh 대형 카운터 (생존/탈락/문제)
  - 3단 그리드: `[좌 문제 28%] [중 보기 40%] [우 통계/보상 1fr]`
  - 중앙에서 밀려나오는 스프레드 애니메이션 (순차 딜레이)
  - 상품 안내 패널 상시 표시
- **야외 고대비 모드** (`host.html` → `display.html`)
  - 진행자 `☀️ 야외모드` 버튼 → 전체 화면 고대비 테마 브로드캐스트
  - 순검정 배경, 강화 텍스트 그림자, 고채도 색상 — 햇빛 환경 가독성
- **서버 헬스체크 배너** (`host.html`)
  - 10초 간격 `/api/health` polling
  - 터널 응답 없음 / 서버 다운 시 상단 빨간 경고 배너 자동 표시
- **자동 재입장 강화** (`participant.html`)
  - `session_not_found` 수신 시 저장된 닉네임으로 자동 재입장 시도
  - 실패 시에만 수동 입장 화면으로 fallback (사용자 개입 최소화)
- **탈락 사유 표시** (`participant.html`)
  - 탈락 화면에 `⏰ 시간 초과` / 오답 구분 표시

#### 🟡 개선
- **정답 팝업 ↔ 탈락 해골 팝업 충돌 해결** (`display.html`)
  - 정답 공개 박스 표시 후 2.5초 지연으로 탈락 팝업 순차 표시
  - 새 문제 시작 시 pending 타이머 즉시 취소
- **QR 코너 브라켓 완벽 대칭** (`display.html`)
  - `right/bottom` 속성 사용으로 단순 대칭 보장 (이전 `calc` 오작동 수정)
  - 28px, `box-sizing:border-box`, 14px border-radius, 순차 펄스 애니메이션
