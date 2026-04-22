#!/bin/bash
# Speed Golden Bell Server v6.0 — Mac/Linux 시작 스크립트
echo ""
echo "====================================================="
echo "  ⚡ Speed Golden Bell Quiz Server v6.0"
echo "====================================================="
echo ""

cd "$(dirname "$0")"
PORT=3000
LOG_FILE="./cloudflare.log"

# ── Node.js 확인 ──────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되지 않았습니다."
    echo "   https://nodejs.org 에서 설치하세요."
    exit 1
fi

# ── 패키지 설치 ───────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
    echo "📦 패키지 설치 중... (최초 1회)"
    npm install
fi

# ── 기존 cloudflared 정리 ─────────────────────────────────────
pkill -f "cloudflared tunnel" 2>/dev/null
[ -f "$LOG_FILE" ] && rm -f "$LOG_FILE"

# ── 절전 방지 ─────────────────────────────────────────────────
if command -v caffeinate &> /dev/null; then
    caffeinate -i &
    CAFFEINATE_PID=$!
fi

# ── Cloudflare Watchdog (백그라운드) ──────────────────────────
# QUIC 타임아웃(10분)으로 죽으면 3초 후 자동 재시작
# server.js의 watchCfLog가 새 URL 감지 → host.html QR 자동 갱신
if command -v cloudflared &> /dev/null; then
    TUNNEL_MODE="cloudflare"
    (
        while true; do
            echo "[WATCHDOG $(date '+%H:%M:%S')] Launching cloudflared" >> "$LOG_FILE"
            cloudflared tunnel --url "http://localhost:$PORT" >> "$LOG_FILE" 2>&1
            EXIT_CODE=$?
            echo "[WATCHDOG $(date '+%H:%M:%S')] cloudflared exited (code=$EXIT_CODE), restart in 3s" >> "$LOG_FILE"
            sleep 3
        done
    ) &
    WATCHDOG_PID=$!

    # URL 감지 대기 (최대 20초)
    echo "🌐 Cloudflare 터널 시작 중..."
    URL=""
    for i in $(seq 1 20); do
        sleep 1
        URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1)
        [ -n "$URL" ] && break
    done

elif command -v npx &> /dev/null; then
    # cloudflared 없으면 localtunnel(npx) 폴백
    TUNNEL_MODE="localtunnel"
    echo "⚠️  cloudflared 없음 → localtunnel(npx) 폴백"
    (
        while true; do
            echo "[WATCHDOG $(date '+%H:%M:%S')] Launching localtunnel" >> "$LOG_FILE"
            npx --yes localtunnel --port "$PORT" 2>&1 | while IFS= read -r line; do
                echo "$line" >> "$LOG_FILE"
            done
            echo "[WATCHDOG $(date '+%H:%M:%S')] localtunnel exited, restart in 5s" >> "$LOG_FILE"
            sleep 5
        done
    ) &
    WATCHDOG_PID=$!

    # localtunnel URL 패턴은 다름
    echo "🌐 localtunnel 시작 중..."
    URL=""
    for i in $(seq 1 25); do
        sleep 1
        URL=$(grep -o 'https://[a-zA-Z0-9-]*\.loca\.lt' "$LOG_FILE" 2>/dev/null | tail -1)
        [ -n "$URL" ] && break
    done
else
    TUNNEL_MODE="none"
    echo "⚠️  외부 터널 없음 — 로컬(LAN) 전용으로 동작합니다."
    echo "   cloudflared 설치: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps"
    URL=""
fi

# ── 접속 URL 출력 ─────────────────────────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "====================================================="
echo "  서버 접속 정보"
echo "====================================================="
echo "  로컬:   http://localhost:$PORT"
[ -n "$LAN_IP" ] && echo "  LAN:    http://$LAN_IP:$PORT"
if [ -n "$URL" ]; then
    echo ""
    echo "  ── 외부(QR) 링크 ──"
    echo "  PARTICIPANT: $URL/participant.html"
    echo "  DISPLAY:     $URL/display.html"
    echo "  HOST:        $URL/host.html"
    echo ""
    echo "  [INFO] Watchdog ON — 터널 끊기면 자동 재시작 ($TUNNEL_MODE)"
else
    echo ""
    echo "  [ERROR] 외부 URL 감지 실패 — host.html에서 수동 입력"
fi
echo "====================================================="
echo ""

# ── 서버 실행 ─────────────────────────────────────────────────
node server.js

# ── 종료 정리 ─────────────────────────────────────────────────
echo ""
echo "서버 종료 중..."
[ -n "$WATCHDOG_PID" ]    && kill "$WATCHDOG_PID"    2>/dev/null
[ -n "$CAFFEINATE_PID" ]  && kill "$CAFFEINATE_PID"  2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
pkill -f "localtunnel"        2>/dev/null
echo "✅ 정리 완료"
