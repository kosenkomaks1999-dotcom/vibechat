/**
 * Модуль для работы с Firebase
 * Управляет подключением к Firebase и операциями с базой данных
 */

import { errorHandler } from './error-handler.js';

/**
 * Инициализирует Firebase с конфигурацией
 * @returns {Object} Объект с database и auth
 */
export function initFirebase() {
  if (!window.firebaseConfig) {
    throw new Error('Firebase configuration not found! Please create config/firebase.config.js');
  }
  
  const firebaseConfig = window.firebaseConfig;
  firebase.initializeApp(firebaseConfig);
  
  const database = firebase.database();
  
  // Включаем автоматическое переподключение и увеличиваем таймауты
  // Это предотвращает отключение при длительных сессиях
  database.goOnline(); // Явно включаем соединение
  
  // Настраиваем keepalive для предотвращения отключения
  // Firebase автоматически переподключается, но мы добавляем явный мониторинг
  const connectedRef = database.ref('.info/connected');
  connectedRef.on('value', (snap) => {
    if (snap.val() === true) {
      console.log('✅ Firebase connected');
    } else {
      console.log('⚠️ Firebase disconnected, reconnecting...');
      // Явно пытаемся переподключиться
      setTimeout(() => {
        database.goOnline();
      }, 1000);
    }
  });
  
  return {
    database: database,
    auth: firebase.auth(),
    storage: firebase.storage()
  };
}

/**
 * Создает ссылку на комнату
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @returns {Object} Firebase reference к комнате
 */
export function getRoomRef(db, roomId) {
  return db.ref("rooms/" + roomId);
}

/**
 * Создает пользователя в комнате
 * @param {Object} roomRef - Firebase reference к комнате
 * @param {string} nickname - Ник пользователя
 * @param {boolean} muted - Состояние микрофона
 * @param {string} userId - Firebase userId пользователя (опционально, для фильтрации комнат)
 * @returns {Object} Firebase reference к пользователю
 */
export function createUserInRoom(roomRef, nickname, muted, userId = null, speakerMuted = false) {
  try {
    const userData = { 
      nick: nickname, 
      mute: muted,
      speakerMuted: speakerMuted || false
    };
    if (userId) {
      userData.userId = userId; // Сохраняем Firebase userId для фильтрации комнат
    }
    console.log('🔵 createUserInRoom: создание записи пользователя', { nickname, muted, speakerMuted, userId, userData });
    const userRef = roomRef.child("users").push(userData);
    console.log('✅ createUserInRoom: запись пользователя создана', userRef.key);
    return userRef;
  } catch (error) {
    errorHandler.handle(error, { operation: 'createUserInRoom', nickname, userId });
    throw error;
  }
}

/**
 * Обновляет состояние микрофона пользователя
 * @param {Object} userRef - Firebase reference к пользователю
 * @param {boolean} muted - Состояние микрофона
 */
export function updateUserMuteStatus(userRef, muted) {
  if (userRef) {
    userRef.update({ mute: muted });
  }
}

/**
 * Обновляет состояние динамиков пользователя
 * @param {Object} userRef - Firebase reference к пользователю
 * @param {boolean} speakerMuted - Состояние динамиков
 */
export function updateUserSpeakerStatus(userRef, speakerMuted) {
  if (userRef) {
    userRef.update({ speakerMuted: speakerMuted });
  }
}

/**
 * Отправляет сообщение в комнату
 * @param {Object} roomRef - Firebase reference к комнате
 * @param {Object} messageData - Данные сообщения
 * @returns {Promise} Promise отправки сообщения
 */
export function sendMessage(roomRef, messageData) {
  return roomRef.child("messages").push(messageData);
}

/**
 * Отправляет WebRTC сигнал
 * @param {Object} roomRef - Firebase reference к комнате
 * @param {string} fromId - ID отправителя
 * @param {string} toId - ID получателя
 * @param {Object} signal - WebRTC signal data
 */
