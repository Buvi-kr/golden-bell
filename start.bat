@echo off
title Speed Golden Bell Server v5.0
chcp 65001 >nul

cd /d "%~dp0"
set "DIR=%~dp0"
set "PORT=3000"
set "LOG_FILE=%DIR%cloudflare.log"

echo =====================================================
echo    Speed Golden Bell Quiz Server (v5.0)
echo =====================================================
echo.

where node >nul 2>&1
if errorlevel 1 ( echo [ERROR] Node.js is not installed. & pause & exit /b )
if not exist "node_modules" ( call npm install >nul 2>&1 )

:: 기존 cloudflared 프로세스 종료
taskkill /f /im cloudflared.exe >nul 2>&1

:: 절전/화면꺼짐 방지
start /min "SleepPreventer" powershell -WindowStyle Hidden -NoProfile -Command "Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport(""kernel32.dll"")] public static extern uint SetThreadExecutionState(uint esFlags);'; while($true){ [Win32.Power]::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds 30 }"

set "CF_EXE=cloudflared"
if exist "%DIR%cloudflared.exe" set "CF_EXE=%DIR%cloudflared.exe"
if exist "%LOG_FILE%" del /f /q "%LOG_FILE%"

:: ── Cloudflared WATCHDOG (PowerShell loop) ───────────────
:: quic timeout(10분)으로 tunnel 죽으면 자동 재시작. 로그는 append.
:: 재시작 시 새 URL 발급되면 server.js의 watchCfLog 가 감지해서
:: host.html 로 cf_url 이벤트 자동 전송 → QR 자동 갱신
start /min "CloudflareWatchdog" powershell -WindowStyle Hidden -NoProfile -Command ^
  "$log='%LOG_FILE%'; $cf='%CF_EXE%'; $port='%PORT%'; ^
   while($true){ ^
     Add-Content -Path $log -Value ('[WATCHDOG ' + (Get-Date -Format 'HH:mm:ss') + '] Launching cloudflared'); ^
     $p = Start-Process -FilePath $cf -ArgumentList @('tunnel','--url',('http://localhost:'+$port)) -RedirectStandardOutput ($log+'.out') -RedirectStandardError ($log+'.err') -NoNewWindow -PassThru; ^
     $p.WaitForExit(); ^
     Get-Content ($log+'.out') -ErrorAction SilentlyContinue | Add-Content -Path $log; ^
     Get-Content ($log+'.err') -ErrorAction SilentlyContinue | Add-Content -Path $log; ^
     Remove-Item ($log+'.out'),($log+'.err') -ErrorAction SilentlyContinue; ^
     Add-Content -Path $log -Value ('[WATCHDOG ' + (Get-Date -Format 'HH:mm:ss') + '] cloudflared exited code=' + $p.ExitCode + ', restart in 3s'); ^
     Start-Sleep -Seconds 3 ^
   }"

:: URL 기다렸다가 공개 링크 출력
powershell -Command "$log='%LOG_FILE%'; $url=''; for($i=0; $i -lt 20; $i++){ if(Test-Path $log){ $match = Select-String -Path $log -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; if($match){ $url = $match.Matches[0].Value; break } }; Start-Sleep -Seconds 1 }; echo ''; echo '====================================================='; echo '    [SUCCESS] CLOUDFLARE PUBLIC LINKS'; echo '====================================================='; if($url){ echo ' Share these links with people outside your network:'; echo ''; echo \"   - PARTICIPANT:  $url/participant.html\"; echo \"   - DISPLAY:      $url/display.html\"; echo \"   - HOST (Admin): $url/host.html\"; echo ''; echo ' [INFO] Tunnel auto-restarts on QUIC timeout.' } else { echo ' [ERROR] Public URL not found.' }; echo '====================================================='; echo '';"

node server.js

:: 서버 종료 시 watchdog + cloudflared 정리
taskkill /f /im cloudflared.exe >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq CloudflareWatchdog*" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq SleepPreventer*" >nul 2>&1
pause
