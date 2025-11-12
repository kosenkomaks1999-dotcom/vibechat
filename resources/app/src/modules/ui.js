/**
 * Модуль для управления UI элементами
 * Обработка интерфейса, уведомлений, фонов, настроек
 */

import { CONSTANTS } from './constants.js';
import { getElementById, getElementsByIds } from '../utils/dom-cache.js';

/**
 * Класс для управления UI
 */
export class UIManager {
  constructor() {
    this.elements = {};
    this.initElements();
  }

  /**
   * Инициализирует все элементы DOM
   */
  initElements() {
    // Используем кэшированные функции для оптимизации производительности
    const ids = [
      "authWindow", "authCloseBtn", "loginTab", "registerTab", "loginForm", "registerForm",
      "loginEmail", "loginPassword", "registerEmail", "registerNickname", "registerPassword",
      "registerPasswordConfirm", "loginError", "registerError", "loginSubmitBtn", "registerSubmitBtn",
      "logoutBtn", "appContent", "nicknameDisplay", "userProfileCard", "userProfileAvatar",
      "userProfileAvatarInitial", "userProfileNickname", "userProfileSettingsBtn",
      "profileSettingsModal", "profileSettingsCloseBtn", "profileAvatarPreview",
      "profileAvatarPreviewInitial", "profileAvatarInput", "profileAvatarUploadBtn",
      "profileAvatarRemoveBtn", "profileNicknameInput", "profileNicknameError",
      "profileEmailDisplay", "profileSettingsSaveBtn", "profileSettingsCancelBtn",
      "refreshRoomsBtn", "createRoomBtn", "findRoomBtn", "addFriendBtnTitle",
      "findRoomModal", "findRoomCloseBtn", "findRoomCancelBtn", "findRoomSubmitBtn",
      "roomIdInput", "findRoomError", "createRoomModal", "createRoomCloseBtn",
      "createRoomCancelBtn", "createRoomSubmitBtn", "roomNameInput", "roomIdDisplayInput",
      "createRoomError", "roomsList", "roomsEmpty", "roomContextMenu", "roomContextLeave",
      "roomContextDelete", "roomIdDisplay", "roomIdValue", "usersCountDisplay",
      "usersCountValue", "muteBtn", "speakerBtn", "users", "usersPanel",
      "roomsTab", "friendsTab", "roomsContent", "friendsContent", "changeBgBtn",
      "closeBtn", "bgSelector", "bgGrid", "bgCloseBtn", "bgCustomBtn",
      "chatMessages", "chatInput", "sendBtn", "emojiBtn", "emojiPicker",
      "emojiGrid", "attachBtn", "fileInput", "micSelector", "micSelect",
      "speakerSelector", "speakerSelect", "blurSlider", "blurValue",
      "connectionStatus", "clearChatBtn", "confirmDialog", "confirmDialogMessage",
      "confirmDialogOk", "confirmDialogCancel", "notificationsBtn", "notificationsBadge",
      "friendsList", "addFriendModal", "addFriendCloseBtn", "addFriendCancelBtn",
      "addFriendSubmitBtn", "friendNicknameInput", "addFriendError",
      "notificationsModal", "notificationsCloseBtn", "notificationsList",
      "notificationsEmpty", "userContextMenu", "userContextAddFriend", "userContextVolume",
      "devConsole", "consoleBtn", "consoleCloseBtn", "consoleClearBtn", "consoleContent"
    ];
    
    // Получаем все элементы за один раз с использованием кэша
    const cachedElements = getElementsByIds(ids);
    
    // Проверяем, что все элементы найдены, иначе используем прямые вызовы
    this.elements = {};
    ids.forEach(id => {
      this.elements[id] = cachedElements[id] || getElementById(id) || document.getElementById(id);
    });
    
    // Маппинг для элементов с другими именами
    this.elements.usersEl = this.elements.users;
    this.elements.minimizeBtn = getElementById("minimizeBtn") || document.getElementById("minimizeBtn");
  }

