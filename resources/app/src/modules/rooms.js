/**
 * Модуль управления комнатами
 * Координирует создание, вход, выход и отображение комнат
 */

import { CONSTANTS } from './constants.js';
import { 
  getRoomRef, 
  createUserInRoom, 
  clearRoomMessages, 
  generateUniqueRoomId, 
  roomExists, 
  createRoomWithName as createRoomWithNameFirebase, 
  getRoomsList, 
  getRoomInfo, 
  deleteRoomById, 
  isRoomCreator 
} from './firebase.js';

/**
 * Класс для управления комнатами
 */
export class RoomsManager {
  constructor(dependencies) {
    // Сохраняем зависимости
    this.db = dependencies.db;
    this.authManager = dependencies.authManager;
    this.ui = dependencies.ui;
    this.webrtc = dependencies.webrtc;
    this.chat = dependencies.chat;
    this.devices = dependencies.devices;
    this.usersManager = dependencies.usersManager;
    this.speechDetector = dependencies.speechDetector;
    this.connectionManager = dependencies.connectionManager;
    this.logger = dependencies.logger;
    this.playNotificationSound = dependencies.playNotificationSound;
    this.CONSTANTS = dependencies.CONSTANTS;
    this.roomsCache = dependencies.roomsCache;
    this.listenersManager = dependencies.listenersManager;
    
    // Приватное состояние
    this._state = {
      roomRef: null,
      myUserRef: null,
      myId: null,
      myNick: CONSTANTS.DEFAULT_NICKNAME,
      muted: false,
      joined: false,
      joinLock: false,
      previousUsersCount: 0,
      intentionalLeave: false,
      currentRoomId: null,
      isInitialLoad: false,
      roomsListInitialized: false,
      roomsListener: null,
      updateRoomsListTimeout: null,
      roomsUpdateTimeout: null
    };
    
    // Callbacks для app.js
    this.callbacks = {
      onJoined: null,        // (data) => { roomRef, myUserRef, myId, roomId, roomName, usersCount }
      onLeft: null,          // () => {}
      onUsersChanged: null,  // (count, users) => {}
      onError: null          // (error, context) => {}
    };
  }
  
  // ==================== ГЕТТЕРЫ (READ-ONLY) ====================
  
  get joined() { return this._state.joined; }
  get roomRef() { return this._state.roomRef; }
  get myId() { return this._state.myId; }
  get myUserRef() { return this._state.myUserRef; }
  get currentRoomId() { return this._state.currentRoomId; }
  get joinLock() { return this._state.joinLock; }
  get myNick() { return this._state.myNick; }
  get muted() { return this._state.muted; }
  
  // ==================== СЕТТЕРЫ (для app.js) ====================
  
  setNickname(nickname) {
    this._state.myNick = nickname;
  }
  
  setMuted(muted) {
    this._state.muted = muted;
  }
  
  setMyId(id) {
    this._state.myId = id;
  }
  
  // ==================== ПРИВАТНЫЕ МЕТОДЫ ====================
  
  /**
   * Обновляет внутреннее состояние
   */
  _updateState(updates) {
    Object.assign(this._state, updates);
  }
  
  /**
   * Вызывает callback с обработкой ошибок
   */
  _triggerCallback(callbackName, ...args) {
    try {
      if (this.callbacks[callbackName]) {
        this.callbacks[callbackName](...args);
      }
    } catch (error) {
      console.error(`Ошибка в callback ${callbackName}:`, error);
      this.logger.error(`Callback error: ${callbackName}`, { error: error.message }).catch(() => {});
    }
  }
  
  // ==================== МОДАЛЬНЫЕ ОКНА ====================
  
  /**
   * Показывает модальное окно создания комнаты
   */
  async showCreateModal() {
    if (this._state.joined) {
      this.ui.showToast("Сначала выйдите из текущей комнаты");
      return;
    }

    try {
      const roomId = await generateUniqueRoomId(this.db, 8);
      if (this.ui.elements.createRoomModal && this.ui.elements.roomIdDisplayInput) {
        this.ui.elements.roomIdDisplayInput.value = roomId;
        this.ui.elements.createRoomModal.classList.add('show');
        if (this.ui.elements.roomNameInput) {
          this.ui.elements.roomNameInput.value = '';
          this.ui.elements.roomNameInput.focus();
        }
        if (this.ui.elements.createRoomError) {
          this.ui.elements.createRoomError.textContent = '';
          this.ui.elements.createRoomError.style.display = 'none';
        }
      }
    } catch (error) {
      console.error('Ошибка при генерации ID комнаты:', error);
      this.ui.showToast('Ошибка при создании комнаты');
    }
  }

