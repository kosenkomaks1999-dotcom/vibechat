/**
 * Модуль кэширования списка комнат
 * Оптимизирует загрузку комнат из Firebase
 */

export class RoomsCache {
  constructor() {
    this.cache = null; // Кэшированные данные комнат
    this.lastUpdate = 0; // Время последнего обновления
    this.cacheTimeout = 5000; // Время жизни кэша (5 секунд)
    this.isLoading = false; // Флаг загрузки
    this.pendingCallbacks = []; // Очередь ожидающих callback'ов
  }

  /**
   * Проверяет, валиден ли кэш
   * @returns {boolean}
   */
  isValid() {
    if (!this.cache) return false;
    const now = Date.now();
    return (now - this.lastUpdate) < this.cacheTimeout;
  }

  /**
   * Получает данные из кэша или загружает новые
   * @param {Function} loadFunction - Функция загрузки данных
   * @returns {Promise<Object>} Данные комнат
   */
  async get(loadFunction) {
    // Если кэш валиден, возвращаем его
    if (this.isValid()) {
      console.log('✅ Используем кэшированные данные комнат');
      return this.cache;
    }

    // Если уже идет загрузка, добавляем callback в очередь
    if (this.isLoading) {
      console.log('⏳ Загрузка уже идет, добавляем в очередь');
      return new Promise((resolve, reject) => {
        this.pendingCallbacks.push({ resolve, reject });
      });
    }

    // Начинаем загрузку
    this.isLoading = true;
    console.log('📡 Загружаем свежие данные комнат из Firebase');

    try {
      const data = await loadFunction();
      this.cache = data;
      this.lastUpdate = Date.now();
      this.isLoading = false;

      // Выполняем все ожидающие callback'и
      this.pendingCallbacks.forEach(cb => cb.resolve(data));
      this.pendingCallbacks = [];

      return data;
    } catch (error) {
      this.isLoading = false;
      
      // Отклоняем все ожидающие callback'и
      this.pendingCallbacks.forEach(cb => cb.reject(error));
      this.pendingCallbacks = [];

      throw error;
    }
  }

  /**
   * Инвалидирует кэш (помечает как устаревший)
   */
  invalidate() {
    console.log('🔄 Кэш комнат инвалидирован');
    this.lastUpdate = 0;
  }

  /**
   * Полностью очищает кэш
   */
  clear() {
    console.log('🗑️ Кэш комнат очищен');
    this.cache = null;
    this.lastUpdate = 0;
  }

  /**
   * Обновляет одну комнату в кэше
   * @param {string} roomId - ID комнаты
   * @param {Object} roomData - Данные комнаты
   */
  updateRoom(roomId, roomData) {
    if (!this.cache) return;
    
    if (roomData === null) {
      // Удаляем комнату
      delete this.cache[roomId];
      console.log('🗑️ Комната удалена из кэша:', roomId);
    } else {
      // Обновляем комнату
      this.cache[roomId] = roomData;
      console.log('✅ Комната обновлена в кэше:', roomId);
    }
    
    // Обновляем время последнего изменения
    this.lastUpdate = Date.now();
  }
}
