/**
 * Модуль для управления друзьями и уведомлениями
 */

import { 
  getUserIdByNickname, 
  sendFriendRequest, 
  acceptFriendRequest, 
  rejectFriendRequest,
  getFriends,
  getFriendRequests,
  getUserInfo,
  getUserOnlineStatus,
  getUserAvatar,
  getUserNickname,
  removeFriend,
  sendFriendMessage,
  sendRoomInvitation,
  getRoomInvitations,
  removeRoomInvitation,
  getRoomsList,
  removeFriendMessage
} from './firebase.js';
import { CONSTANTS } from './constants.js';
import { escapeHtml } from '../utils/security.js';

/**
 * Класс для управления друзьями
 */
export class FriendsManager {
  constructor(db, authManager, onNotificationSound, uiManager = null, onJoinRoom = null) {
    this.db = db;
    this.authManager = authManager;
    this.onNotificationSound = onNotificationSound || (() => {});
    this.uiManager = uiManager; // UI менеджер для показа уведомлений
    this.onJoinRoom = onJoinRoom; // Callback для входа в комнату
    this.friendsListEl = null;
    this.notificationsListEl = null;
    this.notificationsBadgeEl = null;
    this.friendsListeners = {};
    this.requestsListener = null;
    this.onlineStatusListeners = {};
    this.previousPendingCount = -1; // -1 означает, что еще не загружено начальное значение
    this.processedRequestIds = new Set(); // Множество ID запросов, которые уже были обработаны
    this.contextMenu = null; // Контекстное меню для друзей
    this.invitationsListener = null; // Слушатель приглашений в комнаты
    this.messagesListener = null; // Слушатель сообщений от друзей
    this.processedInvitations = new Set(); // Обработанные приглашения (чтобы не показывать повторно)
    this.processedMessages = new Set(); // Обработанные сообщения (чтобы не показывать повторно)
    this.initialRequestIds = new Set(); // ID запросов, которые были при инициализации
    this.friendMessages = []; // Массив для хранения сообщений от друзей для отображения в уведомлениях
    this.isRenderingFriends = false; // Флаг для предотвращения одновременного рендеринга
  }

  /**
   * Инициализирует элементы DOM
   */
  initElements(friendsListEl, notificationsListEl, notificationsBadgeEl) {
    this.friendsListEl = friendsListEl;
    this.notificationsListEl = notificationsListEl;
    this.notificationsBadgeEl = notificationsBadgeEl;
  }

  /**
   * Загружает и отображает список друзей
   */
  async loadFriends() {
    console.log('📋 loadFriends вызван', {
      friendsListEl: !!this.friendsListEl,
      authManager: !!this.authManager
    });
    
    if (!this.friendsListEl) {
      console.error('❌ friendsListEl не установлен!');
      // Пробуем найти элемент напрямую
      this.friendsListEl = document.getElementById('friendsList');
      if (!this.friendsListEl) {
        console.error('❌ Элемент friendsList не найден в DOM!');
        return;
      }
      console.log('✅ friendsListEl найден напрямую');
    }
    
    if (!this.authManager) {
      console.error('❌ authManager не установлен!');
      return;
    }
    
    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.error('❌ Пользователь не авторизован!');
      return;
    }