  /**
   * Показывает модальное окно поиска комнаты
   */
  showFindModal() {
    if (this._state.joined) {
      this.ui.showToast("Сначала выйдите из текущей комнаты");
      return;
    }
    
    if (this.ui.elements.findRoomModal) {
      this.ui.elements.findRoomModal.classList.add('show');
      if (this.ui.elements.roomIdInput) {
        this.ui.elements.roomIdInput.value = '';
        this.ui.elements.roomIdInput.focus();
      }
      if (this.ui.elements.findRoomError) {
        this.ui.elements.findRoomError.textContent = '';
        this.ui.elements.findRoomError.style.display = 'none';
      }
    }
  }
  
  // ==================== СОЗДАНИЕ И ВХОД В КОМНАТУ ====================
  
  /**
   * Создает новую комнату
   */
  async createRoom(roomId, roomName) {
    if (this._state.joinLock) return;
    if (this._state.joined) return;

    if (!roomName || !roomName.trim()) {
      if (this.ui.elements.createRoomError) {
        this.ui.elements.createRoomError.textContent = 'Введите название комнаты';
        this.ui.elements.createRoomError.style.display = 'block';
      }
      return;
    }

    this._updateState({ joinLock: true });
    
    try {
      // Проверяем никнейм
      if (!this._state.myNick || this._state.myNick === this.CONSTANTS.DEFAULT_NICKNAME) {
        this.ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        this._updateState({ joinLock: false });
        return;
      }

      const currentUser = this.authManager.getCurrentUser();
      if (!currentUser) {
        this.ui.showToast("Пользователь не авторизован");
        this._updateState({ joinLock: false });
        return;
      }

      // Создаем комнату в Firebase
      console.log('Создание комнаты:', { roomId, roomName: roomName.trim(), creatorId: currentUser.uid });
      const createdRoomRef = await createRoomWithNameFirebase(this.db, roomId, roomName.trim(), currentUser.uid);
      console.log('Комната успешно создана в Firebase:', createdRoomRef.key);
      
      // Проверяем создание
      const roomSnapshot = await createdRoomRef.once('value');
      if (roomSnapshot.exists()) {
        console.log('Подтверждение: комната существует в Firebase:', roomSnapshot.val());
        await this.logger.logRoom('CREATE', 'Комната создана', {
          roomId: roomId,
          roomName: roomName.trim(),
          creatorId: currentUser.uid,
          creatorEmail: currentUser.email,
          createdAt: Date.now(),
          roomData: roomSnapshot.val()
        }).catch(() => {});
      }
      
      // Получаем roomRef
      const roomRef = getRoomRef(this.db, roomId);
      console.log(`[JOIN ROOM] Setting roomRef to: ${roomRef.key}`);
      
      // Проверяем дубликаты пользователей по Firebase UID
      const firebaseUserId = currentUser.uid;
      const existingUsers = await roomRef.child("users").once("value");
      const existingUsersData = existingUsers.val() || {};
      
      // Удаляем все существующие записи этого пользователя (по Firebase UID)
      const duplicatePromises = [];
      for (const [pushId, userData] of Object.entries(existingUsersData)) {
        if (userData.firebaseUserId === firebaseUserId) {
          console.log(`Удаление дубликата пользователя: ${pushId}`);
          duplicatePromises.push(
            roomRef.child("users").child(pushId).remove().catch(err => {
              console.error(`Ошибка при удалении дубликата ${pushId}:`, err);
            })
          );
        }
      }
      
      if (duplicatePromises.length > 0) {
        await Promise.all(duplicatePromises);
        console.log(`✅ Удалено ${duplicatePromises.length} дубликатов пользователя`);
      }

      // Создаем пользователя в комнате
      const speakerMuted = this.webrtc.speakerMuted || false;
      const myUserRef = createUserInRoom(roomRef, this._state.myNick, this._state.muted, firebaseUserId, speakerMuted);
      const myId = myUserRef.key;
      
      console.log('✅ Пользователь добавлен в комнату:', { 
        pushId: myId, 
        firebaseUserId: firebaseUserId,
        nickname: this._state.myNick 
      });
      
      // Настраиваем onDisconnect
      myUserRef.onDisconnect().remove();

      // Обновляем состояние
      this._updateState({
        roomRef: roomRef,
        myUserRef: myUserRef,
        myId: myId,
        joined: true,
        intentionalLeave: false,
        currentRoomId: roomId,
        joinLock: false
      });
      
      // Обновляем UI
      this.ui.updateJoinButton(true);
      this.ui.updateRoomId(roomId);
      
      if (this.ui.elements.usersPanel) {
        this.ui.elements.usersPanel.style.display = 'flex';
      }
      
      // Получаем счетчик участников
      const usersSnapshot = await roomRef.child("users").once("value");
      const initialCount = usersSnapshot.numChildren();
      this.ui.updateUsersCount(initialCount);
      this._updateState({ previousUsersCount: initialCount });
      
      // Автоочистка если мы первые
      if (initialCount === 1) {
        console.log(`[AUTO-CLEAR] Room was empty, clearing old whiteboard data`);
        roomRef.child('whiteboard/strokes').remove().catch(err => {
          console.error(`[AUTO-CLEAR] Error clearing old data:`, err);
        });
      }
      
      // Уведомляем app.js через callback
      this._triggerCallback('onJoined', {
        roomRef: roomRef,
        myUserRef: myUserRef,
        myId: myId,
        roomId: roomId,
        roomName: roomName.trim(),
        usersCount: initialCount
      });
      
      this.playNotificationSound('join');
      this.ui.showToast(`Комната "${roomName}" создана`);
      
      // Закрываем модальное окно
      if (this.ui.elements.createRoomModal) {
        this.ui.elements.createRoomModal.classList.remove('show');
      }
      
      // Обновляем список комнат
      setTimeout(() => {
        this.loadList(false).catch(err => console.error('Ошибка при обновлении списка комнат:', err));
      }, 500);

    } catch (err) {
      console.error('❌ ОШИБКА при создании комнаты:', err);
      
      let errorMessage = "Ошибка при создании комнаты";
      if (err.code) errorMessage += ` (${err.code})`;
      if (err.message) errorMessage += `: ${err.message}`;
      
      this.ui.showToast(errorMessage, 5000, 'error');
      
      if (this.ui.elements.createRoomError) {
        this.ui.elements.createRoomError.textContent = errorMessage;
        this.ui.elements.createRoomError.style.display = 'block';
      }
      
      this._triggerCallback('onError', err, 'createRoom');
    } finally {
      this._updateState({ joinLock: false });
    }
  }
  
