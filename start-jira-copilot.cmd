@echo off
setlocal
set "APP_DIR=%~dp0"
start "Jira Implementation Copilot" /min cmd /c "cd /d ""%APP_DIR%"" && npm run dev"
echo Starting Jira Implementation Copilot...
echo Your browser will open when the web server is ready.
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\open-browser.ps1"
endlocal
