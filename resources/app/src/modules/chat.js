/**
 * Модуль для работы с чатом
 * Управляет отправкой, получением и отображением сообщений
 */

import { CONSTANTS } from './constants.js';
import { escapeHtml, validateMessageLength, validateFileSize } from '../utils/security.js';
import { sendMessage as sendFirebaseMessage, getUserAvatar } from './firebase.js';
import { errorHandler, ErrorCodes } from './error-handler.js';
import { validateFile as validateFileSecurity } from '../utils/file-security.js';
import { getElementById } from '../utils/dom-cache.js';
import { uploadFile } from '../utils/file-upload.js';

/**
 * Класс для управления чатом
 */
export class ChatManager {
  constructor(roomRef, myNickname, myUserId = null, db = null) {
    this.roomRef = roomRef;
    this.myNickname = myNickname;
    this.myUserId = myUserId;
    this.db = db;
    this.chatMessages = null;
    this.chatInput = null;
    this.attachedFile = null;
    this.fileInput = null;
    this.filePreview = null;
    this.fileName = null;
    this.fileSize = null;
    this.removeFileBtn = null;
    this.lastMessageTime = 0; // Для rate limiting
    this.isSending = false; // Флаг для предотвращения двойной отправки
    this.avatarCache = new Map(); // Кэш аватаров пользователей
  }

  /**
   * Инициализирует элементы DOM для чата
   * @param {HTMLElement} chatMessages - Контейнер для сообщений
   * @param {HTMLElement} chatInput - Поле ввода сообщения
   * @param {HTMLElement} fileInput - Input для файлов
   */
  initElements(chatMessages, chatInput, fileInput) {
    this.chatMessages = chatMessages;
    this.chatInput = chatInput;
    this.fileInput = fileInput;
    // Используем кэшированные функции для оптимизации с fallback
    this.filePreview = getElementById('attachedFilePreview') || document.getElementById('attachedFilePreview');
    this.fileName = getElementById('attachedFileName') || document.getElementById('attachedFileName');
    this.fileSize = getElementById('attachedFileSize') || document.getElementById('attachedFileSize');
    this.removeFileBtn = getElementById('removeAttachedFile') || document.getElementById('removeAttachedFile');
    
    // Обработчик для кнопки удаления файла
    if (this.removeFileBtn) {
      this.removeFileBtn.addEventListener('click', () => {
        this.removeFile();
      });
    }
  }

  /**
   * Загружает аватар пользователя (с кэшированием)
   * @param {string} userId - ID пользователя
   * @returns {Promise<string|null>} URL аватара или null
   */
  async loadUserAvatar(userId) {
    if (!userId || !this.db) return null;
    
    // Проверяем кэш
    if (this.avatarCache.has(userId)) {
      return this.avatarCache.get(userId);
    }
    
    try {
      const avatarUrl = await getUserAvatar(this.db, userId);
      // Кэшируем результат (даже если null)
      this.avatarCache.set(userId, avatarUrl);
      return avatarUrl;
    } catch (error) {
      errorHandler.handleSilent(error, { operation: 'loadUserAvatar', userId });
      this.avatarCache.set(userId, null);
      return null;
    }
  }

  /**
   * Создает элемент аватара для сообщения
   * @param {string} userId - ID пользователя
   * @param {string} nickname - Никнейм пользователя
   * @returns {Promise<HTMLElement>} Элемент аватара
   */
  async createMessageAvatar(userId, nickname) {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    
    // Загружаем аватар пользователя
    const avatarUrl = userId ? await this.loadUserAvatar(userId) : null;
    
    if (avatarUrl) {
      // Показываем пользовательский аватар
      avatar.style.backgroundImage = `url(${avatarUrl})`;
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
      avatar.style.backgroundRepeat = 'no-repeat';
      avatar.style.backgroundColor = 'transparent';
      avatar.textContent = ''; // Убираем текст, так как используется изображение
    } else {
      // Показываем цветной аватар с инициалом
      const avatarColor = this.generateAvatarColor(nickname);
      const avatarInitial = nickname.charAt(0).toUpperCase();
      avatar.style.backgroundImage = 'none';
      avatar.style.background = avatarColor;
      avatar.textContent = avatarInitial;
    }
    
    return avatar;
  }