export function sendSignal(roomRef, fromId, toId, signal) {
  if (!roomRef || !fromId) return;
  roomRef.child("signals").push({ from: fromId, to: toId, signal });
}

/**
 * Удаляет сообщения комнаты (когда комната пуста)
 * @param {Object} roomRef - Firebase reference к комнате
 */
export function clearRoomMessages(roomRef) {
  if (roomRef) {
    roomRef.child("messages").remove().catch(() => {});
  }
}

/**
 * Удаляет всю комнату (когда последний пользователь покинул)
 * @param {Object} roomRef - Firebase reference к комнате
 */
export function deleteRoom(roomRef) {
  if (roomRef) {
    roomRef.remove().catch(() => {});
  }
}

/**
 * Проверяет, занят ли никнейм
 * @param {Object} db - Firebase database reference
 * @param {string} nickname - Никнейм для проверки
 * @returns {Promise<boolean>} true если никнейм занят
 */
export async function isNicknameTaken(db, nickname) {
  try {
    const normalizedNickname = nickname.trim().toLowerCase();
    const snapshot = await db.ref(`nicknames/${normalizedNickname}`).once('value');
    return snapshot.exists();
  } catch (error) {
    errorHandler.handleSilent(error, { operation: 'isNicknameTaken', nickname });
    return false; // В случае ошибки разрешаем регистрацию
  }
}

/**
 * Резервирует никнейм за пользователем
 * @param {Object} db - Firebase database reference
 * @param {string} nickname - Никнейм
 * @param {string} userId - ID пользователя
 * @returns {Promise<void>}
 */
export async function reserveNickname(db, nickname, userId, email) {
  try {
    const normalizedNickname = nickname.trim().toLowerCase();
    await db.ref(`nicknames/${normalizedNickname}`).set(userId);
    // Сохраняем никнейм и email в профиле пользователя (email нужен для входа по никнейму)
    await db.ref(`users/${userId}/nickname`).set(nickname.trim());
    if (email) {
      await db.ref(`users/${userId}/email`).set(email);
    }
  } catch (error) {
    errorHandler.handle(error, { operation: 'reserveNickname', nickname, userId }, { code: ErrorCodes.NICKNAME_TAKEN });
    throw error;
  }
}

/**
 * Получает никнейм пользователя из Firebase
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<string|null>} Никнейм пользователя или null
 */
export async function getUserNickname(db, userId) {
  try {
    const snapshot = await db.ref(`users/${userId}/nickname`).once('value');
    return snapshot.val() || null;
  } catch (error) {
    errorHandler.handleSilent(error, { operation: 'getUserNickname', userId });
    return null;
  }
}

/**
 * Сохраняет аватар пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @param {string} avatarUrl - URL аватара (base64 или URL)
 * @returns {Promise<void>}
 */
export async function saveUserAvatar(db, userId, avatarUrl) {
  try {
    await db.ref(`users/${userId}/avatar`).set(avatarUrl);
  } catch (error) {
    errorHandler.handle(error, { operation: 'saveUserAvatar', userId }, { code: ErrorCodes.AVATAR_UPLOAD_FAILED });
    throw error;
  }
}

/**
 * Получает аватар пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<string|null>} URL аватара или null
 */
export async function getUserAvatar(db, userId) {
  try {
    const snapshot = await db.ref(`users/${userId}/avatar`).once('value');
    return snapshot.val() || null;
  } catch (error) {
    errorHandler.handleSilent(error, { operation: 'getUserAvatar', userId });
    return null;
  }
}

/**
 * Обновляет никнейм пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @param {string} oldNickname - Старый никнейм
 * @param {string} newNickname - Новый никнейм
 * @returns {Promise<void>}
 */
