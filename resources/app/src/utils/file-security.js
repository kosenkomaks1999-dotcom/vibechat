/**
 * Утилиты безопасности для проверки файлов
 * Проверка магических чисел файлов для определения реального типа
 */

/**
 * Магические числа для различных типов файлов
 * Первые байты файла, которые определяют его тип
 */
const FILE_SIGNATURES = {
  // Изображения
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]], // RIFF....WEBP
  'image/bmp': [[0x42, 0x4D]],
  
  // Аудио
  'audio/mpeg': [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]], // MP3 или ID3 tag
  'audio/wav': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45]], // RIFF....WAVE
  'audio/ogg': [[0x4F, 0x67, 0x67, 0x53]],
  'audio/flac': [[0x66, 0x4C, 0x61, 0x43]],
  
  // Видео
  'video/mp4': [[0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70]], // ....ftyp
  'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
  'video/avi': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x41, 0x56, 0x49, 0x20]], // RIFF....AVI
  
  // Документы
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'application/zip': [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06], [0x50, 0x4B, 0x07, 0x08]],
};

/**
 * Проверяет, соответствует ли массив байтов сигнатуре файла
 * @param {Uint8Array} bytes - Массив байтов файла
 * @param {Array} signature - Сигнатура файла (массив чисел или null для пропуска)
 * @returns {boolean} true если соответствует
 */
function matchesSignature(bytes, signature) {
  if (bytes.length < signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    // null означает "любой байт" (для пропуска позиций)
    if (signature[i] !== null && bytes[i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Определяет реальный тип файла по магическим числам
 * @param {File} file - Файл для проверки
 * @returns {Promise<string|null>} MIME-тип файла или null если не удалось определить
 */
export async function detectFileType(file) {
  if (!file || !(file instanceof File)) {
    return null;
  }

  try {
    // Читаем первые 12 байт файла (достаточно для большинства форматов)
    const buffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Проверяем каждую сигнатуру
    for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
      for (const signature of signatures) {
        if (matchesSignature(bytes, signature)) {
          return mimeType;
        }
      }
    }

    // Если не нашли совпадение, возвращаем null
    return null;
  } catch (error) {
    console.error('Ошибка при определении типа файла:', error);
    return null;
  }
}

/**
 * Проверяет, соответствует ли реальный тип файла заявленному MIME-типу
 * @param {File} file - Файл для проверки
 * @param {string} expectedMimeType - Ожидаемый MIME-тип
 * @returns {Promise<boolean>} true если типы совпадают
 */
export async function validateFileType(file, expectedMimeType) {
  if (!file || !expectedMimeType) {
    return false;
  }

  // Определяем реальный тип файла
  const detectedType = await detectFileType(file);

  // Если не удалось определить тип, разрешаем файл (fallback)
  if (!detectedType) {
    console.warn('Не удалось определить тип файла, разрешаем по заявленному типу');
    return true;
  }

  // Проверяем соответствие
  // Разрешаем, если типы точно совпадают или если заявленный тип более общий
  // Например, image/* должен соответствовать image/png, image/jpeg и т.д.
  if (detectedType === expectedMimeType) {
    return true;
  }

  // Проверяем общие типы (image/*, audio/*, video/*)
  const detectedCategory = detectedType.split('/')[0];
  const expectedCategory = expectedMimeType.split('/')[0];
  const expectedSubtype = expectedMimeType.split('/')[1];

  if (expectedSubtype === '*' && detectedCategory === expectedCategory) {
    return true;
  }

  return false;
}

/**
 * Проверяет безопасность файла (тип и размер)
 * @param {File} file - Файл для проверки
 * @param {Object} options - Опции проверки
 * @param {string|string[]} options.allowedTypes - Разрешенные MIME-типы
 * @param {number} options.maxSize - Максимальный размер в байтах
 * @param {boolean} options.strictTypeCheck - Строгая проверка типа (по магическим числам)
 * @returns {Promise<{valid: boolean, error?: string}>} Результат проверки
 */
export async function validateFile(file, options = {}) {
  const {
    allowedTypes = [],
    maxSize = 10 * 1024 * 1024, // 10MB по умолчанию
    strictTypeCheck = true
  } = options;

  // Проверка размера
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `Файл слишком большой. Максимальный размер: ${(maxSize / 1024 / 1024).toFixed(2)} MB`
    };
  }

  // Проверка типа
  if (allowedTypes.length > 0) {
    const allowedTypesArray = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
    const fileType = file.type || '';

    // Проверяем соответствие заявленному типу
    let typeMatches = allowedTypesArray.some(type => {
      if (type.endsWith('/*')) {
        // Общий тип (image/*, audio/* и т.д.)
        const category = type.split('/')[0];
        return fileType.startsWith(category + '/');
      }
      return fileType === type;
    });

    // Если включена строгая проверка, проверяем реальный тип файла
    if (strictTypeCheck && typeMatches) {
      const realTypeMatches = await Promise.all(
        allowedTypesArray.map(async (type) => {
          if (type.endsWith('/*')) {
            const category = type.split('/')[0];
            const detectedType = await detectFileType(file);
            return detectedType && detectedType.startsWith(category + '/');
          }
          return await validateFileType(file, type);
        })
      );

      if (!realTypeMatches.some(match => match)) {
        return {
          valid: false,
          error: 'Тип файла не соответствует заявленному. Возможна подмена типа файла.'
        };
      }
    } else if (!typeMatches) {
      return {
        valid: false,
        error: `Неподдерживаемый тип файла. Разрешенные типы: ${allowedTypesArray.join(', ')}`
      };
    }
  }

  return { valid: true };
}

/**
 * Получает информацию о файле (тип, размер, безопасность)
 * @param {File} file - Файл для анализа
 * @returns {Promise<Object>} Информация о файле
 */
export async function getFileInfo(file) {
  const detectedType = await detectFileType(file);
  
  return {
    name: file.name,
    size: file.size,
    declaredType: file.type,
    detectedType: detectedType,
    typeMatches: detectedType ? (file.type === detectedType || file.type.startsWith(detectedType.split('/')[0] + '/')) : null,
    sizeFormatted: formatFileSize(file.size)
  };
}

/**
 * Форматирует размер файла в читаемый вид
 * @param {number} bytes - Размер в байтах
 * @returns {string} Отформатированный размер
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

