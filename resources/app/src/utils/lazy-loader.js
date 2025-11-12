/**
 * Утилита для lazy loading модулей
 * Загружает модули только когда они нужны, улучшая производительность
 */

/**
 * Класс для управления lazy loading модулей
 */
class LazyLoader {
  constructor() {
    this.loadedModules = new Map(); // Кэш загруженных модулей
    this.loadingPromises = new Map(); // Промисы для модулей в процессе загрузки
  }

  /**
   * Загружает модуль динамически
   * @param {string} modulePath - Путь к модулю
   * @param {boolean} forceReload - Принудительно перезагрузить модуль
   * @returns {Promise<Object>} Promise с экспортами модуля
   */
  async loadModule(modulePath, forceReload = false) {
    // Если модуль уже загружен и не требуется перезагрузка
    if (!forceReload && this.loadedModules.has(modulePath)) {
      return this.loadedModules.get(modulePath);
    }

    // Если модуль уже загружается, возвращаем существующий промис
    if (this.loadingPromises.has(modulePath)) {
      return this.loadingPromises.get(modulePath);
    }

    // Создаем промис для загрузки модуля
    const loadPromise = import(modulePath)
      .then(module => {
        // Сохраняем загруженный модуль в кэш
        this.loadedModules.set(modulePath, module);
        // Удаляем промис из списка загружающихся
        this.loadingPromises.delete(modulePath);
        return module;
      })
      .catch(error => {
        // Удаляем промис при ошибке
        this.loadingPromises.delete(modulePath);
        throw error;
      });

    // Сохраняем промис в списке загружающихся
    this.loadingPromises.set(modulePath, loadPromise);

    return loadPromise;
  }

  /**
   * Предзагружает модуль (загружает заранее, но не блокирует)
   * @param {string} modulePath - Путь к модулю
   * @returns {Promise<Object>} Promise с экспортами модуля
   */
  async preloadModule(modulePath) {
    return this.loadModule(modulePath);
  }

  /**
   * Предзагружает несколько модулей параллельно
   * @param {string[]} modulePaths - Массив путей к модулям
   * @returns {Promise<Object[]>} Promise с массивом экспортов модулей
   */
  async preloadModules(modulePaths) {
    return Promise.all(modulePaths.map(path => this.preloadModule(path)));
  }

  /**
   * Проверяет, загружен ли модуль
   * @param {string} modulePath - Путь к модулю
   * @returns {boolean} true если модуль загружен
   */
  isLoaded(modulePath) {
    return this.loadedModules.has(modulePath);
  }

  /**
   * Очищает кэш загруженных модулей
   * @param {string} modulePath - Путь к модулю (опционально, если не указан - очищает весь кэш)
   */
  clearCache(modulePath = null) {
    if (modulePath) {
      this.loadedModules.delete(modulePath);
    } else {
      this.loadedModules.clear();
    }
  }

  /**
   * Получает список загруженных модулей
   * @returns {string[]} Массив путей к загруженным модулям
   */
  getLoadedModules() {
    return Array.from(this.loadedModules.keys());
  }
}

// Создаем глобальный экземпляр lazy loader
export const lazyLoader = new LazyLoader();

/**
 * Удобная функция для lazy loading модуля
 * @param {string} modulePath - Путь к модулю
 * @returns {Promise<Object>} Promise с экспортами модуля
 */
export async function loadModule(modulePath) {
  return lazyLoader.loadModule(modulePath);
}

/**
 * Удобная функция для предзагрузки модуля
 * @param {string} modulePath - Путь к модулю
 * @returns {Promise<Object>} Promise с экспортами модуля
 */
export async function preloadModule(modulePath) {
  return lazyLoader.preloadModule(modulePath);
}

