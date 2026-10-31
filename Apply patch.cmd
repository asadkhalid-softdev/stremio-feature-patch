@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Patch-Stremio.ps1" %*
set "patch_result=%errorlevel%"
echo.
pause
exit /b %patch_result%
