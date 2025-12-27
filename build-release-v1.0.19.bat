@echo off
echo ========================================
echo   VibeChat v1.0.19 Release Builder
echo   КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ - Heartbeat
echo ========================================
echo.

echo [1/6] Проверка версии в package.json...
findstr "1.0.19" package.json >nul
if %errorlevel% neq 0 (
    echo ОШИБКА: Версия в package.json не обновлена до 1.0.19!
    pause
    exit /b 1
)
echo ✅ Версия в package.json: 1.0.19

echo.
echo [2/6] Проверка версии в app.js...
findstr "1.0.19" resources\app\src\app.js >nul
if %errorlevel% neq 0 (
    echo ОШИБКА: Версия в app.js не обновлена до 1.0.19!
    pause
    exit /b 1
)
echo ✅ Версия в app.js: 1.0.19

echo.
echo [3/6] Очистка старых сборок...
if exist "release\VibeChat-Setup-1.0.19.exe" (
    del "release\VibeChat-Setup-1.0.19.exe"
    echo ✅ Удален старый файл сборки
)

echo.
echo [4/6] Установка зависимостей...
call npm install
if %errorlevel% neq 0 (
    echo ОШИБКА: Не удалось установить зависимости!
    pause
    exit /b 1
)
echo ✅ Зависимости установлены

echo.
echo [5/6] Сборка приложения для Windows...
call npm run build:win
if %errorlevel% neq 0 (
    echo ОШИБКА: Сборка не удалась!
    pause
    exit /b 1
)

echo.
echo [6/6] Проверка результата сборки...
if exist "release\VibeChat-Setup-1.0.19.exe" (
    echo ✅ Сборка успешна!
    echo.
    echo 📦 Файл создан: release\VibeChat-Setup-1.0.19.exe
    
    for %%A in ("release\VibeChat-Setup-1.0.19.exe") do (
        echo 📏 Размер файла: %%~zA байт
    )
    
    echo.
    echo ========================================
    echo   🎉 РЕЛИЗ v1.0.19 ГОТОВ!
    echo ========================================
    echo.
    echo 📋 Следующие шаги:
    echo 1. Протестируйте установку
    echo 2. Проверьте работу heartbeat в консоли
    echo 3. Создайте коммит и тег
    echo 4. Запушьте в GitHub
    echo 5. Создайте релиз на GitHub
    echo.
    echo 🔧 Команды для Git:
    echo git add .
    echo git commit -m "Release v1.0.19: КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ - Heartbeat"
    echo git tag -a v1.0.19 -m "Release v1.0.19 - Heartbeat fix"
    echo git push origin main
    echo git push origin v1.0.19
    echo.
) else (
    echo ❌ ОШИБКА: Файл сборки не найден!
    echo Проверьте логи выше для диагностики проблемы.
    pause
    exit /b 1
)

echo Нажмите любую клавишу для завершения...
pause >nul