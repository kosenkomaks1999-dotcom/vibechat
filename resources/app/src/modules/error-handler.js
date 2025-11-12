/**
 * Централизованная система обработки ошибок
 * Обеспечивает единообразную обработку ошибок во всем приложении
 */

import { logger } from './logger.js';

/**
 * Коды ошибок приложения
 */
export const ErrorCodes = {
  // Общие ошибки
  UNKNOWN: 'UNKNOWN_ERROR',
  NETWORK: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT_ERROR',
  
  // Ошибки авторизации
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  
  // Ошибки комнат
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CREATE_FAILED: 'ROOM_CREATE_FAILED',
  ROOM_JOIN_FAILED: 'ROOM_JOIN_FAILED',
  
  // Ошибки валидации
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_NICKNAME: 'INVALID_NICKNAME',
  NICKNAME_TAKEN: 'NICKNAME_TAKEN',
  
  // Ошибки файлов
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  
  // Ошибки WebRTC
  MICROPHONE_ACCESS_DENIED: 'MICROPHONE_ACCESS_DENIED',
  WEBRTC_CONNECTION_FAILED: 'WEBRTC_CONNECTION_FAILED',
  
  // Ошибки Firebase
  FIREBASE_INIT_FAILED: 'FIREBASE_INIT_FAILED',
  FIREBASE_PERMISSION_DENIED: 'FIREBASE_PERMISSION_DENIED',
  
  // Ошибки профиля
  PROFILE_UPDATE_FAILED: 'PROFILE_UPDATE_FAILED',
  AVATAR_UPLOAD_FAILED: 'AVATAR_UPLOAD_FAILED'
};

/**
 * Класс ошибки приложения
 */
export class AppError extends Error {
  constructor(message, code = ErrorCodes.UNKNOWN, context = null, originalError = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
    this.originalError = originalError;
    this.timestamp = Date.now();
    
    // Сохраняем стек трейс оригинальной ошибки если есть
    if (originalError && originalError.stack) {
      this.stack = originalError.stack;
    }
  }

  /**
   * Преобразует ошибку в объект для логирования
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Класс для централизованной обработки ошибок
 */
export class ErrorHandler {
  constructor() {
    this.errorCallbacks = [];
    this.uiToastCallback = null;
  }

  /**
   * Регистрирует callback для обработки ошибок
   * @param {Function} callback - Функция обработки (error, context) => {}
   */
  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  /**
   * Регистрирует callback для показа уведомлений пользователю
   * @param {Function} callback - Функция показа toast (message) => {}
   */
  setUIToastCallback(callback) {
    this.uiToastCallback = callback;
  }

  /**
   * Обрабатывает ошибку
   * @param {Error|AppError|string} error - Ошибка для обработки
   * @param {Object} context - Контекст ошибки
   * @param {Object} options - Опции обработки
   * @returns {AppError} Обработанная ошибка
   */
  handle(error, context = {}, options = {}) {
    const {
      showToast = true,
      logError = true,
      code = null,
      userMessage = null
    } = options;

    // Преобразуем ошибку в AppError
    let appError;
    
    if (error instanceof AppError) {
      appError = error;
      // Обновляем контекст если передан
      if (context) {
        appError.context = { ...appError.context, ...context };
      }
    } else if (error instanceof Error) {
      // Определяем код ошибки на основе типа или сообщения
      const errorCode = code || this._detectErrorCode(error);
      appError = new AppError(
        userMessage || error.message || 'Произошла неизвестная ошибка',
        errorCode,
        context,
        error
      );
    } else if (typeof error === 'string') {
      const errorCode = code || ErrorCodes.UNKNOWN;
      appError = new AppError(
        userMessage || error,
        errorCode,
        context
      );
    } else {
      appError = new AppError(
        userMessage || 'Произошла неизвестная ошибка',
        code || ErrorCodes.UNKNOWN,
        context
      );
    }

    // Логируем ошибку
    if (logError) {
      this._logError(appError);
    }

    // Показываем уведомление пользователю
    if (showToast && this.uiToastCallback) {
      const message = this._getUserMessage(appError);
      this.uiToastCallback(message);
    }

    // Вызываем зарегистрированные callbacks
    this.errorCallbacks.forEach(callback => {
      try {
        callback(appError, context);
      } catch (e) {
        console.error('Ошибка в callback обработки ошибок:', e);
      }
    });

    return appError;
  }

  /**
   * Обрабатывает ошибку без показа уведомления
   * @param {Error|AppError|string} error - Ошибка
   * @param {Object} context - Контекст
   * @returns {AppError} Обработанная ошибка
   */
  handleSilent(error, context = {}) {
    return this.handle(error, context, { showToast: false });
  }

  /**
   * Логирует ошибку
   * @param {AppError} error - Ошибка для логирования
   * @private
   */
  async _logError(error) {
    try {
      await logger.error('Ошибка приложения', {
        error: error.toJSON(),
        code: error.code,
        message: error.message,
        context: error.context,
        stack: error.stack
      });
    } catch (logError) {
      // Если логирование не удалось, выводим в console
      console.error('Ошибка логирования:', logError);
      console.error('Оригинальная ошибка:', error);
    }
  }

