@echo off
rem Двойной клик — собрать игру, обновить установленную копию (ярлык «Passionaris» на рабочем столе и в меню «Пуск»)
rem и запустить её. Дальше игру можно запускать прямо с ярлыка.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if exist "%~dp0tools\node\node.exe" set "PATH=%~dp0tools\node;%PATH%"

if not exist "node_modules\electron" (
  echo [Passionaris] Устанавливаю зависимости...
  call npm install || goto :fail
)
if not exist "public\assets\map\world.json" (
  echo [Passionaris] Скачиваю открытые данные карты...
  call npm run data:download || goto :fail
  echo [Passionaris] Запекаю карту...
  call npm run data:bake || goto :fail
)
echo [Passionaris] Сборка...
call npm run build || goto :fail
echo [Passionaris] Обновляю установленную копию и ярлыки...
call node scripts\install-local.mjs || goto :fail
start "" "%LOCALAPPDATA%\Programs\Passionaris\Passionaris.exe"
goto :eof

:fail
echo [Passionaris] Ошибка запуска.
pause
