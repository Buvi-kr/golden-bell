# 🔔 골든벨 퀴즈 시스템 v3

300명 동시접속 골든벨 퀴즈 — 설치부터 실행까지 완전 가이드

---

## 📦 사전 준비 (2가지만)

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

## 📋 진행 순서

```
1. start.bat 실행
2. host.html 열기 (터널 URL 자동 감지 & QR 생성)
3. display.html을 빔프로젝터에 띄우기
4. 참여자에게 QR 보여주기
5. [🚀 시작] 클릭 → [▶ 다음 문제] → 타이머 진행 → [✅ 정답 공개] 반복
6. 필요 시 [🔄 패자부활전] 클릭
7. 마지막 생존자 = 골든벨!
```

---

## 📝 문제 유형 4가지

| 유형 | Excel `유형` 컬럼 | 설명 |
|------|------------------|------|
| 객관식 | `choice` | 1~4지선다, 정답=1~4 숫자 |
| O/X | `ox` | 보기1=O, 보기2=X, 정답=1(O) or 2(X) |
| 단답형 | `short` | 직접 타이핑, 정답란에 `서울,Seoul,SEOUL` 처럼 콤마로 복수 정답 |
| 주관식 | `essay` | 자유 서술, 진행자가 host.html에서 수동으로 통과/탈락 결정 |

---

## 📊 문제 수정 방법

### Excel 방식 (권장)
```
1. node make_excel_template.js  ← 처음 한 번만 (템플릿 생성)
2. questions.xlsx를 Excel로 열기
3. Sheet1(문제목록) = 일반 문제 수정
   Sheet2(패자부활전) = 패자부활전 전용 문제 수정
4. 저장
5. host.html에서 [📂 Excel 다시 로드] 클릭 → 즉시 적용
```

**엑셀 컬럼 구조:**
| 번호 | 유형 | 문제 | 보기1 | 보기2 | 보기3 | 보기4 | 정답 | 제한시간 |
|------|------|------|-------|-------|-------|-------|------|----------|
| 1 | choice | 수도는? | 서울 | 부산 | 대구 | 인천 | 1 | 20 |
| 2 | ox | 독도는 우리 땅 | O | X | | | 1 | 15 |
| 3 | short | 가장 높은 산? | | | | | 에베레스트,Everest | 25 |
| 4 | essay | 소감 한 마디 | | | | | (비워두기) | 60 |

### JSON 방식 (개발자용)
`questions.json` 직접 수정:
```json
{
  "main": [...일반 문제...],
  "comeback": [...패자부활전 문제...]
}
```

---

## 🔄 패자부활전

- 정답 공개 후 [🔄 패자부활전] 버튼 활성화
- **Sheet2(패자부활전 시트)의 별도 문제**를 순서대로 사용 (같은 문제 재사용 아님!)
- 탈락자만 답변 가능, 정답자는 자동 부활
- 패자부활전 문제가 남아있는 한 계속 사용 가능

---

## 📱 재접속 / 새로고침 처리

**v3 버그픽스 적용:**
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

## ⚙️ 주요 설정

`server.js` 최하단:
```js
const PORT = process.env.PORT || 3000;  // 포트 변경
```

세션 보존 시간 (기본 20분):
```js
if (Date.now() - new Date(d.savedAt).getTime() > 20 * 60 * 1000)
```

Ghost 플레이어 보존 시간 (기본 30분):
```js
if (Date.now() - ghost.disconnectedAt > 30 * 60 * 1000)
```

---

## 📁 파일 구조

```
golden-bell/
├── server.js                ← 핵심 서버 (수정 불필요)
├── package.json
├── questions.xlsx           ← 문제 파일 (수정)
├── questions.json           ← JSON 백업 문제
├── make_excel_template.js   ← Excel 템플릿 생성기
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
| 포트 3000 사용 중 | 다른 서버 종료 or 포트 변경 |
| QR 스캔해도 안 열림 | cloudflare URL이 host.html에 표시됐는지 확인 |
| 문제가 안 바뀜 | [📂 Excel 다시 로드] 클릭 |
| 재접속이 안 됨 | 정확히 같은 닉네임 입력, 30분 이내 재접속 |
| 패자부활전 비활성화 | Sheet2(패자부활전)에 문제가 있는지 확인 |
| 300명 접속 끊김 | 유선 인터넷 또는 5GHz Wi-Fi 권장 |
```
