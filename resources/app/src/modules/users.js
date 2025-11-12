/**
 * Модуль для управления участниками комнаты
 * Отображение списка участников, управление громкостью
 */

import { CONSTANTS } from './constants.js';
import { escapeHtml } from '../utils/security.js';

/**
 * Класс для управления участниками
 */
export class UsersManager {
  constructor(audios, userVolumes) {
    this.usersEl = null;
    this.audios = audios;
    this.userVolumes = userVolumes;
    this.userCardHandlers = new Map();
  }

  /**
   * Инициализирует элемент контейнера участников
   * @param {HTMLElement} usersEl - Контейнер для участников
   */
  initElement(usersEl) {
    this.usersEl = usersEl;
  }

  /**
   * Обновляет список участников
   * @param {Object} users - Объект с данными участников
   * @param {Function} onVolumeChange - Callback при изменении громкости
   * @param {string} myId - ID текущего пользователя в комнате (pushId)
   */
  updateUsersList(users, onVolumeChange, myId = null) {
    if (!this.usersEl) return;
    
    // Очищаем старые обработчики
    this.userCardHandlers.forEach((handler, card) => {
      if (handler.contextmenu) {
        card.removeEventListener('contextmenu', handler.contextmenu);
      }
      if (handler.slider) {
        handler.slider.removeEventListener('input', handler.sliderInput);
        handler.slider.removeEventListener('click', handler.sliderClick);
      }
      if (handler.closeVolume) {
        document.removeEventListener('click', handler.closeVolume);
      }
      if (handler.volumeContainer) {
        handler.volumeContainer.remove();
      }
    });
    this.userCardHandlers.clear();
    
    // Очищаем контейнер
    this.usersEl.innerHTML = "";
    
    // Проверяем, есть ли участники
    const usersCount = Object.keys(users).length;
    if (usersCount === 0) {
      this.showEmptyState();
      return;
    }
    
    // Создаем карточки участников
    Object.entries(users).forEach(([id, data]) => {
      const card = this.createUserCard(id, data, onVolumeChange, myId);
      this.usersEl.appendChild(card);
    });
  }