  /**
   * Присоединяется к существующей комнате
   */
  async joinRoom(roomId) {
    if (this._state.joinLock) return;
    if (this._state.joined) return;
    
    this._updateState({ joinLock: true });
    
    try {
      if (!roomId || !roomId.trim()) {
        this.ui.showToast("Введите Room ID");
        this._updateState({ joinLock: false });
        return;
      }

      roomId = roomId.trim();

      // Проверяем никнейм
      if (!this._state.myNick || this._state.myNick === this.CONSTANTS.DEFAULT_NICKNAME) {
        this.ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        this._updateState({ joinLock: false });
        return;
      }

      // Проверяем существование комнаты
      const exists = await roomExists(this.db, roomId);
      if (!exists) {
        this.ui.showToast("Комната не существует");
        this._updateState({ joinLock: false });
        return;
      }

      // Получаем roomRef
      const roomRef = getRoomRef(this.db, roomId);
      console.log(`[JOIN ROOM] Setting roomRef to: ${roomRef.key}`);

      // Получаем текущего пользователя
      const currentUser = this.authManager.getCurrentUser();
      const firebaseUserId = currentUser ? currentUser.uid : null;

      // Проверка лимита пользователей и удаление дубликатов
      const usersSnap = await roomRef.child("users").once("value");
      const existingUsersData = usersSnap.val() || {};
      
      // Удаляем все существующие записи этого пользователя (по Firebase UID)
      const duplicatePromises = [];
      for (const [pushId, userData] of Object.entries(existingUsersData)) {
        if (userData.firebaseUserId === firebaseUserId) {
          console.log(`Удаление дубликата пользователя при входе: ${pushId}`);
          duplicatePromises.push(
            roomRef.child("users").child(pushId).remove().catch(err => {
              console.error(`Ошибка при удалении дубликата ${pushId}:`, err);
            })
          );
        }
      }
      
      if (duplicatePromises.length > 0) {
        await Promise.all(duplicatePromises);
        console.log(`✅ Удалено ${duplicatePromises.length} дубликатов пользователя при входе`);
      }
      
      // Пересчитываем после удаления дубликатов
      const usersAfterCleanup = await roomRef.child("users").once("value");
      if (usersAfterCleanup.numChildren() >= this.CONSTANTS.MAX_USERS) {
        this.ui.showToast(`Комната заполнена (макс ${this.CONSTANTS.MAX_USERS} участников)`);
        this._updateState({ joinLock: false });
        return;
      }

      // Создаем пользователя в комнате
      const speakerMuted = this.webrtc.speakerMuted || false;
      const myUserRef = createUserInRoom(roomRef, this._state.myNick, this._state.muted, firebaseUserId, speakerMuted);
      const myId = myUserRef.key;
      
      console.log('✅ Пользователь добавлен в комнату (присоединение):', {
        pushId: myId,
        firebaseUserId: firebaseUserId,
        nickname: this._state.myNick
      });

      // Настраиваем onDisconnect
      myUserRef.onDisconnect().remove();
      
      // Обновляем состояние
      this._updateState({
        roomRef: roomRef,
        myUserRef: myUserRef,
        myId: myId,
        joined: true,
        intentionalLeave: false,
        currentRoomId: roomId,
        joinLock: false
      });

      // Логируем вход
      if (currentUser) {
        const roomInfo = await getRoomInfo(this.db, roomId).catch(() => null);
        await this.logger.logRoom('ENTER', 'Вход в комнату', {
          roomId: roomId,
          roomName: roomInfo?.name || 'Неизвестно',
          userId: currentUser.uid,
          userEmail: currentUser.email,
          userNickname: this._state.myNick,
          timestamp: Date.now()
        }).catch(() => {});
      }
      
      // Обновляем UI
      this.ui.updateJoinButton(true);
      this.ui.updateRoomId(roomId);
      
      if (this.ui.elements.usersPanel) {
        this.ui.elements.usersPanel.style.display = 'flex';
      }
      
      // Получаем счетчик участников
      const usersSnapshotForCount = await roomRef.child("users").once("value");
      const initialCount = usersSnapshotForCount.numChildren();
      this.ui.updateUsersCount(initialCount);
      this._updateState({ previousUsersCount: initialCount });
      
      // Автоочистка если мы первые
      if (initialCount === 1) {
        clearRoomMessages(roomRef);
        console.log(`[AUTO-CLEAR] Room was empty, clearing old whiteboard data`);
        roomRef.child('whiteboard/strokes').remove().catch(err => {
          console.error(`[AUTO-CLEAR] Error clearing old data:`, err);
        });
      }
      
      // Уведомляем app.js через callback
      this._triggerCallback('onJoined', {
        roomRef: roomRef,
        myUserRef: myUserRef,
        myId: myId,
        roomId: roomId,
        roomName: null, // Не знаем название при входе
        usersCount: initialCount
      });
      
      this.playNotificationSound('join');
      this.ui.showToast(`Вы вошли в комнату`);

    } catch (err) {
      console.error('❌ ОШИБКА при входе в комнату:', err);
      this.ui.showToast('Ошибка при подключении к комнате', 5000, 'error');
      this._triggerCallback('onError', err, 'joinRoom');
    } finally {
      this._updateState({ joinLock: false });
    }
  }

  
  // ==================== ВЫХОД ИЗ КОМНАТЫ ====================
  
