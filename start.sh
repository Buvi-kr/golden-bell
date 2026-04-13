#!/bin/bash
echo ""
echo "====================================================="
echo "  🔔 골든벨 퀴즈 서버 시작 중..."
echo "====================================================="
echo ""

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되지 않았습니다."
    echo "   https://nodejs.org 에서 설치하세요."
    exit 1
fi

# npm install (최초 1회)
if [ ! -d "node_modules" ]; then
    echo "📦 패키지 설치 중... (최초 1회)"
    npm install
fi

# cloudflared 확인 및 터널 시작
if command -v cloudflared &> /dev/null; then
    echo "🌐 trycloudflare 터널 시작 중..."
    cloudflared tunnel --url http://localhost:3000 > cloudflare.log 2>&1 &
    CF_PID=$!
    sleep 2
    echo "   터널 URL 확인: cloudflare.log 파일을 열거나"
    echo "   host.html에서 URL을 직접 입력하세요."
else
    echo "⚠️  cloudflared 없음 - 로컬에서만 동작합니다."
    echo "   외부 접속을 위해서는 cloudflared를 설치하세요:"
    echo "   https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
fi

echo ""
node server.js

# 종료 시 cloudflared도 종료
if [ ! -z "$CF_PID" ]; then
    kill $CF_PID 2>/dev/null
fi