  /**
   * Показывает placeholder для пустого списка участников
   */
  showEmptyState() {
    if (!this.usersEl) return;
    
    const emptyState = document.createElement("div");
    emptyState.className = "users-empty-state";
    emptyState.innerHTML = `
      <div class="empty-state-icon">👥</div>
      <div class="empty-state-text">Нет участников</div>
    `;
    this.usersEl.appendChild(emptyState);
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
   * Получает первую букву никнейма (для аватара)
   * @param {string} nickname - Никнейм пользователя
   * @returns {string} Первая буква в верхнем регистре
   */
  getInitials(nickname) {
    return nickname.charAt(0).toUpperCase();
  }

  /**
   * Создает карточку участника
   * @param {string} id - ID участника (pushId в комнате)
   * @param {Object} data - Данные участника
   * @param {Function} onVolumeChange - Callback при изменении громкости
   * @param {string} myId - ID текущего пользователя в комнате (pushId)
   * @returns {HTMLElement} Карточка участника
   */
  createUserCard(id, data, onVolumeChange, myId = null) {
    const card = document.createElement("div");
    card.className = "user-card";
    card.setAttribute('data-user-id', id);
    
    // Контейнер для аватара (слева)
    const avatarContainer = document.createElement("div");
    avatarContainer.className = "user-avatar-container";
    
    // Аватар пользователя
    const avatar = document.createElement("div");
    avatar.className = "user-avatar";
    avatar.style.background = this.generateAvatarColor(data.nick);
    avatar.textContent = this.getInitials(data.nick);
    
    // Загружаем аватарку пользователя, если есть userId
    if (data.userId) {
      this.loadUserAvatar(data.userId, avatar);
    }
    
    avatarContainer.appendChild(avatar);
    
    card.appendChild(avatarContainer);
    
    // Основной контент (по центру)
    const cardMain = document.createElement("div");
    cardMain.className = "user-card-main";
    
    // Индикатор трансляции
    if (data.screenSharing) {
      const screenIndicator = document.createElement("span");
      screenIndicator.className = "screen-indicator";
      screenIndicator.title = "Транслирует экран";
      cardMain.appendChild(screenIndicator);
    }
    
    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = escapeHtml(data.nick);
    cardMain.appendChild(nameSpan);
    
    // Контейнер для иконок статуса
    const statusContainer = document.createElement("div");
    statusContainer.className = "user-status-container";
    
    // Статус микрофона
    const muteStatus = document.createElement("span");
    muteStatus.className = "user-mute-status";
    const muteImg = document.createElement("img");
    muteImg.src = data.mute ? "assets/icons/micoff.png" : "assets/icons/micon.png";
    muteImg.alt = data.mute ? "Микрофон выключен" : "Микрофон включен";
    muteImg.title = data.mute ? "Микрофон выключен" : "Микрофон включен";
    muteStatus.appendChild(muteImg);
    statusContainer.appendChild(muteStatus);
    
    // Статус динамиков
    const speakerStatus = document.createElement("span");
    speakerStatus.className = "user-speaker-status";
    const speakerImg = document.createElement("img");
    speakerImg.src = data.speakerMuted ? "assets/icons/soundoff.png" : "assets/icons/soundon.png";
    speakerImg.alt = data.speakerMuted ? "Динамики выключены" : "Динамики включены";
    speakerImg.title = data.speakerMuted ? "Динамики выключены" : "Динамики включены";
    speakerStatus.appendChild(speakerImg);
    statusContainer.appendChild(speakerStatus);
    
    cardMain.appendChild(statusContainer);
    
    card.appendChild(cardMain);
    
    // Контейнер громкости (вставляется в поток после карточки)
    const volumeContainer = document.createElement("div");
    volumeContainer.className = "user-volume-container hidden";
    volumeContainer.setAttribute('data-user-id', id);
    
    const volumeWrapper = document.createElement("div");
    volumeWrapper.className = "volume-wrapper";
    
    const volumeIcon = document.createElement("span");
    volumeIcon.className = "volume-icon";
    volumeIcon.innerHTML = "🔊";
    volumeWrapper.appendChild(volumeIcon);
    
    const sliderContainer = document.createElement("div");
    sliderContainer.className = "slider-container";
    
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    const savedVolume = this.userVolumes[id] !== undefined 
      ? this.userVolumes[id] 
      : (this.audios[id]?.volume || 1);
    slider.value = savedVolume;
    slider.className = "user-volume";
    slider.setAttribute('data-user-id', id);
    
    // Обновляем иконку при изменении громкости
    const updateVolumeIcon = (vol) => {
      if (vol === 0) {
        volumeIcon.textContent = "🔇";
      } else if (vol < 0.5) {
        volumeIcon.textContent = "🔉";
      } else {
        volumeIcon.textContent = "🔊";
      }
    };
    updateVolumeIcon(savedVolume);
    
    slider.addEventListener('input', (e) => {
      updateVolumeIcon(parseFloat(e.target.value));
    });
    
    sliderContainer.appendChild(slider);
    volumeWrapper.appendChild(sliderContainer);
    
    const volumeValue = document.createElement("span");
    volumeValue.className = "volume-value";
    volumeValue.textContent = Math.round(savedVolume * 100) + "%";
    volumeWrapper.appendChild(volumeValue);
    
    // Обновляем значение при изменении
    slider.addEventListener('input', (e) => {
      volumeValue.textContent = Math.round(parseFloat(e.target.value) * 100) + "%";
    });
    
    volumeContainer.appendChild(volumeWrapper);
    
    // Храним ссылку на контейнер для вставки после карточки
    this.volumeContainers = this.volumeContainers || new Map();
    this.volumeContainers.set(id, volumeContainer);
    
    // Обработчики событий
    // Теперь при ПКМ показываем контекстное меню, а не меню громкости
    const contextmenuHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Закрываем другие контекстные меню
      const roomContextMenu = document.getElementById('roomContextMenu');
      if (roomContextMenu) {
        roomContextMenu.style.display = 'none';
      }
      
      // Показываем контекстное меню для участника
      const userContextMenu = document.getElementById('userContextMenu');
      if (userContextMenu) {
        // Сохраняем никнейм, Firebase userId (если есть) и push ID участника в dataset меню
        const userNickname = data.nick;
        const firebaseUserId = data.userId || null; // Firebase userId из данных пользователя в комнате
        
        console.log('🔵🔵🔵 ПКМ по участнику - Сохранение данных в контекстное меню:');
        console.log('  - Никнейм:', userNickname);
        console.log('  - Firebase userId:', firebaseUserId);
        console.log('  - Push ID:', id);
        console.log('  - Все данные пользователя:', data);
        
        // Обязательно сохраняем никнейм
        if (!userNickname) {
          console.error('❌ ОШИБКА: никнейм не найден в данных пользователя!');
        } else {
          userContextMenu.dataset.userNickname = userNickname;
          console.log('✅ Никнейм сохранен в dataset:', userContextMenu.dataset.userNickname);
        }
        
        userContextMenu.dataset.userPushId = id;
        
        // Сохраняем Firebase userId, если он есть
        if (firebaseUserId) {
          userContextMenu.dataset.firebaseUserId = firebaseUserId;
          console.log('✅ Firebase userId сохранен в dataset:', firebaseUserId);
        } else {
          // Удаляем старый userId, если его нет
          delete userContextMenu.dataset.firebaseUserId;
          console.log('⚠️ Firebase userId не найден в данных пользователя (data.userId отсутствует)');
          console.log('⚠️ Будем использовать никнейм для поиска пользователя');
        }
        
        // Проверяем, что данные сохранены
        const savedNickname = userContextMenu.dataset.userNickname;
        const savedFirebaseUserId = userContextMenu.dataset.firebaseUserId;
        const savedPushId = userContextMenu.dataset.userPushId;
        
        console.log('🔵 Проверка сохраненных данных в dataset:');
        console.log('  - userNickname:', savedNickname);
        console.log('  - firebaseUserId:', savedFirebaseUserId);
        console.log('  - userPushId:', savedPushId);
        
        if (!savedNickname && !savedFirebaseUserId) {
          console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: ни никнейм, ни Firebase userId не сохранены!');
        }
        
        // Скрываем кнопку "Добавить в друзья", если это сам пользователь
        const addFriendBtn = document.getElementById('userContextAddFriend');
        if (addFriendBtn) {
          if (myId && id === myId) {
            console.log('🔵 Скрываем кнопку "Добавить в друзья" (это сам пользователь)');
            addFriendBtn.style.display = 'none';
          } else {
            console.log('🔵 Показываем кнопку "Добавить в друзья"');
            addFriendBtn.style.display = 'block';
          }
        } else {
          console.error('❌ Кнопка "Добавить в друзья" не найдена!');
        }
        
        // Позиционируем меню с проверкой границ
        // Сначала устанавливаем позицию по клику, чтобы меню отобразилось и мы могли получить его размеры
        userContextMenu.style.display = 'block';
        userContextMenu.style.left = e.pageX + 'px';
        userContextMenu.style.top = e.pageY + 'px';
        
        // Теперь получаем реальные размеры меню и корректируем позицию
        setTimeout(() => {
          const menuRect = userContextMenu.getBoundingClientRect();
          const windowWidth = window.innerWidth;
          const windowHeight = window.innerHeight;
          const menuWidth = menuRect.width;
          const menuHeight = menuRect.height;
          
          // Вычисляем позицию с учетом границ окна
          let menuLeft = e.pageX;
          let menuTop = e.pageY;
          
          // Проверяем правую границу
          if (menuLeft + menuWidth > windowWidth) {
            menuLeft = windowWidth - menuWidth - 10; // Отступ 10px от края
          }
          
          // Проверяем левую границу
          if (menuLeft < 10) {
            menuLeft = 10;
          }
          
          // Проверяем нижнюю границу
          if (menuTop + menuHeight > windowHeight) {
            menuTop = windowHeight - menuHeight - 10; // Отступ 10px от края
          }
          
          // Проверяем верхнюю границу
          if (menuTop < 10) {
            menuTop = 10;
          }
          
          userContextMenu.style.left = menuLeft + 'px';
          userContextMenu.style.top = menuTop + 'px';
        }, 0);
        
        // Закрываем все контейнеры громкости
        document.querySelectorAll('.user-volume-container').forEach(container => {
          container.classList.add('hidden');
        });
        
        // Закрываем меню при клике вне его или при открытии другого контекстного меню
        const closeMenu = (event) => {
          if (userContextMenu && 
              !userContextMenu.contains(event.target) && 
              !card.contains(event.target) &&
              event.target !== card) {
            userContextMenu.style.display = 'none';
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
          }
        };
        
        setTimeout(() => {
          document.addEventListener('click', closeMenu, true);
          document.addEventListener('contextmenu', closeMenu, true);
        }, 0);
      }
    };
    
    // Отдельный обработчик для показа меню громкости (можно вызвать из контекстного меню)
    const showVolumeMenu = () => {
      const isVisible = !volumeContainer.classList.contains('hidden');
      
      // Закрываем все другие контейнеры громкости
      document.querySelectorAll('.user-volume-container').forEach(container => {
        if (container !== volumeContainer) {
          container.classList.add('hidden');
        }
      });
      
      // Закрываем контекстное меню
      const userContextMenu = document.getElementById('userContextMenu');
      if (userContextMenu) {
        userContextMenu.style.display = 'none';
      }
      
      if (isVisible) {
        // Скрываем
        volumeContainer.classList.add('hidden');
        if (volumeContainer.parentNode) {
          volumeContainer.parentNode.removeChild(volumeContainer);
        }
      } else {
        // Показываем контейнер громкости
        if (card.nextSibling) {
          card.parentNode.insertBefore(volumeContainer, card.nextSibling);
        } else {
          card.parentNode.appendChild(volumeContainer);
        }
        volumeContainer.classList.remove('hidden');
      }
    };
    
    // Закрытие при клике вне контейнера
    const closeVolumeHandler = (e) => {
      if (!volumeContainer.contains(e.target) && !card.contains(e.target)) {
        volumeContainer.classList.add('hidden');
        if (volumeContainer.parentNode) {
          volumeContainer.parentNode.removeChild(volumeContainer);
        }
      }
    };
    
    document.addEventListener('click', closeVolumeHandler);
    
    const sliderInputHandler = (e) => {
      const volume = parseFloat(e.target.value);
      if (onVolumeChange) {
        onVolumeChange(id, volume);
      }
    };
    
    const sliderClickHandler = (e) => {
      e.stopPropagation();
    };
    
    card.addEventListener('contextmenu', contextmenuHandler);
    slider.addEventListener('input', sliderInputHandler);
    slider.addEventListener('click', sliderClickHandler);
    
    // Сохраняем обработчики
    this.userCardHandlers.set(card, {
      contextmenu: contextmenuHandler,
      showVolumeMenu: showVolumeMenu,
      slider: slider,
      sliderInput: sliderInputHandler,
      sliderClick: sliderClickHandler,
      closeVolume: closeVolumeHandler,
      volumeContainer: volumeContainer,
      userNickname: data.nick,
      userPushId: id
    });
    
    return card;
  }

