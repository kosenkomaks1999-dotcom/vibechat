/**
 * Модуль обработчиков комнат
 * Создание, присоединение, выход из комнат
 */

import { CONSTANTS } from '../modules/constants.js';
import {
  generateUniqueRoomId,
  roomExists,
  createRoomWithName as createRoomWithNameFirebase,
  getRoomRef,
  createUserInRoom,
  clearRoomMessages,
  getRoomInfo,
  deleteRoomById,
  isRoomCreator,
  getRoomsList
} from '../modules/firebase.js';
import { errorHandler, ErrorCodes } from '../modules/error-handler.js';
import { logger } from '../modules/logger.js';
import { playNotificationSound } from '../modules/sounds.js';

/**
 * Класс для обработки комнат
 */
export class RoomHandlers {
  constructor(state, ui, authManager, db, devices, webrtc, chat, usersManager, connectionManager, speechDetector) {
    this.state = state;
    this.ui = ui;
    this.authManager = authManager;
    this.db = db;
    this.devices = devices;
    this.webrtc = webrtc;
    this.chat = chat;
    this.usersManager = usersManager;
    this.connectionManager = connectionManager;
    this.speechDetector = speechDetector;
    this.setupListenersCallback = null;
  }

  /**
   * Устанавливает callback для setupListeners
   */
  setSetupListenersCallback(callback) {
    this.setupListenersCallback = callback;
  }

  /**
   * Показывает модальное окно создания комнаты
   */
  showCreateRoomModal() {
    if (this.state.joined) {
      this.ui.showToast("Сначала выйдите из текущей комнаты");
      return;
    }

    generateUniqueRoomId(this.db, 8).then(roomId => {
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
    }).catch(error => {
      errorHandler.handle(error, { operation: 'generateRoomId' });
      this.ui.showToast('Ошибка при создании комнаты');
    });
  }

  /**
   * Создает новую комнату с названием
   */
  async createRoomWithName(roomId, roomName) {
    if (!this.state.canJoinRoom()) return;

    if (!roomName || !roomName.trim()) {
      if (this.ui.elements.createRoomError) {
        this.ui.elements.createRoomError.textContent = 'Введите название комнаты';
        this.ui.elements.createRoomError.style.display = 'block';
      }
      return;
    }

    this.state.lockJoin();
    
    try {
      // Проверяем никнейм
      if (!this.state.myNick || this.state.myNick === CONSTANTS.DEFAULT_NICKNAME) {
        this.ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        return;
      }

      const currentUser = this.authManager.getCurrentUser();
      if (!currentUser) {
        this.ui.showToast("Пользователь не авторизован");
        return;
      }

      // Создаем комнату
      const createdRoomRef = await createRoomWithNameFirebase(
        this.db,
        roomId,
        roomName.trim(),
        currentUser.uid
      );
      
      // Проверяем, что комната создана
      const roomSnapshot = await createdRoomRef.once('value');
      if (roomSnapshot.exists()) {
        await logger.logRoom('CREATE', 'Комната создана', {
          roomId: roomId,
          roomName: roomName.trim(),
          creatorId: currentUser.uid,
          creatorEmail: currentUser.email,
          createdAt: Date.now(),
          roomData: roomSnapshot.val()
        }).catch(() => {});
      }
      
      // Инициализируем чат если нужно
      if (!this.chat) {
        this.chat = new (await import('../modules/chat.js')).ChatManager(
          null,
          this.state.myNick,
          currentUser.uid,
          this.db
        );
        this.chat.initElements(
          this.ui.elements.chatMessages,
          this.ui.elements.chatInput,
          this.ui.elements.fileInput
        );
        this.chat.showEmptyState();
      }
      
      if (this.chat) {
        this.chat.myNickname = this.state.myNick;
      }

      // Инициализация микрофона
      const deviceId = this.devices.getSelectedMicId();
      await this.webrtc.initMicrophone(deviceId, this.state.muted);

      const roomRef = getRoomRef(this.db, roomId);
      this.webrtc.roomRef = roomRef;
      if (this.chat) {
        this.chat.roomRef = roomRef;
      }
      this.webrtc.myId = this.state.myId;

      // Проверяем дубликаты
      const existingUsers = await roomRef.child("users").once("value");
      const existingUsersData = existingUsers.val() || {};
      
      if (this.state.myId && existingUsersData[this.state.myId]) {
        await roomRef.child("users").child(this.state.myId).remove().catch(() => {});
      }

      const myUserRef = createUserInRoom(roomRef, this.state.myNick, this.state.muted);
      const myId = myUserRef.key;
      this.state.myId = myId; // Обновляем myId в state

      myUserRef.onDisconnect().remove();

      // Обновляем состояние
      this.state.updateRoomInfo(roomRef, myUserRef, myId, roomId);
      
      // Обновляем roomRef и myId в webrtc и chat
      this.webrtc.roomRef = roomRef;
      this.webrtc.myId = myId;
      if (this.chat) {
        this.chat.roomRef = roomRef;
      }
      
      this.ui.updateJoinButton(true);
      if (this.chat) {
        this.chat.clear();
      }
      clearRoomMessages(roomRef);
      
      // Показываем панель участников
      if (this.ui.elements.usersPanel) {
        this.ui.elements.usersPanel.style.display = 'flex';
      }
      
      this.ui.updateRoomId(roomId);
      
      // Переинициализируем мониторинг подключения
      if (this.connectionManager) {
        this.connectionManager.cleanup();
        this.connectionManager.init();
      }

      // Обновляем счетчик участников
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        this.ui.updateUsersCount(count);
        this.state.previousUsersCount = count;
      });