export async function updateUserNickname(db, userId, oldNickname, newNickname) {
  try {
    const normalizedOldNickname = oldNickname.trim().toLowerCase();
    const normalizedNewNickname = newNickname.trim().toLowerCase();
    
    // Удаляем старый никнейм
    if (normalizedOldNickname) {
      await db.ref(`nicknames/${normalizedOldNickname}`).remove();
    }
    
    // Добавляем новый никнейм
    await db.ref(`nicknames/${normalizedNewNickname}`).set(userId);
    
    // Обновляем никнейм в профиле пользователя
    await db.ref(`users/${userId}/nickname`).set(newNickname.trim());
  } catch (error) {
    errorHandler.handle(error, { operation: 'updateUserNickname', userId, oldNickname, newNickname }, { code: ErrorCodes.PROFILE_UPDATE_FAILED });
    throw error;
  }
}

/**
 * Получает email пользователя по никнейму
 * @param {Object} db - Firebase database reference
 * @param {Object} auth - Firebase auth instance
 * @param {string} nickname - Никнейм пользователя
 * @returns {Promise<string|null>} Email пользователя или null
 */
export async function getEmailByNickname(db, auth, nickname) {
  try {
    const normalizedNickname = nickname.trim().toLowerCase();
    console.log('Поиск email по никнейму:', normalizedNickname);
    
    // Получаем userId по никнейму
    const userIdSnapshot = await db.ref(`nicknames/${normalizedNickname}`).once('value');
    if (!userIdSnapshot.exists()) {
      console.log('Никнейм не найден в базе:', normalizedNickname);
      return null;
    }
    
    const userId = userIdSnapshot.val();
    console.log('Найден userId по никнейму:', userId);
    
    // Получаем email из профиля пользователя
    const userSnapshot = await db.ref(`users/${userId}/email`).once('value');
    if (userSnapshot.exists()) {
      const email = userSnapshot.val();
      console.log('Найден email по userId:', email);
      return email;
    }
    
    console.log('Email не найден в профиле пользователя для userId:', userId);
    return null;
  } catch (error) {
    errorHandler.handleSilent(error, { operation: 'getEmailByNickname', nickname });
    return null;
  }
}

/**
 * Получает userId по никнейму
 * @param {Object} db - Firebase database reference
 * @param {string} nickname - Никнейм пользователя
 * @returns {Promise<string|null>} userId или null
 */
export async function getUserIdByNickname(db, nickname) {
  try {
    if (!nickname || !nickname.trim()) {
      console.error('❌ getUserIdByNickname: пустой никнейм');
      return null;
    }
    
    const normalizedNickname = nickname.trim().toLowerCase();
    console.log('🔍 getUserIdByNickname: поиск userId для никнейма:', normalizedNickname);
    console.log('🔍 Путь в Firebase: nicknames/' + normalizedNickname);
    
    const snapshot = await db.ref(`nicknames/${normalizedNickname}`).once('value');
    
    if (snapshot.exists()) {
      const userId = snapshot.val();
      console.log('✅ getUserIdByNickname: найден userId:', userId, 'для никнейма:', normalizedNickname);
      return userId;
    } else {
      console.error('❌ getUserIdByNickname: пользователь с никнеймом не найден:', normalizedNickname);
      console.log('🔍 Проверяем все никнеймы в Firebase...');
      
      // Для отладки: проверяем все никнеймы
      const allNicknamesSnapshot = await db.ref('nicknames').once('value');
      const allNicknames = allNicknamesSnapshot.val() || {};
      console.log('🔍 Все никнеймы в Firebase:', Object.keys(allNicknames));
      
      return null;
    }
  } catch (error) {
    errorHandler.handleSilent(error, { operation: 'getUserIdByNickname', nickname });
    return null;
  }
}

/**
 * Отправляет запрос в друзья
 * @param {Object} db - Firebase database reference
 * @param {string} fromUserId - ID отправителя
 * @param {string} toUserId - ID получателя
 * @param {string} fromNickname - Никнейм отправителя
 * @returns {Promise<Object>} Результат отправки
 */
