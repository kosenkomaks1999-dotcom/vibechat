/**
 * Модуль для логирования в текстовый файл
 * Записывает логи в файл через Electron IPC
 */

export class Logger {
  constructor() {
    this.logs = [];
    this.maxLogsInMemory = 100;
    this.isElectron = typeof window !== 'undefined' && window.electronAPI;
  }

  /**
   * Форматирует сообщение лога
   * @param {string} level - Уровень логирования (info, warn, error, debug)
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   * @returns {string} Отформатированная строка лога
   */
  formatLog(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data: data ? JSON.stringify(data, null, 2) : null
    };

    let logLine = `[${timestamp}] [${logEntry.level}] ${message}`;
    if (data) {
      logLine += `\n${logEntry.data}`;
    }

    return logLine;
  }

  /**
   * Записывает лог в файл (если доступен Electron API)
   * @param {string} level - Уровень логирования
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   */
  async writeToFile(level, message, data = null) {
    if (!this.isElectron) {
      // Если не Electron, просто выводим в консоль
      console.log(this.formatLog(level, message, data));
      return;
    }

    try {
      const logLine = this.formatLog(level, message, data);
      await window.electronAPI.writeLog(logLine);
    } catch (error) {
      console.error('Ошибка записи в лог файл:', error);
    }
  }

  /**
   * Логирование информации
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   */
  async info(message, data = null) {
    const logLine = this.formatLog('info', message, data);
    console.log(logLine);
    
    // Сохраняем в памяти (для истории)
    this.logs.push(logLine);
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift();
    }

    // Записываем в файл
    await this.writeToFile('info', message, data);
  }

  /**
   * Логирование предупреждений
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   */
  async warn(message, data = null) {
    const logLine = this.formatLog('warn', message, data);
    console.warn(logLine);
    
    this.logs.push(logLine);
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift();
    }

    await this.writeToFile('warn', message, data);
  }

  /**
   * Логирование ошибок
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   */
  async error(message, data = null) {
    const logLine = this.formatLog('error', message, data);
    console.error(logLine);
    
    this.logs.push(logLine);
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift();
    }

    await this.writeToFile('error', message, data);
  }

  /**
   * Логирование отладочной информации
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные
   */
  async debug(message, data = null) {
    const logLine = this.formatLog('debug', message, data);
    console.debug(logLine);
    
    this.logs.push(logLine);
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift();
    }

    await this.writeToFile('debug', message, data);
  }

  /**
   * Получает историю логов из памяти
   * @returns {Array} Массив логов
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Очищает историю логов в памяти
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Получает все логи из файла (требует IPC метод в Electron)
   * @returns {Promise<string>} Содержимое файла логов
   */
  async getLogFileContent() {
    if (!this.isElectron) {
      return this.logs.join('\n');
    }

    try {
      return await window.electronAPI.readLogFile();
    } catch (error) {
      console.error('Ошибка чтения лог файла:', error);
      return this.logs.join('\n');
    }
  }

  /**
   * Логирование событий комнат в отдельный файл
   * @param {string} event - Событие (create, enter, leave, load, exit_app)
   * @param {string} message - Сообщение
   * @param {Object} data - Дополнительные данные (roomId, roomName, userId, и т.д.)
   */
  async logRoom(event, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      event: event.toUpperCase(),
      message,
      data
    };

    let logLine = `[${timestamp}] [${logEntry.event}] ${message}`;
    if (data) {
      logLine += `\nДанные: ${JSON.stringify(data, null, 2)}`;
    }
    logLine += '\n---\n';

    // Выводим в консоль
    console.log(`[ROOMS LOG] ${logLine}`);

    // Записываем в отдельный файл через Electron API
    if (this.isElectron && window.electronAPI && window.electronAPI.writeRoomLog) {
      try {
        await window.electronAPI.writeRoomLog(logLine);
      } catch (error) {
        console.error('Ошибка записи в лог комнат:', error);
      }
    } else if (!this.isElectron) {
      // Если не Electron, просто выводим в консоль
      console.log(logLine);
    }
  }
}

// Создаем глобальный экземпляр логгера
export const logger = new Logger();