      if (this.setupListenersCallback) {
        this.setupListenersCallback();
      }
      
      playNotificationSound('join');
      this.ui.showToast(`Комната "${roomName}" создана`);
      
      // Обновляем список комнат
      setTimeout(() => {
        // Используется loadRoomsList из главного файла через callback
      }, 300);

      // Закрываем модальное окно
      if (this.ui.elements.createRoomModal) {
        this.ui.elements.createRoomModal.classList.remove('show');
      }

    } catch (error) {
      errorHandler.handle(error, { operation: 'createRoom', roomId, roomName });
      this.ui.showToast("Ошибка при создании комнаты");
      if (this.ui.elements.createRoomError) {
        this.ui.elements.createRoomError.textContent = 'Ошибка при создании комнаты';
        this.ui.elements.createRoomError.style.display = 'block';
      }
    } finally {
      this.state.unlockJoin();
    }
  }

  /**
   * Присоединяется к существующей комнате по ID
   */
  async findAndJoinRoom(roomId) {
    if (!this.state.canJoinRoom()) return;
    
    this.state.lockJoin();
    
    try {
      if (!roomId || !roomId.trim()) {
        this.ui.showToast("Введите Room ID");
        return;
      }

      roomId = roomId.trim();

      // Проверяем никнейм
      if (!this.state.myNick || this.state.myNick === CONSTANTS.DEFAULT_NICKNAME) {
        this.ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        return;
      }

      // Проверяем существование комнаты
      const exists = await roomExists(this.db, roomId);
      if (!exists) {
        errorHandler.handle(
          'Комната не найдена',
          { operation: 'joinRoom', roomId },
          { code: ErrorCodes.ROOM_NOT_FOUND }
        );
        this.ui.showToast("Комната не существует");
        return;
      }

      // Инициализируем чат если нужно
      if (!this.chat && this.authManager) {
        const currentUser = this.authManager.getCurrentUser();
        if (currentUser) {
          this.chat = new (await import('../modules/chat.js')).ChatManager(
            null,
            this.state.myNick,
            currentUser.uid,
            this.db
          );
          this.chat.initElements(
            this.ui.elements.chatMessages,
            this.ui.elements.chatInput,
            this.ui.elements.fileInput
          );
          this.chat.showEmptyState();
        }
      }
      
      if (this.chat) {
        this.chat.myNickname = this.state.myNick;
      }

      // Инициализация микрофона
      const deviceId = this.devices.getSelectedMicId();
      await this.webrtc.initMicrophone(deviceId, this.state.muted);

      const roomRef = getRoomRef(this.db, roomId);
      this.webrtc.roomRef = roomRef;
      if (this.chat) {
        this.chat.roomRef = roomRef;
      }
      this.webrtc.myId = this.state.myId;

      // Проверка лимита пользователей
      const usersSnap = await roomRef.child("users").once("value");
      const existingUsersDataForJoin = usersSnap.val() || {};
      
      // Удаляем дубликаты
      if (this.state.myId && existingUsersDataForJoin[this.state.myId]) {
        await roomRef.child("users").child(this.state.myId).remove().catch(() => {});
      }
      
      // Пересчитываем количество пользователей
      const usersAfterCleanup = await roomRef.child("users").once("value");
      if (usersAfterCleanup.numChildren() >= CONSTANTS.MAX_USERS) {
        errorHandler.handle(
          'Комната заполнена',
          { operation: 'joinRoom', roomId },
          { code: ErrorCodes.ROOM_FULL }
        );
        this.ui.showToast(`Комната заполнена (макс ${CONSTANTS.MAX_USERS} участников)`);
        return;
      }

      const myUserRef = createUserInRoom(roomRef, this.state.myNick, this.state.muted);
      const myId = myUserRef.key;
      this.state.myId = myId; // Обновляем myId в state

      myUserRef.onDisconnect().remove();

      // Обновляем состояние
      this.state.updateRoomInfo(roomRef, myUserRef, myId, roomId);
      
      // Обновляем roomRef и myId в webrtc и chat
      this.webrtc.roomRef = roomRef;
      this.webrtc.myId = myId;
      if (this.chat) {
        this.chat.roomRef = roomRef;
      }
      
      // Логируем вход в комнату
      const currentUser = this.authManager.getCurrentUser();
      if (currentUser) {
        const roomInfo = await getRoomInfo(this.db, roomId).catch(() => null);
        await logger.logRoom('ENTER', 'Вход в комнату', {
          roomId: roomId,
          roomName: roomInfo?.name || 'Неизвестно',
          userId: currentUser.uid,
          userEmail: currentUser.email,
          userNickname: this.state.myNick,
          timestamp: Date.now()
        }).catch(() => {});
      }
      
      this.ui.updateJoinButton(true);
      if (this.chat) {
        this.chat.clear();
      }
      
      // Показываем панель участников
      if (this.ui.elements.usersPanel) {
        this.ui.elements.usersPanel.style.display = 'flex';
      }
      
      this.ui.updateRoomId(roomId);
      
      // Переинициализируем мониторинг подключения
      if (this.connectionManager) {
        this.connectionManager.cleanup();
        this.connectionManager.init();
      }

      // Удаляем старые сообщения если комната была пуста
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        if (count === 1) {
          clearRoomMessages(roomRef);
        }
      });
      
      // Обновляем список комнат
      setTimeout(() => {
        // Используется loadRoomsList из главного файла через callback
      }, 300);

      // Счетчик участников
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        this.ui.updateUsersCount(count);
        this.state.previousUsersCount = count;
      });

      if (this.setupListenersCallback) {
        this.setupListenersCallback();
      }

      // Создаем соединения с существующими участниками
      usersSnap.forEach(child => {
        const otherId = child.key;
        if (otherId !== myId) {
          this.webrtc.createPeer(otherId, true);
        }
      });

      playNotificationSound('join');

    } catch (error) {
      errorHandler.handle(error, { operation: 'joinRoom', roomId });
      this.ui.showToast("Ошибка при присоединении к комнате");
    } finally {
      this.state.unlockJoin();
    }
  }

  /**
   * Покидает комнату
   */
  async leaveRoom() {
    if (!this.state.joined) return;
    
    // Устанавливаем флаг намеренного выхода
    this.state.intentionalLeave = true;
    
    // Останавливаем мониторинг подключения
    if (this.connectionManager) {
      this.connectionManager.cleanup();
    }
    
    const wasLocked = this.state.joinLock;
    if (!wasLocked) {
      this.state.lockJoin();
    }
    
    try {
      await this.forceLeaveRoom(true, 'Вы вышли из комнаты');
    } finally {
      if (!wasLocked) {
        this.state.unlockJoin();
      }
    }
  }

  /**
   * Принудительно покидает комнату
   */
  async forceLeaveRoom(showNotification = false, customMessage = null) {
    const wasJoined = this.state.joined;
    this.state.intentionalLeave = true;
    
    // Сохраняем ссылки перед очисткой
    const currentRoomRef = this.state.roomRef;
    const currentMyUserRef = this.state.myUserRef;
    const currentMyId = this.state.myId;
    const currentRoomId = this.state.currentRoomId;
    
    // Обнуляем roomRef
    this.state.roomRef = null;
    
    // Удаляем пользователя из комнаты
    if (currentMyUserRef && currentMyId) {
      try {
        try {
          currentMyUserRef.onDisconnect().cancel();
        } catch (e) {
          // Игнорируем ошибки
        }
        
        await currentMyUserRef.remove();
      } catch (error) {
        errorHandler.handleSilent(error, { operation: 'removeUserFromRoom' });
        if (currentRoomRef && currentMyId) {
          try {
            await currentRoomRef.child("users").child(currentMyId).remove();
          } catch (err) {
            errorHandler.handleSilent(err, { operation: 'removeUserFromRoomById' });
          }
        }
      }
    } else if (currentRoomRef && currentMyId) {
      try {
        await currentRoomRef.child("users").child(currentMyId).remove();
      } catch (err) {
        errorHandler.handleSilent(err, { operation: 'removeUserFromRoomById' });
      }
    }
    
    // Отключаем слушатели
    if (currentRoomRef) {
      currentRoomRef.child("users").off();
      currentRoomRef.child("signals").off();
      currentRoomRef.child("messages").off();
    }
    
    // Отменяем все активные попытки переподключения
    if (this.connectionManager) {
      this.connectionManager.cleanup();
    }
    
    // Останавливаем детекцию речи
    if (this.speechDetector && typeof this.speechDetector.stopDetection === 'function') {
      this.speechDetector.stopDetection();
    }
    
    // Сбрасываем состояние
    this.state.resetRoomState();
    
    // Обновляем UI
    if (this.ui.elements.usersPanel) {
      this.ui.elements.usersPanel.style.display = 'none';
    }
    
    this.ui.updateJoinButton(false);
    this.ui.hideRoomInfo();

    // Логируем выход из комнаты
    if (wasJoined && currentRoomId) {
      const currentUser = this.authManager?.getCurrentUser();
      if (currentUser) {
        const roomInfo = await getRoomInfo(this.db, currentRoomId).catch(() => null);
        await logger.logRoom('LEAVE', 'Выход из комнаты', {
          roomId: currentRoomId,
          roomName: roomInfo?.name || 'Неизвестно',
          userId: currentUser.uid,
          userEmail: currentUser.email,
          userNickname: this.state.myNick,
          reason: customMessage || 'Пользователь вышел',
          timestamp: Date.now()
        }).catch(() => {});
      }
    }
    
    // Показываем уведомление
    if (wasJoined && showNotification) {
      playNotificationSound('leave');
      const message = customMessage || 'Вы вышли из комнаты';
      this.ui.showToast(message);
    }
  }

  /**
   * Удаляет комнату (только для создателя)
   */
  async deleteRoom(roomId) {
    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      this.ui.showToast('Пользователь не авторизован');
      return;
    }

    try {
      // Проверяем, является ли пользователь создателем
      const isCreator = await isRoomCreator(this.db, roomId, currentUser.uid);
      if (!isCreator) {
        errorHandler.handle(
          'Только создатель может удалить комнату',
          { operation: 'deleteRoom', roomId },
          { code: ErrorCodes.FIREBASE_PERMISSION_DENIED }
        );
        this.ui.showToast('Только создатель комнаты может её удалить');
        return;
      }

      // Если мы в этой комнате, сначала выходим
      if (this.state.joined && this.state.currentRoomId === roomId) {
        await this.leaveRoom();
      }

      await deleteRoomById(this.db, roomId);
      this.ui.showToast('Комната удалена');
      
      // Обновляем список комнат через callback
      if (this.loadRoomsListCallback) {
        await this.loadRoomsListCallback();
      }
    } catch (error) {
      errorHandler.handle(error, { operation: 'deleteRoom', roomId });
      this.ui.showToast('Ошибка при удалении комнаты');
    }
  }

  /**
   * Устанавливает callback для loadRoomsList
   */
  setLoadRoomsListCallback(callback) {
    this.loadRoomsListCallback = callback;
  }
}