  /**
   * Определяет код ошибки на основе типа или сообщения
   * @param {Error} error - Ошибка
   * @returns {string} Код ошибки
   * @private
   */
  _detectErrorCode(error) {
    const message = error.message?.toLowerCase() || '';
    const errorName = error.name?.toLowerCase() || '';

    // Сетевые ошибки
    if (message.includes('network') || message.includes('fetch') || errorName === 'networkerror') {
      return ErrorCodes.NETWORK;
    }

    // Firebase ошибки
    if (message.includes('firebase') || errorName.includes('firebase')) {
      if (message.includes('permission') || message.includes('denied')) {
        return ErrorCodes.FIREBASE_PERMISSION_DENIED;
      }
      return ErrorCodes.FIREBASE_INIT_FAILED;
    }

    // Ошибки авторизации
    if (message.includes('auth') || message.includes('unauthorized') || message.includes('forbidden')) {
      if (message.includes('invalid') || message.includes('wrong')) {
        return ErrorCodes.INVALID_CREDENTIALS;
      }
      return ErrorCodes.AUTH_FAILED;
    }

    // Ошибки комнат
    if (message.includes('room')) {
      if (message.includes('not found') || message.includes('не существует')) {
        return ErrorCodes.ROOM_NOT_FOUND;
      }
      if (message.includes('full') || message.includes('заполнен')) {
        return ErrorCodes.ROOM_FULL;
      }
      return ErrorCodes.ROOM_JOIN_FAILED;
    }

    // Ошибки файлов
    if (message.includes('file')) {
      if (message.includes('too large') || message.includes('большой')) {
        return ErrorCodes.FILE_TOO_LARGE;
      }
      if (message.includes('type') || message.includes('тип')) {
        return ErrorCodes.INVALID_FILE_TYPE;
      }
      return ErrorCodes.FILE_UPLOAD_FAILED;
    }

    // WebRTC ошибки
    if (message.includes('microphone') || message.includes('permission')) {
      return ErrorCodes.MICROPHONE_ACCESS_DENIED;
    }
    if (message.includes('webrtc') || message.includes('peer')) {
      return ErrorCodes.WEBRTC_CONNECTION_FAILED;
    }

    // Валидация
    if (message.includes('validation') || message.includes('invalid') || message.includes('валидац')) {
      if (message.includes('nickname') || message.includes('никнейм')) {
        return ErrorCodes.INVALID_NICKNAME;
      }
      return ErrorCodes.VALIDATION_ERROR;
    }

    return ErrorCodes.UNKNOWN;
  }

  /**
   * Получает пользовательское сообщение об ошибке
   * @param {AppError} error - Ошибка
   * @returns {string} Сообщение для пользователя
   * @private
   */
  _getUserMessage(error) {
    // Используем предустановленные сообщения для известных ошибок
    const messages = {
      [ErrorCodes.NETWORK]: 'Ошибка сети. Проверьте подключение к интернету',
      [ErrorCodes.AUTH_FAILED]: 'Ошибка авторизации',
      [ErrorCodes.INVALID_CREDENTIALS]: 'Неверный логин или пароль',
      [ErrorCodes.ROOM_NOT_FOUND]: 'Комната не найдена',
      [ErrorCodes.ROOM_FULL]: 'Комната заполнена',
      [ErrorCodes.ROOM_CREATE_FAILED]: 'Ошибка при создании комнаты',
      [ErrorCodes.ROOM_JOIN_FAILED]: 'Ошибка при присоединении к комнате',
      [ErrorCodes.INVALID_NICKNAME]: 'Некорректный никнейм',
      [ErrorCodes.NICKNAME_TAKEN]: 'Этот никнейм уже занят',
      [ErrorCodes.FILE_TOO_LARGE]: 'Файл слишком большой',
      [ErrorCodes.INVALID_FILE_TYPE]: 'Неподдерживаемый тип файла',
      [ErrorCodes.MICROPHONE_ACCESS_DENIED]: 'Доступ к микрофону запрещен',
      [ErrorCodes.WEBRTC_CONNECTION_FAILED]: 'Ошибка соединения',
      [ErrorCodes.FIREBASE_INIT_FAILED]: 'Ошибка инициализации базы данных',
      [ErrorCodes.FIREBASE_PERMISSION_DENIED]: 'Нет доступа к данным',
      [ErrorCodes.PROFILE_UPDATE_FAILED]: 'Ошибка при обновлении профиля',
      [ErrorCodes.AVATAR_UPLOAD_FAILED]: 'Ошибка при загрузке аватара'
    };

    return messages[error.code] || error.message || 'Произошла ошибка. Попробуйте еще раз';
  }

  /**
   * Создает ошибку с указанным кодом
   * @param {string} message - Сообщение об ошибке
   * @param {string} code - Код ошибки
   * @param {Object} context - Контекст
   * @returns {AppError} Созданная ошибка
   */
  createError(message, code = ErrorCodes.UNKNOWN, context = {}) {
    return new AppError(message, code, context);
  }

  /**
   * Оборачивает асинхронную функцию для автоматической обработки ошибок
   * @param {Function} fn - Асинхронная функция
   * @param {Object} options - Опции обработки
   * @returns {Function} Обернутая функция
   */
  wrapAsync(fn, options = {}) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handle(error, { function: fn.name, args }, options);
        throw error;
      }
    };
  }
}

// Создаем глобальный экземпляр обработчика ошибок
export const errorHandler = new ErrorHandler();


