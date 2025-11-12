@echo off
echo ========================================
echo   ОЧИСТКА КЭША VIBECHAT
echo ========================================
echo.

REM Закрываем процесс VibeChat
echo [1/4] Закрываем VibeChat...
taskkill /F /IM VibeChat.exe 2>nul
timeout /t 2 /nobreak >nul

REM Очищаем кэш Electron
echo [2/4] Очищаем кэш Electron...
if exist "%APPDATA%\VibeChat" (
    rmdir /S /Q "%APPDATA%\VibeChat"
    echo Кэш удален: %APPDATA%\VibeChat
) else (
    echo Кэш не найден
)

REM Очищаем временные файлы
echo [3/4] Очищаем временные файлы...
if exist "%TEMP%\VibeChat" (
    rmdir /S /Q "%TEMP%\VibeChat"
    echo Временные файлы удалены
)

echo [4/4] Готово!
echo.
echo ========================================
echo   КЭШИ ОЧИЩЕНЫ
echo ========================================
echo.
echo Теперь запустите VibeChat.exe
echo.
pause