    try {
      // Принудительно запрашиваем свежие данные из Firebase
      const friendsSnapshot = await this.db.ref(`friendships/${currentUser.uid}`).once('value');
      const friends = friendsSnapshot.val() || {};
      console.log('📋 Загружены друзья из Firebase (прямой запрос):', Object.keys(friends || {}).length);
      console.log('📋 Все данные друзей (loadFriends):', JSON.stringify(friends, null, 2));
      
      // Фильтруем только accepted дружбы и убираем дубликаты на уровне данных
      const uniqueFriends = {};
      let pendingCount = 0;
      let acceptedCount = 0;
      let invalidCount = 0;
      
      for (const [friendId, friendship] of Object.entries(friends || {})) {
        if (friendship && typeof friendship === 'object') {
          if (friendship.status === 'accepted') {
            acceptedCount++;
            // Если друг уже есть, берем более новую запись
            if (!uniqueFriends[friendId] || 
                (friendship.timestamp && uniqueFriends[friendId].timestamp && 
                 friendship.timestamp > uniqueFriends[friendId].timestamp)) {
              uniqueFriends[friendId] = friendship;
            }
          } else if (friendship.status === 'pending') {
            pendingCount++;
            console.log('⚠️ Найдена дружба со статусом pending для:', friendId, friendship);
          } else {
            invalidCount++;
            console.log('⚠️ Найдена дружба с невалидным статусом:', friendId, friendship);
          }
        } else {
          invalidCount++;
          console.log('⚠️ Найдена невалидная дружба:', friendId, friendship);
        }
      }
      
      console.log('📋 Статистика друзей (loadFriends): accepted:', acceptedCount, 'pending:', pendingCount, 'invalid:', invalidCount);
      console.log('📋 Уникальных друзей после фильтрации:', Object.keys(uniqueFriends).length);
      
      // Всегда обновляем список, даже если данные не изменились
      // Это гарантирует, что новые друзья будут отображены
      await this.renderFriends(uniqueFriends);
    } catch (error) {
      console.error('Ошибка при загрузке друзей:', error);
      this.isRenderingFriends = false;
    }
  }
  
  /**
   * Синхронизирует дружбы: проверяет, нужно ли создать обратную дружбу
   * Этот метод вызывается после загрузки друзей, чтобы убедиться, что все дружбы синхронизированы
   */
  async syncFriendships(userId, currentFriends) {
    // Этот метод оставлен для будущего использования
    // Основная логика создания обратной дружбы теперь в acceptFriendRequest
    // с обновленными правилами безопасности Firebase
    console.log('🔄 Синхронизация дружб для пользователя:', userId);
  }

  /**
   * Начинает отслеживание списка друзей в реальном времени
   */
  startListeningToFriends() {
    if (!this.authManager || !this.db) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    // Отключаем предыдущий слушатель, если есть
    if (this.friendsListeners[currentUser.uid]) {
      this.db.ref(`friendships/${currentUser.uid}`).off('value', this.friendsListeners[currentUser.uid]);
    }

    // Загружаем начальное состояние друзей, чтобы не показывать уведомления для уже существующих
    const friendsPath = `friendships/${currentUser.uid}`;
    console.log('📋 Загружаем начальное состояние друзей из пути:', friendsPath);
    
    this.db.ref(friendsPath).once('value').then((snap) => {
      const friends = snap.val() || {};
      console.log('📋 Начальная загрузка друзей, всего записей:', Object.keys(friends || {}).length);
      console.log('📋 Все данные друзей (начальная загрузка):', JSON.stringify(friends, null, 2));
      
      // Фильтруем только accepted дружбы для начального состояния
      const initialFriends = {};
      let pendingCount = 0;
      let acceptedCount = 0;
      let invalidCount = 0;
      
      for (const [friendId, friendship] of Object.entries(friends || {})) {
        if (friendship && typeof friendship === 'object') {
          if (friendship.status === 'accepted') {
            acceptedCount++;
            if (!initialFriends[friendId] || 
                (friendship.timestamp && initialFriends[friendId].timestamp && 
                 friendship.timestamp > initialFriends[friendId].timestamp)) {
              initialFriends[friendId] = friendship;
            }
          } else if (friendship.status === 'pending') {
            pendingCount++;
            console.log('⚠️ Найдена дружба со статусом pending при начальной загрузке:', friendId, friendship);
          } else {
            invalidCount++;
            console.log('⚠️ Найдена дружба с невалидным статусом при начальной загрузке:', friendId, friendship);
          }
        } else {
          invalidCount++;
          console.log('⚠️ Найдена невалидная дружба при начальной загрузке:', friendId, friendship);
        }
      }
      
      // Инициализируем предыдущее состояние с уже существующими друзьями
      const previousFriendsSet = new Set(Object.keys(initialFriends));
      let previousFriendsCount = Object.keys(initialFriends).length;
      
      console.log('📋 Статистика друзей (начальная загрузка): accepted:', acceptedCount, 'pending:', pendingCount, 'invalid:', invalidCount);
      console.log('📋 Начальное количество друзей (accepted):', previousFriendsCount);
      console.log('📋 Начальный список друзей:', Array.from(previousFriendsSet));
      
      // Сохраняем предыдущее состояние друзей для отслеживания изменений
      const listener = async (snap) => {
        const friends = snap.val() || {};
        const friendsCount = Object.keys(friends || {}).length;
        console.log('📋 Слушатель друзей сработал, получено друзей:', friendsCount);
        console.log('📋 Все данные друзей:', JSON.stringify(friends, null, 2));
        
        // Фильтруем только accepted дружбы и убираем дубликаты
        const uniqueFriends = {};
        let pendingCount = 0;
        let acceptedCount = 0;
        let invalidCount = 0;
        
        for (const [friendId, friendship] of Object.entries(friends || {})) {
          if (friendship && typeof friendship === 'object') {
            if (friendship.status === 'accepted') {
              acceptedCount++;
              // Если друг уже есть, берем более новую запись
              if (!uniqueFriends[friendId] || 
                  (friendship.timestamp && uniqueFriends[friendId].timestamp && 
                   friendship.timestamp > uniqueFriends[friendId].timestamp)) {
                uniqueFriends[friendId] = friendship;
              }
            } else if (friendship.status === 'pending') {
              pendingCount++;
              console.log('⚠️ Найдена дружба со статусом pending для:', friendId, friendship);
            } else {
              invalidCount++;
              console.log('⚠️ Найдена дружба с невалидным статусом:', friendId, friendship);
            }
          } else {
            invalidCount++;
            console.log('⚠️ Найдена невалидная дружба:', friendId, friendship);
          }
        }
        
        console.log('📋 Статистика друзей: accepted:', acceptedCount, 'pending:', pendingCount, 'invalid:', invalidCount);
        
        const uniqueCount = Object.keys(uniqueFriends).length;
        const currentFriendsSet = new Set(Object.keys(uniqueFriends));
        
        // Проверяем, появились ли новые друзья (которых не было в начальном состоянии)
        const newFriends = [];
        currentFriendsSet.forEach(friendId => {
          if (!previousFriendsSet.has(friendId)) {
            newFriends.push(friendId);
          }
        });
        
        if (newFriends.length > 0) {
          console.log('🆕 Обнаружен(ы) новый(ые) друг(и):', newFriends);
          console.log('🔄 Принудительно обновляем список друзей...');
        }
        
        // Обновляем предыдущее состояние
        newFriends.forEach(friendId => {
          previousFriendsSet.add(friendId);
        });
        previousFriendsCount = uniqueCount;
        
        // ВСЕГДА обновляем список друзей при любых изменениях
        // Это гарантирует, что новые друзья появятся сразу
        await this.renderFriends(uniqueFriends);
        
        // Если появились новые друзья, показываем уведомление
        // ВАЖНО: показываем уведомление ТОЛЬКО для действительно новых друзей
        if (newFriends.length > 0 && this.uiManager && this.uiManager.showToast) {
          const friendNames = await Promise.all(
            newFriends.map(async (friendId) => {
              try {
                const nickname = await getUserNickname(this.db, friendId);
                return nickname || friendId;
              } catch (error) {
                console.error('Ошибка при получении никнейма друга:', error);
                return friendId;
              }
            })
          );
          
          if (friendNames.length === 1) {
            this.uiManager.showToast(`${friendNames[0]} теперь ваш друг!`, 3000, 'success');
          } else if (friendNames.length > 1) {
            this.uiManager.showToast(`${friendNames.length} новых друзей добавлено!`, 3000, 'success');
          }
        }
      };

      this.friendsListeners[currentUser.uid] = listener;
      this.db.ref(`friendships/${currentUser.uid}`).on('value', listener);
      console.log('✅ Слушатель друзей успешно запущен');
    }).catch((error) => {
      console.error('❌ Ошибка при загрузке начального состояния друзей:', error);
      // В случае ошибки, инициализируем пустое состояние
      const previousFriendsSet = new Set();
      let previousFriendsCount = 0;
      
      const listener = async (snap) => {
        const friends = snap.val() || {};
        console.log('📋 Слушатель друзей (fallback) сработал, получено друзей:', Object.keys(friends || {}).length);
        console.log('📋 Все данные друзей (fallback):', JSON.stringify(friends, null, 2));
        
        const uniqueFriends = {};
        let pendingCount = 0;
        let acceptedCount = 0;
        
        for (const [friendId, friendship] of Object.entries(friends || {})) {
          if (friendship && typeof friendship === 'object') {
            if (friendship.status === 'accepted') {
              acceptedCount++;
              if (!uniqueFriends[friendId] || 
                  (friendship.timestamp && uniqueFriends[friendId].timestamp && 
                   friendship.timestamp > uniqueFriends[friendId].timestamp)) {
                uniqueFriends[friendId] = friendship;
              }
            } else if (friendship.status === 'pending') {
              pendingCount++;
              console.log('⚠️ Найдена дружба со статусом pending для:', friendId, friendship);
            }
          }
        }
        
        console.log('📋 Статистика друзей (fallback): accepted:', acceptedCount, 'pending:', pendingCount);
        
        const currentFriendsSet = new Set(Object.keys(uniqueFriends));
        const newFriends = [];
        currentFriendsSet.forEach(friendId => {
          if (!previousFriendsSet.has(friendId)) {
            newFriends.push(friendId);
          }
        });
        
        newFriends.forEach(friendId => {
          previousFriendsSet.add(friendId);
        });
        previousFriendsCount = Object.keys(uniqueFriends).length;
        
        await this.renderFriends(uniqueFriends);
        
        if (newFriends.length > 0 && this.uiManager && this.uiManager.showToast) {
          const friendNames = await Promise.all(
            newFriends.map(async (friendId) => {
              try {
                const nickname = await getUserNickname(this.db, friendId);
                return nickname || friendId;
              } catch (error) {
                console.error('Ошибка при получении никнейма друга:', error);
                return friendId;
              }
            })
          );
          
          if (friendNames.length === 1) {
            this.uiManager.showToast(`${friendNames[0]} теперь ваш друг!`, 3000, 'success');
          } else if (friendNames.length > 1) {
            this.uiManager.showToast(`${friendNames.length} новых друзей добавлено!`, 3000, 'success');
          }
        }
      };
      
      this.friendsListeners[currentUser.uid] = listener;
      this.db.ref(`friendships/${currentUser.uid}`).on('value', listener);
      console.log('✅ Слушатель друзей (fallback) запущен');
    });
  }
  

  /**
   * Останавливает отслеживание списка друзей
   */
  stopListeningToFriends() {
    if (!this.authManager || !this.db) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    if (this.friendsListeners[currentUser.uid]) {
      this.db.ref(`friendships/${currentUser.uid}`).off('value', this.friendsListeners[currentUser.uid]);
      delete this.friendsListeners[currentUser.uid];
    }
  }

  /**
   * Отображает список друзей
   */
  async renderFriends(friends) {
    console.log('🎨 renderFriends вызван', {
      friendsListEl: !!this.friendsListEl,
      friendsCount: Object.keys(friends || {}).length,
      friends: Object.keys(friends || {})
    });
    
    if (!this.friendsListEl) {
      console.error('❌ friendsListEl не установлен в renderFriends!');
      // Пробуем найти элемент напрямую
      this.friendsListEl = document.getElementById('friendsList');
      if (!this.friendsListEl) {
        console.error('❌ Элемент friendsList не найден в DOM при рендеринге!');
        return;
      }
      console.log('✅ friendsListEl найден напрямую в renderFriends');
    }
    
    // Предотвращаем одновременный рендеринг
    if (this.isRenderingFriends) {
      console.log('⏳ Рендеринг друзей уже выполняется, пропускаем');
      return;
    }
    
    this.isRenderingFriends = true;

    try {
      // Полностью очищаем список перед рендерингом, чтобы избежать дубликатов
      while (this.friendsListEl.firstChild) {
        this.friendsListEl.removeChild(this.friendsListEl.firstChild);
      }

      const friendsArray = Object.entries(friends || {});
      
      // Используем Map для отслеживания уже добавленных друзей
      // Ключ - friendId, значение - объект дружбы с максимальным timestamp
      const friendsMap = new Map();

      // Сначала собираем всех уникальных друзей, выбирая запись с максимальным timestamp
      for (const [friendId, friendship] of friendsArray) {
        // Проверяем, что дружба принята и данные валидны
        if (friendship && 
            typeof friendship === 'object' && 
            friendship.status === 'accepted') {
          
          // Если друг уже есть в Map, сравниваем timestamp
          if (friendsMap.has(friendId)) {
            const existingFriendship = friendsMap.get(friendId);
            const existingTimestamp = existingFriendship.timestamp || 0;
            const currentTimestamp = friendship.timestamp || 0;
            
            // Берем запись с более новым timestamp
            if (currentTimestamp > existingTimestamp) {
              friendsMap.set(friendId, friendship);
            }
          } else {
            // Первое вхождение друга
            friendsMap.set(friendId, friendship);
          }
        }
      }
      
      console.log('📋 Уникальных друзей после фильтрации:', friendsMap.size);
      console.log('📋 Данные друзей для рендеринга:', Object.keys(friends || {}));
      
      // Если нет друзей после фильтрации, показываем пустое состояние
      if (friendsMap.size === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'friends-empty';
        emptyEl.textContent = 'Нет друзей';
        emptyEl.style.cssText = 'text-align: center; padding: 20px; color: rgba(255,255,255,0.6);';
        this.friendsListEl.appendChild(emptyEl);
        return;
      }
      
      // Теперь создаем карточки для всех уникальных друзей
      for (const [friendId, friendship] of friendsMap) {
        try {
          const friendCard = await this.createFriendCard(friendId);
          if (friendCard) {
            this.friendsListEl.appendChild(friendCard);
            console.log('✅ Карточка друга создана для:', friendId);
          } else {
            console.warn('⚠️ Не удалось создать карточку для друга:', friendId);
          }
        } catch (error) {
          console.error(`❌ Ошибка при создании карточки друга ${friendId}:`, error);
        }
      }
      
      console.log('✅ Рендеринг друзей завершен. Отображено друзей:', friendsMap.size);
    } catch (error) {
      console.error('❌ Ошибка при рендеринге друзей:', error);
      // Показываем пустое состояние при ошибке
      if (this.friendsListEl) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'friends-empty';
        emptyEl.textContent = 'Ошибка при загрузке друзей';
        emptyEl.style.cssText = 'text-align: center; padding: 20px; color: rgba(255,255,255,0.6);';
        this.friendsListEl.appendChild(emptyEl);
      }
    } finally {
      // ВСЕГДА сбрасываем флаг, даже если произошла ошибка
      this.isRenderingFriends = false;
    }
  }

  /**
   * Создает карточку друга
   */
  async createFriendCard(friendId) {
    try {
      const userInfo = await getUserInfo(this.db, friendId);
      if (!userInfo) return null;

      const nickname = userInfo.nickname || 'Неизвестно';
      const avatar = userInfo.avatar || null;
      const isOnline = userInfo.online === true;

      const card = document.createElement('div');
      card.className = 'friend-card';
      card.setAttribute('data-friend-id', friendId);

      // Аватар
      const avatarEl = document.createElement('div');
      avatarEl.className = 'friend-avatar';
      
      if (avatar) {
        // Используем img элемент для правильного масштабирования
        const img = document.createElement('img');
        img.src = avatar;
        img.alt = nickname;
        avatarEl.appendChild(img);
      } else {
        const initial = nickname.charAt(0).toUpperCase();
        avatarEl.textContent = initial;
        avatarEl.style.background = this.generateAvatarColor(nickname);
      }

      // Индикатор онлайн статуса
      const statusDot = document.createElement('div');
      statusDot.className = `friend-status-dot ${isOnline ? 'online' : 'offline'}`;
      statusDot.title = isOnline ? 'Онлайн' : 'Оффлайн';

      avatarEl.appendChild(statusDot);
      card.appendChild(avatarEl);

      // Информация о друге
      const infoEl = document.createElement('div');
      infoEl.className = 'friend-info';
      
      const nameEl = document.createElement('div');
      nameEl.className = 'friend-name';
      nameEl.textContent = escapeHtml(nickname);
      infoEl.appendChild(nameEl);

      const statusEl = document.createElement('div');
      statusEl.className = 'friend-status-text';
      statusEl.textContent = isOnline ? 'Онлайн' : 'Оффлайн';
      infoEl.appendChild(statusEl);

      card.appendChild(infoEl);

      // Слушаем изменения онлайн статуса
      this.listenToFriendOnlineStatus(friendId, card);

      // Добавляем обработчик правой кнопки мыши для контекстного меню
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showFriendContextMenu(e, friendId, nickname);
      });

      return card;
    } catch (error) {
      console.error('Ошибка при создании карточки друга:', error);
      return null;
    }
  }

  /**
   * Слушает изменения онлайн статуса друга
   */
  listenToFriendOnlineStatus(friendId, cardEl) {
    // Отключаем предыдущий слушатель, если есть
    if (this.onlineStatusListeners[friendId]) {
      this.db.ref(`users/${friendId}/online`).off('value', this.onlineStatusListeners[friendId]);
    }

    const listener = (snap) => {
      const isOnline = snap.val() === true;
      const statusDot = cardEl.querySelector('.friend-status-dot');
      const statusText = cardEl.querySelector('.friend-status-text');
      
      if (statusDot) {
        statusDot.className = `friend-status-dot ${isOnline ? 'online' : 'offline'}`;
        statusDot.title = isOnline ? 'Онлайн' : 'Оффлайн';
      }
      
      if (statusText) {
        statusText.textContent = isOnline ? 'Онлайн' : 'Оффлайн';
      }
    };

    this.onlineStatusListeners[friendId] = listener;
    this.db.ref(`users/${friendId}/online`).on('value', listener);
  }

  /**
   * Отправляет запрос в друзья по userId
   * @param {string} friendUserId - Firebase userId друга
   * @returns {Promise<Object>} Результат отправки
   */
  async sendFriendRequestByUserId(friendUserId) {
    console.log('🔍 Отправка запроса по userId:', friendUserId);
    
    if (!this.authManager || !this.db) {
      console.error('❌ Менеджер друзей не инициализирован');
      return { success: false, error: 'Не авторизован' };
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.error('❌ Пользователь не авторизован');
      return { success: false, error: 'Не авторизован' };
    }

    if (!friendUserId) {
      return { success: false, error: 'UserId не указан' };
    }

    // Проверяем, не пытаемся ли добавить себя
    if (friendUserId === currentUser.uid) {
      console.log('❌ Попытка добавить самого себя');
      return { success: false, error: 'Нельзя добавить самого себя' };
    }

    // Получаем никнейм отправителя
    const myNickname = await getUserNickname(this.db, currentUser.uid);

    // Отправляем запрос напрямую по userId
    console.log('✅ Отправка запроса по userId:', { 
      fromUserId: currentUser.uid, 
      toUserId: friendUserId,
      fromNickname: myNickname 
    });
    const result = await sendFriendRequest(
      this.db, 
      currentUser.uid, 
      friendUserId, 
      myNickname || currentUser.email
    );

    if (result.success) {
      console.log('✅ Запрос в друзья успешно отправлен по userId');
    } else {
      console.error('❌ Ошибка при отправке запроса:', result.error);
    }

    return result;
  }

  /**
   * Отправляет запрос в друзья по никнейму
   * @param {string} nickname - Никнейм пользователя
   * @returns {Promise<Object>} Результат отправки
   */
  async sendFriendRequestByNickname(nickname) {
    console.log('🔍 Поиск пользователя по никнейму:', nickname);
    
    if (!this.authManager || !this.db) {
      console.error('❌ Менеджер друзей не инициализирован');
      return { success: false, error: 'Не авторизован' };
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.error('❌ Пользователь не авторизован');
      return { success: false, error: 'Не авторизован' };
    }

    if (!nickname || !nickname.trim()) {
      return { success: false, error: 'Введите никнейм' };
    }

    // Проверяем, не пытаемся ли добавить себя
    const myNickname = await getUserNickname(this.db, currentUser.uid);
    if (nickname.toLowerCase() === myNickname?.toLowerCase()) {
      console.log('❌ Попытка добавить самого себя');
      return { success: false, error: 'Нельзя добавить самого себя' };
    }

    // Получаем userId по никнейму
    console.log('🔍 Поиск userId для никнейма:', nickname);
    const friendId = await getUserIdByNickname(this.db, nickname);
    if (!friendId) {
      console.error('❌ Пользователь с таким никнеймом не найден:', nickname);
      return { success: false, error: 'Пользователь с таким никнеймом не найден' };
    }

    console.log('✅ Найден пользователь:', { nickname, friendId });

    // Отправляем запрос
    const result = await sendFriendRequest(
      this.db, 
      currentUser.uid, 
      friendId, 
      myNickname || currentUser.email
    );

    if (result.success) {
      console.log('✅ Запрос в друзья успешно отправлен');
    } else {
      console.error('❌ Ошибка при отправке запроса:', result.error);
    }

    return result;
  }

  /**
   * Загружает и отображает уведомления (запросы в друзья и сообщения)
   */
  async loadNotifications() {
    if (!this.notificationsListEl || !this.authManager) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    try {
      const requests = await getFriendRequests(this.db, currentUser.uid);
      console.log('📋 Загружены уведомления (запросы):', requests);
      
      // Загружаем сообщения из Firebase при открытии уведомлений
      // Используем более точный ключ для предотвращения дубликатов
      try {
        const messagesPath = `friendMessages/${currentUser.uid}`;
        const messagesSnapshot = await this.db.ref(messagesPath).once('value');
        const messages = messagesSnapshot.val() || {};
        
        // Инициализируем массив сообщений, если его еще нет
        if (!this.friendMessages) {
          this.friendMessages = [];
        }
        
        // Используем Map с уникальным ключом для предотвращения дубликатов
        // Ключ: friendId + timestamp (это уникально для каждого сообщения)
        const messagesMap = new Map();
        
        // Загружаем ВСЕ сообщения из Firebase напрямую (не добавляем существующие из памяти)
        // Это гарантирует, что мы работаем только с актуальными данными из Firebase
        Object.entries(messages).forEach(([friendId, friendMessages]) => {
          if (friendMessages && typeof friendMessages === 'object') {
            Object.entries(friendMessages).forEach(([messageId, message]) => {
              if (message && typeof message === 'object' && message.timestamp) {
                // Создаем уникальный ключ для сообщения
                // Используем комбинацию friendId и timestamp для уникальности
                const messageKey = `${friendId}_${message.timestamp}`;
                
                // Если сообщение уже есть в Map, пропускаем его (предотвращаем дубликаты)
                if (!messagesMap.has(messageKey)) {
                  const messageData = {
                    friendId: friendId,
                    fromNickname: message.fromNickname || 'Неизвестный пользователь',
                    messageText: message.message || '',
                    timestamp: message.timestamp
                  };
                  messagesMap.set(messageKey, messageData);
                } else {
                  console.log('⚠️ Обнаружен дубликат сообщения, пропускаем:', messageKey);
                }
              }
            });
          }
        });
        
        // Преобразуем Map обратно в массив (это гарантирует уникальность)
        this.friendMessages = Array.from(messagesMap.values());
        
        // Сортируем сообщения по времени (новые сверху)
        this.friendMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        // Ограничиваем количество (последние 50)
        if (this.friendMessages.length > 50) {
          this.friendMessages = this.friendMessages.slice(0, 50);
        }
        
        console.log('📋 Загружено уникальных сообщений из Firebase:', this.friendMessages.length);
      } catch (error) {
        console.error('Ошибка при загрузке сообщений:', error);
      }
      
      // Подсчитываем pending запросы и сообщения
      const pendingCount = Object.values(requests || {}).filter(r => r && r.status === 'pending').length;
      const messagesCount = this.friendMessages?.length || 0;
      const totalCount = pendingCount + messagesCount;
      console.log('📋 Количество pending запросов:', pendingCount, 'сообщений:', messagesCount);
      
      this.renderNotifications(requests);
      this.updateNotificationsBadge(totalCount);
    } catch (error) {
      console.error('Ошибка при загрузке уведомлений:', error);
    }
  }

  /**
   * Отображает уведомления (запросы в друзья и сообщения от друзей)
   */
  renderNotifications(requests) {
    if (!this.notificationsListEl) {
      console.warn('⚠️ notificationsListEl не найден');
      return;
    }

    console.log('🎨 Рендеринг уведомлений:', requests);
    this.notificationsListEl.innerHTML = '';
    
    const requestsArray = Object.entries(requests || {});
    console.log('🎨 Всего запросов:', requestsArray.length);
    console.log('🎨 Сообщений в памяти:', this.friendMessages?.length || 0);
    
    const emptyEl = document.getElementById('notificationsEmpty');
    
    // Сначала показываем сообщения от друзей
    if (this.friendMessages && this.friendMessages.length > 0) {
      if (emptyEl) {
        emptyEl.style.display = 'none';
      }
      
      // Используем Map для удаления дубликатов перед рендерингом
      // Ключ: friendId + timestamp для уникальности
      const uniqueMessagesMap = new Map();
      
      // Фильтруем дубликаты сообщений
      this.friendMessages.forEach(messageData => {
        if (messageData && messageData.friendId && messageData.timestamp) {
          const messageKey = `${messageData.friendId}_${messageData.timestamp}`;
          // Если сообщение еще не добавлено, добавляем его
          // Если уже есть, берем более новую версию (хотя по логике они должны быть одинаковыми)
          if (!uniqueMessagesMap.has(messageKey)) {
            uniqueMessagesMap.set(messageKey, messageData);
          }
        }
      });
      
      // Преобразуем Map в массив и сортируем по времени (новые сверху)
      const uniqueMessages = Array.from(uniqueMessagesMap.values());
      const sortedMessages = uniqueMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      console.log('🎨 Уникальных сообщений для отображения:', sortedMessages.length);
      
      // Отображаем сообщения
      for (const messageData of sortedMessages) {
        const notificationEl = document.createElement('div');
        notificationEl.className = 'notification-item';
        notificationEl.setAttribute('data-message-from', messageData.friendId);
        notificationEl.setAttribute('data-message-id', messageData.timestamp || Date.now());

        const info = document.createElement('div');
        info.className = 'notification-info';
        
        const text = document.createElement('div');
        text.className = 'notification-text';
        text.innerHTML = `<strong>${escapeHtml(messageData.fromNickname)}</strong>: ${escapeHtml(messageData.messageText)}`;
        info.appendChild(text);

        notificationEl.appendChild(info);

        // Кнопка удаления для сообщения
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'notification-delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Удалить уведомление';
        deleteBtn.onclick = async () => {
          try {
            const currentUser = this.authManager.getCurrentUser();
            if (!currentUser) return;
            
            // Удаляем сообщение из Firebase
            const result = await removeFriendMessage(
              this.db,
              currentUser.uid,
              messageData.friendId,
              messageData.timestamp
            );
            
            if (result.success) {
              // Удаляем сообщение из массива
              this.removeMessageNotification(messageData.friendId, messageData.timestamp);
              
              // Удаляем элемент из DOM
              notificationEl.remove();
              
              // Перерисовываем список уведомлений с обновленными данными
              const requestsSnapshot = await this.db.ref(`friendRequests/${currentUser.uid}`).once('value');
              const requests = requestsSnapshot.val() || {};
              this.renderNotifications(requests);
              
              // Обновляем счетчик
              const pendingCount = Object.values(requests || {}).filter(r => r && r.status === 'pending').length;
              const messagesCount = this.friendMessages?.length || 0;
              const totalCount = pendingCount + messagesCount;
              this.updateNotificationsBadge(totalCount);
              
              // Проверяем, нужно ли показать пустое состояние
              if (this.notificationsListEl && this.notificationsListEl.children.length === 0) {
                const emptyEl = document.getElementById('notificationsEmpty');
                if (emptyEl) {
                  emptyEl.style.display = 'block';
                }
              }
            } else {
              console.error('Ошибка при удалении сообщения из Firebase:', result.error);
              if (this.uiManager && this.uiManager.showToast) {
                this.uiManager.showToast('Не удалось удалить уведомление', 3000, 'error');
              }
            }
          } catch (error) {
            console.error('Ошибка при удалении уведомления:', error);
            if (this.uiManager && this.uiManager.showToast) {
              this.uiManager.showToast('Ошибка при удалении уведомления', 3000, 'error');
            }
          }
        };
        notificationEl.appendChild(deleteBtn);

        this.notificationsListEl.appendChild(notificationEl);
      }
    }
    
    // Затем показываем запросы в друзья
    let pendingCount = 0;
    for (const [fromUserId, request] of requestsArray) {
      if (request && request.status === 'pending') {
        // Показываем ВСЕ pending запросы в UI, независимо от processedRequestIds
        // processedRequestIds используется только для предотвращения toast-уведомлений
        console.log('🎨 Отображаем pending запрос от:', fromUserId, request);
        const notificationEl = this.createNotificationElement(fromUserId, request);
        this.notificationsListEl.appendChild(notificationEl);
        pendingCount++;
      } else {
        console.log('🎨 Пропускаем запрос (не pending):', fromUserId, request);
      }
    }
    
    // Если нет ни запросов, ни сообщений - показываем пустое состояние
    if (pendingCount === 0 && (!this.friendMessages || this.friendMessages.length === 0)) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
      }
    } else {
      if (emptyEl) {
        emptyEl.style.display = 'none';
      }
    }
    
    console.log('🎨 Отображено pending запросов:', pendingCount, 'сообщений:', this.friendMessages?.length || 0);
  }

  /**
   * Создает элемент уведомления
   */
  createNotificationElement(fromUserId, request) {
    const notification = document.createElement('div');
    notification.className = 'notification-item';
    notification.setAttribute('data-from-user-id', fromUserId);

    const info = document.createElement('div');
    info.className = 'notification-info';
    
    const text = document.createElement('div');
    text.className = 'notification-text';
    text.textContent = `${escapeHtml(request.fromNickname)} хочет добавить вас в друзья`;
    info.appendChild(text);

    notification.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'notification-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'notification-accept-btn';
    acceptBtn.textContent = 'Принять';
    acceptBtn.onclick = () => this.handleAcceptRequest(fromUserId);
    actions.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'notification-reject-btn';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.onclick = () => this.handleRejectRequest(fromUserId);
    actions.appendChild(rejectBtn);

    notification.appendChild(actions);

    // Кнопка удаления для запроса в друзья
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'notification-delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Удалить уведомление';
    deleteBtn.onclick = async () => {
      try {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) return;
        
        // Отклоняем запрос в друзья (удаляем из Firebase)
        const result = await rejectFriendRequest(this.db, currentUser.uid, fromUserId);
        
        if (result.success) {
          // Удаляем элемент из DOM
          notification.remove();
          
          // Перерисовываем список уведомлений с обновленными данными
          await this.loadNotifications();
          
          // Проверяем, нужно ли показать пустое состояние
          if (this.notificationsListEl && this.notificationsListEl.children.length === 0) {
            const emptyEl = document.getElementById('notificationsEmpty');
            if (emptyEl) {
              emptyEl.style.display = 'block';
            }
          }
        } else {
          console.error('Ошибка при отклонении запроса:', result.error);
          if (this.uiManager && this.uiManager.showToast) {
            this.uiManager.showToast('Не удалось удалить уведомление', 3000, 'error');
          }
        }
      } catch (error) {
        console.error('Ошибка при удалении уведомления:', error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Ошибка при удалении уведомления', 3000, 'error');
        }
      }
    };
    notification.appendChild(deleteBtn);

    return notification;
  }

  /**
   * Удаляет уведомление о сообщении из массива
   */
  removeMessageNotification(friendId, timestamp) {
    if (!this.friendMessages || !Array.isArray(this.friendMessages)) {
      return;
    }
    
    // Удаляем сообщение из массива
    const beforeLength = this.friendMessages.length;
    this.friendMessages = this.friendMessages.filter(msg => 
      !(msg.friendId === friendId && msg.timestamp === timestamp)
    );
    const afterLength = this.friendMessages.length;
    
    console.log('🗑️ Удалено уведомление о сообщении от', friendId, `(${beforeLength} -> ${afterLength})`);
  }

  /**
   * Обрабатывает принятие запроса
   */
  async handleAcceptRequest(friendId) {
    if (!this.authManager) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    try {
      // Помечаем запрос как обработанный СРАЗУ, до выполнения операции
      // Это предотвратит показ уведомлений во время обработки
      if (!this.processedRequestIds) {
        this.processedRequestIds = new Set();
      }
      this.processedRequestIds.add(friendId);
      console.log('🔒 Запрос помечен как обработанный:', friendId);
      
      // Также сразу уменьшаем счетчик pending запросов, чтобы listener не сработал
      if (this.previousPendingCount > 0) {
        this.previousPendingCount--;
      }
      
      const result = await acceptFriendRequest(this.db, currentUser.uid, friendId);
      if (result.success) {
        console.log('✅ Запрос принят, обновляем UI');
        
        // Получаем никнейм друга для тоста
        let friendNickname = friendId;
        try {
          friendNickname = await getUserNickname(this.db, friendId) || friendId;
        } catch (error) {
          console.error('Ошибка при получении никнейма друга:', error);
        }
        
        // Показываем тост об успешном принятии заявки
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast(`${friendNickname} теперь ваш друг!`, 3000, 'success');
        }
        
        // Ждем небольшую задержку, чтобы Firebase синхронизировался
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Сразу обновляем UI уведомлений (удаляем принятый запрос из списка)
        await this.loadNotifications();
        
        // Обновляем список друзей сразу после тоста
        await this.loadFriends();
        
        // Также форсируем обновление через небольшую задержку на случай задержки синхронизации
        setTimeout(async () => {
          await this.loadFriends();
          await this.loadNotifications();
        }, 1000);
        
        // Если модальное окно уведомлений открыто, обновляем его
        const notificationsModal = document.getElementById('notificationsModal');
        if (notificationsModal && notificationsModal.classList.contains('show')) {
          // Загружаем актуальные уведомления
          await this.loadNotifications();
        }
      } else {
        console.error('❌ Ошибка при принятии запроса:', result.error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast(`Ошибка при принятии: ${result.error}`, 5000, 'error');
        }
        // Если ошибка, убираем из обработанных, чтобы можно было попробовать снова
        this.processedRequestIds.delete(friendId);
        // Восстанавливаем счетчик
        if (this.previousPendingCount >= 0) {
          this.previousPendingCount++;
        }
      }
    } catch (error) {
      console.error('Ошибка при принятии запроса:', error);
      // Если ошибка, убираем из обработанных
      if (this.processedRequestIds) {
        this.processedRequestIds.delete(friendId);
      }
      // Восстанавливаем счетчик
      if (this.previousPendingCount >= 0) {
        this.previousPendingCount++;
      }
    }
  }

  /**
   * Обрабатывает отклонение запроса
   */
  async handleRejectRequest(friendId) {
    if (!this.authManager) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    try {
      // Помечаем запрос как обработанный СРАЗУ, до выполнения операции
      // Это предотвратит показ уведомлений во время обработки
      if (!this.processedRequestIds) {
        this.processedRequestIds = new Set();
      }
      this.processedRequestIds.add(friendId);
      console.log('🔒 Запрос помечен как обработанный (отклонен):', friendId);
      
      // Также сразу уменьшаем счетчик pending запросов, чтобы listener не сработал
      if (this.previousPendingCount > 0) {
        this.previousPendingCount--;
      }
      
      const result = await rejectFriendRequest(this.db, currentUser.uid, friendId);
      if (result.success) {
        console.log('✅ Запрос отклонен, обновляем UI');
        
        // Ждем небольшую задержку, чтобы Firebase синхронизировался
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Сразу обновляем UI уведомлений (удаляем отклоненный запрос из списка)
        await this.loadNotifications();
        
        // Если модальное окно уведомлений открыто, обновляем его
        const notificationsModal = document.getElementById('notificationsModal');
        if (notificationsModal && notificationsModal.classList.contains('show')) {
          // Загружаем актуальные уведомления
          await this.loadNotifications();
        }
        
        // Также форсируем обновление через небольшую задержку
        setTimeout(async () => {
          await this.loadNotifications();
        }, 1000);
      } else {
        console.error('❌ Ошибка при отклонении запроса:', result.error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast(`Ошибка при отклонении: ${result.error}`, 5000, 'error');
        }
        // Если ошибка, убираем из обработанных, чтобы можно было попробовать снова
        this.processedRequestIds.delete(friendId);
        // Восстанавливаем счетчик
        if (this.previousPendingCount >= 0) {
          this.previousPendingCount++;
        }
      }
    } catch (error) {
      console.error('❌ Ошибка при отклонении запроса:', error);
      if (this.uiManager && this.uiManager.showToast) {
        this.uiManager.showToast(`Ошибка при отклонении: ${error.message}`, 5000, 'error');
      }
      // Если ошибка, убираем из обработанных
      if (this.processedRequestIds) {
        this.processedRequestIds.delete(friendId);
      }
      // Восстанавливаем счетчик
      if (this.previousPendingCount >= 0) {
        this.previousPendingCount++;
      }
    }
  }

  /**
   * Обновляет badge с количеством уведомлений
   */
  updateNotificationsBadge(count) {
    if (this.notificationsBadgeEl) {
      if (count > 0) {
        this.notificationsBadgeEl.textContent = count > 99 ? '99+' : count.toString();
        this.notificationsBadgeEl.style.display = 'flex';
      } else {
        this.notificationsBadgeEl.style.display = 'none';
      }
    }
  }

  /**
   * Начинает отслеживание уведомлений в реальном времени
   */
  startListeningToRequests() {
    if (!this.authManager || !this.db) {
      console.error('❌ Нельзя запустить слушатель уведомлений: authManager или db не инициализированы');
      return;
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.error('❌ Нельзя запустить слушатель уведомлений: пользователь не авторизован');
      return;
    }

    console.log('🔔 Запуск слушателя уведомлений для пользователя:', currentUser.uid);

    // Отключаем предыдущий слушатель, если есть
    if (this.requestsListener) {
      console.log('🔔 Отключаем предыдущий слушатель уведомлений');
      this.db.ref(`friendRequests/${currentUser.uid}`).off('value', this.requestsListener);
    }

    // Загружаем начальное количество уведомлений
    const requestsPath = `friendRequests/${currentUser.uid}`;
    console.log('🔔 Загружаем начальные уведомления из пути:', requestsPath);
    
    this.db.ref(requestsPath).once('value').then((snap) => {
      const requests = snap.val() || {};
      const pendingRequests = Object.entries(requests).filter(([_, r]) => 
        r && r.status === 'pending'
      );
      this.previousPendingCount = pendingRequests.length;
      
      // НЕ помечаем существующие запросы как обработанные при начальной загрузке
      // processedRequestIds используется ТОЛЬКО для предотвращения toast-уведомлений для новых запросов
      // Все существующие запросы должны отображаться в UI независимо от processedRequestIds
      if (!this.processedRequestIds) {
        this.processedRequestIds = new Set();
      }
      
      // Помечаем все существующие запросы как обработанные для уведомлений,
      // чтобы не показывать toast-уведомления для запросов, которые уже были при загрузке
      // Эти запросы будут отображаться в UI, но toast-уведомления для них показываться не будут
      pendingRequests.forEach(([fromUserId, request]) => {
        this.processedRequestIds.add(fromUserId);
      });
      
      console.log('📋 Начальное количество запросов в друзья:', this.previousPendingCount);
      console.log('📋 Все запросы:', requests);
      console.log('📋 Помеченные как обработанные (не показывать toast):', Array.from(this.processedRequestIds));
      
      // Сохраняем предыдущий список запросов для отслеживания изменений
      let previousRequests = new Set(Object.keys(requests || {}));
      
      // После загрузки начального количества, начинаем слушать изменения
      this.requestsListener = (snap) => {
        const requests = snap.val() || {};
        const currentRequestIds = new Set(Object.keys(requests || {}));
        
        // Проверяем, исчезли ли какие-то запросы (были приняты или отклонены)
        const disappearedRequests = new Set();
        previousRequests.forEach(requestId => {
          if (!currentRequestIds.has(requestId)) {
            disappearedRequests.add(requestId);
          }
        });
        
        // Если запрос исчез, возможно он был принят - обновляем список друзей
        // Это важно для отправителя запроса: когда получатель принимает запрос,
        // запрос удаляется, и нужно обновить список друзей, чтобы увидеть нового друга
        if (disappearedRequests.size > 0) {
          console.log('🔔 Запрос(ы) исчез(ли), возможно принят(ы):', Array.from(disappearedRequests));
          
          // Получаем никнеймы друзей, которые приняли заявки
          const acceptedFriendIds = Array.from(disappearedRequests);
          Promise.all(
            acceptedFriendIds.map(async (friendId) => {
              try {
                const nickname = await getUserNickname(this.db, friendId);
                return nickname || friendId;
              } catch (error) {
                console.error('Ошибка при получении никнейма друга:', error);
                return friendId;
              }
            })
          ).then((friendNames) => {
            // Показываем тост об успешном принятии заявки отправителю
            if (this.uiManager && this.uiManager.showToast && friendNames.length > 0) {
              if (friendNames.length === 1) {
                this.uiManager.showToast(`${friendNames[0]} принял(а) ваш запрос в друзья!`, 3000, 'success');
              } else {
                this.uiManager.showToast(`${friendNames.length} пользователей приняли ваши запросы в друзья!`, 3000, 'success');
              }
            }
            
            // После тоста обновляем список друзей
            setTimeout(async () => {
              await this.loadFriends();
            }, 500);
          });
          
          // Обновляем список друзей несколько раз с задержками, чтобы гарантировать обновление
          // Firebase может синхронизироваться с небольшой задержкой
          setTimeout(async () => {
            console.log('🔄 Первое обновление списка друзей после исчезновения запроса...');
            await this.loadFriends();
          }, 200);
          
          setTimeout(async () => {
            console.log('🔄 Второе обновление списка друзей после исчезновения запроса...');
            await this.loadFriends();
          }, 800);
          
          setTimeout(async () => {
            console.log('🔄 Третье обновление списка друзей после исчезновения запроса...');
            await this.loadFriends();
          }, 1500);
        }
        
        // Обновляем предыдущий список запросов
        previousRequests = currentRequestIds;
        
        // Находим все pending запросы
        const allPendingRequests = Object.entries(requests).filter(([_, r]) => 
          r && r.status === 'pending'
        );
        const pendingCount = allPendingRequests.length;
        
        console.log('🔔 Слушатель уведомлений сработал:', {
          previousCount: this.previousPendingCount,
          currentCount: pendingCount,
          requestsCount: Object.keys(requests).length,
          processedIds: Array.from(this.processedRequestIds || [])
        });
        
        // Находим новые запросы (которые еще не были обработаны для уведомлений)
        // processedRequestIds используется ТОЛЬКО для предотвращения toast-уведомлений,
        // но не для скрытия запросов в UI
        if (!this.processedRequestIds) {
          this.processedRequestIds = new Set();
        }
        
        // Определяем новые запросы для показа toast-уведомлений
        // ВАЖНО: показываем уведомление ТОЛЬКО если количество УВЕЛИЧИЛОСЬ
        // Это гарантирует, что мы не покажем уведомление для уже существующих запросов
        const newRequests = [];
        
        // Находим новые запросы (которые появились после последнего снимка)
        // ВАЖНО: Проверяем только если количество действительно увеличилось И это не первая инициализация
        if (pendingCount > this.previousPendingCount && this.previousPendingCount >= 0) {
          // Количество увеличилось - есть новый запрос
          // Находим запросы, которых НЕТ в processedRequestIds (новые запросы)
          for (const [fromUserId, request] of allPendingRequests) {
            // Запрос считается новым, если он не был в processedRequestIds
            if (!this.processedRequestIds.has(fromUserId)) {
              newRequests.push([fromUserId, request]);
            }
          }
          
          // Если нашли новые запросы, показываем уведомление только для самого свежего
          if (newRequests.length > 0) {
            console.log('🔔 Новый запрос в друзья получен!', { 
              previous: this.previousPendingCount, 
              current: pendingCount,
              newRequests: newRequests.length
            });
            
            // Находим самый свежий новый запрос (с максимальным timestamp)
            let newestRequest = null;
            let newestRequestId = null;
            let maxTimestamp = 0;
            
            for (const [fromUserId, request] of newRequests) {
              const timestamp = request.timestamp || 0;
              if (timestamp > maxTimestamp) {
                maxTimestamp = timestamp;
                newestRequest = request;
                newestRequestId = fromUserId;
              }
            }
            
            // Если нашли новый запрос, показываем уведомление
            if (newestRequest && newestRequestId) {
              // ВАЖНО: Помечаем запрос как обработанный ДО показа уведомления,
              // чтобы предотвратить повторные уведомления при следующем срабатывании listener
              this.processedRequestIds.add(newestRequestId);
              
              // ВАЖНО: Обновляем счетчик ДО показа уведомления,
              // чтобы при следующем срабатывании listener не показал уведомление снова
              this.previousPendingCount = pendingCount;
              
              const fromNickname = newestRequest.fromNickname || 'Неизвестный пользователь';
              const notificationMessage = `${fromNickname} хочет добавить вас в друзья`;
              
              console.log('🔔 Информация о новом запросе:', { 
                fromUserId: newestRequestId, 
                fromNickname,
                timestamp: newestRequest.timestamp 
              });
              
              // Проигрываем звук уведомления
              if (this.onNotificationSound && typeof this.onNotificationSound === 'function') {
                this.onNotificationSound();
              }
              
              // Показываем toast уведомление (красная плашка)
              if (this.uiManager && typeof this.uiManager.showToast === 'function') {
                console.log('🔔 Показываем toast уведомление:', notificationMessage);
                this.uiManager.showToast(notificationMessage);
              } else {
                console.warn('⚠️ uiManager не доступен для показа toast уведомления', {
                  uiManager: this.uiManager,
                  showToast: this.uiManager ? typeof this.uiManager.showToast : 'нет uiManager'
                });
              }
              
              // Обновляем UI, чтобы показать новый запрос (только если модальное окно открыто)
              try {
                const notificationsModal = document.getElementById('notificationsModal');
                if (notificationsModal && notificationsModal.classList.contains('show') && this.notificationsListEl) {
                  this.renderNotifications(requests);
                }
              } catch (error) {
                console.error('Ошибка при обновлении уведомлений:', error);
              }
            }
          } else {
            // Если новых запросов нет, но количество увеличилось, 
            // обновляем счетчик, чтобы не показывать уведомления повторно
            this.previousPendingCount = pendingCount;
          }
        } else {
          // Если количество не увеличилось, просто обновляем счетчик
          this.previousPendingCount = pendingCount;
        }
        
        // Обновляем набор обработанных запросов
        // Удаляем из обработанных те ID, которых больше нет в текущих запросах
        // (когда запрос был принят/отклонен и удален)
        const currentRequestIdsSet = new Set(allPendingRequests.map(([fromUserId]) => fromUserId));
        
        // Очищаем processedRequestIds от запросов, которых больше нет
        const idsToRemove = [];
        for (const requestId of this.processedRequestIds) {
          if (!currentRequestIdsSet.has(requestId)) {
            idsToRemove.push(requestId);
          }
        }
        idsToRemove.forEach(requestId => {
          this.processedRequestIds.delete(requestId);
          console.log('🔔 Удаляем обработанный запрос из памяти (запрос был удален):', requestId);
        });
        
        // Всегда обновляем badge
        this.updateNotificationsBadge(pendingCount);
        
        // ВАЖНО: Обновляем список уведомлений в UI
        // processedRequestIds НЕ влияет на отображение - показываем ВСЕ pending запросы
        // processedRequestIds используется ТОЛЬКО для предотвращения повторных toast-уведомлений
        // Обновляем только если модальное окно открыто (чтобы не перерисовывать без необходимости)
        // Если модальное окно закрыто, список будет обновлен при его открытии через loadNotifications()
        const notificationsModal = document.getElementById('notificationsModal');
        if (notificationsModal && notificationsModal.classList.contains('show')) {
          this.renderNotifications(requests);
        }
      };

      // Начинаем слушать изменения
      console.log('🔔 Регистрируем слушатель для пути:', requestsPath);
      this.db.ref(requestsPath).on('value', this.requestsListener);
      console.log('✅ Слушатель уведомлений успешно запущен');
    }).catch((error) => {
      console.error('❌ Ошибка при загрузке начальных уведомлений:', error);
      console.error('Детали ошибки:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      
      // В случае ошибки, начинаем слушать с нулевым количеством
      this.previousPendingCount = 0;
      if (!this.processedRequestIds) {
        this.processedRequestIds = new Set();
      }
      this.requestsListener = (snap) => {
        const requests = snap.val() || {};
        const allPendingRequests = Object.entries(requests).filter(([_, r]) => 
          r && r.status === 'pending'
        );
        const pendingCount = allPendingRequests.length;
        
        console.log('🔔 Слушатель уведомлений (fallback) сработал:', {
          currentCount: pendingCount,
          requests: requests
        });
        
        // Находим новые запросы
        const newRequests = allPendingRequests.filter(([fromUserId]) => 
          !this.processedRequestIds.has(fromUserId)
        );
        
        // Если есть новые запросы и количество увеличилось
        if (newRequests.length > 0 && pendingCount > this.previousPendingCount && this.previousPendingCount >= 0) {
          const [fromUserId, request] = newRequests[0];
          const fromNickname = request.fromNickname || 'Неизвестный пользователь';
          const notificationMessage = `${fromNickname} хочет добавить вас в друзья`;
          
          // Помечаем как обработанный
          this.processedRequestIds.add(fromUserId);
          
          this.onNotificationSound();
          if (this.uiManager && typeof this.uiManager.showToast === 'function') {
            this.uiManager.showToast(notificationMessage);
          }
        }
        
        // Обновляем обработанные запросы
        if (pendingCount < this.previousPendingCount) {
          const currentRequestIds = new Set(allPendingRequests.map(([fromUserId]) => fromUserId));
          for (const requestId of this.processedRequestIds) {
            if (!currentRequestIds.has(requestId)) {
              this.processedRequestIds.delete(requestId);
            }
          }
        }
        
        this.previousPendingCount = pendingCount;
        
        // Обновляем badge
        this.updateNotificationsBadge(pendingCount);
        
        // Если модальное окно открыто, обновляем список
        const notificationsModal = document.getElementById('notificationsModal');
        if (notificationsModal && notificationsModal.classList.contains('show')) {
          this.renderNotifications(requests);
        }
      };
      this.db.ref(requestsPath).on('value', this.requestsListener);
      console.log('✅ Слушатель уведомлений (fallback) запущен');
    });
  }

  /**
   * Останавливает отслеживание уведомлений
   */
  stopListeningToRequests() {
    if (!this.authManager || !this.db) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    if (this.requestsListener) {
      this.db.ref(`friendRequests/${currentUser.uid}`).off('value', this.requestsListener);
      this.requestsListener = null;
    }
  }

  /**
   * Останавливает все слушатели
   */
  cleanup() {
    // Останавливаем слушатели онлайн статуса друзей
    Object.entries(this.onlineStatusListeners).forEach(([friendId, listener]) => {
      if (this.db) {
        this.db.ref(`users/${friendId}/online`).off('value', listener);
      }
    });
    this.onlineStatusListeners = {};

    // Останавливаем слушатель запросов
    this.stopListeningToRequests();
    
    // Останавливаем слушатель списка друзей
    this.stopListeningToFriends();
    
    // Останавливаем слушатель приглашений в комнаты
    this.stopListeningToInvitations();
    
    // Останавливаем слушатель сообщений
    this.stopListeningToMessages();
  }

  /**
   * Начинает отслеживание сообщений от друзей
   * ВРЕМЕННО ОТКЛЮЧЕНО - метод комментирован, но оставлен для будущего использования
   */
  startListeningToMessages() {
    if (!this.authManager || !this.db) {
      console.warn('⚠️ Нельзя запустить слушатель сообщений: authManager или db не инициализированы');
      return;
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.warn('⚠️ Нельзя запустить слушатель сообщений: пользователь не авторизован');
      return;
    }

    console.log('💬 Запуск слушателя сообщений для пользователя:', currentUser.uid);

    // Отключаем предыдущий слушатель, если есть
    if (this.messagesListener) {
      this.db.ref(`friendMessages/${currentUser.uid}`).off('value', this.messagesListener);
    }

    // Загружаем начальные сообщения
    const messagesPath = `friendMessages/${currentUser.uid}`;
    
    this.db.ref(messagesPath).once('value').then((snap) => {
      const messages = snap.val() || {};
      
      // Помечаем существующие сообщения как обработанные и загружаем их в память
      if (!this.processedMessages) {
        this.processedMessages = new Set();
      }
      if (!this.friendMessages) {
        this.friendMessages = [];
      }
      
      try {
        // Используем Map для предотвращения дубликатов при начальной загрузке
        const messagesMap = new Map();
        
        // Загружаем все сообщения из Firebase
        Object.entries(messages).forEach(([friendId, friendMessages]) => {
          if (friendMessages && typeof friendMessages === 'object') {
            Object.entries(friendMessages).forEach(([messageId, message]) => {
              if (message && typeof message === 'object' && message.timestamp) {
                const messageKey = `${friendId}_${messageId}_${message.timestamp}`;
                // Помечаем сообщение как обработанное для слушателя
                this.processedMessages.add(messageKey);
                
                // Создаем ключ для уникальности сообщения (используем friendId и timestamp)
                const uniqueKey = `${friendId}_${message.timestamp}`;
                
                // Добавляем сообщение в Map только если его еще нет
                if (!messagesMap.has(uniqueKey)) {
                  const messageData = {
                    friendId: friendId,
                    fromNickname: message.fromNickname || 'Неизвестный пользователь',
                    messageText: message.message || '',
                    timestamp: message.timestamp
                  };
                  messagesMap.set(uniqueKey, messageData);
                }
              }
            });
          }
        });
        
        // Преобразуем Map в массив (гарантирует уникальность)
        this.friendMessages = Array.from(messagesMap.values());
        
        // Сортируем сообщения по времени (новые сверху)
        this.friendMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        
        // Ограничиваем количество (последние 50)
        if (this.friendMessages.length > 50) {
          this.friendMessages = this.friendMessages.slice(0, 50);
        }
        
        console.log('💬 Загружено уникальных сообщений в память (startListeningToMessages):', this.friendMessages.length);
      } catch (error) {
        console.error('Ошибка при обработке начальных сообщений:', error);
      }
      
      // Начинаем слушать изменения
      this.messagesListener = (snap) => {
        try {
          const messages = snap.val() || {};
          
          // Показываем уведомления о новых сообщениях
          Object.entries(messages).forEach(([friendId, friendMessages]) => {
            if (friendMessages && typeof friendMessages === 'object') {
              Object.entries(friendMessages).forEach(([messageId, message]) => {
                if (message && typeof message === 'object' && message.timestamp) {
                  const messageKey = `${friendId}_${messageId}_${message.timestamp}`;
                  if (!this.processedMessages.has(messageKey)) {
                    // Помечаем как обработанное ДО показа уведомления
                    this.processedMessages.add(messageKey);
                    this.showFriendMessageNotification(friendId, message);
                  }
                }
              });
            }
          });
        } catch (error) {
          console.error('Ошибка в слушателе сообщений:', error);
        }
      };

      this.db.ref(messagesPath).on('value', this.messagesListener);
      console.log('✅ Слушатель сообщений запущен');
    }).catch((error) => {
      console.error('❌ Ошибка при загрузке начальных сообщений:', error);
    });
  }

  /**
   * Обновляет уведомления после получения нового сообщения
   */
  async updateNotificationsAfterMessage() {
    try {
      const currentUser = this.authManager.getCurrentUser();
      if (!currentUser) return;
      
      // Обновляем отображение уведомлений, если список открыт
      const notificationsModal = document.getElementById('notificationsModal');
      if (notificationsModal && notificationsModal.classList.contains('show')) {
        // Если модальное окно открыто, обновляем список
        const requests = await getFriendRequests(this.db, currentUser.uid);
        this.renderNotifications(requests || {});
      }
      
      // Обновляем badge - учитываем и запросы, и сообщения
      const currentRequests = await getFriendRequests(this.db, currentUser.uid);
      const pendingCount = Object.values(currentRequests || {}).filter(r => r && r.status === 'pending').length;
      const totalCount = pendingCount + (this.friendMessages?.length || 0);
      if (this.notificationsBadgeEl) {
        this.notificationsBadgeEl.textContent = totalCount;
        this.notificationsBadgeEl.style.display = totalCount > 0 ? 'block' : 'none';
      }
    } catch (error) {
      console.error('Ошибка при обновлении уведомлений после сообщения:', error);
    }
  }

  /**
   * Показывает уведомление о новом сообщении от друга
   */
  showFriendMessageNotification(friendId, message) {
    const fromNickname = message.fromNickname || 'Неизвестный пользователь';
    const messageText = message.message || '';
    const timestamp = message.timestamp || Date.now();
    
    // Проигрываем звук уведомления
    if (this.onNotificationSound && typeof this.onNotificationSound === 'function') {
      this.onNotificationSound();
    }

    // Сохраняем сообщение в массиве для постоянного отображения
    if (!this.friendMessages) {
      this.friendMessages = [];
    }
    
    // Проверяем, нет ли уже такого сообщения (по friendId и timestamp)
    const messageKey = `${friendId}_${timestamp}`;
    const isDuplicate = this.friendMessages.some(m => 
      m.friendId === friendId && m.timestamp === timestamp
    );
    
    if (!isDuplicate) {
      // Добавляем новое сообщение в начало массива
      this.friendMessages.unshift({
        friendId: friendId,
        fromNickname: fromNickname,
        messageText: messageText,
        timestamp: timestamp
      });
      
      // Ограничиваем количество сообщений (например, последние 50)
      if (this.friendMessages.length > 50) {
        this.friendMessages = this.friendMessages.slice(0, 50);
      }
      
      // Обновляем отображение уведомлений и badge асинхронно
      this.updateNotificationsAfterMessage();
    }
  }

  /**
   * Останавливает отслеживание сообщений
   */
  stopListeningToMessages() {
    // Безопасная проверка - метод может быть не инициализирован
    if (!this.authManager || !this.db) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    // Безопасная проверка - свойство может быть не определено
    if (this.messagesListener) {
      try {
        this.db.ref(`friendMessages/${currentUser.uid}`).off('value', this.messagesListener);
        this.messagesListener = null;
      } catch (error) {
        console.error('Ошибка при остановке слушателя сообщений:', error);
      }
    }
  }

  /**
   * Генерирует цвет для аватара на основе строки
   */
  generateAvatarColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const hue = Math.abs(hash % 360);
    return `linear-gradient(135deg, hsl(${hue}, 70%, 60%), hsl(${hue + 30}, 70%, 50%))`;
  }

  /**
   * Показывает контекстное меню для друга
   */
  showFriendContextMenu(e, friendId, friendNickname) {
    // Удаляем предыдущее меню, если есть
    const existingMenu = document.getElementById('friendContextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Создаем контекстное меню
    const menu = document.createElement('div');
    menu.id = 'friendContextMenu';
    menu.className = 'friend-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.style.zIndex = '10000';

    // Кнопка "Удалить друга"
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'context-menu-item';
    deleteBtn.textContent = 'Удалить друга';
    deleteBtn.onclick = () => {
      this.handleRemoveFriend(friendId, friendNickname);
      menu.remove();
    };
    menu.appendChild(deleteBtn);

    // Кнопка "Написать другу"
    const messageBtn = document.createElement('div');
    messageBtn.className = 'context-menu-item';
    messageBtn.textContent = 'Написать другу';
    messageBtn.onclick = () => {
      this.showMessageModal(friendId, friendNickname);
      menu.remove();
    };
    menu.appendChild(messageBtn);

    // Кнопка "Пригласить в комнату"
    const inviteBtn = document.createElement('div');
    inviteBtn.className = 'context-menu-item';
    inviteBtn.textContent = 'Пригласить в комнату';
    inviteBtn.onclick = () => {
      this.showRoomInviteModal(friendId, friendNickname);
      menu.remove();
    };
    menu.appendChild(inviteBtn);

    document.body.appendChild(menu);

    // Закрываем меню при клике вне его
    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  /**
   * Обрабатывает удаление друга
   */
  async handleRemoveFriend(friendId, friendNickname) {
    if (!this.authManager) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    // Подтверждение удаления
    if (!this.uiManager || !this.uiManager.showConfirm) {
      console.error('UI Manager не доступен для показа диалога подтверждения');
      return;
    }
    const confirmed = await this.uiManager.showConfirm(`Вы уверены, что хотите удалить ${friendNickname} из друзей?`);
    if (!confirmed) return;

    try {
      const result = await removeFriend(this.db, currentUser.uid, friendId);
      if (result.success) {
        console.log('✅ Друг удален');
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast(`${friendNickname} удален из друзей`, 3000, 'success');
        }
        // Обновляем список друзей
        await this.loadFriends();
      } else {
        console.error('Ошибка при удалении друга:', result.error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Ошибка при удалении друга', 5000, 'error');
        }
      }
    } catch (error) {
      console.error('Ошибка при удалении друга:', error);
      if (this.uiManager && this.uiManager.showToast) {
        this.uiManager.showToast('Ошибка при удалении друга');
      }
    }
  }

  /**
   * Показывает модальное окно для отправки сообщения
   */
  async showMessageModal(friendId, friendNickname) {
    // Удаляем предыдущее модальное окно, если есть
    const existingModal = document.getElementById('friendMessageModal');
    if (existingModal) {
      existingModal.remove();
    }

    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.id = 'friendMessageModal';
    modal.className = 'modal show';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '500px';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = `Написать ${friendNickname}`;
    modalHeader.appendChild(headerTitle);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close-btn';
    closeBtn.textContent = '✖';
    closeBtn.onclick = () => {
      modal.remove();
    };
    modalHeader.appendChild(closeBtn);
    
    modalContent.appendChild(modalHeader);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const messageGroup = document.createElement('div');
    messageGroup.className = 'modal-input-group';
    
    const messageLabel = document.createElement('label');
    messageLabel.textContent = 'Сообщение:';
    messageGroup.appendChild(messageLabel);

    const messageTextarea = document.createElement('textarea');
    messageTextarea.id = 'friendMessageText';
    messageTextarea.className = 'modal-input';
    messageTextarea.placeholder = 'Введите сообщение...';
    messageTextarea.style.width = '100%';
    messageTextarea.style.minHeight = '120px';
    messageTextarea.style.resize = 'vertical';
    messageTextarea.style.fontFamily = 'inherit';
    messageGroup.appendChild(messageTextarea);
    
    modalBody.appendChild(messageGroup);

    const errorDiv = document.createElement('div');
    errorDiv.id = 'friendMessageError';
    errorDiv.className = 'modal-error';
    errorDiv.style.display = 'none';
    modalBody.appendChild(errorDiv);

    modalContent.appendChild(modalBody);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'modal-submit-btn';
    sendBtn.textContent = 'Отправить';
    sendBtn.onclick = async () => {
      const message = messageTextarea.value.trim();
      if (!message) {
        errorDiv.textContent = 'Введите сообщение';
        errorDiv.style.display = 'block';
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Отправка...';

      try {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) return;

        const myNickname = await getUserNickname(this.db, currentUser.uid);
        const result = await sendFriendMessage(
          this.db,
          currentUser.uid,
          friendId,
          myNickname || currentUser.email,
          message
        );

        if (result.success) {
          modal.remove();
          if (this.uiManager && this.uiManager.showToast) {
            this.uiManager.showToast('Сообщение отправлено', 3000, 'success');
          }
        } else {
          errorDiv.textContent = result.error || 'Ошибка при отправке сообщения';
          errorDiv.style.display = 'block';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Отправить';
        }
      } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        errorDiv.textContent = 'Ошибка при отправке сообщения';
        errorDiv.style.display = 'block';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Отправить';
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-cancel-btn';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = () => {
      modal.remove();
    };

    modalFooter.appendChild(cancelBtn);
    modalFooter.appendChild(sendBtn);
    modalContent.appendChild(modalFooter);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Закрытие по клику вне модального окна
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    };

    // Закрытие по Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Фокус на текстовое поле
    setTimeout(() => {
      messageTextarea.focus();
    }, 100);
  }

  /**
   * Показывает модальное окно для приглашения в комнату
   */
  async showRoomInviteModal(friendId, friendNickname) {
    // Удаляем предыдущее модальное окно, если есть
    const existingModal = document.getElementById('roomInviteModal');
    if (existingModal) {
      existingModal.remove();
    }

    // Получаем список комнат
    let rooms = {};
    try {
      rooms = await getRoomsList(this.db);
    } catch (error) {
      console.error('Ошибка при получении списка комнат:', error);
      if (this.uiManager && this.uiManager.showToast) {
        this.uiManager.showToast('Ошибка при загрузке комнат', 5000, 'error');
      }
      return;
    }
    
    // Получаем ID текущего пользователя для фильтрации комнат
    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;
    
    const roomsArray = Object.entries(rooms || {}).filter(([roomId, roomData]) => {
      // Показываем только комнаты, которые существуют и созданы текущим пользователем
      return roomData && roomData.name && roomData.creatorId === currentUser.uid;
    });

    if (roomsArray.length === 0) {
      if (this.uiManager && this.uiManager.showToast) {
        this.uiManager.showToast('Нет доступных комнат для приглашения. Создайте комнату сначала.');
      }
      return;
    }

    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.id = 'roomInviteModal';
    modal.className = 'modal show';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '500px';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = `Пригласить ${friendNickname} в комнату`;
    modalHeader.appendChild(headerTitle);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close-btn';
    closeBtn.textContent = '✖';
    closeBtn.onclick = () => {
      modal.remove();
    };
    modalHeader.appendChild(closeBtn);
    
    modalContent.appendChild(modalHeader);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const roomGroup = document.createElement('div');
    roomGroup.className = 'modal-input-group';
    
    const roomLabel = document.createElement('label');
    roomLabel.textContent = 'Выберите комнату:';
    roomGroup.appendChild(roomLabel);

    const roomSelect = document.createElement('select');
    roomSelect.id = 'roomInviteSelect';
    roomSelect.className = 'modal-input';
    roomSelect.style.width = '100%';
    roomSelect.style.padding = '12px 16px';
    roomSelect.style.fontFamily = 'inherit';
    roomGroup.appendChild(roomSelect);
    
    modalBody.appendChild(roomGroup);
    
    roomsArray.forEach(([roomId, roomData]) => {
      const option = document.createElement('option');
      option.value = roomId;
      option.textContent = roomData.name || roomId;
      roomSelect.appendChild(option);
    });

    modalBody.appendChild(roomSelect);

    const errorDiv = document.createElement('div');
    errorDiv.id = 'roomInviteError';
    errorDiv.className = 'modal-error';
    errorDiv.style.display = 'none';
    modalBody.appendChild(errorDiv);

    modalContent.appendChild(modalBody);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'modal-submit-btn';
    sendBtn.textContent = 'Отправить приглашение';
    sendBtn.onclick = async () => {
      const roomId = roomSelect.value;
      if (!roomId) {
        errorDiv.textContent = 'Выберите комнату';
        errorDiv.style.display = 'block';
        return;
      }

      const selectedRoom = rooms[roomId];
      if (!selectedRoom) {
        errorDiv.textContent = 'Комната не найдена';
        errorDiv.style.display = 'block';
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Отправка...';

      try {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) return;

        const myNickname = await getUserNickname(this.db, currentUser.uid);
        const result = await sendRoomInvitation(
          this.db,
          currentUser.uid,
          friendId,
          myNickname || currentUser.email,
          roomId,
          selectedRoom.name || roomId
        );

        if (result.success) {
          modal.remove();
          if (this.uiManager && this.uiManager.showToast) {
            this.uiManager.showToast('Приглашение отправлено', 3000, 'success');
          }
        } else {
          errorDiv.textContent = result.error || 'Ошибка при отправке приглашения';
          errorDiv.style.display = 'block';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Отправить приглашение';
        }
      } catch (error) {
        console.error('Ошибка при отправке приглашения:', error);
        errorDiv.textContent = 'Ошибка при отправке приглашения';
        errorDiv.style.display = 'block';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Отправить приглашение';
      }
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-cancel-btn';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = () => {
      modal.remove();
    };

    modalFooter.appendChild(cancelBtn);
    modalFooter.appendChild(sendBtn);
    modalContent.appendChild(modalFooter);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Закрытие по клику вне модального окна
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    // Закрытие по Escape
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Начинает отслеживание приглашений в комнаты
   */
  startListeningToInvitations() {
    if (!this.authManager || !this.db) {
      console.warn('⚠️ Нельзя запустить слушатель приглашений: authManager или db не инициализированы');
      return;
    }

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) {
      console.warn('⚠️ Нельзя запустить слушатель приглашений: пользователь не авторизован');
      return;
    }

    console.log('🎫 Запуск слушателя приглашений в комнаты для пользователя:', currentUser.uid);

    // Отключаем предыдущий слушатель, если есть
    if (this.invitationsListener) {
      this.db.ref(`roomInvitations/${currentUser.uid}`).off('value', this.invitationsListener);
    }

    // Загружаем начальные приглашения
    const invitationsPath = `roomInvitations/${currentUser.uid}`;
    
    this.db.ref(invitationsPath).once('value').then((snap) => {
      const invitations = snap.val() || {};
      const invitationsArray = Object.entries(invitations);
      
      // Помечаем существующие приглашения как обработанные
      if (!this.processedInvitations) {
        this.processedInvitations = new Set();
      }
      try {
        invitationsArray.forEach(([fromUserId, invitation]) => {
          if (invitation && typeof invitation === 'object' && invitation.status === 'pending' && invitation.timestamp) {
            const invitationKey = `${fromUserId}_${invitation.timestamp}`;
            this.processedInvitations.add(invitationKey);
          }
        });
      } catch (error) {
        console.error('Ошибка при обработке начальных приглашений:', error);
      }
      
      // Начинаем слушать изменения
      this.invitationsListener = (snap) => {
        try {
          const invitations = snap.val() || {};
          const invitationsArray = Object.entries(invitations);
          
          console.log('🎫 Получены приглашения в комнаты:', invitationsArray.length);
          
          // Показываем уведомления о новых приглашениях
          invitationsArray.forEach(([fromUserId, invitation]) => {
            if (invitation && typeof invitation === 'object' && invitation.status === 'pending' && invitation.timestamp) {
              const invitationKey = `${fromUserId}_${invitation.timestamp}`;
              if (!this.processedInvitations.has(invitationKey)) {
                // Помечаем как обработанное ДО показа уведомления
                this.processedInvitations.add(invitationKey);
                // Показываем уведомление
                this.showRoomInvitationNotification(fromUserId, invitation);
              }
            }
          });
          
          // Удаляем обработанные приглашения, которых больше нет
          const currentKeys = new Set();
          invitationsArray.forEach(([fromUserId, invitation]) => {
            if (invitation && typeof invitation === 'object' && invitation.status === 'pending' && invitation.timestamp) {
              currentKeys.add(`${fromUserId}_${invitation.timestamp}`);
            }
          });
          
          for (const key of this.processedInvitations) {
            if (!currentKeys.has(key)) {
              this.processedInvitations.delete(key);
            }
          }
        } catch (error) {
          console.error('Ошибка в слушателе приглашений:', error);
        }
      };

      this.db.ref(invitationsPath).on('value', this.invitationsListener);
      console.log('✅ Слушатель приглашений в комнаты запущен');
    }).catch((error) => {
      // PERMISSION_DENIED - это нормально, если правила Firebase не настроены для приглашений
      // Не показываем это как критическую ошибку
      if (error.code === 'PERMISSION_DENIED') {
        console.log('ℹ️ Приглашения в комнаты недоступны (правила Firebase не настроены или функция отключена)');
      } else {
        console.error('❌ Ошибка при загрузке начальных приглашений:', error);
      }
    });
  }

  /**
   * Показывает уведомление о приглашении в комнату
   */
  showRoomInvitationNotification(fromUserId, invitation) {
    // Проверяем, не показывается ли уже это приглашение
    const existingModal = document.getElementById('roomInvitationAcceptModal');
    if (existingModal) {
      const existingInvitationKey = existingModal.dataset.invitationKey;
      const currentInvitationKey = `${fromUserId}_${invitation.timestamp}`;
      if (existingInvitationKey === currentInvitationKey) {
        // Уже показываем это приглашение, не показываем повторно
        return;
      }
    }
    
    const fromNickname = invitation.fromNickname || 'Неизвестный пользователь';
    const roomName = invitation.roomName || invitation.roomId;
    
    // Проигрываем звук уведомления
    if (this.onNotificationSound && typeof this.onNotificationSound === 'function') {
      this.onNotificationSound();
    }

    // Показываем toast уведомление
    if (this.uiManager && typeof this.uiManager.showToast === 'function') {
      const message = `${fromNickname} приглашает вас в комнату "${roomName}"`;
      this.uiManager.showToast(message);
    }

    // Показываем модальное окно с приглашением
    this.showRoomInvitationAcceptModal(fromUserId, invitation);
  }

  /**
   * Показывает модальное окно для принятия/отклонения приглашения в комнату
   */
  async showRoomInvitationAcceptModal(fromUserId, invitation) {
    // Удаляем предыдущее модальное окно, если есть
    const existingModal = document.getElementById('roomInvitationAcceptModal');
    if (existingModal) {
      existingModal.remove();
    }

    const fromNickname = invitation.fromNickname || 'Неизвестный пользователь';
    const roomName = invitation.roomName || invitation.roomId;
    const roomId = invitation.roomId;

    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.id = 'roomInvitationAcceptModal';
    modal.className = 'modal show';
    modal.dataset.invitationKey = `${fromUserId}_${invitation.timestamp}`;
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '400px';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Приглашение в комнату';
    modalHeader.appendChild(headerTitle);
    modalContent.appendChild(modalHeader);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modalBody.style.textAlign = 'center';

    const message = document.createElement('p');
    message.textContent = `${fromNickname} приглашает вас в комнату "${roomName}"`;
    message.style.color = 'white';
    message.style.marginBottom = '20px';
    modalBody.appendChild(message);

    modalContent.appendChild(modalBody);

    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';
    modalFooter.style.justifyContent = 'center';
    modalFooter.style.gap = '10px';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'modal-btn primary';
    acceptBtn.textContent = 'Войти';
    acceptBtn.onclick = async () => {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Вход...';

      try {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) return;

        // Удаляем приглашение
        await removeRoomInvitation(this.db, currentUser.uid, fromUserId);
        
        // Удаляем из обработанных приглашений
        const invitationKey = `${fromUserId}_${invitation.timestamp}`;
        if (this.processedInvitations) {
          this.processedInvitations.delete(invitationKey);
        }

        // Закрываем модальное окно
        modal.remove();

        // Входим в комнату
        if (this.onJoinRoom && typeof this.onJoinRoom === 'function') {
          await this.onJoinRoom(roomId);
        } else {
          console.warn('⚠️ onJoinRoom callback не доступен');
        }

        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Вы вошли в комнату', 3000, 'success');
        }
      } catch (error) {
        console.error('Ошибка при входе в комнату:', error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Ошибка при входе в комнату', 5000, 'error');
        }
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'Войти';
      }
    };

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'modal-btn';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.onclick = async () => {
      rejectBtn.disabled = true;
      rejectBtn.textContent = 'Отклонение...';

      try {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) return;

        await removeRoomInvitation(this.db, currentUser.uid, fromUserId);
        
        // Удаляем из обработанных приглашений
        const invitationKey = `${fromUserId}_${invitation.timestamp}`;
        if (this.processedInvitations) {
          this.processedInvitations.delete(invitationKey);
        }

        modal.remove();
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Приглашение отклонено');
        }
      } catch (error) {
        console.error('Ошибка при отклонении приглашения:', error);
        if (this.uiManager && this.uiManager.showToast) {
          this.uiManager.showToast('Ошибка при отклонении приглашения');
        }
        rejectBtn.disabled = false;
        rejectBtn.textContent = 'Отклонить';
      }
    };

    modalFooter.appendChild(acceptBtn);
    modalFooter.appendChild(rejectBtn);
    modalContent.appendChild(modalFooter);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Закрытие по клику вне модального окна
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * Останавливает отслеживание приглашений в комнаты
   */
  stopListeningToInvitations() {
    // Безопасная проверка - метод может быть не инициализирован
    if (!this.authManager || !this.db) return;

    const currentUser = this.authManager.getCurrentUser();
    if (!currentUser) return;

    // Безопасная проверка - свойство может быть не определено
    if (this.invitationsListener) {
      try {
        this.db.ref(`roomInvitations/${currentUser.uid}`).off('value', this.invitationsListener);
        this.invitationsListener = null;
      } catch (error) {
        console.error('Ошибка при остановке слушателя приглашений:', error);
      }
    }
  }
}

