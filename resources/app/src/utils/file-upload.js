/**
 * Модуль для загрузки файлов на Catbox.moe
 * Бесплатный хостинг для всех типов файлов (изображения, аудио, видео)
 * Лимиты: до 200 MB на файл, файлы хранятся вечно
 */

import { errorHandler, ErrorCodes } from '../modules/error-handler.js';

/**
 * Загружает изображение на Imgur
 * @param {File} file - Файл для загрузки
 * @returns {Promise<Object>} Данные загруженного файла
 */
export async function uploadToImgur(file) {
  try {
    const formData = new FormData();
    formData.append('image', file);
    
    console.log('📤 Загрузка изображения на Imgur:', {
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      type: file.type
    });

    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': 'Client-ID 546c25a59c58ad7'
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки на Imgur: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.data?.error || 'Imgur upload failed');
    }

    console.log('✅ Файл успешно загружен на Imgur:', data.data.link);

    return {
      url: data.data.link,
      name: file.name,
      size: file.size,
      type: file.type,
      host: 'imgur'
    };
  } catch (error) {
    console.error('❌ Ошибка загрузки на Imgur:', error);
    throw error;
  }
}

/**
 * Загружает файл на Catbox.moe
 * @param {File} file - Файл для загрузки
 * @returns {Promise<Object>} Данные загруженного файла
 */
export async function uploadToCatbox(file) {
  try {
    // Проверка размера файла (200 MB максимум)
    const MAX_SIZE = 200 * 1024 * 1024; // 200 MB
    if (file.size > MAX_SIZE) {
      throw new Error(`Файл слишком большой. Максимальный размер: 200 MB`);
    }

    // Создаем FormData для отправки
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', file);
    
    console.log('📤 Загрузка файла на Catbox:', {
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      type: file.type
    });

    // Отправляем файл на Catbox
    const response = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Ошибка загрузки: ${response.status} ${response.statusText}`);
    }

    // Catbox возвращает просто URL в виде текста
    const url = await response.text();
    
    console.log('📥 Ответ от Catbox:', url);
    
    if (!url || !url.trim()) {
      throw new Error('Catbox вернул пустой ответ');
    }
    
    if (!url.startsWith('https://files.catbox.moe/')) {
      console.error('Некорректный URL от Catbox:', url);
      throw new Error('Получен некорректный URL от Catbox: ' + url);
    }

    console.log('✅ Файл успешно загружен на Catbox:', url);

    return {
      url: url.trim(),
      name: file.name,
      size: file.size,
      type: file.type,
      host: 'catbox'
    };
  } catch (error) {
    console.error('❌ Ошибка загрузки на Catbox:', error);
    errorHandler.handleSilent(error, { 
      operation: 'uploadToCatbox', 
      fileName: file.name,
      fileSize: file.size 
    });
    throw error;
  }
}

/**
 * Загружает файл с прогрессом
 * @param {File} file - Файл для загрузки
 * @param {Function} onProgress - Callback для отслеживания прогресса (percent) => {}
 * @returns {Promise<Object>} Данные загруженного файла
 */
export async function uploadFileWithProgress(file, onProgress) {
  try {
    const MAX_SIZE = 200 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new Error(`Файл слишком большой. Максимальный размер: 200 MB`);
    }

    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Отслеживание прогресса загрузки
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      });

      // Обработка завершения
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const url = xhr.responseText.trim();
          
          if (!url || !url.startsWith('https://files.catbox.moe/')) {
            reject(new Error('Получен некорректный URL от Catbox'));
            return;
          }

          console.log('✅ Файл успешно загружен на Catbox:', url);

          resolve({
            url: url,
            name: file.name,
            size: file.size,
            type: file.type,
            host: 'catbox'
          });
        } else {
          reject(new Error(`Ошибка загрузки: ${xhr.status} ${xhr.statusText}`));
        }
      });

      // Обработка ошибок
      xhr.addEventListener('error', () => {
        reject(new Error('Ошибка сети при загрузке файла'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Загрузка файла отменена'));
      });

      // Отправляем запрос
      xhr.open('POST', 'https://catbox.moe/user/api.php');
      xhr.send(formData);
    });
  } catch (error) {
    console.error('❌ Ошибка загрузки на Catbox:', error);
    errorHandler.handleSilent(error, { 
      operation: 'uploadFileWithProgress', 
      fileName: file.name 
    });
    throw error;
  }
}

/**
 * Основная функция для загрузки файлов
 * Автоматически выбирает метод загрузки с fallback
 * @param {File} file - Файл для загрузки
 * @param {Function} onProgress - Опциональный callback для прогресса
 * @returns {Promise<Object>} Данные загруженного файла
 */
export async function uploadFile(file, onProgress = null) {
  // Для изображений пробуем Imgur (не блокируется), для остального - Catbox
  const isImage = file.type.startsWith('image/');
  
  try {
    if (isImage) {
      // Пробуем Imgur для изображений (работает везде)
      console.log('🎯 Используем Imgur для изображения');
      return await uploadToImgur(file);
    } else {
      // Для аудио/видео используем Catbox
      console.log('🎯 Используем Catbox для файла');
      if (onProgress) {
        return await uploadFileWithProgress(file, onProgress);
      } else {
        return await uploadToCatbox(file);
      }
    }
  } catch (error) {
    console.error('❌ Первая попытка не удалась:', error);
    
    // Fallback: если Imgur не сработал, пробуем Catbox
    if (isImage) {
      console.log('🔄 Fallback: пробуем Catbox для изображения');
      try {
        return await uploadToCatbox(file);
      } catch (fallbackError) {
        console.error('❌ Fallback тоже не сработал:', fallbackError);
        throw new Error('Не удалось загрузить файл ни на один хостинг');
      }
    } else {
      throw error;
    }
  }
}