  /**
   * Покидает комнату
   */
  async leaveRoom() {
    if (!this._state.joined) return;
    
    // Устанавливаем флаг намеренного выхода
    this._updateState({ intentionalLeave: true });
    
    console.log('Выход из комнаты:', this._state.currentRoomId);
    
    // Сохраняем ссылки перед очисткой состояния
    const currentMyUserRef = this._state.myUserRef;
    const currentMyId = this._state.myId;
    const currentRoomRef = this._state.roomRef;
    
    // Удаляем пользователя из комнаты в Firebase
    if (currentMyUserRef && currentMyId) {
      try {
        // Отключаем onDisconnect обработчики ПЕРЕД удалением
        try {
          currentMyUserRef.onDisconnect().cancel();
        } catch (e) {
          // Игнорируем ошибки отмены onDisconnect
        }
        
        await currentMyUserRef.remove();
        console.log('Пользователь удален из комнаты:', currentMyId);
      } catch (error) {
        console.error('Ошибка при удалении пользователя из комнаты:', error);
        // Пытаемся удалить напрямую по ID, если ссылка не работает
        if (currentRoomRef && currentMyId) {
          try {
            await currentRoomRef.child("users").child(currentMyId).remove();
            console.log('Пользователь удален по ID:', currentMyId);
          } catch (err) {
            console.error('Ошибка при удалении пользователя по ID:', err);
          }
        }
      }
    } else if (currentRoomRef && currentMyId) {
      // Если ссылка на пользователя не сохранена, пытаемся удалить по ID
      try {
        await currentRoomRef.child("users").child(currentMyId).remove();
        console.log('Пользователь удален по ID (без ссылки):', currentMyId);
      } catch (err) {
        console.error('Ошибка при удалении пользователя по ID:', err);
      }
    }
    
    // Уведомляем app.js для очистки
    this._triggerCallback('onLeft');
    
    // Очищаем состояние
    this._updateState({
      roomRef: null,
      myUserRef: null,
      myId: null,
      joined: false,
      currentRoomId: null
    });
    
    // Обновляем UI
    this.ui.updateJoinButton(false);
    this.ui.updateRoomId(null);
    this.ui.updateUsersCount(0);
    
    if (this.ui.elements.usersPanel) {
      this.ui.elements.usersPanel.style.display = 'none';
    }
    
    this.ui.showToast("Вы вышли из комнаты");
  }
  
