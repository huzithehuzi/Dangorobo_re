@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js LTS is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

set "LOCK_HASH="
set "SAVED_HASH="
for /f %%H in ('powershell -NoProfile -Command "(Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash"') do set "LOCK_HASH=%%H"
if exist ".dev-deps.hash" set /p SAVED_HASH=<".dev-deps.hash"

if not exist "node_modules\electron\dist\electron.exe" goto install
if /i not "%LOCK_HASH%"=="%SAVED_HASH%" goto install
goto run

:install
echo Installing or refreshing development dependencies...
call npm ci
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)
> ".dev-deps.hash" echo %LOCK_HASH%

:run
echo Starting the pet directly from the current source...
call npm start
if errorlevel 1 (
  echo The development run ended with an error.
  pause
)
endlocal
