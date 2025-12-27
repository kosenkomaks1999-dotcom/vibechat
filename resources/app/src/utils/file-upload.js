/**
 * Модуль для подготовки файлов к отправке через Firebase
 * Конвертирует файлы в base64 для хранения в Firebase
 * Лимит: до 5 MB на файл
 */

import { errorHandler } from '../modules/error-handler.js';



/**
 * Конвертирует файл в base64
 * @param {File} file - Файл для конвертации
 * @returns {Promise<string>} Base64 строка
 */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Конвертирует файл в base64 для Firebase
 * @param {File} file - Файл для конвертации
 * @returns {Promise<Object>} Данные файла
 */
async function convertFileToBase64(file) {
  try {
    // Проверка размера файла (5 MB максимум для base64)
    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      throw new Error(`Файл слишком большой. Максимальный размер: 5 MB`);
    }

    console.log('📤 Конвертация файла в base64:', {
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      type: file.type
    });

    // Конвертируем файл в base64
    const base64 = await fileToBase64(file);

    console.log('✅ Файл сконвертирован в base64');

    return {
      data: base64,
      name: file.name,
      size: file.size,
      type: file.type
    };
  } catch (error) {
    console.error('❌ Ошибка конвертации файла:', error);
    errorHandler.handleSilent(error, { 
      operation: 'convertFileToBase64', 
      fileName: file.name,
      fileSize: file.size 
    });
    throw error;
  }
}

/**
 * Основная функция для подготовки файлов
 * Конвертирует файл в base64 для Firebase
 * @param {File} file - Файл для конвертации
 * @returns {Promise<Object>} Данные файла
 */
export async function uploadFile(file) {
  return await convertFileToBase64(file);
}
