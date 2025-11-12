/**
 * Модуль управления состоянием приложения
 * Централизованное хранилище состояния
 */

import { CONSTANTS } from '../modules/constants.js';

/**
 * Класс для управления состоянием приложения
 */
export class AppState {
  constructor() {
    // Firebase
    this.db = null;
    this.auth = null;
    this.authManager = null;
    
    // Комнаты
    this.roomRef = null;
    this.myUserRef = null;
    this.myId = null;
    this.currentRoomId = null;
    this.joined = false;
    this.joinLock = false;
    this.intentionalLeave = false;
    
    // Пользователь
    this.myNick = CONSTANTS.DEFAULT_NICKNAME;
    this.muted = false;
    this.previousUsersCount = 0;
    
    // Список комнат
    this.roomsListener = null;
    this.updateRoomsListTimeout = null;
    this.isLoadingRoomsList = false;
    this.lastLoadRoomsListTime = 0;
    this.isInitialLoad = false;
    this.roomsListInitialized = false;
    
    // Менеджеры
    this.ui = null;
    this.devices = null;
    this.webrtc = null;
    this.chat = null;
    this.usersManager = null;
    this.connectionManager = null;
    this.friendsManager = null;
    this.speechDetector = null;
    
    // Обработчики
    this.roomHandlers = null;
    this.profileHandlers = null;
  }
  
  /**
   * Инициализирует состояние
   */
  initialize() {
    // Состояние уже инициализировано через конструктор
  }

  /**
   * Сбрасывает состояние при выходе из комнаты
   */
  resetRoomState() {
    this.roomRef = null;
    this.myUserRef = null;
    this.myId = null;
    this.currentRoomId = null;
    this.joined = false;
    this.intentionalLeave = false;
    this.previousUsersCount = 0;
  }

  /**
   * Проверяет, может ли пользователь присоединиться к комнате
   */
  canJoinRoom() {
    return !this.joinLock && !this.joined;
  }

  /**
   * Устанавливает флаг блокировки входа
   */
  lockJoin() {
    this.joinLock = true;
  }

  /**
   * Снимает флаг блокировки входа
   */
  unlockJoin() {
    this.joinLock = false;
  }

  /**
   * Обновляет информацию о комнате
   */
  updateRoomInfo(roomRef, myUserRef, myId, roomId) {
    this.roomRef = roomRef;
    this.myUserRef = myUserRef;
    this.myId = myId;
    this.currentRoomId = roomId;
    this.joined = true;
    this.intentionalLeave = false;
  }
}

