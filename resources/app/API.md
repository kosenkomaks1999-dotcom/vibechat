# VibeChat API Документация

Подробная документация API модулей VibeChat.

## Содержание

- [AuthManager](#authmanager)
- [ChatManager](#chatmanager)
- [WebRTCManager](#webrtcmanager)
- [FriendsManager](#friendsmanager)
- [UIManager](#uimanager)
- [Утилиты](#утилиты)

---

## AuthManager

Класс для управления авторизацией пользователей.

### Конструктор

```javascript
const authManager = new AuthManager(auth);
```

**Параметры:**
- `auth` (FirebaseAuth) - Экземпляр Firebase Auth

### Методы

#### signIn(email, password, getEmailByNicknameFn?)

Вход пользователя в систему.

```javascript
const result = await authManager.signIn('user@example.com', 'password');
// или по никнейму
const result = await authManager.signIn('username', 'password', getEmailByNicknameFn);
```

**Параметры:**
- `email` (string) - Email или никнейм пользователя
- `password` (string) - Пароль
- `getEmailByNicknameFn?` (Function) - Опциональная функция для получения email по никнейму

**Возвращает:**
```javascript
{
  success: boolean,
  user?: User,
  error?: string
}
```

#### signUp(email, password)

Регистрация нового пользователя.

```javascript
const result = await authManager.signUp('user@example.com', 'password');
```

**Параметры:**
- `email` (string) - Email пользователя
- `password` (string) - Пароль (минимум 6 символов)

**Возвращает:**
```javascript
{
  success: boolean,
  user?: User,
  error?: string
}
```

#### signOut()

Выход пользователя из системы.

```javascript
await authManager.signOut();
```

**Возвращает:** `Promise<void>`

#### getCurrentUser()

Получить текущего авторизованного пользователя.

```javascript
const user = authManager.getCurrentUser();
```

**Возвращает:** `User | null`

#### onAuthStateChanged(callback)

Подписка на изменения состояния авторизации.

```javascript
authManager.onAuthStateChanged((user) => {
  if (user) {
    console.log('Пользователь авторизован:', user.email);
  } else {
    console.log('Пользователь не авторизован');
  }
});
```

**Параметры:**
- `callback` (Function) - Функция обратного вызова `(user: User | null) => void`

**Возвращает:** `Function` - Функция для отписки

---

## ChatManager

Класс для управления чатом и сообщениями.

### Конструктор

```javascript
const chat = new ChatManager(roomRef, myNickname, myUserId, db);
```

**Параметры:**
- `roomRef` (DatabaseReference) - Ссылка на комнату в Firebase
- `myNickname` (string) - Никнейм текущего пользователя
- `myUserId` (string) - ID текущего пользователя
- `db` (Database) - Экземпляр Firebase Database

### Методы

#### initElements(chatMessages, chatInput, fileInput)

Инициализация DOM элементов для чата.

```javascript
chat.initElements(
  document.getElementById('chatMessages'),
  document.getElementById('chatInput'),
  document.getElementById('fileInput')
);
```

**Параметры:**
- `chatMessages` (HTMLElement) - Контейнер для сообщений
- `chatInput` (HTMLElement) - Поле ввода сообщения
- `fileInput` (HTMLElement) - Input для файлов

#### sendMessage(showToast)

Отправка сообщения в чат.

```javascript
await chat.sendMessage((message) => {
  console.log(message);
});
```

**Параметры:**
- `showToast` (Function) - Функция для показа уведомлений `(message: string) => void`

**Возвращает:** `Promise<void>`

#### attachFile(file, showToast)

Прикрепление файла к сообщению.

```javascript
const file = fileInput.files[0];
const success = await chat.attachFile(file, (message) => {
  console.log(message);
});
```

**Параметры:**
- `file` (File) - Файл для прикрепления
- `showToast` (Function) - Функция для показа уведомлений

**Возвращает:** `Promise<boolean>`

**Поддерживаемые типы файлов:**
- Изображения: PNG, JPEG, GIF, WebP
- Аудио: MP3, WAV, OGG, M4A, WebM
- Видео: MP4, WebM, OGG

#### displayMessage(message)

Отображение сообщения в чате.

```javascript
await chat.displayMessage({
  author: 'Username',
  text: 'Hello!',
  timestamp: Date.now(),
  userId: 'user-123'
});
```

**Параметры:**
- `message` (Object) - Объект сообщения
  - `author` (string) - Автор сообщения
  - `text` (string) - Текст сообщения
  - `timestamp` (number) - Временная метка
  - `userId` (string) - ID пользователя
  - `file?` (Object) - Файл (опционально)

#### clear()

Очистка чата.

```javascript
chat.clear();
```

#### removeFile()

Удаление прикрепленного файла.

```javascript
chat.removeFile();
```

---

## WebRTCManager

Класс для управления WebRTC соединениями.

### Конструктор

```javascript
const webrtc = new WebRTCManager(roomRef, myId, onStreamReceived);
```

**Параметры:**
- `roomRef` (DatabaseReference) - Ссылка на комнату
- `myId` (string) - ID текущего пользователя
- `onStreamReceived` (Function) - Callback при получении потока

### Методы

#### initMicrophone(deviceId?, muted?)

Инициализация микрофона.

```javascript
const stream = await webrtc.initMicrophone('device-id', false);
```

**Параметры:**
- `deviceId?` (string) - ID устройства микрофона
- `muted?` (boolean) - Начальное состояние микрофона

**Возвращает:** `Promise<MediaStream>`

#### createPeer(otherId, initiator)

Создание P2P соединения с другим пользователем.

```javascript
webrtc.createPeer('user-123', true);
```

**Параметры:**
- `otherId` (string) - ID другого пользователя
- `initiator` (boolean) - Инициирует ли это соединение

#### toggleMute(muted)

Переключение состояния микрофона.

```javascript
webrtc.toggleMute(true); // Выключить микрофон
```

**Параметры:**
- `muted` (boolean) - Новое состояние микрофона

#### toggleSpeaker()

Переключение состояния динамиков.

```javascript
const isMuted = webrtc.toggleSpeaker();
```

**Возвращает:** `boolean` - Новое состояние динамиков

#### setUserVolume(userId, volume)

Установка громкости для пользователя.

```javascript
webrtc.setUserVolume('user-123', 0.5); // 50% громкости
```

**Параметры:**
- `userId` (string) - ID пользователя
- `volume` (number) - Громкость (0-1)

#### cleanup()

Очистка всех соединений и ресурсов.

```javascript
webrtc.cleanup();
```

---

## FriendsManager

Класс для управления системой друзей.

### Конструктор

```javascript
const friendsManager = new FriendsManager(db, authManager, ui, userId);
```

**Параметры:**
- `db` (Database) - Firebase Database
- `authManager` (AuthManager) - Менеджер авторизации
- `ui` (UIManager) - Менеджер UI
- `userId` (string) - ID текущего пользователя

### Методы

#### loadFriends()

Загрузка списка друзей.

```javascript
await friendsManager.loadFriends();
```

**Возвращает:** `Promise<void>`

#### sendFriendRequest(nickname)

Отправка запроса в друзья.

```javascript
const result = await friendsManager.sendFriendRequest('username');
```

**Параметры:**
- `nickname` (string) - Никнейм пользователя

**Возвращает:**
```javascript
{
  success: boolean,
  error?: string
}
```

#### acceptFriendRequest(friendId)

Принятие запроса в друзья.

```javascript
const result = await friendsManager.acceptFriendRequest('user-123');
```

**Параметры:**
- `friendId` (string) - ID друга

**Возвращает:**
```javascript
{
  success: boolean,
  error?: string
}
```

#### rejectFriendRequest(friendId)

Отклонение запроса в друзья.

```javascript
const result = await friendsManager.rejectFriendRequest('user-123');
```

**Параметры:**
- `friendId` (string) - ID друга

**Возвращает:**
```javascript
{
  success: boolean,
  error?: string
}
```

#### loadNotifications()

Загрузка уведомлений.

```javascript
await friendsManager.loadNotifications();
```

**Возвращает:** `Promise<void>`

---

## UIManager

Класс для управления UI элементами.

### Конструктор

```javascript
const ui = new UIManager();
```

### Методы

#### showToast(message, duration?, type?)

Показ уведомления.

```javascript
ui.showToast('Сообщение', 3000, 'success');
```

**Параметры:**
- `message` (string) - Текст сообщения
- `duration?` (number) - Длительность в мс (по умолчанию 3000)
- `type?` (string) - Тип: 'success', 'error', 'info' (по умолчанию 'info')

#### showConfirm(message)

Показ диалога подтверждения.

```javascript
const confirmed = await ui.showConfirm('Вы уверены?');
if (confirmed) {
  // Действие подтверждено
}
```

**Параметры:**
- `message` (string) - Текст сообщения

**Возвращает:** `Promise<boolean>`

#### updateMuteButton(muted)

Обновление состояния кнопки микрофона.

```javascript
ui.updateMuteButton(true);
```

**Параметры:**
- `muted` (boolean) - Состояние микрофона

---

## Утилиты

### DOM Cache

Кэширование DOM элементов для оптимизации.

```javascript
import { getElementById, getElementsByIds } from './utils/dom-cache.js';

// Получить один элемент
const element = getElementById('myElement');

// Получить несколько элементов
const elements = getElementsByIds(['id1', 'id2', 'id3']);
```

### Lazy Loader

Lazy loading модулей.

```javascript
import { loadModule, preloadModule } from './utils/lazy-loader.js';

// Загрузка по требованию
const module = await loadModule('./modules/my-module.js');

// Предзагрузка
await preloadModule('./modules/my-module.js');
```

### File Security

Проверка безопасности файлов.

```javascript
import { validateFile, detectFileType, getFileInfo } from './utils/file-security.js';

// Проверка файла
const validation = await validateFile(file, {
  allowedTypes: ['image/png', 'image/jpeg'],
  maxSize: 10 * 1024 * 1024,
  strictTypeCheck: true
});

if (!validation.valid) {
  console.error(validation.error);
}

// Определение типа файла
const fileType = await detectFileType(file);

// Получение информации о файле
const info = await getFileInfo(file);
console.log(info);
// {
//   name: 'image.png',
//   size: 1024000,
//   declaredType: 'image/png',
//   detectedType: 'image/png',
//   typeMatches: true,
//   sizeFormatted: '1 MB'
// }
```

### Security

Валидация и безопасность.

```javascript
import { escapeHtml, validateNicknameLength, validateNicknameFormat } from './utils/security.js';

// Экранирование HTML
const safe = escapeHtml('<script>alert("XSS")</script>');

// Валидация никнейма
const isValidLength = validateNicknameLength('username', 15);
const isValidFormat = validateNicknameFormat('username');
```

---

## Примеры использования

### Полный пример создания комнаты и отправки сообщения

```javascript
import { RoomHandlers } from './app/room-handlers.js';
import { ChatHandlers } from './app/chat-handlers.js';
import { ChatManager } from './modules/chat.js';

// Создание комнаты
const roomHandlers = new RoomHandlers(state, ui, authManager, db, ...);
await roomHandlers.createRoomWithName('room-123', 'My Room');

// Инициализация чата
const chat = new ChatManager(roomRef, 'MyNickname', userId, db);
chat.initElements(chatMessages, chatInput, fileInput);

// Обработчики чата
const chatHandlers = new ChatHandlers(state, ui, chat);
chatHandlers.init();

// Отправка сообщения
chatHandlers.sendMessage();
```

### Пример работы с друзьями

```javascript
import { FriendsManager } from './modules/friends.js';
import { FriendsHandlers } from './app/friends-handlers.js';

// Инициализация менеджера друзей
const friendsManager = new FriendsManager(db, authManager, ui, userId);
await friendsManager.loadFriends();

// Обработчики друзей
const friendsHandlers = new FriendsHandlers(state, ui, friendsManager, roomHandlers);
friendsHandlers.init();

// Отправка запроса в друзья
await friendsHandlers.handleAddFriend();
```

---

**Версия документации:** 1.0.0  
**Последнее обновление:** 2025-01-08

