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
    
    if (file.type.startsWith('image/')) {
      const img = document.createElement("img");
      img.src = file.data;
      img.alt = escapeHtml(file.name);
      img.title = escapeHtml(file.name) + " (ПКМ для скачивания)";
      img.className = "message-image";
      
      // Обработчик контекстного меню для скачивания изображения
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.downloadImage(file.data, file.name);
      });
      
      fileContainer.appendChild(img);
    } else if (file.type.startsWith('audio/')) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = file.data;
      audio.className = "message-audio";
      fileContainer.appendChild(audio);
      const filenameSpan = document.createElement("span");
      filenameSpan.className = "message-filename";
      filenameSpan.textContent = escapeHtml(file.name);
      fileContainer.appendChild(filenameSpan);
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = file.data;
      video.className = "message-video";
      fileContainer.appendChild(video);
      const filenameSpan = document.createElement("span");
      filenameSpan.className = "message-filename";
      filenameSpan.textContent = escapeHtml(file.name);
      fileContainer.appendChild(filenameSpan);
    } else {
      const sizeKB = (file.size / 1024).toFixed(2);
      const link = document.createElement("a");
      link.href = file.data;
      link.download = escapeHtml(file.name);
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
      if (!validateFileSize(this.attachedFile.size, CONSTANTS.MAX_FILE_SIZE)) {
        showToast("Файл слишком большой (макс 10MB)");
        this.attachedFile = null;
        this.fileInput.value = "";
        this.isSending = false;
        return;
      }
      
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const fileData = {
              name: escapeHtml(this.attachedFile.name),
              type: this.attachedFile.type,
              size: this.attachedFile.size,
              data: e.target.result // base64
            };

            const messageData = {
              author: escapeHtml(this.myNickname),
              userId: this.myUserId || null, // Добавляем userId для получения аватара
              text: text ? escapeHtml(text) : '',
              file: fileData,
              timestamp: Date.now()
            };

            sendFirebaseMessage(this.roomRef, messageData)
              .then(() => {
                this.chatInput.value = "";
                this.attachedFile = null;
                this.fileInput.value = "";
                this.hideFilePreview();
                this.isSending = false;
                resolve();
              })
              .catch(err => {
                errorHandler.handle(err, { operation: 'sendMessage', hasFile: true });
                showToast("Ошибка при отправке сообщения");
                this.isSending = false;
                reject(err);
              });
          } catch (err) {
            errorHandler.handle(err, { operation: 'processFile', fileName: this.attachedFile?.name });
            showToast("Ошибка при обработке файла");
            this.hideFilePreview();
            this.isSending = false;
            reject(err);
          }
        };
        reader.onerror = () => {
          showToast("Ошибка при чтении файла");
          this.attachedFile = null;
          this.fileInput.value = "";
          this.hideFilePreview();
          this.isSending = false;
          reject(new Error("File read error"));
        };
        reader.readAsDataURL(this.attachedFile);
      });
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

