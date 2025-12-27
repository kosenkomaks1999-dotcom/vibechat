# Карта зависимостей модуля RoomsManager

## 📦 Внешние зависимости (что нужно передать в конструктор)

### Обязательные зависимости:
1. **db** - Firebase database instance
2. **authManager** - AuthManager instance (для получения текущего пользователя)
3. **ui** - UIManager instance (для toast, модальных окон, обновления UI)
4. **webrtc** - WebRTCManager instance
5. **chat** - ChatManager instance (может быть null, будет создан)
6. **devices** - DevicesManager instance
7. **usersManager** - UsersManager instance
8. **speechDetector** - SpeechDetector instance
9. **connectionManager** - ConnectionManager instance (может быть null)
10. **logger** - Logger instance

### Утилиты и функции:
- **playNotificationSound** - функция для звуков
- **CONSTANTS** - константы приложения
- **roomsCache** - RoomsCache instance
- **listenersManager** - FirebaseListenersManager instance

### Firebase функции (из firebase.js):
- getRoomRef
- createUserInRoom
- updateUserMuteStatus
- updateUserSpeakerStatus
- clearRoomMessages
- generateUniqueRoomId
- roomExists
- createRoomWithName (as createRoomWithNameFirebase)
- getRoomsList
- getRoomInfo
- deleteRoomById
- isRoomCreator

---

## 🔄 Состояние (state) которое нужно управлять

### Переменные состояния комнаты:
```javascript
roomRef = null              // Firebase reference к текущей комнате
myUserRef = null            // Firebase reference к текущему пользователю в комнате
myId = null                 // Push ID пользователя в комнате
myNick = ''                 // Никнейм пользователя
muted = false               // Состояние микрофона
joined = false              // Флаг нахождения в комнате
joinLock = false            // Блокировка повторного входа
previousUsersCount = 0      // Предыдущее количество участников
intentionalLeave = false    // Флаг намеренного выхода
currentRoomId = null        // ID текущей комнаты
isReconnecting = false      // Флаг процесса переподключения
reconnectAttempts = 0       // Счетчик попыток переподключения
MAX_RECONNECT_ATTEMPTS = 3  // Максимум попыток
```

### Таймеры и слушатели:
```javascript
updateRoomsListTimeout = null   // Таймер обновления списка
usersUpdateTimeout = null       // Таймер debounce пользователей
roomsUpdateTimeout = null       // Таймер debounce комнат
heartbeatInterval = null        // Интервал heartbeat
roomsListener = null            // Слушатель изменений комнат
isInitialLoad = false           // Флаг начальной загрузки
roomsListInitialized = false    // Флаг инициализации списка
```

---

## 📤 Публичные методы (API модуля)

### Управление комнатами:
1. **createRoom(roomId, roomName)** - создать комнату
2. **joinRoom(roomId)** - войти в комнату
3. **leaveRoom()** - выйти из комнаты
4. **forceLeaveRoom(showNotification, customMessage)** - принудительный выход

### Работа со списком:
5. **loadRoomsList(force)** - загрузить список комнат
6. **renderRoomsList(rooms)** - отрисовать список
7. **startRoomsListener()** - запустить слушатель изменений
8. **stopRoomsListener()** - остановить слушатель

### Модальные окна:
9. **showCreateRoomModal()** - показать окно создания
10. **showFindRoomModal()** - показать окно поиска

### Утилиты:
11. **getCurrentRoomId()** - получить ID текущей комнаты
12. **isInRoom()** - проверка нахождения в комнате
13. **getRoomRef()** - получить Firebase ref комнаты
14. **cleanup()** - очистка ресурсов

---

## 🔗 Взаимодействие с другими модулями

### WebRTC:
- `webrtc.initMicrophone(deviceId, muted)` - инициализация микрофона
- `webrtc.applySpeakerSelection(deviceId)` - применение динамиков
- `webrtc.roomRef = roomRef` - установка ссылки на комнату
- `webrtc.myId = myId` - установка ID пользователя
- `webrtc.setUserVolume(userId, volume)` - установка громкости
- `webrtc.handleSignal(data)` - обработка WebRTC сигналов
- `webrtc.cleanup()` - очистка при выходе