  /**
   * Очищает список участников
   */
  clear() {
    if (this.usersEl) {
      this.usersEl.innerHTML = "";
    }
    // Удаляем все контейнеры громкости
    document.querySelectorAll('.user-volume-container').forEach(container => {
      container.remove();
    });
    this.userCardHandlers.clear();
    if (this.volumeContainers) {
      this.volumeContainers.clear();
    }
  }

  /**
   * Добавляет класс "speaking" к карточке участника
   * @param {string} userId - ID участника
   */
  markSpeaking(userId) {
    const userCard = document.querySelector(`[data-user-id="${userId}"]`);
    if (userCard) {
      // Активируем импульсы вокруг аватара
      const avatarContainer = userCard.querySelector('.user-avatar-container');
      if (avatarContainer) {
        avatarContainer.classList.add('speaking');
      }
    }
  }

  /**
   * Убирает класс "speaking" с карточки участника
   * @param {string} userId - ID участника
   */
  markNotSpeaking(userId) {
    const userCard = document.querySelector(`[data-user-id="${userId}"]`);
    if (userCard) {
      // Деактивируем импульсы вокруг аватара
      const avatarContainer = userCard.querySelector('.user-avatar-container');
      if (avatarContainer) {
        avatarContainer.classList.remove('speaking');
      }
    }
  }