  /**
   * Отображает сообщение в чате
   * @param {Object} message - Данные сообщения
   */
  async displayMessage(message) {
    if (!this.chatMessages) return;
    
    // Логируем полученное сообщение для отладки
    if (message.file) {
      console.log('📥 Получено сообщение с файлом:', {
        author: message.author,
        fileName: message.file.name,
        fileUrl: message.file.url,
        fileType: message.file.type,
        host: message.file.host
      });
    }
    
    // Удаляем placeholder пустого чата
    const emptyState = this.chatMessages.querySelector('.chat-empty-state');
    if (emptyState) {
      emptyState.remove();
    }
    
    // Удаляем старые сообщения, если их слишком много
    const messages = Array.from(this.chatMessages.children).filter(
      child => child.classList.contains('chat-message')
    );
    
    while (messages.length >= CONSTANTS.MAX_MESSAGES) {
      const firstMessage = this.chatMessages.querySelector('.chat-message');
      if (firstMessage) {
        firstMessage.remove();
      } else {
        break;
      }
    }
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "chat-message";
    
    const time = new Date(message.timestamp || Date.now());
    const timeStr = time.toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Безопасное создание элементов для файлов
    let fileContainer = null;
    if (message.file) {
      fileContainer = this.createFileElement(message.file);
    }
    
    // Аватар автора сообщения
    const authorNick = escapeHtml(message.author || 'Неизвестно');
    const userId = message.userId || null;
    
    // Создаем аватар асинхронно
    const messageAvatar = await this.createMessageAvatar(userId, authorNick);
    messageDiv.appendChild(messageAvatar);
    
    // Безопасное создание контента сообщения
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    contentDiv.style.cssText = "display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0;";
    
    // Заголовок сообщения (автор и время)
    const headerDiv = document.createElement("div");
    headerDiv.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";
    
    const authorSpan = document.createElement("span");
    authorSpan.className = "message-author";
    authorSpan.textContent = `${authorNick}:`;
    headerDiv.appendChild(authorSpan);
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "message-time";
    timeSpan.textContent = timeStr;
    headerDiv.appendChild(timeSpan);
    
    contentDiv.appendChild(headerDiv);
    
    // Текст сообщения
    if (message.text) {
      const textSpan = document.createElement("span");
      textSpan.style.cssText = "word-wrap: break-word;";
      textSpan.textContent = escapeHtml(message.text);
      contentDiv.appendChild(textSpan);
    }
    
    // Файл (если есть)
    if (fileContainer) {
      contentDiv.appendChild(fileContainer);
    }
    
    messageDiv.appendChild(contentDiv);
    
    this.chatMessages.appendChild(messageDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  /**
   * Создает элемент для отображения файла
   * @param {Object} file - Данные файла
   * @returns {HTMLElement} Контейнер с файлом
   */
  createFileElement(file) {
    const fileContainer = document.createElement("div");
    fileContainer.className = "message-file";
    
    // Только URL от Catbox (base64 больше не поддерживается)
    const fileSource = file.url;
    
    if (!fileSource) {
      console.error('Файл без URL (старый формат base64):', file);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'file-error';
      errorDiv.textContent = `⚠️ Файл в старом формате: ${escapeHtml(file.name)}`;
      errorDiv.style.cssText = 'color: #ffa94d; padding: 8px; font-size: 12px;';
      fileContainer.appendChild(errorDiv);
      return fileContainer;
    }
    
    if (file.type.startsWith('image/')) {
      const img = document.createElement("img");
      img.src = fileSource;
      img.alt = escapeHtml(file.name);
      img.title = escapeHtml(file.name) + " (ПКМ для скачивания)";
      img.className = "message-image";
      img.crossOrigin = "anonymous"; // Для загрузки с внешних доменов
      
      // Обработчик ошибки загрузки
      img.addEventListener('error', () => {
        console.error('Ошибка загрузки изображения:', fileSource);
        img.style.display = 'none';
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.textContent = `❌ Не удалось загрузить изображение: ${escapeHtml(file.name)}`;
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px;';
        fileContainer.appendChild(errorMsg);
        
        // Добавляем ссылку для прямого открытия
        const link = document.createElement('a');
        link.href = fileSource;
        link.target = '_blank';
        link.textContent = 'Открыть в браузере';
        link.style.cssText = 'color: #4dabf7; text-decoration: underline; margin-left: 8px;';
        errorMsg.appendChild(link);
      });
      
      // Обработчик контекстного меню для скачивания изображения
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.downloadImage(fileSource, file.name);
      });
      
      fileContainer.appendChild(img);
    } else if (file.type.startsWith('audio/')) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = fileSource;
      audio.className = "message-audio";
      audio.crossOrigin = "anonymous";
      
      // Обработчик ошибки
      audio.addEventListener('error', () => {
        console.error('Ошибка загрузки аудио:', fileSource);
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.innerHTML = `❌ Не удалось загрузить аудио: ${escapeHtml(file.name)} <a href="${fileSource}" target="_blank" style="color: #4dabf7;">Открыть</a>`;
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px;';
        fileContainer.appendChild(errorMsg);
      });
      
      fileContainer.appendChild(audio);
      const filenameSpan = document.createElement("span");
      filenameSpan.className = "message-filename";
      filenameSpan.textContent = escapeHtml(file.name);
      fileContainer.appendChild(filenameSpan);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = fileSource;
      video.className = "message-video";
      video.crossOrigin = "anonymous";
      
      // Обработчик ошибки
      video.addEventListener('error', () => {
        console.error('Ошибка загрузки видео:', fileSource);
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.innerHTML = `❌ Не удалось загрузить видео: ${escapeHtml(file.name)} <a href="${fileSource}" target="_blank" style="color: #4dabf7;">Открыть</a>`;
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px;';
        fileContainer.appendChild(errorMsg);
      });
      
      fileContainer.appendChild(video);
      const filenameSpan = document.createElement("span");
      filenameSpan.className = "message-filename";
      filenameSpan.textContent = escapeHtml(file.name);
      fileContainer.appendChild(filenameSpan);
    } else {
      const sizeKB = (file.size / 1024).toFixed(2);
      const link = document.createElement("a");
      link.href = fileSource;
      link.download = escapeHtml(file.name);
      link.target = "_blank";
      link.className = "message-file-link";
      link.textContent = `📎 ${escapeHtml(file.name)} (${sizeKB} KB)`;
      fileContainer.appendChild(link);
    }
    