export async function sendFriendRequest(db, fromUserId, toUserId, fromNickname) {
  try {
    console.log('📤 Отправка запроса в друзья:', { fromUserId, toUserId, fromNickname });
    
    // Проверяем, не являются ли они уже друзьями
    const friendshipSnapshot = await db.ref(`friendships/${fromUserId}/${toUserId}`).once('value');
    if (friendshipSnapshot.exists()) {
      console.log('❌ Пользователи уже друзья');
      return { success: false, error: 'Вы уже друзья с этим пользователем' };
    }
    
    // Проверяем, не отправлен ли уже запрос
    // Пытаемся прочитать запрос (может не сработать из-за правил, но попробуем)
    try {
      const requestSnapshot = await db.ref(`friendRequests/${toUserId}/${fromUserId}`).once('value');
      if (requestSnapshot.exists()) {
        const existingRequest = requestSnapshot.val();
        if (existingRequest && existingRequest.status === 'pending') {
          console.log('❌ Запрос уже отправлен');
          return { success: false, error: 'Запрос уже отправлен' };
        }
      }
    } catch (readError) {
      // Если не можем прочитать (из-за правил), продолжаем - попробуем записать
      console.log('⚠️ Не удалось проверить существующий запрос (возможно, из-за правил), продолжаем...');
    }
    
    // Отправляем запрос
    const requestData = {
      fromUserId,
      fromNickname,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    const requestPath = `friendRequests/${toUserId}/${fromUserId}`;
    console.log('💾 Сохранение запроса в Firebase:', requestPath, requestData);
    console.log('💾 Проверка прав доступа перед записью...');
    
    try {
      // Пытаемся записать данные
      await db.ref(requestPath).set(requestData);
      console.log('💾 Запись в Firebase выполнена, проверяем результат...');
      
      // Небольшая задержка для синхронизации Firebase
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Проверяем, что запрос действительно сохранен
      const verifySnapshot = await db.ref(requestPath).once('value');
      if (verifySnapshot.exists()) {
        const savedData = verifySnapshot.val();
        console.log('✅ Запрос успешно сохранен в Firebase:', savedData);
        console.log('✅ Путь в Firebase:', requestPath);
        console.log('✅ Данные запроса:', {
          fromUserId: savedData.fromUserId,
          fromNickname: savedData.fromNickname,
          status: savedData.status,
          timestamp: savedData.timestamp
        });
        return { success: true };
      } else {
        console.error('❌ Ошибка: запрос не сохранен в Firebase после записи');
        console.error('❌ Путь в Firebase:', requestPath);
        console.error('❌ Возможная причина: правила безопасности Firebase блокируют запись');
        return { success: false, error: 'Не удалось сохранить запрос. Проверьте правила Firebase.' };
      }
    } catch (writeError) {
      console.error('❌ Ошибка при записи в Firebase:', writeError);
      console.error('❌ Детали ошибки записи:', {
        code: writeError.code,
        message: writeError.message,
        stack: writeError.stack
      });
      
      // Проверяем, может быть запрос уже существует
      try {
        const existingCheck = await db.ref(requestPath).once('value');
        if (existingCheck.exists()) {
          console.log('⚠️ Запрос уже существует в Firebase (возможно, была ошибка доступа)');
          return { success: true };
        }
      } catch (checkError) {
        console.error('❌ Ошибка при проверке существующего запроса:', checkError);
      }
      
      return { success: false, error: writeError.message || 'Ошибка при сохранении запроса в Firebase' };
    }
  } catch (error) {
    console.error('❌ Ошибка при отправке запроса в друзья:', error);
    console.error('Детали ошибки:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message || 'Ошибка при отправке запроса' };
  }
}

/**
 * Принимает запрос в друзья
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @param {string} friendId - ID друга
 * @returns {Promise<Object>} Результат принятия
 */
export async function acceptFriendRequest(db, userId, friendId) {
  try {
    console.log('✅ Принятие запроса в друзья:', { userId, friendId });
    
    // Проверяем, существует ли запрос
    const requestSnapshot = await db.ref(`friendRequests/${userId}/${friendId}`).once('value');
    if (!requestSnapshot.exists()) {
      console.error('❌ Запрос не найден');
      return { success: false, error: 'Запрос не найден' };
    }
    
    const timestamp = Date.now();
    
    // Создаем дружбу для принимающего (userId) - это всегда работает
    await db.ref(`friendships/${userId}/${friendId}`).set({
      status: 'accepted',
      timestamp: timestamp
    });
    console.log('✅ Создана дружба для принимающего:', `friendships/${userId}/${friendId}`);
    
    // Создаем дружбу для отправителя (friendId)
    // С обновленными правилами безопасности Firebase это должно работать:
    // правила разрешают создание дружбы, если auth.uid == $friendId (отправитель запроса)
    await db.ref(`friendships/${friendId}/${userId}`).set({
      status: 'accepted',
      timestamp: timestamp
    });
    console.log('✅ Создана дружба для отправителя:', `friendships/${friendId}/${userId}`);
    
    // Удаляем запрос
    await db.ref(`friendRequests/${userId}/${friendId}`).remove();
    console.log('✅ Запрос удален');
    
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка при принятии запроса в друзья:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Отклоняет запрос в друзья
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @param {string} friendId - ID друга
 * @returns {Promise<Object>} Результат отклонения
 */
export async function rejectFriendRequest(db, userId, friendId) {
  try {
    await db.ref(`friendRequests/${userId}/${friendId}`).remove();
    return { success: true };
  } catch (error) {
    console.error('Ошибка при отклонении запроса в друзья:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Получает список друзей пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object>} Объект с друзьями {friendId: {status, timestamp}}
 */
export async function getFriends(db, userId) {
  try {
    const snapshot = await db.ref(`friendships/${userId}`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Ошибка при получении списка друзей:', error);
    return {};
  }
}

/**
 * Получает список запросов в друзья
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object>} Объект с запросами {fromUserId: {fromUserId, fromNickname, timestamp, status}}
 */
export async function getFriendRequests(db, userId) {
  try {
    const snapshot = await db.ref(`friendRequests/${userId}`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Ошибка при получении запросов в друзья:', error);
    return {};
  }
}

/**
 * Устанавливает онлайн статус пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @param {boolean} isOnline - Онлайн статус
 * @returns {Promise<void>}
 */
// Хранилище для onDisconnect handlers, чтобы можно было их отменить
const onlineStatusDisconnectHandlers = new Map();

export async function setUserOnlineStatus(db, userId, isOnline) {
  try {
    // Проверяем базовые параметры
    if (!db || !userId) {
      console.warn('⚠️ Не удалось установить онлайн статус: отсутствует db или userId');
      return;
    }
    
    const onlineRef = db.ref(`users/${userId}/online`);
    const lastSeenRef = db.ref(`users/${userId}/lastSeen`);
    
    if (isOnline) {
      // Отменяем предыдущий onDisconnect handler, если он есть
      const handlerKey = userId;
      if (onlineStatusDisconnectHandlers.has(handlerKey)) {
        try {
          const previousHandler = onlineStatusDisconnectHandlers.get(handlerKey);
          if (previousHandler && typeof previousHandler.cancel === 'function') {
            previousHandler.cancel();
          }
        } catch (e) {
          // Игнорируем ошибки при отмене предыдущего handler
        }
        onlineStatusDisconnectHandlers.delete(handlerKey);
      }
      
      // Устанавливаем онлайн статус
      await onlineRef.set(true);
      await lastSeenRef.set(Date.now());
      
      // Настраиваем onDisconnect для автоматической установки offline при отключении
      try {
        const disconnectHandler = onlineRef.onDisconnect();
        disconnectHandler.set(false);
        lastSeenRef.onDisconnect().set(Date.now());
        
        // Сохраняем handler для возможности отмены
        onlineStatusDisconnectHandlers.set(handlerKey, disconnectHandler);
        
        console.log('✅ Онлайн статус установлен с onDisconnect handler для пользователя:', userId);
      } catch (disconnectError) {
        console.warn('⚠️ Не удалось настроить onDisconnect для онлайн статуса:', disconnectError);
        // Продолжаем работу даже если не удалось настроить onDisconnect
      }
    } else {
      // Отменяем onDisconnect handler при установке offline вручную
      const handlerKey = userId;
      if (onlineStatusDisconnectHandlers.has(handlerKey)) {
        try {
          const handler = onlineStatusDisconnectHandlers.get(handlerKey);
          if (handler && typeof handler.cancel === 'function') {
            handler.cancel();
          }
        } catch (e) {
          // Игнорируем ошибки при отмене handler
        }
        onlineStatusDisconnectHandlers.delete(handlerKey);
      }
      
      // Устанавливаем офлайн статус
      await onlineRef.set(false);
      await lastSeenRef.set(Date.now());
      console.log('✅ Офлайн статус установлен для пользователя:', userId);
    }
  } catch (error) {
    // Обрабатываем ошибку PERMISSION_DENIED как предупреждение, так как это может происходить
    // если пользователь еще не авторизован или правила Firebase отклоняют запрос
    if (error.code === 'PERMISSION_DENIED') {
      console.warn('⚠️ Не удалось установить онлайн статус: нет доступа. Пользователь может быть не авторизован.');
    } else {
      console.error('Ошибка при установке онлайн статуса:', error);
    }
    // Не пробрасываем ошибку дальше, чтобы не прерывать работу приложения
  }
}

/**
 * Получает онлайн статус пользователя
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<boolean>} Онлайн статус
 */
export async function getUserOnlineStatus(db, userId) {
  try {
    const snapshot = await db.ref(`users/${userId}/online`).once('value');
    return snapshot.val() === true;
  } catch (error) {
    console.error('Ошибка при получении онлайн статуса:', error);
    return false;
  }
}

/**
 * Получает информацию о пользователе
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @returns {Promise<Object|null>} Информация о пользователе
 */
export async function getUserInfo(db, userId) {
  try {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Ошибка при получении информации о пользователе:', error);
    return null;
  }
}

/**
 * Генерирует уникальный ID комнаты из букв и цифр
 * @param {Object} db - Firebase database reference
 * @returns {Promise<string>} Уникальный ID комнаты
 */
export async function generateUniqueRoomId(db, length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let roomId = '';
  let attempts = 0;
  const maxAttempts = 100;

  do {
    roomId = '';
    for (let i = 0; i < length; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Проверяем уникальность
    const roomRef = getRoomRef(db, roomId);
    const snapshot = await roomRef.once('value');
    
    if (!snapshot.exists()) {
      return roomId;
    }
    
    attempts++;
  } while (attempts < maxAttempts);

  // Если не удалось сгенерировать за 100 попыток, добавляем timestamp
  const timestamp = Date.now().toString(36);
  return roomId.substring(0, length - timestamp.length) + timestamp;
}

/**
 * Проверяет существование комнаты
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @returns {Promise<boolean>} true если комната существует
 */
export async function roomExists(db, roomId) {
  try {
    const roomRef = getRoomRef(db, roomId);
    const snapshot = await roomRef.once('value');
    return snapshot.exists();
  } catch (error) {
    console.error('Ошибка при проверке существования комнаты:', error);
    return false;
  }
}

/**
 * Создает комнату с названием и создателем
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @param {string} roomName - Название комнаты
 * @param {string} creatorId - ID создателя комнаты
 * @returns {Promise<Object>} Firebase reference к комнате
 */
export async function createRoomWithName(db, roomId, roomName, creatorId) {
  try {
    console.log('createRoomWithName вызвана:', { roomId, roomName, creatorId });
    const roomRef = getRoomRef(db, roomId);
    
    const roomData = {
      name: roomName,
      creatorId: creatorId,
      createdAt: Date.now(),
      users: {}
    };
    
    console.log('Сохранение комнаты в Firebase:', roomData);
    await roomRef.set(roomData);
    
    // Проверяем, что комната действительно сохранена
    const verifySnapshot = await roomRef.once('value');
    if (verifySnapshot.exists()) {
      console.log('✅ Комната успешно сохранена в Firebase:', verifySnapshot.val());
    } else {
      console.error('❌ ОШИБКА: Комната не найдена в Firebase после сохранения!');
    }
    
    return roomRef;
  } catch (error) {
    console.error('Ошибка при создании комнаты:', error);
    console.error('Детали ошибки:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Получает список всех комнат
 * @param {Object} db - Firebase database reference
 * @returns {Promise<Object>} Объект с комнатами
 */
export async function getRoomsList(db) {
  try {
    console.log('Запрос списка комнат из Firebase...');
    const snapshot = await db.ref("rooms").once('value');
    const rooms = snapshot.val() || {};
    console.log('Получены данные комнат из Firebase:', {
      roomsCount: Object.keys(rooms).length,
      rooms: Object.keys(rooms)
    });
    return rooms;
  } catch (error) {
    console.error('Ошибка при получении списка комнат:', error);
    console.error('Код ошибки:', error.code);
    console.error('Сообщение ошибки:', error.message);
    return {};
  }
}

/**
 * Получает информацию о комнате
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @returns {Promise<Object|null>} Информация о комнате
 */
export async function getRoomInfo(db, roomId) {
  try {
    const roomRef = getRoomRef(db, roomId);
    const snapshot = await roomRef.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Ошибка при получении информации о комнате:', error);
    return null;
  }
}

/**
 * Удаляет комнату
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @returns {Promise<void>}
 */
export async function deleteRoomById(db, roomId) {
  try {
    const roomRef = getRoomRef(db, roomId);
    await roomRef.remove();
  } catch (error) {
    console.error('Ошибка при удалении комнаты:', error);
    throw error;
  }
}

/**
 * Проверяет, является ли пользователь создателем комнаты
 * @param {Object} db - Firebase database reference
 * @param {string} roomId - ID комнаты
 * @param {string} userId - ID пользователя
 * @returns {Promise<boolean>} true если пользователь является создателем
 */
export async function isRoomCreator(db, roomId, userId) {
  try {
    const roomInfo = await getRoomInfo(db, roomId);
    return roomInfo && roomInfo.creatorId === userId;
  } catch (error) {
    console.error('Ошибка при проверке создателя комнаты:', error);
    return false;
  }
}

/**
 * Удаляет друга (удаляет дружбу в обе стороны)
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @param {string} friendId - ID друга
 * @returns {Promise<Object>} Результат удаления
 */
export async function removeFriend(db, userId, friendId) {
  try {
    console.log('🗑️ Удаление друга:', { userId, friendId });
    
    // Удаляем дружбу в обе стороны
    await db.ref(`friendships/${userId}/${friendId}`).remove();
    await db.ref(`friendships/${friendId}/${userId}`).remove();
    
    console.log('✅ Друг удален из друзей');
    return { success: true };
  } catch (error) {
    console.error('Ошибка при удалении друга:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Отправляет сообщение другу
 * @param {Object} db - Firebase database reference
 * @param {string} fromUserId - ID отправителя
 * @param {string} toUserId - ID получателя
 * @param {string} fromNickname - Никнейм отправителя
 * @param {string} message - Текст сообщения
 * @returns {Promise<Object>} Результат отправки
 */
export async function sendFriendMessage(db, fromUserId, toUserId, fromNickname, message) {
  try {
    console.log('💬 Отправка сообщения другу:', { fromUserId, toUserId, fromNickname, message });
    
    const messageData = {
      fromUserId,
      fromNickname,
      message,
      timestamp: Date.now(),
      read: false
    };
    
    // Сохраняем сообщение в базе данных
    const messagePath = `friendMessages/${toUserId}/${fromUserId}`;
    await db.ref(messagePath).push(messageData);
    
    console.log('✅ Сообщение отправлено');
    return { success: true };
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Получает сообщения от друга
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @param {string} friendId - ID друга
 * @returns {Promise<Object>} Сообщения от друга
 */
export async function getFriendMessages(db, userId, friendId) {
  try {
    const snapshot = await db.ref(`friendMessages/${userId}/${friendId}`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Ошибка при получении сообщений:', error);
    return {};
  }
}

/**
 * Удаляет сообщение от друга из Firebase
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID пользователя
 * @param {string} friendId - ID друга
 * @param {number} timestamp - Timestamp сообщения для идентификации
 * @returns {Promise<Object>} Результат удаления
 */
export async function removeFriendMessage(db, userId, friendId, timestamp) {
  try {
    const messagesRef = db.ref(`friendMessages/${userId}/${friendId}`);
    const snapshot = await messagesRef.once('value');
    const messages = snapshot.val() || {};
    
    // Ищем сообщение с нужным timestamp
    let messageIdToDelete = null;
    for (const [msgId, message] of Object.entries(messages)) {
      if (message && message.timestamp === timestamp) {
        messageIdToDelete = msgId;
        break;
      }
    }
    
    if (messageIdToDelete) {
      await messagesRef.child(messageIdToDelete).remove();
      console.log('✅ Сообщение удалено из Firebase:', messageIdToDelete);
      return { success: true };
    } else {
      console.log('⚠️ Сообщение с timestamp не найдено:', timestamp);
      return { success: false, error: 'Сообщение не найдено' };
    }
  } catch (error) {
    console.error('❌ Ошибка при удалении сообщения:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Отправляет приглашение в комнату другу
 * @param {Object} db - Firebase database reference
 * @param {string} fromUserId - ID отправителя
 * @param {string} toUserId - ID получателя
 * @param {string} fromNickname - Никнейм отправителя
 * @param {string} roomId - ID комнаты
 * @param {string} roomName - Название комнаты
 * @returns {Promise<Object>} Результат отправки
 */
export async function sendRoomInvitation(db, fromUserId, toUserId, fromNickname, roomId, roomName) {
  try {
    console.log('🎫 Отправка приглашения в комнату:', { fromUserId, toUserId, roomId, roomName });
    
    const invitationData = {
      fromUserId,
      fromNickname,
      roomId,
      roomName,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    // Сохраняем приглашение в базе данных
    const invitationPath = `roomInvitations/${toUserId}/${fromUserId}`;
    await db.ref(invitationPath).set(invitationData);
    
    console.log('✅ Приглашение отправлено');
    return { success: true };
  } catch (error) {
    console.error('Ошибка при отправке приглашения:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Получает приглашения в комнаты
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @returns {Promise<Object>} Приглашения в комнаты
 */
export async function getRoomInvitations(db, userId) {
  try {
    const snapshot = await db.ref(`roomInvitations/${userId}`).once('value');
    return snapshot.val() || {};
  } catch (error) {
    console.error('Ошибка при получении приглашений:', error);
    return {};
  }
}

/**
 * Удаляет приглашение в комнату
 * @param {Object} db - Firebase database reference
 * @param {string} userId - ID текущего пользователя
 * @param {string} fromUserId - ID отправителя приглашения
 * @returns {Promise<Object>} Результат удаления
 */
export async function removeRoomInvitation(db, userId, fromUserId) {
  try {
    await db.ref(`roomInvitations/${userId}/${fromUserId}`).remove();
    return { success: true };
  } catch (error) {
    console.error('Ошибка при удалении приглашения:', error);
    return { success: false, error: error.message };
  }
}

