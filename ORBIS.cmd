@echo off
rem Двойной клик — собрать и запустить ORBIS (лаунчер).
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if exist "%~dp0tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"

if not exist "node_modules\electron" (
  echo [ORBIS] Устанавливаю зависимости...
  call npm install || goto :fail
)
if not exist "public\assets\map\world.json" (
  echo [ORBIS] Скачиваю открытые данные карты...
  call npm run data:download || goto :fail
  echo [ORBIS] Запекаю карту...
  call npm run data:bake || goto :fail
)
echo [ORBIS] Сборка...
call npm run build || goto :fail
start "" "node_modules\.bin\electron.cmd" .
goto :eof

:fail
echo [ORBIS] Ошибка запуска.
pause
