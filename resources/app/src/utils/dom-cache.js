/**
 * Утилита для кэширования DOM элементов
 * Оптимизирует производительность за счет избежания повторных запросов к DOM
 */

/**
 * Класс для кэширования DOM элементов
 */
class DOMCache {
  constructor() {
    this.cache = new Map();
    this.observers = new Map(); // MutationObserver для отслеживания изменений DOM
  }

  /**
   * Получает элемент по ID с кэшированием
   * @param {string} id - ID элемента
   * @param {boolean} forceRefresh - Принудительно обновить кэш
   * @returns {HTMLElement|null} Элемент или null
   */
  getElementById(id, forceRefresh = false) {
    if (!id || typeof id !== 'string') {
      return null;
    }

    // Если элемент уже в кэше и не требуется обновление
    if (!forceRefresh && this.cache.has(id)) {
      const cached = this.cache.get(id);
      // Проверяем, что элемент все еще в DOM
      if (cached && document.contains(cached)) {
        return cached;
      } else {
        // Элемент удален из DOM, удаляем из кэша
        this.cache.delete(id);
      }
    }

    // Получаем элемент из DOM
    const element = document.getElementById(id);
    
    if (element) {
      this.cache.set(id, element);
      // Настраиваем отслеживание удаления элемента
      this._observeElement(id, element);
    }

    return element;
  }

  /**
   * Получает несколько элементов по ID
   * @param {string[]} ids - Массив ID элементов
   * @returns {Object} Объект с элементами {id: element}
   */
  getElementsByIds(ids) {
    const elements = {};
    ids.forEach(id => {
      elements[id] = this.getElementById(id);
    });
    return elements;
  }

  /**
   * Настраивает отслеживание элемента для автоматической очистки кэша при удалении
   * @param {string} id - ID элемента
   * @param {HTMLElement} element - Элемент для отслеживания
   * @private
   */
  _observeElement(id, element) {
    // Если уже есть observer для этого элемента, не создаем новый
    if (this.observers.has(id)) {
      return;
    }

    // Создаем MutationObserver для отслеживания удаления элемента
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === element || (node.nodeType === 1 && node.contains && node.contains(element))) {
            // Элемент удален, очищаем кэш
            this.cache.delete(id);
            observer.disconnect();
            this.observers.delete(id);
          }
        });
      });
    });

    // Наблюдаем за родительским элементом
    const parent = element.parentNode;
    if (parent) {
      observer.observe(parent, {
        childList: true,
        subtree: true
      });
      this.observers.set(id, observer);
    }
  }

  /**
   * Очищает кэш для конкретного элемента
   * @param {string} id - ID элемента
   */
  clearElement(id) {
    if (this.observers.has(id)) {
      this.observers.get(id).disconnect();
      this.observers.delete(id);
    }
    this.cache.delete(id);
  }

  /**
   * Очищает весь кэш
   */
  clear() {
    // Отключаем все observers
    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();
    this.cache.clear();
  }

  /**
   * Проверяет, есть ли элемент в кэше
   * @param {string} id - ID элемента
   * @returns {boolean} true если элемент в кэше
   */
  has(id) {
    return this.cache.has(id);
  }

  /**
   * Получает размер кэша
   * @returns {number} Количество элементов в кэше
   */
  size() {
    return this.cache.size;
  }
}

// Создаем глобальный экземпляр кэша
export const domCache = new DOMCache();

/**
 * Оптимизированная функция для получения элемента по ID
 * Использует кэш для повышения производительности
 * @param {string} id - ID элемента
 * @param {boolean} forceRefresh - Принудительно обновить кэш
 * @returns {HTMLElement|null} Элемент или null
 */
export function getElementById(id, forceRefresh = false) {
  return domCache.getElementById(id, forceRefresh);
}

/**
 * Оптимизированная функция для получения нескольких элементов
 * @param {string[]} ids - Массив ID элементов
 * @returns {Object} Объект с элементами {id: element}
 */
export function getElementsByIds(ids) {
  return domCache.getElementsByIds(ids);
}

