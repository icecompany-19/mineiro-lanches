@echo off
setlocal
set "ML_NAVEGADOR="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "ML_NAVEGADOR=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined ML_NAVEGADOR if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "ML_NAVEGADOR=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined ML_NAVEGADOR if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "ML_NAVEGADOR=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined ML_NAVEGADOR if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "ML_NAVEGADOR=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined ML_NAVEGADOR if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "ML_NAVEGADOR=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined ML_NAVEGADOR (
  echo Nao foi encontrado Google Chrome ou Microsoft Edge.
  echo Instale um deles e abra este atalho novamente.
  pause
  exit /b 1
)
start "" "%ML_NAVEGADOR%" --user-data-dir="%LOCALAPPDATA%\MineiroLanches\Impressao" --no-first-run --kiosk-printing --app="https://mineirolanches.store/painel/"
endlocal
