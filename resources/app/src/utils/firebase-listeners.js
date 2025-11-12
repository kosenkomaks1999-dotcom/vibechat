/**
 * Менеджер Firebase слушателей
 * Управляет подписками и предотвращает утечки памяти
 */

export class FirebaseListenersManager {
  constructor() {
    this.listeners = new Map(); // Map<listenerId, {ref, events}>
  }

  /**
   * Регистрирует слушатель
   * @param {string} listenerId - Уникальный ID слушателя
   * @param {Object} ref - Firebase reference
   * @param {string} event - Тип события ('value', 'child_added', и т.д.)
   * @param {Function} callback - Callback функция
   */
  register(listenerId, ref, event, callback) {
    // Если слушатель с таким ID уже существует, отписываемся от него
    if (this.listeners.has(listenerId)) {
      console.warn(`⚠️ Слушатель ${listenerId} уже существует, отписываемся от старого`);
      this.unregister(listenerId);
    }

    // Подписываемся на событие
    ref.on(event, callback);

    // Сохраняем информацию о слушателе
    this.listeners.set(listenerId, {
      ref,
      events: [{ event, callback }]
    });

    console.log(`✅ Слушатель ${listenerId} зарегистрирован (${event})`);
  }

  /**
   * Регистрирует несколько событий для одного слушателя
   * @param {string} listenerId - Уникальный ID слушателя
   * @param {Object} ref - Firebase reference
   * @param {Array} events - Массив объектов {event, callback}
   */
  registerMultiple(listenerId, ref, events) {
    // Если слушатель с таким ID уже существует, отписываемся от него
    if (this.listeners.has(listenerId)) {
      console.warn(`⚠️ Слушатель ${listenerId} уже существует, отписываемся от старого`);
      this.unregister(listenerId);
    }

    // Подписываемся на все события
    events.forEach(({ event, callback }) => {
      ref.on(event, callback);
    });

    // Сохраняем информацию о слушателе
    this.listeners.set(listenerId, { ref, events });

    console.log(`✅ Слушатель ${listenerId} зарегистрирован (${events.length} событий)`);
  }

  /**
   * Отписывается от слушателя
   * @param {string} listenerId - ID слушателя
   */
  unregister(listenerId) {
    const listener = this.listeners.get(listenerId);
    if (!listener) {
      console.warn(`⚠️ Слушатель ${listenerId} не найден`);
      return;
    }

    // Отписываемся от всех событий
    listener.events.forEach(({ event, callback }) => {
      listener.ref.off(event, callback);
    });

    // Удаляем из Map
    this.listeners.delete(listenerId);

    console.log(`✅ Слушатель ${listenerId} отписан`);
  }

  /**
   * Отписывается от всех слушателей
   */
  unregisterAll() {
    console.log(`🗑️ Отписываемся от всех слушателей (${this.listeners.size})`);
    
    this.listeners.forEach((listener, listenerId) => {
      listener.events.forEach(({ event, callback }) => {
        listener.ref.off(event, callback);
      });
    });

    this.listeners.clear();
    console.log('✅ Все слушатели отписаны');
  }

  /**
   * Проверяет, зарегистрирован ли слушатель
   * @param {string} listenerId - ID слушателя
   * @returns {boolean}
   */
  has(listenerId) {
    return this.listeners.has(listenerId);
  }

  /**
   * Получает количество активных слушателей
   * @returns {number}
   */
  count() {
    return this.listeners.size;
  }

  /**
   * Получает список всех активных слушателей
   * @returns {Array<string>}
   */
  list() {
    return Array.from(this.listeners.keys());
  }
}