  /**
   * Показывает диалог подтверждения
   * @param {string} message - Текст сообщения
   * @returns {Promise<boolean>} Promise, который разрешается с true если пользователь подтвердил, false если отменил
   */
  showConfirm(message) {
    return new Promise((resolve) => {
      if (!this.elements.confirmDialog || !this.elements.confirmDialogMessage) {
        resolve(false);
        return;
      }

      // Устанавливаем текст сообщения
      this.elements.confirmDialogMessage.textContent = message;
      
      // Показываем диалог
      this.elements.confirmDialog.classList.add("show");

      // Обработчики кнопок
      const handleOk = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const handleClickOutside = (e) => {
        if (e.target === this.elements.confirmDialog) {
          cleanup();
          resolve(false);
        }
      };

      const handleEscape = (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(false);
        }
      };

      const cleanup = () => {
        this.elements.confirmDialog.classList.remove("show");
        if (this.elements.confirmDialogOk) {
          this.elements.confirmDialogOk.removeEventListener("click", handleOk);
        }
        if (this.elements.confirmDialogCancel) {
          this.elements.confirmDialogCancel.removeEventListener("click", handleCancel);
        }
        this.elements.confirmDialog.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };

      // Добавляем обработчики
      if (this.elements.confirmDialogOk) {
        this.elements.confirmDialogOk.addEventListener("click", handleOk);
      }
      if (this.elements.confirmDialogCancel) {
        this.elements.confirmDialogCancel.addEventListener("click", handleCancel);
      }
      this.elements.confirmDialog.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    });
  }

  /**
   * Показывает toast уведомление
   * @param {string} message - Текст сообщения
   * @param {number} duration - Длительность в миллисекундах
   */
  showToast(message, duration = CONSTANTS.TOAST_DURATION, type = 'info') {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container-premium";
      container.style.position = "fixed";
      container.style.top = "20px";
      container.style.left = "50%";
      container.style.transform = "translateX(-50%)";
      container.style.zIndex = "99999";
      container.style.pointerEvents = "none";
      document.body.appendChild(container);
    }
    
    const toast = document.createElement("div");
    toast.className = `toast-premium toast-${type}`;
    toast.innerHTML = `
      <div class="toast-icon">
        ${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}
      </div>
      <div class="toast-message">${message}</div>
      <div class="toast-close">×</div>
    `;
    
    container.appendChild(toast);

    // Анимация появления
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0) scale(1)";
    });

    // Автоматическое закрытие
    const autoCloseTimer = setTimeout(() => {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (container.contains(toast)) {
          container.removeChild(toast);
        }
        // Удаляем контейнер, если нет активных toast
        if (container && container.children.length === 0) {
          container.remove();
        }
      }, 400);
    }, duration);

    // Ручное закрытие по клику
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.style.pointerEvents = "auto";
    closeBtn.style.cursor = "pointer";
    const closeHandler = () => {
      clearTimeout(autoCloseTimer);
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (container.contains(toast)) {
          container.removeChild(toast);
        }
        if (container && container.children.length === 0) {
          container.remove();
        }
      }, 400);
    };
    closeBtn.addEventListener('click', closeHandler);
    
    // Включаем pointer events для всего toast при наведении
    toast.style.pointerEvents = "auto";
  }

  /**
   * Обновляет счетчик участников
   * @param {number} count - Количество участников
   */
  updateUsersCount(count) {
    if (this.elements.usersCountDisplay && this.elements.usersCountValue) {
      this.elements.usersCountValue.textContent = `Участников: ${count}/${CONSTANTS.MAX_USERS}`;
      this.elements.usersCountDisplay.style.display = 'block';
    }
  }

  /**
   * Обновляет отображение ID комнаты
   * @param {string} roomId - ID комнаты
   */
  updateRoomId(roomId) {
    if (this.elements.roomIdDisplay && this.elements.roomIdValue) {
      if (roomId) {
        this.elements.roomIdValue.textContent = roomId;
        this.elements.roomIdDisplay.style.display = 'block';
      } else {
        this.elements.roomIdDisplay.style.display = 'none';
        if (this.elements.usersCountDisplay) {
          this.elements.usersCountDisplay.style.display = 'none';
        }
      }
    }
  }

  /**
   * Скрывает информацию о комнате
   */
  hideRoomInfo() {
    if (this.elements.roomIdDisplay) {
      this.elements.roomIdDisplay.style.display = 'none';
    }
    if (this.elements.usersCountDisplay) {
      this.elements.usersCountDisplay.style.display = 'none';
    }
  }

  /**
   * Обновляет индикатор состояния подключения
   * @param {string} status - 'connected', 'disconnected', 'connecting'
   */
  updateConnectionStatus(status) {
    if (!this.elements.connectionStatus) return;
    
    this.elements.connectionStatus.className = `connection-status ${status}`;
    
    const connectionText = this.elements.connectionStatus.querySelector(".connection-text");
    const connectionDot = this.elements.connectionStatus.querySelector(".connection-dot");
    
    if (status === 'connected') {
      if (connectionText) connectionText.textContent = 'Подключено';
      if (connectionDot) connectionDot.title = 'Подключено к серверу';
    } else if (status === 'disconnected') {
      if (connectionText) connectionText.textContent = 'Отключено';
      if (connectionDot) connectionDot.title = 'Нет подключения к серверу';
    } else {
      if (connectionText) connectionText.textContent = 'Подключение...';
      if (connectionDot) connectionDot.title = 'Установка подключения...';
    }
  }

  /**
   * Обновляет состояние кнопки Join/Leave
   * @param {boolean} isJoined - Присоединен ли пользователь
   */
  updateJoinButton(isJoined) {
    if (this.elements.joinBtn) {
      this.elements.joinBtn.innerText = isJoined ? "Leave" : "Join";
    }
  }

  /**
   * Обновляет состояние кнопки микрофона
   * @param {boolean} muted - Выключен ли микрофон
   */
  updateMuteButton(muted) {
    if (this.elements.muteBtn) {
      const muteImg = this.elements.muteBtn.querySelector('img');
      if (muteImg) {
        muteImg.src = muted ? "assets/icons/micoff.png" : "assets/icons/micon.png";
      }
      if (muted) {
        this.elements.muteBtn.classList.add("muted");
      } else {
        this.elements.muteBtn.classList.remove("muted");
      }
    }
  }

  /**
   * Обновляет состояние кнопки динамиков
   * @param {boolean} muted - Выключены ли динамики
   */
  updateSpeakerButton(muted) {
    if (this.elements.speakerBtn) {
      const speakerImg = this.elements.speakerBtn.querySelector('img');
      if (speakerImg) {
        speakerImg.src = muted ? "assets/icons/soundoff.png" : "assets/icons/soundon.png";
      }
      if (muted) {
        this.elements.speakerBtn.classList.add("muted");
      } else {
        this.elements.speakerBtn.classList.remove("muted");
      }
    }
  }

  /**
   * Загружает сохраненный ник из localStorage
   * @deprecated Используйте setNicknameDisplay вместо этого
   */
  loadSavedNickname() {
    // Больше не используется, так как никнейм загружается из Firebase
  }

  /**
   * Устанавливает отображение никнейма
   * @param {string} nickname - Никнейм для отображения
   */
  setNicknameDisplay(nickname) {
    // Обновляем никнейм в плашке пользователя
    if (this.elements.userProfileNickname) {
      this.elements.userProfileNickname.textContent = nickname || 'Не установлен';
    }
  }

  /**
   * Устанавливает отображение email в настройках профиля
   * @param {string} email - Email для отображения
   */
  setProfileEmail(email) {
    if (this.elements.profileEmailDisplay) {
      this.elements.profileEmailDisplay.textContent = email || '';
    }
  }

  /**
   * Устанавливает аватар пользователя
   * @param {string} avatarUrl - URL аватара или null для удаления
   * @param {string} nickname - Никнейм для генерации цветного аватара, если avatarUrl отсутствует
   */
  setUserAvatar(avatarUrl, nickname) {
    if (!this.elements.userProfileAvatar) return;
    
    const avatarEl = this.elements.userProfileAvatar;
    const initialEl = this.elements.userProfileAvatarInitial;
    
    if (avatarUrl) {
      // Удаляем старое изображение, если есть
      const oldImg = avatarEl.querySelector('img');
      if (oldImg) {
        oldImg.remove();
      }
      
      // Создаем новый img элемент для правильного масштабирования
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = nickname || 'Avatar';
      avatarEl.appendChild(img);
      
      if (initialEl) {
        initialEl.style.display = 'none';
      }
    } else {
      // Удаляем изображение, если есть
      const oldImg = avatarEl.querySelector('img');
      if (oldImg) {
        oldImg.remove();
      }
      
      // Показываем цветной аватар с инициалом
      avatarEl.style.backgroundImage = 'none';
      if (nickname && nickname !== 'Не установлен') {
        const avatarColor = this.generateAvatarColor(nickname);
        avatarEl.style.background = avatarColor;
        if (initialEl) {
          initialEl.textContent = nickname.charAt(0).toUpperCase();
          initialEl.style.display = 'flex';
        }
      } else {
        avatarEl.style.background = 'linear-gradient(135deg, rgba(88, 101, 242, 0.6), rgba(235, 69, 158, 0.6))';
        if (initialEl) {
          initialEl.textContent = '?';
          initialEl.style.display = 'flex';
        }
      }
    }
  }

  /**
   * Генерирует цвет для аватара на основе никнейма
   * @param {string} nickname - Никнейм
   * @returns {string} CSS градиент
   */
  generateAvatarColor(nickname) {
    let hash = 0;
    for (let i = 0; i < nickname.length; i++) {
      hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue1 = Math.abs(hash) % 360;
    const hue2 = (hue1 + 60) % 360;
    return `linear-gradient(135deg, hsl(${hue1}, 70%, 60%), hsl(${hue2}, 70%, 50%))`;
  }

  /**
   * Показывает модальное окно настроек профиля
   */
  showProfileSettings() {
    if (this.elements.profileSettingsModal) {
      this.elements.profileSettingsModal.classList.add('show');
    }
  }

  /**
   * Скрывает модальное окно настроек профиля
   */
  hideProfileSettings() {
    if (this.elements.profileSettingsModal) {
      this.elements.profileSettingsModal.classList.remove('show');
    }
  }

  /**
   * Обновляет превью аватара в настройках профиля
   * @param {string} avatarUrl - URL аватара или null
   * @param {string} nickname - Никнейм для генерации цветного аватара
   */
  updateAvatarPreview(avatarUrl, nickname) {
    if (!this.elements.profileAvatarPreview) return;
    
    const previewEl = this.elements.profileAvatarPreview;
    const initialEl = this.elements.profileAvatarPreviewInitial;
    
    if (avatarUrl) {
      previewEl.style.backgroundImage = `url(${avatarUrl})`;
      previewEl.style.backgroundSize = 'cover';
      previewEl.style.backgroundPosition = 'center';
      if (initialEl) {
        initialEl.style.display = 'none';
      }
    } else {
      previewEl.style.backgroundImage = 'none';
      if (nickname && nickname !== 'Не установлен') {
        const avatarColor = this.generateAvatarColor(nickname);
        previewEl.style.background = avatarColor;
        if (initialEl) {
          initialEl.textContent = nickname.charAt(0).toUpperCase();
          initialEl.style.display = 'flex';
        }
      } else {
        previewEl.style.background = 'linear-gradient(135deg, rgba(88, 101, 242, 0.6), rgba(235, 69, 158, 0.6))';
        if (initialEl) {
          initialEl.textContent = '?';
          initialEl.style.display = 'flex';
        }
      }
    }
  }

  /**
   * Показывает ошибку в настройках профиля
   * @param {string} message - Сообщение об ошибке
   */
  showProfileError(message) {
    if (this.elements.profileNicknameError) {
      this.elements.profileNicknameError.textContent = message;
      this.elements.profileNicknameError.style.display = 'block';
    }
  }

  /**
   * Скрывает ошибку в настройках профиля
   */
  clearProfileError() {
    if (this.elements.profileNicknameError) {
      this.elements.profileNicknameError.style.display = 'none';
      this.elements.profileNicknameError.textContent = '';
    }
  }

  /**
   * Сохраняет ник в localStorage
   * @param {string} nickname - Ник пользователя
   */
  saveNickname(nickname) {
    if (nickname) {
      localStorage.setItem('voicechat_nickname', nickname);
    }
  }

  /**
   * Инициализирует панель эмодзи
   */
  initEmojiPicker() {
    if (!this.elements.emojiGrid) return;
    
    const popularEmojis = [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
      "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
      "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
      "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣",
      "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬",
      "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗",
      "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯",
      "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐",
      "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈",
      "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾",
      "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿",
      "😾", "👋", "🤚", "🖐", "✋", "🖖", "👌", "🤏", "✌️", "🤞",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎",
      "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏",
      "✍️", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃",
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟",
      "🔥", "⭐", "🌟", "✨", "💫", "💥", "💢", "💯", "🎉", "🎊",
      "🎈", "🎁", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀", "🏈", "⚾",
      "🎾", "🏐", "🏉", "🎱", "🏓", "🏸", "🥅", "🏒", "🏑", "🏏",
      "🎯", "🎲", "🎮", "🕹️", "🎰", "🃏", "🀄", "🎴", "🎭", "🎨",
      "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🎷", "🎺", "🎸", "🎻"
    ];

    this.elements.emojiGrid.innerHTML = "";
    const emojisToShow = [...new Set(popularEmojis)];
    
    emojisToShow.forEach(emoji => {
      const emojiBtn = document.createElement("button");
      emojiBtn.className = "emoji-item";
      emojiBtn.textContent = emoji;
      emojiBtn.title = emoji;
      emojiBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cursorPos = this.elements.chatInput.selectionStart || this.elements.chatInput.value.length;
        const textBefore = this.elements.chatInput.value.substring(0, cursorPos);
        const textAfter = this.elements.chatInput.value.substring(cursorPos);
        this.elements.chatInput.value = textBefore + emoji + textAfter;
        this.elements.chatInput.focus();
        this.elements.chatInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
        this.elements.emojiPicker.classList.remove("show");
      });
      this.elements.emojiGrid.appendChild(emojiBtn);
    });
  }

  /**
   * Инициализирует настройки фона
   */
  initBackgroundSettings() {
    const presetBackgrounds = [
      { name: "Фон 1", image: "assets/background.jpg" },
      { name: "Фон 2", image: "assets/background2.jpg" },
      { name: "Фон 3", image: "assets/background3.jpg" },
      { name: "Фон 4", image: "assets/background4.jpg" },
      { name: "Фон 5", image: "assets/background5.jpg" }
    ];

    if (!this.elements.bgGrid) return;

    this.elements.bgGrid.innerHTML = "";
    presetBackgrounds.forEach((preset) => {
      const bgOption = document.createElement("div");
      bgOption.className = "bg-option";
      bgOption.style.backgroundImage = `url(${preset.image})`;
      bgOption.style.backgroundSize = "cover";
      bgOption.style.backgroundPosition = "center";
      bgOption.title = preset.name;
      
      const img = new Image();
      img.onerror = () => {
        bgOption.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
        bgOption.style.backgroundImage = "none";
      };
      img.src = preset.image;
      
      bgOption.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".bg-option").forEach(opt => opt.classList.remove("selected"));
        bgOption.classList.add("selected");
        this.setBackground(preset.image);
        // Не закрываем окно автоматически, пользователь может выбрать несколько фонов
      });
      this.elements.bgGrid.appendChild(bgOption);
    });

    // Загружаем сохраненный фон
    const savedBackground = localStorage.getItem('selectedBackground');
    if (savedBackground) {
      this.setBackground(savedBackground);
    }
  }

  /**
   * Устанавливает фон
   * @param {string} background - Путь к фону или градиент
   */
  setBackground(background) {
    if (!background) return;
    
    const isGradient = background.startsWith("linear-gradient") || background.startsWith("radial-gradient");
    
    if (isGradient) {
      document.body.style.setProperty('background', background, 'important');
      document.body.style.setProperty('background-image', 'none', 'important');
    } else {
      document.body.style.setProperty('background-image', `url(${background})`, 'important');
      document.body.style.setProperty('background-size', 'cover', 'important');
      document.body.style.setProperty('background-position', 'center center', 'important');
      document.body.style.setProperty('background-repeat', 'no-repeat', 'important');
    }
    
    localStorage.setItem('selectedBackground', background);
  }

  /**
   * Инициализирует настройки размытости и цвета
   */
  initAppearanceSettings() {
    // Размытость
    if (this.elements.blurSlider && this.elements.blurValue) {
      const savedBlur = localStorage.getItem('panelBlur');
      if (savedBlur) {
        this.elements.blurSlider.value = savedBlur;
        this.elements.blurValue.textContent = savedBlur;
        this.applyBlur(savedBlur);
      }

      this.elements.blurSlider.addEventListener('input', (e) => {
        const value = e.target.value;
        this.elements.blurValue.textContent = value;
        this.applyBlur(value);
      });
    }

  }

  /**
   * Применяет размытость ко всем панелям
   * @param {number} blurValue - Значение размытости в пикселях (0-30)
   */
  applyBlur(blurValue) {
    const blurStyle = `${blurValue}px`;
    const elements = [
      '.title-bar',
      '.left-panel',
      '.center-panel',
      '.chat-messages',
      '.user-card',
      '.bg-selector',
      '.device-selector',
      '.users-panel'
    ];
    
    elements.forEach(selector => {
      const elementsList = document.querySelectorAll(selector);
      elementsList.forEach(el => {
        el.style.setProperty('backdrop-filter', `blur(${blurStyle})`, 'important');
      });
    });
    
    localStorage.setItem('panelBlur', blurValue);
  }


  /**
   * Инициализирует обработчики авторизации
   */
  initAuthHandlers() {
    // Переключение между вкладками
    if (this.elements.loginTab && this.elements.registerTab) {
      this.elements.loginTab.addEventListener('click', () => {
        this.elements.loginTab.classList.add('active');
        this.elements.registerTab.classList.remove('active');
        this.elements.loginForm.classList.add('active');
        this.elements.registerForm.classList.remove('active');
        this.clearAuthErrors();
      });

      this.elements.registerTab.addEventListener('click', () => {
        this.elements.registerTab.classList.add('active');
        this.elements.loginTab.classList.remove('active');
        this.elements.registerForm.classList.add('active');
        this.elements.loginForm.classList.remove('active');
        this.clearAuthErrors();
      });
    }
    
    // Обработчик кнопки закрытия окна авторизации
    if (this.elements.authCloseBtn) {
      this.elements.authCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Кнопка закрытия окна авторизации нажата');
        if (window.electronAPI && window.electronAPI.closeWindow) {
          window.electronAPI.closeWindow();
        } else {
          window.close();
        }
      });
      // Убеждаемся, что кнопка кликабельна
      this.elements.authCloseBtn.style.pointerEvents = 'auto';
      this.elements.authCloseBtn.style.cursor = 'pointer';
      console.log('Обработчик для authCloseBtn установлен');
    } else {
      console.warn('authCloseBtn не найден');
    }
  }

  /**
   * Показывает окно авторизации
   */
  showAuthWindow() {
    // Скрываем основное приложение
    if (this.elements.appContent) {
      this.elements.appContent.style.display = 'none';
    }
    
    // Показываем окно авторизации
    const authWindowEl = this.elements.authWindow || document.getElementById('authWindow');
    if (authWindowEl) {
      authWindowEl.style.display = 'flex';
      authWindowEl.classList.add('show');
    }
  }

  /**
   * Скрывает окно авторизации
   */
  hideAuthWindow() {
    console.log('hideAuthWindow вызвана');
    
    // Скрываем окно авторизации
    const authWindowEl = this.elements.authWindow || document.getElementById('authWindow');
    if (authWindowEl) {
      authWindowEl.classList.remove('show');
      authWindowEl.style.display = 'none';
      console.log('Окно авторизации скрыто');
    }
    
    // Показываем основное приложение
    if (this.elements.appContent) {
      this.elements.appContent.style.display = 'block';
      console.log('Основное приложение показано');
    }
  }

  /**
   * Очищает ошибки авторизации
   */
  clearAuthErrors() {
    if (this.elements.loginError) {
      this.elements.loginError.textContent = '';
      this.elements.loginError.style.display = 'none';
    }
    if (this.elements.registerError) {
      this.elements.registerError.textContent = '';
      this.elements.registerError.style.display = 'none';
    }
  }

  /**
   * Показывает ошибку входа
   * @param {string} message - Текст ошибки
   */
  showLoginError(message) {
    if (this.elements.loginError) {
      this.elements.loginError.textContent = message;
      this.elements.loginError.style.display = 'block';
    }
  }

  /**
   * Показывает ошибку регистрации
   * @param {string} message - Текст ошибки
   */
  showRegisterError(message) {
    if (this.elements.registerError) {
      this.elements.registerError.textContent = message;
      this.elements.registerError.style.display = 'block';
    }
  }

  /**
   * @deprecated Больше не используется, email отображается в настройках профиля
   * Обновляет информацию о пользователе (устаревший метод)
   * @param {string} email - Email пользователя
   */
  updateUserInfo(email) {
    // Больше не используется
  }

  /**
   * @deprecated Больше не используется, данные отображаются в плашке пользователя
   * Скрывает информацию о пользователе
   */
  hideUserInfo() {
    // Больше не используется
  }

  /**
   * Устанавливает состояние загрузки для кнопки входа
   * @param {boolean} isLoading - Состояние загрузки
   */
  setLoginLoading(isLoading) {
    if (this.elements.loginSubmitBtn) {
      this.elements.loginSubmitBtn.disabled = isLoading;
      this.elements.loginSubmitBtn.textContent = isLoading ? 'Вход...' : 'Войти';
    }
  }

  /**
   * Устанавливает состояние загрузки для кнопки регистрации
   * @param {boolean} isLoading - Состояние загрузки
   */
  setRegisterLoading(isLoading) {
    if (this.elements.registerSubmitBtn) {
      this.elements.registerSubmitBtn.disabled = isLoading;
      this.elements.registerSubmitBtn.textContent = isLoading ? 'Регистрация...' : 'Зарегистрироваться';
    }
  }
}

