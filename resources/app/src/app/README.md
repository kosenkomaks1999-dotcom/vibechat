# Модули приложения

Эта папка содержит рефакторенные модули приложения для лучшей организации кода.

## Структура

```
app/
  state.js           # Управление состоянием приложения
  lifecycle.js       # Жизненный цикл приложения
  handlers/          # Обработчики событий
    auth-handlers.js # Обработчики авторизации
```

## Использование

### State (Состояние)

```javascript
import { appState } from './app/state.js';

// Установка состояния
appState.db = db;
appState.myNick = 'username';

// Проверка состояния
if (appState.isAuthenticated()) {
  // код
}
```

### Lifecycle (Жизненный цикл)

```javascript
import { initApp, showAuth, hideSplashAndShow, cleanup } from './app/lifecycle.js';

// Инициализация приложения
await initApp({
  ui,
  db,
  authManager,
  chat,
  onInitComplete: () => {
    console.log('Приложение инициализировано');
  }
});

// Показ авторизации
showAuth(ui);

// Очистка ресурсов
await cleanup({ db, authManager });
```

### Handlers (Обработчики)

```javascript
import { setupAuthHandlers } from './app/handlers/auth-handlers.js';

setupAuthHandlers({
  ui,
  authManager,
  db,
  auth,
  onAuthSuccess: () => {
    initApp({ ui, db, authManager, chat });
  }
});
```

## Интеграция с существующим кодом

Новые модули можно использовать постепенно. Они полностью совместимы со старым кодом.

### Пример интеграции в app.js

```javascript
import { appState } from './app/state.js';
import { initApp, showAuth } from './app/lifecycle.js';
import { setupAuthHandlers } from './app/handlers/auth-handlers.js';
import { errorHandler } from './utils/error-handler.js';

// Инициализация Firebase
try {
  const firebaseInit = initFirebase();
  appState.db = firebaseInit.database;
  appState.auth = firebaseInit.auth;
  appState.authManager = new AuthManager(appState.auth);
} catch (error) {
  errorHandler.handle(error, { action: 'initFirebase' }, { showToUser: true });
  return;
}

// Настройка обработчиков авторизации
setupAuthHandlers({
  ui,
  authManager: appState.authManager,
  db: appState.db,
  auth: appState.auth,
  onAuthSuccess: () => {
    initApp({
      ui,
      db: appState.db,
      authManager: appState.authManager,
      chat,
      onInitComplete: () => {
        // Инициализация завершена
      }
    });
  }
});
```

## Преимущества

1. **Модульность**: Код разделен на логические модули
2. **Тестируемость**: Каждый модуль можно тестировать отдельно
3. **Переиспользование**: Модули можно использовать в разных местах
4. **Поддерживаемость**: Легче находить и исправлять ошибки
5. **Централизация**: Состояние и логика сосредоточены в одном месте

