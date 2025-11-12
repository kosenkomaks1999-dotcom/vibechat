@echo off
chcp 65001 >nul
echo ========================================
echo   ПРИНУДИТЕЛЬНАЯ ОЧИСТКА И ЗАПУСК
echo ========================================
echo.

REM Закрываем все процессы VibeChat
echo [1/5] Закрываем все процессы VibeChat...
taskkill /F /IM VibeChat.exe 2>nul
timeout /t 3 /nobreak >nul

REM Очищаем кэш Electron в APPDATA
echo [2/5] Очищаем кэш в APPDATA...
if exist "%APPDATA%\VibeChat" (
    rmdir /S /Q "%APPDATA%\VibeChat"
    echo ✓ Удалено: %APPDATA%\VibeChat
)

REM Очищаем кэш в LOCALAPPDATA
echo [3/5] Очищаем кэш в LOCALAPPDATA...
if exist "%LOCALAPPDATA%\VibeChat" (
    rmdir /S /Q "%LOCALAPPDATA%\VibeChat"
    echo ✓ Удалено: %LOCALAPPDATA%\VibeChat
)

REM Очищаем временные файлы
echo [4/5] Очищаем временные файлы...
if exist "%TEMP%\VibeChat" (
    rmdir /S /Q "%TEMP%\VibeChat"
    echo ✓ Удалено: %TEMP%\VibeChat
)

echo [5/5] Запускаем VibeChat...
echo.
echo ========================================
echo   КЭШИ ПОЛНОСТЬЮ ОЧИЩЕНЫ
echo ========================================
echo.
echo Запускаем приложение...
echo.

REM Запускаем VibeChat
start "" "%~dp0VibeChat.exe"

echo ✓ VibeChat запущен!
echo.
echo ВАЖНО: Проверьте версию в консоли (кнопка 📟):
echo Должно быть: "🚀 VibeChat 1.1.0-performance-fix-v2"
echo.
timeout /t 3 /nobreak >nul