  /**
   * Принудительный выход из комнаты
   */
  async forceLeave(showNotification = false, customMessage = null) {
    const wasJoined = this._state.joined;
    
    // Устанавливаем флаг намеренного выхода
    this._updateState({ intentionalLeave: true });
    
    if (showNotification && wasJoined) {
      const message = customMessage || "Вы были отключены от комнаты";
      this.ui.showToast(message, 5000, 'warning');
    }
    
    // Сохраняем ссылки перед очисткой состояния
    const currentMyUserRef = this._state.myUserRef;
    const currentMyId = this._state.myId;
    const currentRoomRef = this._state.roomRef;
    
    // Удаляем пользователя из комнаты в Firebase
    if (currentMyUserRef && currentMyId) {
      try {
        // Отключаем onDisconnect обработчики ПЕРЕД удалением
        try {
          currentMyUserRef.onDisconnect().cancel();
        } catch (e) {
          // Игнорируем ошибки отмены onDisconnect
        }
        
        await currentMyUserRef.remove();
        console.log('Пользователь удален из комнаты (forceLeave):', currentMyId);
      } catch (error) {
        console.error('Ошибка при удалении пользователя из комнаты:', error);
        // Пытаемся удалить напрямую по ID
        if (currentRoomRef && currentMyId) {
          try {
            await currentRoomRef.child("users").child(currentMyId).remove();
            console.log('Пользователь удален по ID (forceLeave):', currentMyId);
          } catch (err) {
            console.error('Ошибка при удалении пользователя по ID:', err);
          }
        }
      }
    } else if (currentRoomRef && currentMyId) {
      // Если ссылка на пользователя не сохранена, пытаемся удалить по ID
      try {
        await currentRoomRef.child("users").child(currentMyId).remove();
        console.log('Пользователь удален по ID (без ссылки, forceLeave):', currentMyId);
      } catch (err) {
        console.error('Ошибка при удалении пользователя по ID:', err);
      }
    }
    
    // Уведомляем app.js для очистки
    this._triggerCallback('onLeft');
    
    // Очищаем состояние
    this._updateState({
      roomRef: null,
      myUserRef: null,
      myId: null,
      joined: false,
      currentRoomId: null
    });
    
    // Обновляем UI
    this.ui.updateJoinButton(false);
    this.ui.updateRoomId(null);
    this.ui.updateUsersCount(0);
    
    if (this.ui.elements.usersPanel) {
      this.ui.elements.usersPanel.style.display = 'none';
    }
  }

  
  // ==================== СПИСОК КОМНАТ ====================
  
