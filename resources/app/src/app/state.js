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
  }
  
  /**
   * Инициализирует состояние
   */
  initialize() {
    // Состояние уже инициализировано через конструктор
  }
  
  /**
   * Сбрасывает состояние (при выходе)
   */
  reset() {
    this.roomRef = null;
    this.myUserRef = null;
    this.myId = null;
    this.currentRoomId = null;
    this.joined = false;
    this.joinLock = false;
    this.intentionalLeave = false;
    this.myNick = CONSTANTS.DEFAULT_NICKNAME;
    this.muted = false;
    this.previousUsersCount = 0;
    
    if (this.roomsListener) {
      this.roomsListener.off();
      this.roomsListener = null;
    }
    
    if (this.updateRoomsListTimeout) {
      clearTimeout(this.updateRoomsListTimeout);
      this.updateRoomsListTimeout = null;
    }
    
    this.isLoadingRoomsList = false;
    this.lastLoadRoomsListTime = 0;
    this.isInitialLoad = false;
    this.roomsListInitialized = false;
  }
  
  /**
   * Проверяет, инициализировано ли Firebase
   */
  isFirebaseInitialized() {
    return this.db !== null && this.auth !== null;
  }
  
  /**
   * Проверяет, авторизован ли пользователь
   */
  isAuthenticated() {
    return this.authManager !== null && this.authManager.isAuthenticated();
  }
  
  /**
   * Проверяет, находится ли пользователь в комнате
   */
  isInRoom() {
    return this.joined && this.roomRef !== null && this.currentRoomId !== null;
  }
}

/**
 * Глобальный экземпляр состояния приложения
 */
export const appState = new AppState();