### Chat:
- `chat.roomRef = roomRef` - установка ссылки на комнату
- `chat.myNickname = myNick` - установка никнейма
- `chat.clear()` - очистка чата
- `chat.displayMessage(message)` - отображение сообщения
- Создание нового ChatManager если null

### UI:
- `ui.showToast(message, duration, type)` - уведомления
- `ui.updateJoinButton(joined)` - обновление кнопки
- `ui.updateRoomId(roomId)` - отображение ID комнаты
- `ui.updateUsersCount(count)` - счетчик участников
- `ui.elements.*` - доступ к DOM элементам

### UsersManager:
- `usersManager.updateUsersList(users, callback, myId)` - обновление списка
- `usersManager.clear()` - очистка списка
- `usersManager.markSpeaking(userId)` - индикация речи
- `usersManager.markNotSpeaking(userId)` - снятие индикации

### SpeechDetector:
- `speechDetector.setMyId(myId)` - установка ID
- `speechDetector.updateUserMutedStates(users)` - обновление состояний
- `speechDetector.startDetection()` - запуск детектора
- `speechDetector.stopDetection()` - остановка детектора

### ConnectionManager:
- `connectionManager.cleanup()` - очистка
- `connectionManager.init()` - инициализация

### Devices:
- `devices.getSelectedMicId()` - получение ID микрофона
- `devices.getSelectedSpeakerId()` - получение ID динамиков

### AuthManager:
- `authManager.getCurrentUser()` - получение текущего пользователя
- Используется для получения userId и email

### Logger:
- `logger.logRoom(action, message, data)` - логирование действий

---

## 🎯 События которые нужно эмитить

### События для app.js:
1. **room-joined** - вход в комнату успешен
   - payload: { roomId, roomName, usersCount }

2. **room-left** - выход из комнаты
   - payload: { roomId, reason }

3. **room-created** - комната создана
   - payload: { roomId, roomName }

4. **users-changed** - изменение участников
   - payload: { count, users }

5. **room-error** - ошибка с комнатой
   - payload: { error, roomId }

---

## 🔧 Функции которые останутся в app.js

### Heartbeat:
- `startHeartbeat()` - запуск heartbeat
- `stopHeartbeat()` - остановка heartbeat

### Reconnect:
- `attemptReconnect()` - попытка переподключения

### Listeners:
- `setupListeners()` - установка слушателей Firebase
  - users listener
  - signals listener  
  - messages listener

### Update функции:
- `updateSpeechDetector()` - обновление детектора речи

---

## 📋 План рефакторинга

### Шаг 1: Создать класс RoomsManager
- Конструктор с зависимостями
- Приватные поля для состояния
- Публичные методы

### Шаг 2: Перенести функции
- showCreateRoomModal → showCreateModal()
- createRoomWithName → createRoom()
- findAndJoinRoom → joinRoom()
- leaveRoom → leaveRoom()
- forceLeaveRoom → forceLeave()
- loadRoomsList → loadList()
- renderRoomsList → renderList()
- startRoomsListener → startListener()
- stopRoomsListener → stopListener()
- showRoomContextMenu → showContextMenu()

### Шаг 3: Перенести обработчики событий
- Кнопки создания/поиска комнаты
- Модальные окна
- Контекстное меню

### Шаг 4: Интеграция в app.js
- Создать экземпляр RoomsManager
- Подписаться на события
- Заменить прямые вызовы функций на методы класса

### Шаг 5: Тестирование
- Создание комнаты
- Вход в комнату
- Выход из комнаты
- Список комнат
- Переподключение

---

## ⚠️ Критические моменты

1. **Состояние joined** - должно быть доступно из app.js
2. **roomRef** - нужен для других модулей (webrtc, chat)
3. **myId** - используется в webrtc и speechDetector
4. **Слушатели Firebase** - правильная отписка при выходе
5. **Heartbeat** - должен работать корректно
6. **Переподключение** - не должно сломаться
7. **UI элементы** - доступ через ui.elements
8. **Таймеры** - правильная очистка
9. **Кэш комнат** - синхронизация с Firebase
10. **Звуки** - воспроизведение при событиях
