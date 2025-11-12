# Руководство по использованию новых модулей обработчиков

## Обзор

В рамках рефакторинга были созданы новые модули обработчиков для лучшей организации кода:

- `chat-handlers.js` - обработка чата
- `ui-handlers.js` - обработка UI событий
- `friends-handlers.js` - обработка друзей

## Использование в app.js

### 1. Импорт модулей

```javascript
import { ChatHandlers } from './app/chat-handlers.js';
import { UIHandlers } from './app/ui-handlers.js';
import { FriendsHandlers } from './app/friends-handlers.js';
```

### 2. Инициализация обработчиков

```javascript
// После инициализации всех менеджеров
const chatHandlers = new ChatHandlers(state, ui, chat);
chatHandlers.init();

const uiHandlers = new UIHandlers(
  state, 
  ui, 
  devices, 
  webrtc, 
  speechDetector, 
  updateSpeechDetectorCallback
);
uiHandlers.init();
uiHandlers.setLoadRoomsListCallback(() => loadRoomsList());
uiHandlers.setLoadFriendsCallback(() => friendsManager.loadFriends());
uiHandlers.setLoadNotificationsCallback(() => friendsManager.loadNotifications());

const friendsHandlers = new FriendsHandlers(state, ui, friendsManager, roomHandlers);
friendsHandlers.init();
```

### 3. Обновление ссылок

Если чат или друзья инициализируются позже, обновите ссылки:

```javascript
chatHandlers.setChat(chat);
friendsHandlers.setFriendsManager(friendsManager);
```

## Унифицированная обработка ошибок

Все модули теперь используют `error-handler` для обработки ошибок:

```javascript
import { errorHandler, ErrorCodes } from '../modules/error-handler.js';

try {
  // код
} catch (error) {
  errorHandler.handle(error, { operation: 'operationName', context: 'value' });
}

// Для ошибок без показа уведомления
errorHandler.handleSilent(error, { operation: 'operationName' });
```

## Тесты

Добавлены тесты для критических модулей:

- `webrtc.test.js` - тесты для WebRTCManager
- `chat.test.js` - тесты для ChatManager
- `firebase.test.js` - тесты для функций Firebase

Запуск тестов:
```bash
cd resources/app
npm test
```

## Преимущества

1. **Модульность** - код разделен на логические модули
2. **Переиспользование** - обработчики можно использовать в разных местах
3. **Тестируемость** - модули легко тестировать изолированно
4. **Поддерживаемость** - код легче понимать и изменять
5. **Единообразная обработка ошибок** - все ошибки обрабатываются через error-handler

