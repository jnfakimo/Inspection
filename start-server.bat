@echo off
REM Staging Test Server Startup Script
REM 臺北農產巡檢系統 - Staging 測試服務器啟動腳本

echo.
echo ===============================================
echo   Staging Test Server - Startup Script
echo   臺北農產 - 設備巡檢系統
echo ===============================================
echo.

cd /d "C:\Users\jnfa\OneDrive\Documents\OPENCODE_0623\word-cloud"

echo Starting HTTP server on port 8765...
echo.
echo ℹ️  Server URL: http://localhost:8765
echo ℹ️  Test Console: http://localhost:8765/system/staging-test.html
echo ℹ️  To stop server: Press Ctrl+C
echo.
echo ===============================================
echo.

python -m http.server 8765

pause