  /**
   * Загружает список комнат
   */
  async loadList(force = false) {
    try {
      console.log('=== НАЧАЛО ЗАГРУЗКИ КОМНАТ ===');
      
      if (!this.db) {
        console.error('❌ База данных не инициализирована!');
        throw new Error('База данных не инициализирована');
      }
      
      const currentUser = this.authManager?.getCurrentUser();
      if (!currentUser) {
        console.error('❌ Пользователь не авторизован!');
        throw new Error('Пользователь не авторизован');
      }
      
      console.log('✅ Пользователь авторизован:', currentUser.uid);
      
      // Используем кэш
      let allRooms;
      if (force) {
        console.log('🔄 Принудительная загрузка (force=true), игнорируем кэш');
        this.roomsCache.invalidate();
      }
      
      // Загружаем через кэш
      allRooms = await this.roomsCache.get(async () => {
        console.log('📡 Запрос к Firebase: db.ref("rooms").once("value")...');
        const snapshot = await this.db.ref("rooms").once('value');
        return snapshot.val() || {};
      });
      
      const allRoomsCount = Object.keys(allRooms).length;
      console.log(`✅ Получено комнат из Firebase: ${allRoomsCount}`);
      
      // Фильтруем комнаты
      const filteredRooms = {};
      const currentUserId = currentUser.uid;
      
      Object.entries(allRooms).forEach(([roomId, roomData]) => {
        const isCreator = roomData?.creatorId === currentUserId;
        
        let isParticipant = false;
        if (roomData?.users) {
          const users = roomData.users;
          isParticipant = Object.values(users).some(user => user.userId === currentUserId);
        }
        
        if (isCreator || isParticipant) {
          filteredRooms[roomId] = roomData;
        }
      });
      
      const rooms = filteredRooms;
      const roomsCount = Object.keys(rooms).length;
      
      console.log(`📊 После фильтрации: ${roomsCount} комнат из ${allRoomsCount}`);

      // Логируем
      if (force) {
        await this.logger.logRoom('LOAD', 'Загрузка списка комнат', {
          userId: currentUser.uid,
          userEmail: currentUser.email,
          allRoomsCount: allRoomsCount,
          filteredRoomsCount: roomsCount
        }).catch(() => {});
      }
      
      // Инициализируем UI элементы
      if (this.ui.initElements && typeof this.ui.initElements === 'function') {
        this.ui.initElements();
      }
      
      // Получаем элементы
      let roomsListEl = this.ui.elements?.roomsList || document.getElementById('roomsList');
      const roomsEmptyEl = this.ui.elements?.roomsEmpty || document.getElementById('roomsEmpty');
      
      if (!roomsListEl) {
        console.warn('⚠️ Элемент roomsList не найден, ждем...');
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (this.ui.initElements) {
          this.ui.initElements();
        }
        
        roomsListEl = this.ui.elements?.roomsList || document.getElementById('roomsList');
      }
      
      if (!roomsListEl) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Элемент roomsList не найден!');
        return;
      }
      
      // Скрываем пустое состояние
      if (roomsCount > 0 && roomsEmptyEl) {
        roomsEmptyEl.style.display = 'none';
      }
      
      // Рендерим комнаты
      this.renderList(rooms);
      
      console.log('=== ЗАГРУЗКА КОМНАТ ЗАВЕРШЕНА ===');
      
    } catch (error) {
      console.error('❌ ОШИБКА при загрузке комнат:', error);
      this.renderList({});
      throw error;
    }
  }

  
  /**
   * Отрисовывает список комнат (ПОЛНАЯ ВЕРСИЯ с всеми проверками)
   */
  renderList(rooms) {
    const roomsCount = Object.keys(rooms || {}).length;
    console.log('🔵 renderList вызвана, комнат:', roomsCount);
    console.log('🔵 Данные комнат для рендеринга:', rooms);
    
    // Принудительная инициализация элементов UI перед использованием
    if (this.ui.initElements && typeof this.ui.initElements === 'function') {
      console.log('🔵 Инициализируем элементы UI перед рендерингом...');
      this.ui.initElements();
    }
    
    if (!this.ui.elements || !this.ui.elements.roomsList || !this.ui.elements.roomsEmpty) {
      console.warn('⚠️ Элементы списка комнат не найдены:', {
        uiElements: !!this.ui.elements,
        roomsList: !!this.ui.elements?.roomsList,
        roomsEmpty: !!this.ui.elements?.roomsEmpty
      });
      
      // Пытаемся найти элементы напрямую
      const roomsListDirect = document.getElementById('roomsList') || document.querySelector('.rooms-list');
      const roomsEmptyDirect = document.getElementById('roomsEmpty') || document.querySelector('.rooms-empty');
      
      if (roomsListDirect && roomsEmptyDirect) {
        console.log('✅ Элементы найдены напрямую через DOM, используем их');
        if (!this.ui.elements) this.ui.elements = {};
        this.ui.elements.roomsList = roomsListDirect;
        this.ui.elements.roomsEmpty = roomsEmptyDirect;
      } else {
        console.error('❌ Элементы не найдены даже напрямую, повторная попытка через 200ms...');
        // Повторная попытка через небольшую задержку
        setTimeout(() => {
          if (this.ui.initElements) {
            this.ui.initElements();
          }
          const retryRoomsList = document.getElementById('roomsList') || document.querySelector('.rooms-list');
          const retryRoomsEmpty = document.getElementById('roomsEmpty') || document.querySelector('.rooms-empty');
          if (retryRoomsList && retryRoomsEmpty) {
            if (!this.ui.elements) this.ui.elements = {};
            this.ui.elements.roomsList = retryRoomsList;
            this.ui.elements.roomsEmpty = retryRoomsEmpty;
            this.renderList(rooms);
          } else {
            console.error('❌ Элементы все еще не найдены после повторной попытки');
          }
        }, 200);
        return;
      }
    }
    
    console.log('Элементы UI найдены, начинаем рендеринг списка комнат');

    const roomsArray = Object.entries(rooms || {}).map(([roomId, roomData]) => {
      const usersCount = roomData.users ? Object.keys(roomData.users).length : 0;
      console.log(`Комната ${roomId}: ${usersCount} участников`);
      return {
        id: roomId,
        name: roomData.name || 'Без названия',
        creatorId: roomData.creatorId,
        usersCount: usersCount
      };
    });

    console.log('Массив комнат для отображения:', roomsArray.length);

    if (roomsArray.length === 0) {
      console.log('Нет комнат для отображения, показываем пустое состояние');
      this.ui.elements.roomsList.innerHTML = '';
      // Показываем пустое состояние по центру контейнера
      if (this.ui.elements.roomsEmpty) {
        this.ui.elements.roomsEmpty.style.display = 'flex';
      }
      return;
    }
    
    // Скрываем пустое состояние один раз
    if (this.ui.elements.roomsEmpty) {
      this.ui.elements.roomsEmpty.style.display = 'none';
      console.log('🔵 Пустое состояние скрыто (есть комнаты для отображения)');
    }

    console.log('Очищаем список и отображаем', roomsArray.length, 'комнат');
    
    // Используем DocumentFragment для оптимизации DOM операций
    const fragment = document.createDocumentFragment();

    let renderedCount = 0;
    roomsArray.forEach((room, index) => {
      console.log(`🔵 Рендеринг комнаты ${index + 1}/${roomsArray.length}: ${room.id} (${room.name})`);
      
      const roomCard = document.createElement('div');
      roomCard.className = 'room-card';
      roomCard.dataset.roomId = room.id;
      if (this._state.currentRoomId === room.id) {
        roomCard.classList.add('active');
      }

      roomCard.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-name">${this._escapeHtml(room.name)}</div>
          <div class="room-card-users">${room.usersCount}</div>
        </div>
      `;

      // Обработчик клика для входа в комнату
      roomCard.addEventListener('click', async (e) => {
        if (e.button === 0) { // Левый клик
          if (room.id !== this._state.currentRoomId) {
            await this.joinRoom(room.id);
          }
        }
      });

      // Обработчик правого клика для контекстного меню
      roomCard.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, room.id, room.creatorId);
      });

      try {
        fragment.appendChild(roomCard);
        renderedCount++;
        console.log(`✅ Комната ${room.id} добавлена в fragment (${renderedCount}/${roomsArray.length})`);
      } catch (appendError) {
        console.error(`❌ Ошибка при добавлении комнаты ${room.id} в fragment:`, appendError);
      }
    });
    
    // Добавляем все комнаты одной операцией для оптимизации DOM
    this.ui.elements.roomsList.innerHTML = '';
    this.ui.elements.roomsList.appendChild(fragment);
    
    console.log('✅ Список комнат отрендерен, добавлено карточек:', renderedCount, 'из', roomsArray.length);
    console.log('🔵 Элемент roomsList содержит детей:', this.ui.elements.roomsList.children.length);
    console.log('🔵 Элемент roomsList видим:', {
      display: window.getComputedStyle(this.ui.elements.roomsList).display,
      visibility: window.getComputedStyle(this.ui.elements.roomsList).visibility,
      opacity: window.getComputedStyle(this.ui.elements.roomsList).opacity,
      height: window.getComputedStyle(this.ui.elements.roomsList).height,
      width: window.getComputedStyle(this.ui.elements.roomsList).width
    });
    
    // Финальная проверка: если комнаты не отрендерились, попробуем еще раз
    if (renderedCount === 0 && roomsArray.length > 0) {
      console.error('❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: Комнаты не отрендерились!');
      console.error('Попытка повторного рендеринга через 300ms...');
      setTimeout(() => {
        console.log('🔄 Повторный рендеринг списка комнат...');
        this.renderList(rooms);
      }, 300);
    }
    
    // Убеждаемся, что контейнер комнат виден
    const roomsContent = document.getElementById('roomsContent');
    if (roomsContent) {
      const computedStyle = window.getComputedStyle(roomsContent);
      console.log('roomsContent найден, стили:', {
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity,
        hasActiveClass: roomsContent.classList.contains('active')
      });
      
      // НЕ переключаем вкладки автоматически - пользователь может быть на вкладке "Друзья"
      // Список комнат обновляется в фоне, но вкладка остается той, которую выбрал пользователь
    } else {
      console.warn('⚠️ roomsContent элемент не найден!');
    }
  }
  
  /**
   * Экранирование HTML (приватный метод)
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  
  // ==================== КОНТЕКСТНОЕ МЕНЮ ====================
  
  /**
   * Показывает контекстное меню для комнаты
   */
  showContextMenu(e, roomId, creatorId) {
    if (!this.ui.elements.roomContextMenu) {
      console.warn('roomContextMenu элемент не найден');
      return;
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.warn('Пользователь не авторизован');
      return;
    }

    console.log('showContextMenu вызвана:', {
      roomId,
      creatorId,
      currentUserUid: currentUser.uid,
      joined: this._state.joined,
      currentRoomId: this._state.currentRoomId
    });

    // Показываем кнопку удаления только для создателя
    if (this.ui.elements.roomContextDelete) {
      if (creatorId === currentUser.uid) {
        this.ui.elements.roomContextDelete.style.display = 'block';
        console.log('Кнопка удаления показана (создатель комнаты)');
      } else {
        this.ui.elements.roomContextDelete.style.display = 'none';
        console.log('Кнопка удаления скрыта (не создатель)');
      }
    }

    // Показываем кнопку выхода только если пользователь в этой комнате
    if (this.ui.elements.roomContextLeave) {
      if (this._state.joined && this._state.currentRoomId && this._state.currentRoomId === roomId) {
        this.ui.elements.roomContextLeave.style.display = 'block';
        console.log('✅ Кнопка выхода ПОКАЗАНА для комнаты:', roomId);
      } else {
        this.ui.elements.roomContextLeave.style.display = 'none';
      }
    }

    // Позиционируем меню
    this.ui.elements.roomContextMenu.style.display = 'block';
    this.ui.elements.roomContextMenu.style.left = e.pageX + 'px';
    this.ui.elements.roomContextMenu.style.top = e.pageY + 'px';
    this.ui.elements.roomContextMenu.dataset.roomId = roomId;

    // Закрываем меню при клике вне его
    const closeMenu = (event) => {
      if (this.ui.elements.roomContextMenu && !this.ui.elements.roomContextMenu.contains(event.target)) {
        this.ui.elements.roomContextMenu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  
  // ==================== СЛУШАТЕЛИ ИЗМЕНЕНИЙ ====================
  
  /**
   * Запускает слушатель изменений списка комнат
   */
  startListener() {
    if (!this.db) {
      console.error('База данных не инициализирована для слушателя комнат');
      return;
    }
    
    const currentUser = this.authManager?.getCurrentUser();
    if (!currentUser) {
      console.warn('⚠️ Пользователь не авторизован, слушатель комнат не запущен');
      return;
    }
    
    // Используем менеджер слушателей для предотвращения дубликатов
    if (this.listenersManager.has('rooms')) {
      console.warn('⚠️ Слушатель комнат уже зарегистрирован, пропускаем');
      return;
    }

    console.log('🔵 Запуск слушателя комнат в реальном времени');
    
    const roomsRef = this.db.ref("rooms");
    let isFirstListenerEvent = true;
    
    // Debounce для обновления списка
    const scheduleUpdate = (roomId = null, roomData = null, action = 'update') => {
      // Обновляем кэш напрямую для мгновенного отклика
      if (roomId && action === 'remove') {
        this.roomsCache.updateRoom(roomId, null);
      } else if (roomId && roomData) {
        this.roomsCache.updateRoom(roomId, roomData);
      } else {
        this.roomsCache.invalidate();
      }
      
      if (this._state.roomsUpdateTimeout) return;
      this._state.roomsUpdateTimeout = setTimeout(() => {
        this._state.roomsUpdateTimeout = null;
        this.loadList();
      }, 1000);
    };
    
    // Callbacks для событий
    const onChildAdded = (snap) => {
      if (this._state.isInitialLoad || (isFirstListenerEvent && this._state.roomsListInitialized)) {
        isFirstListenerEvent = false;
        return;
      }
      isFirstListenerEvent = false;
      
      const roomId = snap.key;
      const roomData = snap.val();
      console.log('🔵 [LISTENER] Новая комната добавлена:', roomId);
      scheduleUpdate(roomId, roomData, 'add');
    };
    
    const onChildChanged = (snap) => {
      if (this._state.isInitialLoad) return;
      const roomId = snap.key;
      const roomData = snap.val();
      console.log('🔵 [LISTENER] Комната изменена:', roomId);
      
      // Немедленно обновляем счетчик на карточке
      const roomCard = document.querySelector(`.room-card[data-room-id="${roomId}"]`);
      if (roomCard && roomData) {
        const usersCountEl = roomCard.querySelector('.room-card-users');
        if (usersCountEl) {
          const usersCount = roomData.users ? Object.keys(roomData.users).length : 0;
          usersCountEl.textContent = usersCount;
          console.log(`✅ Счетчик на карточке комнаты ${roomId} обновлен: ${usersCount}`);
        }
      }
      
      scheduleUpdate(roomId, roomData, 'change');
    };
    
    const onChildRemoved = (snap) => {
      if (this._state.isInitialLoad) return;
      const roomId = snap.key;
      console.log('🔵 [LISTENER] Комната удалена:', roomId);
      scheduleUpdate(roomId, null, 'remove');
    };
    
    // Регистрируем все события через менеджер
    this.listenersManager.registerMultiple('rooms', roomsRef, [
      { event: 'child_added', callback: onChildAdded },
      { event: 'child_changed', callback: onChildChanged },
      { event: 'child_removed', callback: onChildRemoved }
    ]);
    
    this._updateState({ roomsListener: true, roomsListInitialized: true });
    console.log('✅ Слушатели комнат запущены через менеджер');
  }

  /**
   * Останавливает слушатель изменений
   */
  stopListener() {
    if (this.listenersManager.has('rooms')) {
      this.listenersManager.unregister('rooms');
      this._updateState({ roomsListener: null });
      console.log('✅ Слушатель комнат остановлен');
    }
  }
  
  // ==================== УТИЛИТЫ ====================
  
  /**
   * Удаляет комнату (только для создателя)
   */
  async deleteRoom(roomId) {
    try {
      const currentUser = this.authManager.getCurrentUser();
      if (!currentUser) {
        this.ui.showToast('Пользователь не авторизован');
        return;
      }
      
      // Проверяем права
      const isCreator = await isRoomCreator(this.db, roomId, currentUser.uid);
      if (!isCreator) {
        this.ui.showToast('Только создатель может удалить комнату');
        return;
      }
      
      // Если мы в этой комнате, сначала выходим
      if (this._state.joined && this._state.currentRoomId === roomId) {
        await this.leaveRoom();
      }
      
      // Удаляем комнату
      await deleteRoomById(this.db, roomId);
      this.ui.showToast('Комната удалена');
      
      // Обновляем список
      await this.loadList(true);
      
    } catch (error) {
      console.error('Ошибка при удалении комнаты:', error);
      this.ui.showToast('Ошибка при удалении комнаты');
    }
  }
  
  /**
   * Очистка ресурсов
   */
  cleanup() {
    this.stopListener();
    if (this._state.roomsUpdateTimeout) {
      clearTimeout(this._state.roomsUpdateTimeout);
    }
    if (this._state.updateRoomsListTimeout) {
      clearTimeout(this._state.updateRoomsListTimeout);
    }
  }
}
