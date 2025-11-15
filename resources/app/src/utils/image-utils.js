/**
 * Утилиты для работы с изображениями
 */

/**
 * Сжимает изображение до указанного размера
 * @param {File} file - Файл изображения
 * @param {number} maxSizeKB - Максимальный размер в KB (по умолчанию 150)
 * @param {number} maxWidth - Максимальная ширина (по умолчанию 512)
 * @param {number} maxHeight - Максимальная высота (по умолчанию 512)
 * @returns {Promise<string>} Base64 строка сжатого изображения
 */
export async function compressImage(file, maxSizeKB = 150, maxWidth = 512, maxHeight = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    
    reader.onload = (e) => {
      img.onload = () => {
        // Вычисляем новые размеры с сохранением пропорций
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = (height / width) * maxWidth;
            width = maxWidth;
          } else {
            width = (width / height) * maxHeight;
            height = maxHeight;
          }
        }
        
        // Создаем canvas и рисуем изображение
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Сжимаем с постепенным уменьшением качества
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        
        // Уменьшаем качество пока размер больше maxSizeKB
        while (dataUrl.length > maxSizeKB * 1024 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        
        resolve(dataUrl);
      };
      
      img.onerror = reject;
      img.src = e.target.result;
    };
    
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Создает URL для предпросмотра изображения
 * @param {File} file - Файл изображения
 * @returns {Promise<string>} Object URL для предпросмотра
 */
export function createImagePreview(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      resolve(objectUrl);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Не удалось загрузить изображение'));
    };
    
    img.src = objectUrl;
  });
}
