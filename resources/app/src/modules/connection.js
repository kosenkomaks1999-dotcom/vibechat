/**
 * Модуль для мониторинга подключения к Firebase
 * Отслеживает состояние соединения и автоматически переподключается
 */

import { CONSTANTS } from './constants.js';

/**
 * Класс для управления подключением
 */
export class ConnectionManager {
  constructor(db, onStatusChange, onReconnect, enableHeartbeat = false) {
    this.db = db;
    this.onStatusChange = onStatusChange;
    this.onReconnect = onReconnect;
    this.reconnectTimeout = null;
    this.connectedRef = null;
    this.isReconnecting = false; // Флаг для предотвращения race condition
    this.heartbeatInterval = null; // Интервал для heartbeat
    this.lastHeartbeat = Date.now(); // Время последнего heartbeat
    this.wasConnected = null; // null = еще не инициализировано, false = было disconnected, true = было connected
    this.enableHeartbeat = enableHeartbeat; // Флаг включения heartbeat (по умолчанию отключен)
  }

  /**
   * Инициализирует мониторинг подключения
   */
  init() {
    // Обновляем lastHeartbeat сразу при инициализации
    this.lastHeartbeat = Date.now();
    
    // Мониторинг состояния подключения
    this.connectedRef = this.db.ref('.info/connected');
    this.connectedRef.on('value', (snap) => {
      const isConnected = snap.val() === true;
      
      console.log('🔍 Firebase .info/connected callback:', {
        isConnected,
        wasConnected: this.wasConnected,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Обнаруживаем переход из disconnected в connected (восстановление соединения)
      // ВАЖНО: вызываем callback только если ранее было disconnected (wasConnected === false)
      // и это не первое подключение (wasConnected !== null)
      if (isConnected && this.wasConnected === false) {
        console.log('🔄 Firebase соединение восстановлено после разрыва');
        this.onStatusChange('connected');
        
        // Если есть callback для переподключения, вызываем его
        if (this.onReconnect && typeof this.onReconnect === 'function') {
          console.log('🔄 Вызываем callback переподключения...');
          this.onReconnect().catch(err => {
            console.error('Ошибка при переподключении:', err);
          });
        }
      } else if (isConnected) {
        // Просто обновляем статус без переподключения
        this.onStatusChange('connected');
      } else {
        console.log('⚠️ Firebase соединение потеряно');
        this.onStatusChange('disconnected');
      }
      
      this.wasConnected = isConnected;
      this.lastHeartbeat = Date.now();
      
      console.log('🔍 После обновления:', {
        wasConnected: this.wasConnected,
        lastHeartbeat: new Date(this.lastHeartbeat).toLocaleTimeString()
      });
    });
    
    // Запускаем heartbeat для дополнительной проверки (если включен)
    if (this.enableHeartbeat) {
      console.log('🔍 Heartbeat включен');
      this.startHeartbeat();
    } else {
      console.log('🔍 Heartbeat отключен (используется только Firebase .info/connected)');
    }
  }

  /**
   * Запускает heartbeat для проверки соединения
   */
  startHeartbeat() {
    // Очищаем предыдущий интервал, если есть
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Проверяем соединение каждые 10 секунд
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastHeartbeat = now - this.lastHeartbeat;
      
      // Логируем для отладки
      console.log('🔍 Heartbeat check:', {
        timeSinceLastHeartbeat: Math.round(timeSinceLastHeartbeat / 1000) + 's',
        wasConnected: this.wasConnected,
        threshold: '30s'
      });
      
      // Если прошло больше 30 секунд без обновления, считаем соединение потерянным
      // ВАЖНО: проверяем только если wasConnected === true (не null и не false)
      // Это предотвращает ложное срабатывание при первом запуске
      // Увеличен таймаут с 15 до 30 секунд для большей надежности
      if (timeSinceLastHeartbeat > 30000 && this.wasConnected === true) {
        console.warn('⚠️ Heartbeat timeout: соединение не отвечает');
        this.wasConnected = false;
        this.onStatusChange('disconnected');
      }
    }, 10000); // Проверяем каждые 10 секунд вместо 5
  }

  /**
   * Попытка переподключения
   * @param {Function} reconnectCallback - Функция для переподключения
   */
  attemptReconnect(reconnectCallback) {
    if (this.reconnectTimeout || this.isReconnecting) return; // Уже идет переподключение
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (reconnectCallback) {
        this.isReconnecting = true;
        this.onStatusChange('connecting');
        reconnectCallback()
          .then(() => {
            this.isReconnecting = false;
          })
          .catch(err => {
            console.error('Ошибка переподключения:', err);
            this.isReconnecting = false;
            this.onStatusChange('disconnected');
          });
      }
    }, CONSTANTS.RECONNECT_DELAY);
  }

  /**
   * Очищает мониторинг
   */
  cleanup() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.connectedRef) {
      this.connectedRef.off();
      this.connectedRef = null;
    }
    this.isReconnecting = false;
    this.wasConnected = null; // Сбрасываем в null при очистке
  }
}

