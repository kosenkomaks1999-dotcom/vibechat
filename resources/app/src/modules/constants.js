/**
 * Константы приложения
 * Все магические числа и ограничения собраны здесь
 */

export const CONSTANTS = {
  // Ограничения чата
  MAX_MESSAGES: 200,
  MAX_MESSAGE_LENGTH: 200,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Ограничения комнат
  MAX_USERS: 8,
  ROOM_ID_MIN_LENGTH: 1,
  ROOM_ID_MAX_LENGTH: 50,
  ROOM_ID_PATTERN: /^[a-zA-Z0-9_-]+$/, // Только буквы, цифры, дефис и подчеркивание
  
  // Пороги для детекции речи
  SPEECH_DETECTION: {
    RMS_THRESHOLD_ON: 0.015,   // Порог для включения подсветки
    RMS_THRESHOLD_OFF: 0.008,   // Порог для выключения (ниже, чтобы не мерцала)
    FREQ_THRESHOLD_ON: 15,      // Порог частот для включения
    FREQ_THRESHOLD_OFF: 10      // Порог частот для выключения
  },
  
  // Настройки анализатора аудио
  AUDIO_ANALYSER: {
    FFT_SIZE: 256,
    SMOOTHING_TIME_CONSTANT: 0.8
  },
  
  // Настройки звуковых уведомлений
  NOTIFICATION_SOUNDS: {
    JOIN: {
      START_FREQ: 400,
      END_FREQ: 600,
      DURATION: 0.15
    },
    LEAVE: {
      START_FREQ: 500,
      END_FREQ: 300,
      DURATION: 0.2
    },
    GAIN: 0.3
  },
  
  // Настройки UI
  TOAST_DURATION: 2000,
  DEFAULT_NICKNAME: "Player",
  MAX_NICKNAME_LENGTH: 15, // Максимальная длина никнейма
  
  // Производительность
  SPEECH_CHECK_INTERVAL: 100, // проверка каждые 100ms вместо каждого кадра
  MESSAGE_RATE_LIMIT: 1000, // 1 сообщение в секунду
  RECONNECT_DELAY: 2000 // задержка перед переподключением
};