  /**
   * Загружает аватарку пользователя из Firebase
   * @param {string} userId - Firebase userId пользователя
   * @param {HTMLElement} avatarElement - Элемент аватара для обновления
   */
  async loadUserAvatar(userId, avatarElement) {
    try {
      // Импортируем функцию getUserAvatar из firebase.js
      const { getUserAvatar } = await import('./firebase.js');
      
      // Получаем ссылку на базу данных из window (она должна быть доступна глобально)
      const db = window.firebase?.database();
      if (!db) {
        console.warn('Firebase database не доступна для загрузки аватарки');
        return;
      }
      
      // Загружаем аватарку
      const avatarUrl = await getUserAvatar(db, userId);
      
      if (avatarUrl) {
        // Создаем img элемент для аватарки
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.alt = 'Avatar';
        // Не нужно устанавливать inline стили - CSS уже настроен правильно
        // img будет использовать стили из .user-avatar img
        
        // Очищаем текст (инициалы) и добавляем изображение
        avatarElement.textContent = '';
        avatarElement.appendChild(img);
        
        console.log('✅ Аватарка загружена для пользователя:', userId);
      }
    } catch (error) {
      console.warn('Не удалось загрузить аватарку:', error);
      // Оставляем инициалы, если не удалось загрузить аватарку
    }
  }
}

