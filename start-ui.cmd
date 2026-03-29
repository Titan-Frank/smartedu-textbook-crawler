@echo off
setlocal
cd /d "%~dp0"
echo Installing dependencies if needed...
call npm --prefix scripts install
if errorlevel 1 exit /b %errorlevel%
echo Starting SmartEdu UI at http://127.0.0.1:3210
call npm --prefix scripts run crawl-ui
