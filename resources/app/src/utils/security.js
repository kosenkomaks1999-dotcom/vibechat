/**
 * Утилиты безопасности
 * Функции для защиты от XSS и других атак
 */

/**
 * Экранирует HTML специальные символы для защиты от XSS
 * @param {string} text - Текст для экранирования
 * @returns {string} Экранированный HTML-безопасный текст
 */
export function escapeHtml(text) {
  if (text == null) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Валидирует длину сообщения
 * @param {string} text - Текст сообщения
 * @param {number} maxLength - Максимальная длина
 * @returns {boolean} true если валидно
 */
export function validateMessageLength(text, maxLength) {
  if (!text || typeof text !== 'string') return false;
  return text.length > 0 && text.length <= maxLength;
}

/**
 * Валидирует размер файла
 * @param {number} fileSize - Размер файла в байтах
 * @param {number} maxSize - Максимальный размер в байтах
 * @returns {boolean} true если валидно
 */
export function validateFileSize(fileSize, maxSize) {
  return fileSize <= maxSize;
}

/**
 * Валидирует длину никнейма
 * @param {string} nickname - Никнейм для валидации
 * @param {number} maxLength - Максимальная длина
 * @returns {boolean} true если валидно
 */
export function validateNicknameLength(nickname, maxLength) {
  if (!nickname || typeof nickname !== 'string') return false;
  const trimmed = nickname.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

/**
 * Валидирует формат никнейма (только буквы, цифры, дефис и подчеркивание)
 * @param {string} nickname - Никнейм для валидации
 * @returns {boolean} true если валидно
 */
export function validateNicknameFormat(nickname) {
  if (!nickname || !nickname.trim()) {
    return false;
  }
  // Разрешаем только буквы (латиница и кириллица), цифры, дефис и подчеркивание
  const nicknamePattern = /^[a-zA-Zа-яА-ЯёЁ0-9_-]+$/;
  return nicknamePattern.test(nickname.trim());
}

