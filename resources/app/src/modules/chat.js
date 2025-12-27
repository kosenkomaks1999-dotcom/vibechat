/**
 * Модуль для работы с чатом
 * Управляет отправкой, получением и отображением сообщений
 */

import { CONSTANTS } from './constants.js';
import { escapeHtml, validateMessageLength, validateFileSize } from '../utils/security.js';
import { sendMessage as sendFirebaseMessage, getUserAvatar } from './firebase.js';
import { errorHandler } from './error-handler.js';
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
    console.log('📥 Получено сообщение:', {
      author: message.author,
      text: message.text,
      hasFile: !!message.file,
      file: message.file
    });
    
    if (message.file) {
      console.log('📎 Детали файла:', {
        fileName: message.file.name,
        fileType: message.file.type,
        fileSize: message.file.size,
        hasData: !!message.file.data
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
      const textContainer = this.createMessageText(message.text);
      contentDiv.appendChild(textContainer);
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
   * Создает элемент с текстом сообщения, преобразуя ссылки в кликабельные
   * @param {string} text - Текст сообщения
   * @returns {HTMLElement} Контейнер с текстом
   */
  createMessageText(text) {
    const container = document.createElement("div");
    container.style.cssText = "word-wrap: break-word; display: flex; flex-direction: column; gap: 8px;";
    
    // Регулярное выражение для поиска URL
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex) || [];
    
    // Создаем текстовый элемент с кликабельными ссылками
    const textSpan = document.createElement("span");
    textSpan.style.cssText = "word-wrap: break-word;";
    
    if (urls.length > 0) {
      // Разбиваем текст на части и создаем ссылки
      let lastIndex = 0;
      const fragment = document.createDocumentFragment();
      
      text.replace(urlRegex, (match, url, offset) => {
        // Добавляем текст до ссылки
        if (offset > lastIndex) {
          const textNode = document.createTextNode(escapeHtml(text.substring(lastIndex, offset)));
          fragment.appendChild(textNode);
        }
        
        // Создаем кликабельную ссылку
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url;
        link.style.cssText = "color: #4dabf7; text-decoration: underline; word-break: break-all;";
        fragment.appendChild(link);
        
        lastIndex = offset + match.length;
        return match;
      });
      
      // Добавляем оставшийся текст
      if (lastIndex < text.length) {
        const textNode = document.createTextNode(escapeHtml(text.substring(lastIndex)));
        fragment.appendChild(textNode);
      }
      
      textSpan.appendChild(fragment);
    } else {
      // Если ссылок нет, просто показываем текст
      textSpan.textContent = escapeHtml(text);
    }
    
    container.appendChild(textSpan);
    
    // Добавляем превью для первой ссылки
    if (urls.length > 0) {
      const firstUrl = urls[0];
      this.createLinkPreview(firstUrl).then(preview => {
        if (preview) {
          container.appendChild(preview);
        }
      });
    }
    
    return container;
  }

  /**
   * Создает превью для ссылки (Open Graph)
   * @param {string} url - URL для превью
   * @returns {Promise<HTMLElement|null>} Элемент превью или null
   */
  async createLinkPreview(url) {
    try {
      // Создаем превью контейнер
      const previewContainer = document.createElement("div");
      previewContainer.className = "link-preview";
      previewContainer.style.cssText = `
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        overflow: hidden;
        max-width: 400px;
        background: rgba(255, 255, 255, 0.05);
        cursor: pointer;
        transition: background 0.2s;
        display: flex;
        flex-direction: row;
      `;
      
      previewContainer.addEventListener('mouseenter', () => {
        previewContainer.style.background = 'rgba(255, 255, 255, 0.08)';
      });
      
      previewContainer.addEventListener('mouseleave', () => {
        previewContainer.style.background = 'rgba(255, 255, 255, 0.05)';
      });
      
      previewContainer.addEventListener('click', (e) => {
        e.preventDefault();
        // Создаем временную ссылку для открытия в системном браузере
        const tempLink = document.createElement('a');
        tempLink.href = url;
        tempLink.target = '_blank';
        tempLink.rel = 'noopener noreferrer';
        tempLink.click();
      });
      
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      
      // Проверяем, является ли ссылка прямой ссылкой на изображение
      // Убираем параметры запроса для проверки расширения
      const urlPath = urlObj.pathname.toLowerCase();
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      const isDirectImage = imageExtensions.some(ext => urlPath.endsWith(ext));
      
      console.log('🔍 Проверка ссылки на изображение:', {
        url: url,
        path: urlPath,
        isDirectImage: isDirectImage
      });
      
      // Если это прямая ссылка на изображение, показываем превью
      if (isDirectImage) {
        const previewImage = document.createElement("img");
        previewImage.crossOrigin = "anonymous"; // Попытка обойти CORS
        previewImage.src = url;
        previewImage.style.cssText = `
          width: 80px;
          height: 80px;
          object-fit: cover;
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.05);
        `;
        
        previewImage.onload = () => {
          console.log('✅ Превью изображения загружено:', url);
        };
        
        previewImage.onerror = (e) => {
          console.warn('⚠️ Не удалось загрузить превью изображения:', url, e);
          // Если изображение не загрузилось, скрываем его
          previewImage.style.display = 'none';
        };
        
        previewContainer.appendChild(previewImage);
      }
      
      const previewContent = document.createElement("div");
      previewContent.style.cssText = "padding: 12px; flex: 1; min-width: 0;";
      
      const domainSpan = document.createElement("div");
      domainSpan.style.cssText = "font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 4px;";
      domainSpan.textContent = `🔗 ${domain}`;
      
      const titleSpan = document.createElement("div");
      titleSpan.style.cssText = "font-size: 14px; color: #fff; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      
      // Для прямых изображений показываем имя файла
      if (isDirectImage) {
        const fileName = url.split('/').pop().split('?')[0];
        titleSpan.textContent = fileName.length > 30 ? fileName.substring(0, 30) + '...' : fileName;
        titleSpan.title = fileName;
      } else {
        titleSpan.textContent = url.length > 50 ? url.substring(0, 50) + '...' : url;
        titleSpan.title = url;
      }
      
      previewContent.appendChild(domainSpan);
      previewContent.appendChild(titleSpan);
      previewContainer.appendChild(previewContent);
      
      return previewContainer;
    } catch (error) {
      errorHandler.handleSilent(error, { operation: 'createLinkPreview', url });
      return null;
    }
  }

  /**
   * Создает элемент для отображения файла
   * @param {Object} file - Данные файла
   * @returns {HTMLElement} Контейнер с файлом
   */
  createFileElement(file) {
    const fileContainer = document.createElement("div");
    fileContainer.className = "message-file";
    
    // Используем base64 данные из Firebase
    const fileSource = file.data;
    
    console.log('🎨 Создание элемента файла:', {
      name: file.name,
      type: file.type,
      hasData: !!fileSource,
      size: file.size
    });
    
    if (!fileSource) {
      console.error('❌ Файл без данных:', file);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'file-error';
      errorDiv.textContent = `⚠️ Файл поврежден: ${escapeHtml(file.name)}`;
      errorDiv.style.cssText = 'color: #ffa94d; padding: 8px; font-size: 12px; background: rgba(255, 169, 77, 0.1); border-radius: 4px;';
      fileContainer.appendChild(errorDiv);
      return fileContainer;
    }
    
    if (file.type.startsWith('image/')) {
      const img = document.createElement("img");
      img.src = fileSource;
      img.alt = escapeHtml(file.name);
      img.title = escapeHtml(file.name) + " (ПКМ для скачивания)";
      img.className = "message-image";
      
      // Обработчик успешной загрузки
      img.addEventListener('load', () => {
        console.log('✅ Изображение успешно загружено:', {
          url: fileSource,
          fileName: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight
        });
      });
      
      // Обработчик ошибки загрузки
      img.addEventListener('error', (e) => {
        console.error('❌ Ошибка загрузки изображения:', {
          url: fileSource,
          fileName: file.name,
          error: e
        });
        img.style.display = 'none';
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 4px; margin-top: 4px;';
        
        const errorText = document.createElement('div');
        errorText.textContent = `❌ Не удалось загрузить изображение: ${escapeHtml(file.name)}`;
        errorMsg.appendChild(errorText);
        
        // Добавляем ссылку для прямого открытия
        const linkContainer = document.createElement('div');
        linkContainer.style.cssText = 'margin-top: 4px;';
        
        const link = document.createElement('a');
        link.href = fileSource;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '🔗 Открыть в браузере';
        link.style.cssText = 'color: #4dabf7; text-decoration: underline;';
        linkContainer.appendChild(link);
        
        errorMsg.appendChild(linkContainer);
        fileContainer.appendChild(errorMsg);
      });
      
      // Обработчик контекстного меню для скачивания изображения
      img.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.downloadImage(fileSource, file.name);
      });
      
      // Обработчик клика для открытия в модальном окне
      img.addEventListener('click', () => {
        this.openMediaViewer(fileSource, file.name, 'image');
      });
      
      img.style.cursor = 'pointer';
      img.title = 'Нажмите для просмотра';
      
      fileContainer.appendChild(img);
    } else if (file.type.startsWith('audio/')) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.className = "message-audio";
      audio.src = fileSource;
      
      // Обработчик успешной загрузки
      audio.addEventListener('loadeddata', () => {
        console.log('✅ Аудио успешно загружено:', fileSource);
      });
      
      // Обработчик ошибки
      audio.addEventListener('error', (e) => {
        console.error('❌ Ошибка загрузки аудио:', {
          url: fileSource,
          fileName: file.name,
          error: e,
          errorCode: audio.error ? audio.error.code : 'unknown',
          errorMessage: audio.error ? audio.error.message : 'unknown'
        });
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 4px; margin-top: 4px;';
        
        const errorText = `❌ Не удалось загрузить аудио: ${escapeHtml(file.name)}`;
        const link = `<a href="${fileSource}" target="_blank" rel="noopener noreferrer" style="color: #4dabf7; text-decoration: underline; margin-left: 8px;">🔗 Открыть</a>`;
        errorMsg.innerHTML = errorText + link;
        
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
      video.className = "message-video";
      video.src = fileSource;
      
      // Обработчик успешной загрузки
      video.addEventListener('loadeddata', () => {
        console.log('✅ Видео успешно загружено:', fileSource);
      });
      
      // Обработчик ошибки
      video.addEventListener('error', (e) => {
        console.error('❌ Ошибка загрузки видео:', {
          url: fileSource,
          fileName: file.name,
          error: e,
          errorCode: video.error ? video.error.code : 'unknown',
          errorMessage: video.error ? video.error.message : 'unknown'
        });
        const errorMsg = document.createElement('div');
        errorMsg.className = 'file-error';
        errorMsg.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 4px; margin-top: 4px;';
        
        const errorText = `❌ Не удалось загрузить видео: ${escapeHtml(file.name)}`;
        const link = `<a href="${fileSource}" target="_blank" rel="noopener noreferrer" style="color: #4dabf7; text-decoration: underline; margin-left: 8px;">🔗 Открыть</a>`;
        errorMsg.innerHTML = errorText + link;
        
        fileContainer.appendChild(errorMsg);
      });
      
      // Обработчик клика для открытия в модальном окне
      video.addEventListener('click', () => {
        this.openMediaViewer(fileSource, file.name, 'video');
      });
      
      video.style.cursor = 'pointer';
      video.title = 'Нажмите для просмотра в полном размере';
      
      fileContainer.appendChild(video);
      const filenameSpan = document.createElement("span");
      filenameSpan.className = "message-filename";
      filenameSpan.textContent = escapeHtml(file.name);
      fileContainer.appendChild(filenameSpan);
    } else {
      // Документы и архивы
      const sizeKB = (file.size / 1024).toFixed(2);
      
      // Определяем иконку по типу файла
      let icon = '📎';
      if (file.type === 'application/pdf') {
        icon = '📄';
      } else if (file.type.includes('word') || file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
        icon = '📝';
      } else if (file.type.includes('excel') || file.name.endsWith('.xls') || file.name.endsWith('.xlsx')) {
        icon = '📊';
      } else if (file.type.includes('powerpoint') || file.name.endsWith('.ppt') || file.name.endsWith('.pptx')) {
        icon = '📊';
      } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        icon = '📃';
      } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        icon = '📋';
      } else if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('7z') || 
                 file.type.includes('tar') || file.type.includes('gzip') ||
                 file.name.endsWith('.zip') || file.name.endsWith('.rar') || file.name.endsWith('.7z')) {
        icon = '🗜️';
      }
      
      const link = document.createElement("a");
      link.href = fileSource;
      link.download = escapeHtml(file.name);
      link.target = "_blank";
      link.className = "message-file-link";
      link.textContent = `${icon} ${escapeHtml(file.name)} (${sizeKB} KB)`;
      fileContainer.appendChild(link);
    }
    
    return fileContainer;
  }

  /**
   * Открывает медиа-файл в модальном окне для просмотра
   * @param {string} source - Base64 данные или URL файла
   * @param {string} fileName - Имя файла
   * @param {string} type - Тип файла (image, video, document)
   */
  openMediaViewer(source, fileName, type) {
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'media-viewer-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;
    
    // Контейнер для контента
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = `
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    `;
    
    // Заголовок с именем файла
    const header = document.createElement('div');
    header.style.cssText = `
      color: #fff;
      font-size: 16px;
      font-weight: 500;
      text-align: center;
      padding: 12px 24px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      max-width: 600px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    header.textContent = fileName;
    header.title = fileName;
    
    // Создаем элемент для отображения медиа
    let mediaElement;
    
    if (type === 'image') {
      mediaElement = document.createElement('img');
      mediaElement.src = source;
      mediaElement.style.cssText = `
        max-width: 90vw;
        max-height: 80vh;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      `;
    } else if (type === 'video') {
      mediaElement = document.createElement('video');
      mediaElement.src = source;
      mediaElement.controls = true;
      mediaElement.autoplay = true;
      mediaElement.style.cssText = `
        max-width: 90vw;
        max-height: 80vh;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      `;
    }
    
    // Кнопки управления
    const controls = document.createElement('div');
    controls.style.cssText = `
      display: flex;
      gap: 12px;
      align-items: center;
    `;
    
    // Кнопка скачивания
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '💾 Скачать';
    downloadBtn.style.cssText = `
      padding: 10px 20px;
      background: rgba(88, 101, 242, 0.8);
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    `;
    downloadBtn.onmouseover = () => downloadBtn.style.background = 'rgba(88, 101, 242, 1)';
    downloadBtn.onmouseout = () => downloadBtn.style.background = 'rgba(88, 101, 242, 0.8)';
    downloadBtn.onclick = () => {
      this.downloadImage(source, fileName);
    };
    
    // Кнопка закрытия
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Закрыть';
    closeBtn.style.cssText = `
      padding: 10px 20px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    `;
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    closeBtn.onclick = () => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => modal.remove(), 200);
    };
    
    controls.appendChild(downloadBtn);
    controls.appendChild(closeBtn);
    
    // Собираем все вместе
    contentContainer.appendChild(header);
    contentContainer.appendChild(mediaElement);
    contentContainer.appendChild(controls);
    modal.appendChild(contentContainer);
    
    // Закрытие по клику на фон
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => modal.remove(), 200);
      }
    });
    
    // Закрытие по ESC
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        modal.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => modal.remove(), 200);
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);
    
    // Добавляем в DOM
    document.body.appendChild(modal);
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
      // Ограничение для base64 в Firebase
      if (!validateFileSize(this.attachedFile.size, CONSTANTS.MAX_FILE_SIZE)) {
        const maxSizeMB = Math.round(CONSTANTS.MAX_FILE_SIZE / 1024 / 1024);
        showToast(`Файл слишком большой (макс ${maxSizeMB}MB)`);
        this.attachedFile = null;
        this.fileInput.value = "";
        this.isSending = false;
        return;
      }
      
      try {
        // Показываем прогресс конвертации
        showToast("Подготовка файла...", 5000, 'info');
        
        // Конвертируем файл в base64
        const fileData = await uploadFile(this.attachedFile);
        
        console.log('✅ Файл подготовлен для отправки');
        
        // Отправляем сообщение с base64 данными
        const messageData = {
          author: escapeHtml(this.myNickname),
          userId: this.myUserId || null,
          text: text ? escapeHtml(text) : '',
          file: {
            data: fileData.data,
            name: escapeHtml(fileData.name),
            type: fileData.type,
            size: fileData.size
          },
          timestamp: Date.now()
        };

        console.log('📤 Отправка сообщения с файлом в Firebase:', {
          fileName: fileData.name,
          fileType: fileData.type,
          fileSize: (fileData.size / 1024).toFixed(2) + ' KB'
        });

        await sendFirebaseMessage(this.roomRef, messageData);
        
        console.log('✅ Сообщение отправлено в Firebase');
        
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
      // Изображения
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      // Аудио
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/webm',
      // Видео
      'video/mp4', 'video/webm', 'video/ogg',
      // Документы
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint', // .ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/plain', // .txt
      'text/csv', // .csv
      'application/rtf', // .rtf
      // Архивы
      'application/zip', // .zip
      'application/x-zip-compressed', // .zip (альтернативный MIME)
      'application/x-rar-compressed', // .rar
      'application/x-7z-compressed', // .7z
      'application/x-tar', // .tar
      'application/gzip' // .gz
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

