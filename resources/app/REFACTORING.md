# Рефакторинг VibeChat

## Обзор изменений

Проект был рефакторен для улучшения поддерживаемости, тестируемости и структуры кода.

## Новые модули

### 1. Система обработки ошибок (`src/utils/error-handler.js`)

Централизованная система обработки ошибок с:
- Классом `AppError` для типизированных ошибок
- Классом `ErrorHandler` для обработки ошибок
- Кодами ошибок (`ERROR_CODES`)
- Автоматическим логированием
- Показом ошибок пользователю

**Использование:**
```javascript
import { errorHandler, ERROR_CODES } from './utils/error-handler.js';

try {
  // код
} catch (error) {
  errorHandler.handle(error, { context: 'value' }, { showToUser: true });
}
```

### 2. Модуль состояния приложения (`src/app/state.js`)

Централизованное хранилище состояния приложения:
- `AppState` класс для управления состоянием
- Глобальный экземпляр `appState`
- Методы для проверки состояния (isAuthenticated, isInRoom и т.д.)

**Использование:**
```javascript
import { appState } from './app/state.js';

appState.db = db;
appState.myNick = 'username';
if (appState.isAuthenticated()) {
  // код
}
```

### 3. Обработчики событий (`src/app/handlers/`)

Разделение обработчиков событий по категориям:
- `auth-handlers.js` - обработчики авторизации
- `room-handlers.js` - обработчики комнат (планируется)
- `chat-handlers.js` - обработчики чата (планируется)

**Использование:**
```javascript
import { setupAuthHandlers } from './app/handlers/auth-handlers.js';

setupAuthHandlers({
  ui,
  authManager,
  db,
  auth,
  onAuthSuccess: () => { /* код */ }
});
```

### 4. Модуль жизненного цикла (`src/app/lifecycle.js`)

Управление жизненным циклом приложения:
- `initApp()` - инициализация приложения
- `showAuth()` - показ окна авторизации
- `hideSplashAndShow()` - скрытие splash screen
- `cleanup()` - очистка ресурсов

**Использование:**
```javascript
import { initApp, showAuth } from './app/lifecycle.js';

await initApp({
  ui,
  db,
  authManager,
  chat,
  onInitComplete: () => { /* код */ }
});
```

## Тестирование

Добавлена поддержка Jest для unit-тестирования:
- Настроен Jest с поддержкой ES модулей
- Созданы тесты для критических модулей
- Добавлены скрипты для запуска тестов

**Запуск тестов:**
```bash
npm test
npm run test:watch
npm run test:coverage
```

## Миграция

### Старый код:
```javascript
// В app.js
let myNick = 'Player';
let muted = false;
// ... много переменных состояния

try {
  // код
} catch (error) {
  console.error(error);
  alert('Ошибка');
}
```

### Новый код:
```javascript
// Использование appState
import { appState } from './app/state.js';
appState.myNick = 'Player';
appState.muted = false;

// Использование errorHandler
import { errorHandler } from './utils/error-handler.js';
try {
  // код
} catch (error) {
  errorHandler.handle(error, { context }, { showToUser: true });
}
```

## Преимущества рефакторинга

1. **Лучшая организация кода**: Разделение на модули по ответственности
2. **Тестируемость**: Модули можно тестировать изолированно
3. **Переиспользование**: Модули можно использовать в разных местах
4. **Поддерживаемость**: Легче находить и исправлять ошибки
5. **Типобезопасность**: Централизованные ошибки с кодами
6. **Логирование**: Автоматическое логирование всех ошибок

## Следующие шаги

1. ✅ Создать систему обработки ошибок
2. ✅ Создать модуль состояния
3. ✅ Создать обработчики авторизации
4. ✅ Создать модуль жизненного цикла
5. ✅ Настроить Jest
6. ✅ Написать тесты для критических модулей
7. ⏳ Продолжить рефакторинг app.js (разделить на более мелкие модули)
8. ⏳ Добавить тесты для остальных модулей
9. ⏳ Создать обработчики для комнат и чата

## Обратная совместимость

Все изменения обратно совместимы. Старый код продолжает работать, но рекомендуется постепенно мигрировать на новые модули.

## Документация

- [TESTING.md](./TESTING.md) - Документация по тестированию
- [README.md](./README.md) - Основная документация