    return fileContainer;
  }

  /**
   * Отправляет сообщение
   * @param {Function} showToast - Функция для показа уведомлений
   * @returns {Promise} Promise отправки сообщения
   */
  async sendMessage(showToast) {
    if (!this.roomRef) {
      showToast("Сначала присоединитесь к комнате");
      return;
    }
    
    // Предотвращение двойной отправки
    if (this.isSending) {
      return;
    }
    
    const text = this.chatInput.value.trim();
    if (!text && !this.attachedFile) return;
    
    // Rate limiting - проверка частоты отправки
    const now = Date.now();
    if (now - this.lastMessageTime < CONSTANTS.MESSAGE_RATE_LIMIT) {
      showToast("Слишком быстро! Подождите немного.");
      return;
    }
    this.lastMessageTime = now;
    this.isSending = true;
    
    // Валидируем длину сообщения только если есть текст
    // Если есть только файл без текста - это валидно
    if (text && !validateMessageLength(text, CONSTANTS.MAX_MESSAGE_LENGTH)) {
      showToast(`Сообщение слишком длинное (макс ${CONSTANTS.MAX_MESSAGE_LENGTH} символов)`);
      this.isSending = false;
      return;
    }

    // Если есть прикрепленный файл
    if (this.attachedFile) {
      // Catbox поддерживает до 200MB, но ограничиваем для разумного использования
      if (!validateFileSize(this.attachedFile.size, CONSTANTS.MAX_FILE_SIZE)) {
        const maxSizeMB = Math.round(CONSTANTS.MAX_FILE_SIZE / 1024 / 1024);
        showToast(`Файл слишком большой (макс ${maxSizeMB}MB)`);
        this.attachedFile = null;
        this.fileInput.value = "";
        this.isSending = false;
        return;
      }
      
      try {
        // Показываем прогресс загрузки
        showToast("Загрузка файла на сервер...", 10000, 'info');
        
        // Загружаем файл на Catbox.moe
        const fileData = await uploadFile(this.attachedFile, (percent) => {
          // Можно добавить прогресс-бар позже
          console.log(`Загрузка: ${percent}%`);
        });
        
        console.log('✅ Файл загружен на Catbox:', fileData);
        
        // Отправляем сообщение с URL файла вместо base64
        const messageData = {
          author: escapeHtml(this.myNickname),
          userId: this.myUserId || null,
          text: text ? escapeHtml(text) : '',
          file: {
            url: fileData.url,
            name: escapeHtml(fileData.name),
            type: fileData.type,
            size: fileData.size,
            host: fileData.host
          },
          timestamp: Date.now()
        };

        console.log('📤 Отправка сообщения с файлом в Firebase:', {
          fileName: fileData.name,
          fileUrl: fileData.url,
          fileType: fileData.type,
          fileSize: (fileData.size / 1024).toFixed(2) + ' KB'
        });

        await sendFirebaseMessage(this.roomRef, messageData);
        
        this.chatInput.value = "";
        this.attachedFile = null;
        this.fileInput.value = "";
        this.hideFilePreview();
        this.isSending = false;
        
        showToast("Файл отправлен", 3000, 'success');
      } catch (err) {
        errorHandler.handle(err, { operation: 'uploadFile', fileName: this.attachedFile?.name });
        showToast(err.message || "Ошибка при загрузке файла", 5000, 'error');
        this.isSending = false;
        throw err;
      }
    } else {
      // Обычное текстовое сообщение
      try {
        await sendFirebaseMessage(this.roomRef, {
          author: escapeHtml(this.myNickname),
          userId: this.myUserId || null, // Добавляем userId для получения аватара
          text: escapeHtml(text),
          timestamp: Date.now()
        });
        
        this.chatInput.value = "";
        this.isSending = false;
      } catch (err) {
        errorHandler.handle(err, { operation: 'sendMessage', hasFile: false });
        showToast("Ошибка при отправке сообщения");
        this.isSending = false;
        throw err;
      }
    }
  }

  /**
   * Прикрепляет файл
   * @param {File} file - Файл для прикрепления
   * @param {Function} showToast - Функция для показа уведомлений
   * @returns {boolean} true если файл успешно прикреплен
   */
  async attachFile(file, showToast) {
    if (!file) return false;
    
    // Валидация типа файла с проверкой магических чисел
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/webm',
      'video/mp4', 'video/webm', 'video/ogg'
    ];
    
    // Используем улучшенную проверку файла с проверкой магических чисел
    const validation = await validateFileSecurity(file, {
      allowedTypes: allowedTypes,
      maxSize: CONSTANTS.MAX_FILE_SIZE,
      strictTypeCheck: true // Включаем строгую проверку типа по магическим числам
    });
    
    if (!validation.valid) {
      if (showToast) {
        showToast(validation.error || "Файл не прошел проверку безопасности");
      }
      errorHandler.handleSilent(
        new Error(validation.error || 'File validation failed'),
        { operation: 'attachFile', fileName: file.name, fileType: file.type }
      );
      return false;
    }
    
    this.attachedFile = file;
    this.showFilePreview(file);
    if (showToast) {
      showToast(`Файл "${file.name}" прикреплен`);
    }
    return true;
  }

  /**
   * Показывает плашку с информацией о прикрепленном файле
   * @param {File} file - Файл для отображения
   */
  showFilePreview(file) {
    if (!this.filePreview || !this.fileName || !this.fileSize) return;
    
    // Форматируем размер файла
    const fileSizeFormatted = this.formatFileSize(file.size);
    
    // Получаем расширение файла
    const fileNameParts = file.name.split('.');
    const fileExtension = fileNameParts.length > 1 ? fileNameParts.pop().toUpperCase() : '';
    
    // Обрезаем имя файла, если оно слишком длинное
    const maxNameLength = 30;
    let fileName = escapeHtml(file.name);
    if (fileName.length > maxNameLength) {
      fileName = fileName.substring(0, maxNameLength - 3) + '...';
    }
    
    this.fileName.textContent = fileName;
    this.fileName.title = file.name; // Полное имя в подсказке
    this.fileSize.textContent = fileExtension 
      ? `${fileSizeFormatted} • ${fileExtension}`
      : fileSizeFormatted;
    
    // Показываем плашку
    this.filePreview.style.display = 'flex';
  }

  /**
   * Скрывает плашку с файлом
   */
  hideFilePreview() {
    if (this.filePreview) {
      this.filePreview.style.display = 'none';
    }
  }

  /**
   * Удаляет прикрепленный файл
   */
  removeFile() {
    this.attachedFile = null;
    if (this.fileInput) {
      this.fileInput.value = "";
    }
    this.hideFilePreview();
  }

  /**
   * Форматирует размер файла в читаемый вид
   * @param {number} bytes - Размер в байтах
   * @returns {string} Отформатированный размер
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Скачивает изображение
   * @param {string} imageData - Base64 данные изображения или URL
   * @param {string} fileName - Имя файла для сохранения
   */
  downloadImage(imageData, fileName) {
    // Функция для выполнения скачивания
    const performDownload = (downloadUrl, downloadFileName) => {
      try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = downloadFileName;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        
        // Удаляем ссылку и освобождаем URL если это Blob
        setTimeout(() => {
          if (link.parentNode) {
            document.body.removeChild(link);
          }
          if (downloadUrl.startsWith('blob:')) {
            URL.revokeObjectURL(downloadUrl);
          }
        }, 100);
      } catch (error) {
        errorHandler.handleSilent(error, { operation: 'downloadImage', fileName });
      }
    };

    // Если это base64 data URL, конвертируем в Blob для более надежной работы
    if (imageData.startsWith('data:')) {
      try {
        fetch(imageData)
          .then(res => res.blob())
          .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            performDownload(blobUrl, fileName);
          })
          .catch((err) => {
            // Если fetch не работает, пробуем напрямую
            errorHandler.handleSilent(err, { operation: 'downloadImageFetch', fileName });
            performDownload(imageData, fileName);
          });
      } catch (error) {
        // Fallback: пробуем скачать напрямую
        errorHandler.handleSilent(error, { operation: 'downloadImage', fileName });
        performDownload(imageData, fileName);
      }
    } else {
      // Если это обычный URL, используем напрямую
      performDownload(imageData, fileName);
    }
  }

  /**
   * Очищает чат
   */
  clear() {
    if (this.chatMessages) {
      // Очищаем все содержимое (кнопка теперь находится вне этого контейнера)
      this.chatMessages.innerHTML = "";
      this.showEmptyState();
    }
    this.removeFile();
  }

  /**
   * Показывает placeholder для пустого чата
   */
  showEmptyState() {
    if (!this.chatMessages) return;
    
    // Проверяем, нет ли уже placeholder
    if (this.chatMessages.querySelector('.chat-empty-state')) return;
    
    const emptyState = document.createElement("div");
    emptyState.className = "chat-empty-state";
    emptyState.innerHTML = `
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-text">Нет сообщений</div>
      <div class="empty-state-hint">Начните общение, отправив первое сообщение</div>
    `;
    this.chatMessages.appendChild(emptyState);
  }

  /**
   * Генерирует цвет аватара на основе никнейма
   * @param {string} nickname - Никнейм пользователя
   * @returns {string} CSS градиент
   */
  generateAvatarColor(nickname) {
    // Генерируем цвет на основе хэша никнейма
    let hash = 0;
    for (let i = 0; i < nickname.length; i++) {
      hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Генерируем два цвета для градиента
    const hue1 = Math.abs(hash) % 360;
    const hue2 = (hue1 + 60) % 360;
    
    return `linear-gradient(135deg, hsl(${hue1}, 70%, 60%), hsl(${hue2}, 70%, 50%))`;
  }

  /**
   * Устанавливает ник пользователя
   * @param {string} nickname - Ник пользователя
   */
  setNickname(nickname) {
    this.myNickname = nickname;
  }
}

