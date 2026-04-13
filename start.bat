@echo off
title Golden Bell Quiz Server v4.0

cd /d "%~dp0"
set "DIR=%~dp0"
set "PORT=3000"
set "LOG_FILE=%DIR%cloudflare.log"

echo =====================================================
echo    Golden Bell Quiz Server System (v4.0)
echo =====================================================
echo.

where node >nul 2>&1
if errorlevel 1 ( echo [ERROR] Node.js is not installed. & pause & exit /b )
if not exist "node_modules" ( call npm install >nul 2>&1 )

taskkill /f /im cloudflared.exe >nul 2>&1
start /min "SleepPreventer" powershell -WindowStyle Hidden -NoProfile -Command "Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport(""kernel32.dll"")] public static extern uint SetThreadExecutionState(uint esFlags);'; while($true){ [Win32.Power]::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds 30 }"

set "CF_EXE=cloudflared"
if exist "%DIR%cloudflared.exe" set "CF_EXE=%DIR%cloudflared.exe"
if exist "%LOG_FILE%" del /f /q "%LOG_FILE%"
start "CloudflareTunnel" /min cmd /c ""%CF_EXE%" tunnel --url http://localhost:%PORT% > "%LOG_FILE%" 2>&1"

powershell -Command "$log='%LOG_FILE%'; $url=''; for($i=0; $i -lt 20; $i++){ if(Test-Path $log){ $match = Select-String -Path $log -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'; if($match){ $url = $match.Matches[0].Value; break } }; Start-Sleep -Seconds 1 }; echo ''; echo '====================================================='; echo '    [SUCCESS] CLOUDFLARE PUBLIC LINKS'; echo '====================================================='; if($url){ echo ' Share these links with people outside your network:'; echo ''; echo \"   - PARTICIPANT:  $url/participant.html\"; echo \"   - DISPLAY:      $url/display.html\"; echo \"   - HOST (Admin): $url/host.html\" } else { echo ' [ERROR] Public URL not found.' }; echo '====================================================='; echo '';"

node server.js
pause
