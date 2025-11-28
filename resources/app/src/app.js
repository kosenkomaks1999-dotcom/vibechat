/**
 * Главный файл приложения VibeChat
 * Объединяет все модули и управляет состоянием приложения
 */

import { CONSTANTS } from './modules/constants.js';
import { initFirebase, getRoomRef, createUserInRoom, updateUserMuteStatus, updateUserSpeakerStatus, clearRoomMessages, deleteRoom, isNicknameTaken, reserveNickname, getUserNickname, getEmailByNickname, saveUserAvatar, getUserAvatar, updateUserNickname, setUserOnlineStatus, generateUniqueRoomId, roomExists, createRoomWithName as createRoomWithNameFirebase, getRoomsList, getRoomInfo, deleteRoomById, isRoomCreator } from './modules/firebase.js';
import { FriendsManager } from './modules/friends.js';
import { AuthManager } from './modules/auth.js';
import { WebRTCManager } from './modules/webrtc.js';
import { ChatManager } from './modules/chat.js';
import { UIManager } from './modules/ui.js';
import { UsersManager } from './modules/users.js';
import { SpeechDetector } from './modules/speech.js';
import { DevicesManager } from './modules/devices.js';
import { ConnectionManager } from './modules/connection.js';
import { WhiteboardManager } from './modules/whiteboard.js';
import { RoomsManager } from './modules/rooms.js';
import { playNotificationSound } from './modules/sounds.js';
import { validateNicknameLength, validateNicknameFormat, escapeHtml } from './utils/security.js';
import { compressImage } from './utils/image-utils.js';
import { logger } from './modules/logger.js';
import { devConsole } from './modules/console.js';
import { RoomsCache } from './utils/rooms-cache.js';
import { FirebaseListenersManager } from './utils/firebase-listeners.js';
// import { FriendsHandlers } from './app/friends-handlers.js'; // Временно отключено из-за проблем

document.addEventListener("DOMContentLoaded", async () => {
  // Версия приложения для отладки
  const APP_VERSION = '1.0.17';
  
  // 🚨 КРИТИЧНО: Отключаем избыточное логирование для производительности
  const DEBUG_MODE = false; // Установите true для отладки
  
  // Переопределяем console.log для отключения в production
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  
  if (!DEBUG_MODE) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    // console.error оставляем для критических ошибок
  }
  
  // Показываем только версию
  originalLog('%c🚀 VibeChat ' + APP_VERSION, 'color: #5865F2; font-size: 16px; font-weight: bold;');
  originalLog('%c✅ Логирование отключено для производительности', 'color: #43B581; font-size: 12px;');
  
  // Инициализация логирования (неблокирующая)
  logger.info('=== VibeChat запущен ===').catch(() => {});
  logger.info('Версия: ' + APP_VERSION, { timestamp: new Date().toISOString() }).catch(() => {});
  
  const splashScreen = document.getElementById('splashScreen');
  const appContent = document.getElementById('appContent');
  const authWindow = document.getElementById('authWindow');

  // Убеждаемся что окно авторизации скрыто при старте
  if (authWindow) {
    authWindow.style.display = 'none';
    }
    if (appContent) {
    appContent.style.display = 'none';
  }

  // Инициализация UI менеджера (нужен для показа ошибок)
  const ui = new UIManager();

  // Инициализация Firebase
  let db, auth;
  let authManager = null;
  
  try {
    const firebaseInit = initFirebase();
    db = firebaseInit.database;
    auth = firebaseInit.auth;
    authManager = new AuthManager(auth);
    logger.info('Firebase инициализирован успешно').catch(() => {});
  } catch (error) {
    console.error('Ошибка инициализации Firebase:', error);
    logger.error('Ошибка инициализации Firebase', { error: error.message }).catch(() => {});
    // При ошибке просто показываем окно авторизации после splash screen
    setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add('fade-out');
      setTimeout(() => {
        if (splashScreen && splashScreen.parentNode) {
          splashScreen.remove();
        }
          if (authWindow) {
            authWindow.style.display = 'flex';
        }
      }, 1200);
    }
    }, 2000);
    // Показываем ошибку через toast уведомление
    setTimeout(() => {
      ui.showToast('Ошибка: Конфигурация Firebase не найдена! Пожалуйста, создайте файл config/firebase.config.js', 8000, 'error');
    }, 2500);
    return;
  }

  // Состояние приложения
  let roomRef = null;
  let myUserRef = null;
  let myId = null;
  let myNick = CONSTANTS.DEFAULT_NICKNAME;
  let muted = false;
  let joined = false;
  let joinLock = false;
  let previousUsersCount = 0;
  let intentionalLeave = false; // Флаг намеренного выхода
  let currentRoomId = null; // ID текущей комнаты
  let updateRoomsListTimeout = null; // Таймер для отложенного обновления списка комнат
  let isInitialLoad = false; // Флаг начальной загрузки (предотвращает конфликты со слушателем)
  let roomsListInitialized = false; // Флаг того, что список комнат уже был загружен при инициализации
  let roomsListener = null; // Слушатель изменений списка комнат
  let isReconnecting = false; // Флаг процесса переподключения
  let reconnectAttempts = 0; // Счетчик попыток переподключения
  const MAX_RECONNECT_ATTEMPTS = 3; // Максимальное количество попыток
  let usersUpdateTimeout = null; // Таймер для debounce обновления пользователей
  let roomsUpdateTimeout = null; // Таймер для debounce обновления списка комнат
  let heartbeatInterval = null; // Интервал для heartbeat (поддержание соединения)
  let presenceCheckInterval = null; // Интервал для проверки присутствия в комнате
  
  // 🚀 ОПТИМИЗАЦИЯ: Кэш и менеджер слушателей
  const roomsCache = new RoomsCache();
  const listenersManager = new FirebaseListenersManager();

  // Инициализация менеджеров
  const devices = new DevicesManager();
  const webrtc = new WebRTCManager(null, null, null);
  let chat = null; // Будет инициализирован после получения userId
  const usersManager = new UsersManager(webrtc.audios, webrtc.userVolumes);
  let connectionManager = null; // Будет инициализирован позже
  let friendsManager = null; // Будет инициализирован после авторизации
  let roomsManager = null; // Менеджер комнат (будет инициализирован после авторизации)
  // let friendsHandlers = null; // Обработчики друзей - временно отключено
  let roomHandlers = null; // Обработчики комнат (будет создан позже)
  let whiteboard = null; // Вайтборд для совместного рисования

  // Инициализация UI
  // Никнейм теперь загружается из Firebase в функции initApp()
  ui.initEmojiPicker();
  ui.initBackgroundSettings();
  ui.initAppearanceSettings();
  ui.initAuthHandlers();
  devices.initElements();
  devices.setupCloseHandlers();

  // Функция показа окна авторизации
  function showAuth() {
    console.log('showAuth() вызвана - показываем окно авторизации');
    logger.info('Показано окно авторизации').catch(() => {});
    
    // Изменяем размер окна под форму авторизации
    // Размер контейнера: 420px ширина + padding по 40px с каждой стороны = 500px
    // Высота: заголовок + табы + форма регистрации (самая высокая с 4 полями) = примерно 750px
    if (window.electronAPI && window.electronAPI.setWindowSize) {
      window.electronAPI.setWindowSize(500, 750, true);
    }
    
    // Используем метод UI для показа окна авторизации
    ui.showAuthWindow();
  }
  
  // Функция инициализации приложения после авторизации
  async function initApp() {
    console.log('initApp() вызвана - показываем основное приложение');
    
    // Восстанавливаем размер окна для основного приложения
    // Размеры: 1200x720 (обычный), минимум: 1000x600
    if (window.electronAPI && window.electronAPI.restoreWindowSize) {
      window.electronAPI.restoreWindowSize(1200, 720, 1000, 600, true);
    }
    
    // Скрываем окно авторизации
    if (authWindow) {
      authWindow.style.display = 'none';
      authWindow.classList.remove('show');
    }
    
    // Показываем основное приложение
    if (appContent) {
      appContent.style.display = 'flex'; // Используем flex как в CSS
      appContent.style.opacity = '1';
      appContent.style.visibility = 'visible';
      appContent.classList.add('show');
      // Убеждаемся что контент виден и выше фона
      appContent.style.position = 'relative';
      appContent.style.zIndex = '10';
    }
    
    // Обновляем информацию о пользователе и загружаем никнейм
    if (authManager) {
      const currentUser = authManager.getCurrentUser();
      console.log('Текущий пользователь в initApp:', currentUser);
      if (currentUser && currentUser.email) {
        console.log('Обновляем информацию о пользователе:', currentUser.email);
        
        // Загружаем никнейм из Firebase, если есть
        try {
          const savedNickname = await getUserNickname(db, currentUser.uid);
          if (savedNickname) {
            ui.setNicknameDisplay(savedNickname);
            ui.saveNickname(savedNickname);
            myNick = savedNickname;
            console.log('Никнейм загружен из Firebase:', savedNickname);
            
            // Синхронизируем с RoomsManager
            if (roomsManager) {
              roomsManager.setNickname(savedNickname);
            }
          } else {
            // Если никнейма нет в Firebase, показываем сообщение
            ui.setNicknameDisplay('Не установлен');
            myNick = CONSTANTS.DEFAULT_NICKNAME;
            console.warn('Никнейм не найден в Firebase');
          }
          
          // Загружаем аватар пользователя
          try {
            const avatarUrl = await getUserAvatar(db, currentUser.uid);
            ui.setUserAvatar(avatarUrl, savedNickname || 'Не установлен');
          } catch (avatarError) {
            console.warn('Не удалось загрузить аватар:', avatarError);
            ui.setUserAvatar(null, savedNickname || 'Не установлен');
          }
          
          // Обновляем email в профиле пользователя, если его там нет (для существующих пользователей)
          // Это необходимо для входа по никнейму
          try {
            const userEmailSnapshot = await db.ref(`users/${currentUser.uid}/email`).once('value');
            if (!userEmailSnapshot.exists() && currentUser.email) {
              await db.ref(`users/${currentUser.uid}/email`).set(currentUser.email);
              console.log('Email обновлен в профиле пользователя:', currentUser.email);
            }
          } catch (emailError) {
            console.warn('Не удалось обновить email в профиле:', emailError);
          }
        } catch (error) {
          console.warn('Не удалось загрузить данные профиля:', error);
          ui.setNicknameDisplay('Ошибка загрузки');
          ui.setUserAvatar(null, 'Не установлен');
          myNick = CONSTANTS.DEFAULT_NICKNAME;
        }
        
        logger.info('Пользователь вошел в приложение', { email: currentUser.email }).catch(() => {});
        
        // Инициализируем чат с userId и db
        if (!chat) {
          chat = new ChatManager(null, myNick, currentUser.uid, db);
  chat.initElements(
    ui.elements.chatMessages,
    ui.elements.chatInput,
    ui.elements.fileInput
  );
  chat.showEmptyState();
        } else {
          // Обновляем userId и db в существующем чате
          chat.myUserId = currentUser.uid;
          chat.db = db;
        }
        
        // Устанавливаем обработчик кнопки выхода после авторизации
        // Функция будет определена позже, но вызовем ее через setTimeout для надежности
        setTimeout(() => {
          if (typeof setupLogoutHandler === 'function') {
            setupLogoutHandler();
          }
        }, 100);
        
        // Инициализируем менеджер друзей
        if (!friendsManager) {
          console.log('🔔 Инициализация FriendsManager...');
          console.log('🔔 Передаем ui в FriendsManager:', ui);
          console.log('🔔 ui.showToast доступен:', typeof ui.showToast);
          
          // Создаем callback для входа в комнату
          const joinRoomCallback = async (roomId) => {
            if (typeof findAndJoinRoom === 'function') {
              await findAndJoinRoom(roomId);
            } else {
              console.error('Функция findAndJoinRoom не найдена');
            }
          };
          
          try {
          friendsManager = new FriendsManager(db, authManager, () => {
            playNotificationSound('join');
            }, ui, joinRoomCallback); // Передаем callback для входа в комнату
          
          console.log('🔔 FriendsManager создан, uiManager:', friendsManager.uiManager);
          
          // Получаем элементы с fallback на прямые вызовы
          const friendsListEl = ui.elements.friendsList || document.getElementById('friendsList');
          const notificationsListEl = ui.elements.notificationsList || document.getElementById('notificationsList');
          const notificationsBadgeEl = ui.elements.notificationsBadge || document.getElementById('notificationsBadge');
          
          console.log('🔔 Элементы друзей:', {
            friendsList: !!friendsListEl,
            notificationsList: !!notificationsListEl,
            notificationsBadge: !!notificationsBadgeEl
          });
          
          if (!friendsListEl || !notificationsListEl) {
            console.warn('⚠️ Элементы друзей не найдены, пробуем через ui.initElements()...');
            ui.initElements();
            const retryFriendsList = ui.elements.friendsList || document.getElementById('friendsList');
            const retryNotificationsList = ui.elements.notificationsList || document.getElementById('notificationsList');
            const retryNotificationsBadge = ui.elements.notificationsBadge || document.getElementById('notificationsBadge');
            
            friendsManager.initElements(
              retryFriendsList,
              retryNotificationsList,
              retryNotificationsBadge
            );
          } else {
            friendsManager.initElements(
              friendsListEl,
              notificationsListEl,
              notificationsBadgeEl
            );
          }
          
          // Связываем friendsManager с usersManager для проверки статуса друзей
          usersManager.setFriendsManager(friendsManager);
          
          // Начинаем отслеживание уведомлений и друзей в реальном времени
            // Слушатель автоматически загрузит данные при первом срабатывании
          console.log('🔔 Запускаем слушатель уведомлений...');
          friendsManager.startListeningToRequests();
          friendsManager.startListeningToFriends();
            
            // Загружаем друзей и уведомления после установки слушателей
            // Это гарантирует, что слушатель не добавит дубликаты
            setTimeout(() => {
              friendsManager.loadFriends();
              friendsManager.loadNotifications();
            }, 100);
            
            // Запускаем слушатели приглашений и сообщений
            try {
              friendsManager.startListeningToInvitations();
              friendsManager.startListeningToMessages();
            } catch (error) {
              console.warn('⚠️ Ошибка при запуске слушателей приглашений/сообщений:', error);
            }
            
          console.log('✅ FriendsManager полностью инициализирован');
          
          // Устанавливаем обработчик для кнопки добавления друга после инициализации friendsManager
          setTimeout(() => {
            // Обновляем элементы UI перед поиском кнопки
            ui.initElements();
            
            const addFriendBtn = ui.elements.addFriendSubmitBtn || document.getElementById('addFriendSubmitBtn');
            console.log('🔍 Поиск кнопки добавления друга:', {
              fromCache: !!ui.elements.addFriendSubmitBtn,
              fromDOM: !!document.getElementById('addFriendSubmitBtn'),
              found: !!addFriendBtn
            });
            
            if (addFriendBtn) {
              // Удаляем старый обработчик, если есть
              const newBtn = addFriendBtn.cloneNode(true);
              addFriendBtn.parentNode.replaceChild(newBtn, addFriendBtn);
              const btn = newBtn;
              
              // Обновляем ссылку в ui.elements
              ui.elements.addFriendSubmitBtn = btn;
              
              btn.addEventListener('click', async function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('🔵 Кнопка добавления друга нажата!');
                
                const currentInput = ui.elements.friendNicknameInput || document.getElementById('friendNicknameInput');
                const currentModal = ui.elements.addFriendModal || document.getElementById('addFriendModal');
                const currentError = ui.elements.addFriendError || document.getElementById('addFriendError');
                
                console.log('🔍 Элементы формы:', {
                  input: !!currentInput,
                  modal: !!currentModal,
                  error: !!currentError
                });
                
                if (!currentInput || !currentModal) {
                  console.error('❌ Элементы не найдены');
                  ui.showToast('Ошибка: элементы формы не найдены');
                  return;
                }
                
                const nickname = currentInput?.value?.trim() || '';
                console.log('🔍 Никнейм:', nickname);
                
                if (currentError) {
                  currentError.textContent = '';
                  currentError.style.display = 'none';
                }
                
                if (!nickname) {
                  if (currentError) {
                    currentError.textContent = 'Введите никнейм';
                    currentError.style.display = 'block';
                  }
                  return;
                }
                
                if (!friendsManager) {
                  console.error('❌ friendsManager не инициализирован');
                  ui.showToast('Ошибка. Перезагрузите приложение.');
                  return;
                }
                
                const btnEl = this;
                const originalText = btnEl.textContent;
                btnEl.disabled = true;
                btnEl.textContent = 'Отправка...';
                
                try {
                  console.log('🚀 Отправка запроса в друзья для:', nickname);
                  const result = await friendsManager.sendFriendRequestByNickname(nickname);
                  console.log('📥 Результат отправки запроса:', result);
                  
                  const message = result.success 
                    ? 'Заявка отправлена'
                    : (result.error === 'Запрос уже отправлен' 
                      ? 'Заявка уже отправлена'
                      : (result.error || 'Запрос отправлен'));
                  
                  ui.showToast(message);
                  currentModal.classList.remove('show');
                  
                  if (currentInput) currentInput.value = '';
                  if (currentError) {
                    currentError.textContent = '';
                    currentError.style.display = 'none';
                  }
                } catch (error) {
                  console.error('❌ ОШИБКА при отправке запроса:', error);
                  console.error('Стек ошибки:', error.stack);
                  ui.showToast('Ошибка при отправке запроса: ' + (error.message || 'Неизвестная ошибка'));
                  if (currentError) {
                    currentError.textContent = error.message || 'Ошибка при отправке запроса';
                    currentError.style.display = 'block';
                  }
                } finally {
                  btnEl.disabled = false;
                  btnEl.textContent = originalText;
                }
              }, true);
              
              console.log('✅ Обработчик добавления друга установлен');
            } else {
              console.error('❌ Кнопка добавления друга не найдена!');
            }
          }, 200);
          } catch (error) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА при инициализации FriendsManager:', error);
            console.error('Стек ошибки:', error.stack);
            // Продолжаем работу даже при ошибке
          }
        }
        
        // Инициализируем менеджер комнат
        if (!roomsManager) {
          console.log('🏠 Инициализация RoomsManager...');
          roomsManager = new RoomsManager({
            db,
            authManager,
            ui,
            webrtc,
            chat,
            devices,
            usersManager,
            speechDetector,
            connectionManager,
            logger,
            playNotificationSound,
            CONSTANTS,
            roomsCache,
            listenersManager
          });
          
          // Устанавливаем callbacks для синхронизации состояния
          roomsManager.callbacks.onJoined = (data) => {
            console.log('🏠 RoomsManager.onJoined callback:', data);
            
            // Обновляем локальное состояние
            roomRef = data.roomRef;
            myUserRef = data.myUserRef;
            myId = data.myId;
            joined = true;
            currentRoomId = data.roomId;
            
            // Обновляем другие модули
            webrtc.roomRef = roomRef;
            webrtc.myId = myId;
            if (chat) {
              chat.roomRef = roomRef;
            }
            speechDetector.setMyId(myId);
            
            // Инициализация микрофона
            const deviceId = devices.getSelectedMicId();
            webrtc.initMicrophone(deviceId, muted).then(() => {
              updateSpeechDetector();
            }).catch(err => {
              console.error('Ошибка инициализации микрофона:', err);
            });
            
            // Применяем сохраненные динамики
            const savedSpeakerId = devices.getSelectedSpeakerId();
            if (savedSpeakerId) {
              webrtc.applySpeakerSelection(savedSpeakerId);
            }
            
            // Очищаем чат
            if (chat) {
              chat.clear();
            }
            clearRoomMessages(roomRef);
            
            // Переинициализируем мониторинг подключения
            if (connectionManager) {
              connectionManager.cleanup();
              connectionManager.init();
            }
            
            // Запускаем слушатели, heartbeat и проверку присутствия
            setupListeners();
            startHeartbeat();
            startPresenceCheck();
            
            // Запускаем детектор речи
            if (speechDetector && typeof speechDetector.startDetection === 'function') {
              speechDetector.startDetection();
              console.log('✅ Детектор речи запущен после входа в комнату');
            }
          };
          
          roomsManager.callbacks.onLeft = () => {
            console.log('🏠 RoomsManager.onLeft callback');
            
            // Очищаем состояние
            roomRef = null;
            myUserRef = null;
            myId = null;
            joined = false;
            currentRoomId = null;
            
            // Очищаем модули
            webrtc.cleanup();
            webrtc.roomRef = null;
            webrtc.myId = null;
            if (chat) {
              chat.clear();
              chat.roomRef = null;
            }
            usersManager.clear();
            stopHeartbeat();
            stopPresenceCheck();
            if (speechDetector && typeof speechDetector.stopDetection === 'function') {
              speechDetector.stopDetection();
            }
          };
          
          // Устанавливаем начальные значения
          roomsManager.setNickname(myNick);
          roomsManager.setMuted(muted);
          
          console.log('✅ RoomsManager инициализирован');
        }
        
      // Устанавливаем онлайн статус
      await setUserOnlineStatus(db, currentUser.uid, true);
      } else {
        console.warn('Пользователь не найден при инициализации приложения');
      }
    }
    
    // 🔧 FIX: Убираем автоматическое переключение вкладок при инициализации
    // Вкладка "Комнаты" уже активна по умолчанию в HTML
    // Загружаем список комнат БЕЗ переключения вкладок
    // 🚀 ОПТИМИЗАЦИЯ: Увеличена задержка до 800ms для полной инициализации Firebase listeners
    setTimeout(async () => {
      try {
        const currentUser = authManager?.getCurrentUser();
        if (!currentUser) {
          console.warn('⚠️ Пользователь не авторизован в initApp, список комнат не загружен');
          return;
        }
        
        console.log('🔵 Инициализация загрузки списка комнат для пользователя:', currentUser.uid);
        
        // Загружаем комнаты через RoomsManager
        if (roomsManager) {
          console.log('✅ RoomsManager готов, загружаем комнаты из initApp...');
          try {
            // Устанавливаем флаги через RoomsManager
            roomsManager._updateState({ isInitialLoad: true });
            isInitialLoad = true; // Синхронизируем с локальной переменной
            
            await roomsManager.loadList(true);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            roomsListInitialized = true;
            roomsManager._updateState({ roomsListInitialized: true });
            
            roomsManager.startListener();
            
            setTimeout(() => {
              isInitialLoad = false;
              roomsManager._updateState({ isInitialLoad: false });
            }, 1000);
            
            console.log('✅ Комнаты загружены из initApp через RoomsManager');
          } catch (error) {
            console.error('❌ Ошибка загрузки комнат из initApp:', error.message || error);
            if (error.stack) console.error(error.stack);
          }
        } else {
          console.warn('⚠️ RoomsManager не инициализирован');
        }
        
        console.log('=== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ЗАВЕРШЕНА ===');
      } catch (error) {
        console.error('❌ Ошибка при загрузке списка комнат в initApp:', error);
        console.error('Детали ошибки:', error.message, error.code, error.stack);
      }
    }, 800); // 🚀 ОПТИМИЗАЦИЯ: Увеличена задержка до 800ms для полной инициализации Firebase
  }

  // Обработчики форм авторизации (только если authManager инициализирован)
  if (authManager) {
    if (ui.elements.loginForm) {
      ui.elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        ui.clearAuthErrors();
        
        const login = ui.elements.loginEmail.value.trim(); // Может быть email или никнейм
        const password = ui.elements.loginPassword.value;
        
        if (!login || !password) {
          ui.showLoginError('Заполните все поля');
          return;
        }
        
        ui.setLoginLoading(true);
        
        // Создаем функцию для получения email по никнейму
        const getEmailByNicknameFn = login.includes('@') 
          ? null 
          : async (nickname) => {
              try {
                return await getEmailByNickname(db, auth, nickname);
              } catch (error) {
                console.error('Ошибка при получении email по никнейму:', error);
                return null;
              }
            };
        
        const result = await authManager.signIn(login, password, getEmailByNicknameFn);
        ui.setLoginLoading(false);
        
        if (result.success) {
          // Определяем, что было введено - email или никнейм
          const loginType = login.includes('@') ? 'email' : 'nickname';
          logger.info('Пользователь успешно вошел', { login, loginType }).catch(() => {});
          initApp();
        } else {
          logger.warn('Ошибка входа', { login, error: result.error }).catch(() => {});
          ui.showLoginError(result.error);
        }
      });
    }

    if (ui.elements.registerForm) {
      ui.elements.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        ui.clearAuthErrors();
        
        const email = ui.elements.registerEmail.value.trim();
        const nickname = ui.elements.registerNickname.value.trim();
        const password = ui.elements.registerPassword.value;
        const passwordConfirm = ui.elements.registerPasswordConfirm.value;
        
        if (!email || !nickname || !password || !passwordConfirm) {
          ui.showRegisterError('Заполните все поля');
          return;
        }
        
        // Валидация никнейма
        if (!validateNicknameLength(nickname, CONSTANTS.MAX_NICKNAME_LENGTH)) {
          ui.showRegisterError(`Никнейм должен быть от 1 до ${CONSTANTS.MAX_NICKNAME_LENGTH} символов`);
          return;
        }
        
        if (!validateNicknameFormat(nickname)) {
          ui.showRegisterError('Никнейм может содержать только буквы, цифры, дефис и подчеркивание');
          return;
        }
        
        if (password !== passwordConfirm) {
          ui.showRegisterError('Пароли не совпадают');
          return;
        }
        
        if (password.length < 6) {
          ui.showRegisterError('Пароль должен содержать минимум 6 символов');
          return;
        }
        
        ui.setRegisterLoading(true);
        
        // Проверяем, занят ли никнейм
        const nicknameTaken = await isNicknameTaken(db, nickname);
        if (nicknameTaken) {
          ui.setRegisterLoading(false);
          ui.showRegisterError('Этот никнейм уже занят. Выберите другой');
          return;
        }
        
        // Регистрируем пользователя
        const result = await authManager.signUp(email, password);
        
        if (result.success && result.user) {
          // Сохраняем никнейм в Firebase
          try {
            await reserveNickname(db, nickname, result.user.uid, email);
            logger.info('Пользователь успешно зарегистрирован', { email, nickname }).catch(() => {});
            
            // Сохраняем никнейм в localStorage
            ui.saveNickname(nickname);
            
            initApp();
          } catch (nicknameError) {
            console.error('Ошибка при сохранении никнейма:', nicknameError);
            // Если не удалось сохранить никнейм, все равно входим в приложение
            logger.warn('Не удалось сохранить никнейм', { error: nicknameError.message }).catch(() => {});
            initApp();
          }
        } else {
          ui.showRegisterError(result.error);
        }
        
        ui.setRegisterLoading(false);
      });
    }
  }

  // 🎨 Улучшенная функция скрытия splash screen с плавным переходом
  let splashProcessed = false;
  async function hideSplashAndShow(isAuthorized) {
    // Защита от повторных вызовов
    if (splashProcessed) return;
    splashProcessed = true;

    if (isAuthorized) {
      // Пользователь авторизован - загружаем данные перед показом приложения
      try {
        updateSplashProgress(70, 'Загрузка комнат...');
        
        // 🔧 FIX: Запускаем глобальный слушатель комнат ДО загрузки списка
        if (roomsManager && !roomsListener) {
          roomsManager.startListener();
          console.log('✅ Глобальный слушатель комнат запущен на splash screen');
        }
        
        // Загружаем комнаты
        if (roomsManager) {
          await roomsManager.loadList(true).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        
        updateSplashProgress(85, 'Загрузка друзей...');
        
        // Загружаем друзей если friendsManager инициализирован
        if (friendsManager) {
          await Promise.all([
            friendsManager.loadFriends().catch(() => {}),
            friendsManager.loadNotifications().catch(() => {})
          ]);
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        
        updateSplashProgress(100, 'Готово!');
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 🔧 FIX: Инициализируем приложение ДО скрытия splash screen
        console.log('🚀 Инициализация приложения на splash screen...');
        initApp();
        console.log('✅ Приложение полностью инициализировано');
        
      } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
      }
    }

    // Скрываем splash screen с анимацией
    if (splashScreen && !splashScreen.classList.contains('fade-out')) {
      splashScreen.classList.add('fade-out');
      
      // Начинаем показывать целевое окно с небольшой задержкой (для перекрытия анимаций)
      setTimeout(() => {
        if (isAuthorized) {
          // Пользователь авторизован - показываем основное приложение
          if (appContent) {
            appContent.style.opacity = '0';
            appContent.style.display = 'flex';
            // Плавное появление
            setTimeout(() => {
              appContent.style.transition = 'opacity 0.8s ease-in';
              appContent.style.opacity = '1';
            }, 50);
          }
          // initApp() уже вызван выше
        } else {
          // Пользователь не авторизован - показываем окно авторизации
          if (authWindow) {
            authWindow.style.opacity = '0';
            authWindow.style.display = 'flex';
            // Плавное появление
            setTimeout(() => {
              authWindow.style.transition = 'opacity 0.8s ease-in';
              authWindow.style.opacity = '1';
            }, 50);
          }
          showAuth();
        }
      }, 800); // Начинаем показывать новое окно за 400ms до полного исчезновения splash
      
      // Удаляем splash screen после завершения анимации
      setTimeout(() => {
        if (splashScreen && splashScreen.parentNode) {
          splashScreen.remove();
        }
      }, 1500);
    } else {
      // Если splash screen уже скрыт или удален, сразу показываем нужное окно
      if (isAuthorized) {
        initApp();
      } else {
        showAuth();
      }
    }
  }

  // 🎨 Управление индикатором загрузки
  const splashProgress = document.getElementById('splashProgress');
  const splashLoadingText = document.getElementById('splashLoadingText');
  
  function updateSplashProgress(percent, text) {
    if (splashProgress) {
      splashProgress.style.width = percent + '%';
    }
    if (splashLoadingText && text) {
      splashLoadingText.textContent = text;
    }
  }
  
  // Реальная загрузка с привязкой к операциям
  updateSplashProgress(0, 'Инициализация...');
  
  // Проверка авторизации при загрузке
  if (authManager) {
    let authStateResolved = false;
    
    // ВРЕМЕННО: Принудительно выходим из аккаунта для тестирования
    // Раскомментируйте следующую строку, если нужно всегда показывать окно авторизации
    // authManager.signOut().then(() => console.log('Принудительный выход из аккаунта'));
    
    // Подписываемся на изменения состояния авторизации
    // onAuthStateChanged срабатывает сразу при подписке с текущим состоянием пользователя
    authManager.onAuthStateChanged(async (user) => {
      // Игнорируем повторные вызовы (только первый вызов)
      if (authStateResolved) {
        console.log('onAuthStateChanged вызван повторно, игнорируем');
        return;
      }
      authStateResolved = true;
      
      // 20% - Подключение к Firebase завершено
      updateSplashProgress(20, 'Подключение к Firebase...');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Проверяем, авторизован ли пользователь
      const isAuthorized = user !== null && user !== undefined;
      
      console.log('=== ПРОВЕРКА АВТОРИЗАЦИИ ===');
      console.log('user:', user);
      console.log('isAuthorized:', isAuthorized);
      
      // 40% - Загрузка модулей
      updateSplashProgress(40, 'Загрузка модулей...');
      
      // Логируем в файл (неблокирующее)
      logger.info('Проверка авторизации', {
        isAuthorized,
        email: user ? user.email : null,
        uid: user ? user.uid : null
      }).catch(() => {});
      
      if (user) {
        console.log('email:', user.email);
        console.log('uid:', user.uid);
      } else {
        console.log('Пользователь НЕ авторизован (user === null)');
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 60% - Проверка авторизации завершена
      updateSplashProgress(60, 'Проверка авторизации...');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Показываем окно
      if (isAuthorized) {
        console.log('>>> Показываем ОСНОВНОЕ ПРИЛОЖЕНИЕ (пользователь авторизован)');
        logger.info('Показываем основное приложение', { email: user.email }).catch(() => {});
        await hideSplashAndShow(true);
      } else {
        console.log('>>> Показываем ОКНО АВТОРИЗАЦИИ (пользователь НЕ авторизован)');
        logger.info('Показываем окно авторизации').catch(() => {});
        updateSplashProgress(100, 'Готово!');
        await new Promise(resolve => setTimeout(resolve, 200));
        await hideSplashAndShow(false);
      }
    });
  } else {
    // Если authManager не инициализирован, показываем окно авторизации с прогрессом
    console.log('authManager не инициализирован, показываем окно авторизации');
    
    // Симулируем этапы загрузки
    setTimeout(() => updateSplashProgress(20, 'Подключение к Firebase...'), 100);
    setTimeout(() => updateSplashProgress(40, 'Загрузка модулей...'), 200);
    setTimeout(() => updateSplashProgress(60, 'Проверка авторизации...'), 300);
    setTimeout(() => updateSplashProgress(100, 'Готово!'), 400);
    
    setTimeout(() => {
      hideSplashAndShow(false);
    }, 800);
  }

  // Инициализация элементов чата будет выполнена после авторизации в initApp()
  // Убрана отсюда, так как chat может быть null до авторизации

  // Инициализация менеджера участников
  usersManager.initElement(ui.elements.usersEl);

  // Инициализация детектора речи
  const speechDetector = new SpeechDetector(
    webrtc.audioAnalysers,
    webrtc.speakingStates,
    webrtc.localAudioAnalyser,
    webrtc.localStream,
    myId,
    muted
  );

  speechDetector.setOnSpeakingChange((userId, isSpeaking) => {
    if (isSpeaking) {
      usersManager.markSpeaking(userId);
    } else {
      usersManager.markNotSpeaking(userId);
    }
  });

  // Обновление детектора речи при изменении состояния
  const updateSpeechDetector = () => {
    speechDetector.setMuted(muted);
    speechDetector.updateLocalAnalyser(webrtc.localAudioAnalyser, webrtc.localStream);
  };

  // Обработчики событий UI

  // Никнейм больше не редактируется пользователем, он загружается из Firebase
  // Убраны обработчики событий для поля ввода никнейма

  // Инициализация настроек профиля
  let currentAvatarUrl = null;
  let currentAvatarFile = null;
  let originalAvatarUrl = null; // Сохраняем оригинальный аватар для отмены изменений

  // Функция конвертации файла в base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Сжимает изображение до указанного размера в KB
   * @param {File} file - Файл изображения
   * @param {number} maxSizeKB - Максимальный размер в килобайтах (по умолчанию 150KB)
   * @param {number} maxWidth - Максимальная ширина (по умолчанию 512px)
   * @param {number} maxHeight - Максимальная высота (по умолчанию 512px)
   * @returns {Promise<string>} Base64 строка сжатого изображения
   */
  async function compressImage(file, maxSizeKB = 150, maxWidth = 512, maxHeight = 512) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      
      img.onload = () => {
        try {
          // Вычисляем новые размеры с сохранением пропорций
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
          }
          
          // Создаем canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          // Рисуем изображение на canvas
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Функция для конвертации canvas в base64 с заданным качеством
          const canvasToBase64 = (quality) => {
            // Используем JPEG для лучшего сжатия (даже если исходник PNG)
            return canvas.toDataURL('image/jpeg', quality);
          };
          
          // Функция для вычисления размера base64 в KB
          const getBase64SizeKB = (base64Str) => {
            return (base64Str.length * 3 / 4 - (base64Str.match(/=/g) || []).length) / 1024;
          };
          
          // Пытаемся сжать до нужного размера, начиная с качества 0.8
          let quality = 0.8;
          let base64 = canvasToBase64(quality);
          let sizeKB = getBase64SizeKB(base64);
          
          // Если размер уже меньше целевого, возвращаем результат
          if (sizeKB <= maxSizeKB) {
            URL.revokeObjectURL(objectUrl);
            resolve(base64);
            return;
          }
          
          // Уменьшаем качество пока не достигнем нужного размера
          const step = 0.1;
          const minQuality = 0.3;
          
          while (quality > minQuality && sizeKB > maxSizeKB) {
            quality -= step;
            base64 = canvasToBase64(quality);
            sizeKB = getBase64SizeKB(base64);
          }
          
          // Если все еще слишком большой, уменьшаем размеры изображения
          if (sizeKB > maxSizeKB) {
            const reductionFactor = Math.sqrt(maxSizeKB / sizeKB);
            width = Math.floor(width * reductionFactor);
            height = Math.floor(height * reductionFactor);
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            quality = 0.7;
            base64 = canvasToBase64(quality);
            sizeKB = getBase64SizeKB(base64);
          }
          
          console.log(`Изображение сжато: ${(file.size / 1024).toFixed(2)}KB -> ${sizeKB.toFixed(2)}KB`);
          URL.revokeObjectURL(objectUrl);
          resolve(base64);
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Ошибка загрузки изображения'));
      };
      
      img.src = objectUrl;
    });
  }

  // Открытие модального окна настроек профиля
  if (ui.elements.userProfileSettingsBtn && authManager) {
    ui.elements.userProfileSettingsBtn.addEventListener('click', async () => {
      try {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) {
          ui.showToast('Пользователь не авторизован', 3000, 'error');
          return;
        }
        
        // Загружаем текущие данные профиля
        try {
          const nickname = await getUserNickname(db, currentUser.uid);
          if (ui.elements.profileNicknameInput) {
            ui.elements.profileNicknameInput.value = nickname || '';
          }
          
          // Отображаем email в настройках профиля
          if (currentUser.email) {
            ui.setProfileEmail(currentUser.email);
          }
          
          // Загружаем текущий аватар
          const avatarUrl = await getUserAvatar(db, currentUser.uid);
          currentAvatarUrl = avatarUrl;
          originalAvatarUrl = avatarUrl; // Сохраняем оригинальный аватар
          currentAvatarFile = null; // Сбрасываем файл при открытии настроек
          ui.updateAvatarPreview(avatarUrl, nickname || 'Не установлен');
        } catch (error) {
          console.error('Ошибка при загрузке данных профиля:', error);
          logger.error('Ошибка загрузки профиля', { error: error.message }).catch(() => {});
          ui.showToast('Ошибка при загрузке данных профиля', 3000, 'error');
        }
        
        ui.showProfileSettings();
      } catch (error) {
        console.error('🔴 Критическая ошибка при открытии настроек профиля:', error);
        logger.error('Ошибка открытия настроек', { error: error.message }).catch(() => {});
        ui.showToast('Ошибка при открытии настроек', 3000, 'error');
      }
    });
  }

  // Закрытие модального окна (восстанавливаем оригинальные значения)
  const resetProfileSettings = () => {
    currentAvatarUrl = originalAvatarUrl;
    currentAvatarFile = null;
    ui.clearProfileError();
  };

  if (ui.elements.profileSettingsCloseBtn) {
    ui.elements.profileSettingsCloseBtn.addEventListener('click', () => {
      resetProfileSettings();
      ui.hideProfileSettings();
    });
  }

  if (ui.elements.profileSettingsCancelBtn) {
    ui.elements.profileSettingsCancelBtn.addEventListener('click', () => {
      resetProfileSettings();
      ui.hideProfileSettings();
    });
  }

  // Загрузка аватара
  if (ui.elements.profileAvatarUploadBtn && ui.elements.profileAvatarInput) {
    ui.elements.profileAvatarUploadBtn.addEventListener('click', () => {
      ui.elements.profileAvatarInput.click();
    });

    ui.elements.profileAvatarInput.addEventListener('change', async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        
        // Проверяем размер файла (максимум 7MB для аватара)
        if (file.size > 7 * 1024 * 1024) {
          ui.showProfileError('Размер файла должен быть не более 7MB');
          return;
        }

        // Проверяем тип файла
        if (!file.type.startsWith('image/')) {
          ui.showProfileError('Выберите изображение');
          return;
        }

        try {
          // Показываем индикатор загрузки
          ui.showToast('Сжатие изображения...');
          
          // Сжимаем изображение до ~150KB
          const compressedBase64 = await compressImage(file, 150, 512, 512);
          
          currentAvatarUrl = compressedBase64;
          currentAvatarFile = file; // Сохраняем оригинальный файл для информации
          
          // Обновляем превью
          const nickname = ui.elements.profileNicknameInput ? ui.elements.profileNicknameInput.value.trim() : '';
          ui.updateAvatarPreview(compressedBase64, nickname || 'Не установлен');
          ui.clearProfileError();
          
          // Показываем информацию о сжатии
          const originalSizeKB = (file.size / 1024).toFixed(2);
          const compressedSizeKB = ((compressedBase64.length * 3 / 4 - (compressedBase64.match(/=/g) || []).length) / 1024).toFixed(2);
          console.log(`Аватар сжат: ${originalSizeKB}KB -> ${compressedSizeKB}KB`);
        } catch (error) {
          console.error('Ошибка при обработке файла:', error);
          logger.error('Ошибка обработки аватара', { error: error.message }).catch(() => {});
          ui.showProfileError('Ошибка при обработке изображения');
        }
      } catch (error) {
        console.error('🔴 Критическая ошибка при загрузке аватара:', error);
        logger.error('Критическая ошибка аватара', { error: error.message }).catch(() => {});
        ui.showProfileError('Ошибка при загрузке файла');
      }
    });
  }

  // Удаление аватара
  if (ui.elements.profileAvatarRemoveBtn) {
    ui.elements.profileAvatarRemoveBtn.addEventListener('click', () => {
      currentAvatarUrl = null;
      currentAvatarFile = null;
      const nickname = ui.elements.profileNicknameInput ? ui.elements.profileNicknameInput.value.trim() : '';
      ui.updateAvatarPreview(null, nickname || 'Не установлен');
      if (ui.elements.profileAvatarInput) {
        ui.elements.profileAvatarInput.value = '';
      }
    });
  }

  // Сохранение настроек профиля
  if (ui.elements.profileSettingsSaveBtn && authManager) {
    ui.elements.profileSettingsSaveBtn.addEventListener('click', async () => {
      const currentUser = authManager.getCurrentUser();
      if (!currentUser) {
        ui.showProfileError('Пользователь не авторизован');
        return;
      }

      ui.clearProfileError();

      const newNickname = ui.elements.profileNicknameInput ? ui.elements.profileNicknameInput.value.trim() : '';
      // Получаем старый никнейм, если его нет в переменной
      let oldNickname = myNick;
      if (!oldNickname || oldNickname === CONSTANTS.DEFAULT_NICKNAME) {
        oldNickname = await getUserNickname(db, currentUser.uid) || null;
      }

      // Валидация никнейма
      if (!newNickname) {
        ui.showProfileError('Никнейм не может быть пустым');
        return;
      }

      if (!validateNicknameLength(newNickname, CONSTANTS.MAX_NICKNAME_LENGTH)) {
        ui.showProfileError(`Никнейм должен быть от 1 до ${CONSTANTS.MAX_NICKNAME_LENGTH} символов`);
        return;
      }

      if (!validateNicknameFormat(newNickname)) {
        ui.showProfileError('Никнейм может содержать только буквы, цифры, дефис и подчеркивание');
        return;
      }

      try {
        // Проверяем, изменился ли никнейм
        if (oldNickname && newNickname.toLowerCase() !== oldNickname.toLowerCase()) {
          // Проверяем, занят ли новый никнейм
          const nicknameTaken = await isNicknameTaken(db, newNickname);
          if (nicknameTaken) {
            ui.showProfileError('Этот никнейм уже занят. Выберите другой');
            return;
          }

          // Обновляем никнейм
          await updateUserNickname(db, currentUser.uid, oldNickname, newNickname);
          myNick = newNickname;
          ui.setNicknameDisplay(newNickname);
          ui.saveNickname(newNickname);
          logger.info('Никнейм обновлен', { oldNickname, newNickname }).catch(() => {});
          
          // Синхронизируем с RoomsManager
          if (roomsManager) {
            roomsManager.setNickname(newNickname);
          }
        } else if (!oldNickname) {
          // Если никнейма не было, просто резервируем новый
          const nicknameTaken = await isNicknameTaken(db, newNickname);
          if (nicknameTaken) {
            ui.showProfileError('Этот никнейм уже занят. Выберите другой');
            return;
          }
          
          await reserveNickname(db, newNickname, currentUser.uid, currentUser.email);
          myNick = newNickname;
          ui.setNicknameDisplay(newNickname);
          ui.saveNickname(newNickname);
          logger.info('Никнейм установлен', { newNickname }).catch(() => {});
          
          // Синхронизируем с RoomsManager
          if (roomsManager) {
            roomsManager.setNickname(newNickname);
          }
        }

        // Сохраняем аватар, если он изменился
        // Проверяем, был ли выбран новый файл
        if (currentAvatarFile !== null) {
          // Новый файл был выбран - сохраняем сжатое изображение
          await saveUserAvatar(db, currentUser.uid, currentAvatarUrl);
          originalAvatarUrl = currentAvatarUrl; // Обновляем оригинальное значение
          logger.info('Аватар обновлен').catch(() => {});
        } else {
          // Проверяем, был ли аватар удален (currentAvatarUrl === null после нажатия "Удалить")
          const existingAvatar = await getUserAvatar(db, currentUser.uid);
          if (currentAvatarUrl === null && existingAvatar !== null) {
            // Аватар был удален пользователем
            await saveUserAvatar(db, currentUser.uid, null);
            originalAvatarUrl = null; // Обновляем оригинальное значение
            logger.info('Аватар удален').catch(() => {});
          }
          // Если аватар не менялся, ничего не делаем
        }

        // Обновляем отображение аватара и никнейма в плашке пользователя
        ui.setUserAvatar(currentAvatarUrl, newNickname);
        ui.setNicknameDisplay(newNickname);

        // Обновляем никнейм в чате, если пользователь в комнате
        if (chat) {
          chat.myNickname = newNickname;
        }

        // Сбрасываем состояние после успешного сохранения
        currentAvatarFile = null;
        ui.hideProfileSettings();
        ui.showToast('Настройки профиля сохранены');
      } catch (error) {
        console.error('Ошибка при сохранении настроек профиля:', error);
        ui.showProfileError('Ошибка при сохранении настроек. Попробуйте еще раз.');
      }
    });
  }

  // Флаг для предотвращения рекурсивных вызовов при изменении микрофона
  let isUpdatingMicrophone = false;

  // Переключение микрофона
  const toggleMute = () => {
    muted = !muted;
    webrtc.toggleMute(muted);
    ui.updateMuteButton(muted);
    updateUserMuteStatus(myUserRef, muted);
    updateSpeechDetector();
    
    // Синхронизируем с RoomsManager
    if (roomsManager) {
      roomsManager.setMuted(muted);
    }
  };

  if (ui.elements.muteBtn) {
    ui.elements.muteBtn.addEventListener("click", toggleMute);
    
    // ПКМ для контекстного меню микрофона
    ui.elements.muteBtn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const currentVolume = webrtc.getMicrophoneVolume();
      // Получаем ID текущего устройства из webrtc или devices
      const currentDeviceId = webrtc.getCurrentMicDeviceId() || devices.getSelectedMicId();
      console.log('🎤 Открытие меню микрофона, currentDeviceId:', currentDeviceId);
      await devices.showMicContextMenu(
        e,
        (volume) => {
          // Callback для изменения громкости микрофона
          webrtc.setMicrophoneVolume(volume);
        },
        async (deviceId) => {
          // Callback для изменения устройства
          console.log('🔔 onDeviceChange вызван, deviceId:', deviceId, 'joined:', joined, 'isUpdatingMicrophone:', isUpdatingMicrophone);
          if (deviceId && !isUpdatingMicrophone) {
            try {
              isUpdatingMicrophone = true;
              console.log('✅ Условия выполнены, вызываем updateMicrophone');
              
              // Если в комнате - обновляем микрофон
              if (joined && webrtc.localStream) {
                await webrtc.updateMicrophone(deviceId);
                updateSpeechDetector();
              }
              
              // Обновляем выбранное устройство в селекторе
              if (devices.micSelect) {
                devices.micSelect.value = deviceId;
              }
              
              // Всегда сохраняем выбранный микрофон
              devices.saveSelectedMicId(deviceId);
              console.log('💾 Микрофон сохранен, будет применен при входе в комнату');
            } catch (error) {
              console.error('Ошибка при смене микрофона:', error);
              ui.showToast('Ошибка при смене микрофона');
            } finally {
              isUpdatingMicrophone = false;
            }
          } else {
            console.warn('❌ Условия НЕ выполнены:', { deviceId, isUpdatingMicrophone });
          }
        },
        currentVolume,
        currentDeviceId
      );
    });
  }

  // Переключение динамиков
  const toggleSpeaker = () => {
    const speakerMuted = webrtc.toggleSpeaker();
    ui.updateSpeakerButton(speakerMuted);
    // Обновляем статус динамиков в Firebase
    updateUserSpeakerStatus(myUserRef, speakerMuted);
  };

  if (ui.elements.speakerBtn) {
    ui.elements.speakerBtn.addEventListener("click", toggleSpeaker);
    
    // ПКМ для контекстного меню динамиков
    ui.elements.speakerBtn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const currentVolume = webrtc.getMasterVolume();
      // Получаем ID текущего устройства из webrtc или devices
      const currentDeviceId = webrtc.getCurrentSpeakerDeviceId() || devices.getSelectedSpeakerId();
      await devices.showSpeakerContextMenu(
        e,
        (volume) => {
          // Callback для изменения общей громкости
          webrtc.setMasterVolume(volume);
        },
        async (deviceId) => {
          // Callback для изменения устройства
          if (deviceId) {
            try {
              webrtc.applySpeakerSelection(deviceId);
              // Обновляем выбранное устройство в селекторе
              if (devices.speakerSelect) {
                devices.speakerSelect.value = deviceId;
              }
              // Сохраняем выбранные динамики
              devices.saveSelectedSpeakerId(deviceId);
            } catch (error) {
              console.error('Ошибка при смене динамиков:', error);
              ui.showToast('Ошибка при смене динамиков');
            }
          }
        },
        currentVolume,
        currentDeviceId
      );
    });
  }

  // Выбор динамиков
  if (devices.speakerSelect) {
    devices.speakerSelect.addEventListener('change', () => {
      const deviceId = devices.speakerSelect.value;
      webrtc.applySpeakerSelection(deviceId);
      // Сохраняем выбранные динамики
      devices.saveSelectedSpeakerId(deviceId);
    });
    webrtc.setSpeakerSelect(devices.speakerSelect);
  }

  // Выбор микрофона
  if (devices.micSelect) {
    devices.micSelect.addEventListener('change', async () => {
      if (joined && !isUpdatingMicrophone) {
        try {
          isUpdatingMicrophone = true;
          const deviceId = devices.getSelectedMicId();
          await webrtc.updateMicrophone(deviceId);
          updateSpeechDetector();
          // Сохраняем выбранный микрофон
          devices.saveSelectedMicId(deviceId);
        } finally {
          isUpdatingMicrophone = false;
        }
      }
    });
  }

  // Прикрепление файла
  if (ui.elements.attachBtn) {
    ui.elements.attachBtn.addEventListener("click", () => {
      ui.elements.fileInput.click();
    });
  }

  if (ui.elements.fileInput) {
    ui.elements.fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file && chat) {
        try {
          await chat.attachFile(file, (msg) => ui.showToast(msg));
        } catch (error) {
          console.error('Ошибка при прикреплении файла:', error);
          ui.showToast('Ошибка при прикреплении файла');
        }
      }
    });
  }

  // Отправка сообщения
  if (ui.elements.sendBtn) {
    ui.elements.sendBtn.addEventListener("click", () => {
      if (chat) {
      chat.sendMessage(ui.showToast.bind(ui));
      }
    });
  }

  if (ui.elements.chatInput) {
    ui.elements.chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && chat) {
        chat.sendMessage(ui.showToast.bind(ui));
      }
    });

    // Обработчик вставки изображений через Ctrl+V
    ui.elements.chatInput.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items || !chat) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Проверяем, является ли элемент изображением
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          
          const file = item.getAsFile();
          if (file) {
            console.log('📋 Вставка изображения из буфера обмена:', file.name, file.type);
            await chat.attachFile(file, ui.showToast.bind(ui));
          }
          break;
        }
      }
    });

    // Обработчик drag-and-drop для изображений
    ui.elements.chatInput.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.elements.chatInput.style.backgroundColor = 'rgba(74, 171, 247, 0.1)';
    });

    ui.elements.chatInput.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.elements.chatInput.style.backgroundColor = '';
    });

    ui.elements.chatInput.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.elements.chatInput.style.backgroundColor = '';

      if (!chat) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        console.log('🎯 Перетаскивание файла:', file.name, file.type);
        
        // Прикрепляем файл (валидация типа происходит в attachFile)
        await chat.attachFile(file, ui.showToast.bind(ui));
      }
    });
  }

  // Эмодзи пикер
  if (ui.elements.emojiBtn) {
    ui.elements.emojiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.elements.emojiPicker.classList.toggle("show");
    });
  }

  document.addEventListener("click", (e) => {
    if (ui.elements.emojiPicker && !ui.elements.emojiPicker.contains(e.target) && e.target !== ui.elements.emojiBtn) {
      ui.elements.emojiPicker.classList.remove("show");
    }
  });

  // Очистка чата
  if (ui.elements.clearChatBtn) {
    ui.elements.clearChatBtn.addEventListener("click", async () => {
      if (!chat) {
        ui.showToast("Чат не инициализирован");
        return;
      }
      
      if (joined && roomRef) {
        // Показываем подтверждение
        const confirmed = await ui.showConfirm("Вы уверены, что хотите очистить все сообщения в чате?");
        if (confirmed) {
          // Очищаем локально
          chat.clear();
          // Очищаем из Firebase
          clearRoomMessages(roomRef);
          ui.showToast("Чат очищен");
        }
      } else {
        // Если не в комнате, просто очищаем локально
        chat.clear();
        ui.showToast("Чат очищен");
      }
    });
  }

  // Открытие вайтборда
  const openWhiteboardBtn = document.getElementById('openWhiteboardBtn');
  if (openWhiteboardBtn) {
    openWhiteboardBtn.addEventListener("click", () => {
      if (!joined || !roomRef) {
        ui.showToast("Войдите в комнату чтобы открыть доску");
        return;
      }
      
      const currentUser = authManager.getCurrentUser();
      if (!currentUser) {
        ui.showToast("Ошибка: пользователь не авторизован");
        return;
      }
      
      const currentRoomId = roomRef.key;
      
      console.log(`[Whiteboard Button] Opening whiteboard. Current roomRef.key: ${currentRoomId}`);
      console.log(`[Whiteboard Button] Existing whiteboard: ${whiteboard ? 'YES' : 'NO'}`);
      
      // КРИТИЧНО: ВСЕГДА уничтожаем старый whiteboard если он существует
      if (whiteboard) {
        console.log(`[Whiteboard] Destroying existing whiteboard before creating new one`);
        
        // Закрываем модальное окно если открыто
        if (whiteboard.isOpen) {
          whiteboard.close();
        }
        
        // Останавливаем все слушатели Firebase
        whiteboard.stopListening();
        
        // Очищаем canvas если он существует
        if (whiteboard.context && whiteboard.canvas) {
          whiteboard.context.clearRect(0, 0, whiteboard.canvas.width, whiteboard.canvas.height);
          whiteboard.context.fillStyle = '#FFFFFF';
          whiteboard.context.fillRect(0, 0, whiteboard.canvas.width, whiteboard.canvas.height);
        }
        
        // Очищаем все данные
        whiteboard.strokes = [];
        whiteboard.offlineBuffer = [];
        whiteboard.pointsBuffer = [];
        
        // Уничтожаем ссылку
        whiteboard = null;
        
        console.log(`[Whiteboard] Old whiteboard destroyed completely`);
      }
      
      // ВСЕГДА создаем НОВЫЙ whiteboard для текущей комнаты
      console.log(`[Whiteboard] Creating NEW whiteboard for room: ${currentRoomId}`);
      whiteboard = new WhiteboardManager(roomRef, currentUser.uid, myNick, ui);
      
      // Открываем whiteboard
      whiteboard.open();
    });
  }

  // Обработчики друзей
  // Основные обработчики устанавливаются через FriendsHandlers после авторизации
  // Здесь только базовые обработчики, которые не требуют friendsManager
  
  // Кнопка уведомлений (базовый обработчик)
  if (ui.elements.notificationsBtn) {
    ui.elements.notificationsBtn.addEventListener('click', async () => {
      if (ui.elements.notificationsModal) {
        ui.elements.notificationsModal.classList.add('show');
        // Загружаем уведомления при открытии модального окна
        if (friendsManager) {
          console.log('🔔 Открытие модального окна уведомлений, загружаем список...');
          await friendsManager.loadNotifications();
        } else {
          console.warn('⚠️ friendsManager не инициализирован при открытии модального окна уведомлений');
        }
      }
    });
  }

  // Закрытие модального окна уведомлений
  if (ui.elements.notificationsCloseBtn) {
    ui.elements.notificationsCloseBtn.addEventListener('click', () => {
      if (ui.elements.notificationsModal) {
        ui.elements.notificationsModal.classList.remove('show');
      }
    });
  }

  // Закрытие модального окна уведомлений при клике вне его
  if (ui.elements.notificationsModal) {
    ui.elements.notificationsModal.addEventListener('click', (e) => {
      if (e.target === ui.elements.notificationsModal) {
        ui.elements.notificationsModal.classList.remove('show');
      }
    });
  }

  // Переключение между вкладками Комнаты/Друзья
  if (ui.elements.roomsTab && ui.elements.friendsTab) {
    ui.elements.roomsTab.addEventListener('click', async () => {
      // При переключении на вкладку "Комнаты" проверяем, загружены ли комнаты
      // Если список пустой, автоматически загружаем комнаты
      const roomsListEl = ui.elements?.roomsList || document.getElementById('roomsList');
      if (roomsListEl && roomsListEl.children.length === 0) {
        console.log('🔄 Вкладка "Комнаты" открыта, список пустой - загружаем комнаты...');
        if (typeof loadRoomsList === 'function' && db) {
          try {
            await loadRoomsList(true);
          } catch (error) {
            console.error('❌ Ошибка при автоматической загрузке при переключении на вкладку:', error);
          }
        }
      }
      
      ui.elements.roomsTab.classList.add('active');
      ui.elements.friendsTab.classList.remove('active');
      ui.elements.roomsContent.classList.add('active');
      ui.elements.friendsContent.classList.remove('active');
    });

      ui.elements.friendsTab.addEventListener('click', async () => {
      ui.elements.friendsTab.classList.add('active');
      ui.elements.roomsTab.classList.remove('active');
      ui.elements.friendsContent.classList.add('active');
      ui.elements.roomsContent.classList.remove('active');
        
        // Загружаем друзей при переключении на вкладку "Друзья"
        // Это гарантирует, что список всегда актуален, даже если слушатель не сработал
        if (friendsManager) {
          console.log('🔄 Переключение на вкладку "Друзья", загружаем список...');
          await friendsManager.loadFriends();
        }
    });
  }

  // Фон
  if (ui.elements.changeBgBtn) {
    ui.elements.changeBgBtn.addEventListener("click", () => {
      ui.elements.bgSelector.classList.add("show");
    });
  }

  if (ui.elements.bgCloseBtn) {
    ui.elements.bgCloseBtn.addEventListener("click", () => {
      ui.elements.bgSelector.classList.remove("show");
    });
  }

  if (ui.elements.bgSelector) {
    ui.elements.bgSelector.addEventListener("click", (e) => {
      if (e.target === ui.elements.bgSelector) {
        ui.elements.bgSelector.classList.remove("show");
      }
    });
  }

  if (ui.elements.bgCustomBtn) {
    ui.elements.bgCustomBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          ui.setBackground(reader.result);
          document.querySelectorAll(".bg-option").forEach(opt => opt.classList.remove("selected"));
          ui.elements.bgSelector.classList.remove("show");
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  // Закрытие окна (в основном приложении)
  if (ui.elements.closeBtn) {
    ui.elements.closeBtn.addEventListener("click", () => {
      if (window.electronAPI && window.electronAPI.closeWindow) {
        window.electronAPI.closeWindow();
      } else {
        window.close();
      }
    });
  }

  // Обработчик кнопки закрытия окна авторизации устанавливается в ui.initAuthHandlers()
  // Дублирующий обработчик удален для избежания конфликтов

  // Сворачивание окна
  const minimizeBtn = document.getElementById("minimizeBtn");
  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", () => {
      if (window.electronAPI && window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow();
      }
    });
  }

  // Обработчики обновлений
  if (ui.elements.checkUpdateBtn) {
    ui.elements.checkUpdateBtn.addEventListener("click", () => {
      console.log('🔄 Нажата кнопка проверки обновлений');
      if (window.electronAPI && window.electronAPI.checkForUpdates) {
        console.log('✅ electronAPI.checkForUpdates доступен, отправляем запрос');
        // Показываем плашку с текстом "Проверка обновлений..."
        if (ui.elements.updateStatus && ui.elements.updateStatusText) {
          ui.elements.updateStatus.style.display = 'flex';
          ui.elements.updateStatus.className = 'update-status checking';
          ui.elements.updateStatusText.textContent = 'Проверка обновлений...';
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
        }
        window.electronAPI.checkForUpdates();
      } else {
        console.error('❌ electronAPI.checkForUpdates недоступен');
      }
    });
  } else {
    console.warn('⚠️ Кнопка checkUpdateBtn не найдена');
  }

  if (ui.elements.downloadUpdateBtn) {
    ui.elements.downloadUpdateBtn.addEventListener("click", () => {
      console.log('📥 Нажата кнопка загрузки обновления');
      if (window.electronAPI && window.electronAPI.downloadUpdate) {
        console.log('✅ electronAPI.downloadUpdate доступен, начинаем загрузку');
        // Меняем текст на "Обновляется..."
        if (ui.elements.updateStatusText) {
          ui.elements.updateStatusText.textContent = 'Обновляется...';
        }
        if (ui.elements.downloadUpdateBtn) {
          ui.elements.downloadUpdateBtn.style.display = 'none';
        }
        window.electronAPI.downloadUpdate();
      } else {
        console.error('❌ electronAPI.downloadUpdate недоступен');
      }
    });
  }

  if (ui.elements.forceUpdateBtn) {
    ui.elements.forceUpdateBtn.addEventListener("click", () => {
      console.log('🔄 Нажата кнопка переустановки - открываем страницу релизов');
      // Открываем страницу релизов в системном браузере
      const link = document.createElement('a');
      link.href = 'https://github.com/kosenkomaks1999-dotcom/vibechat/releases';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    });
  }

  // Слушаем события обновлений от main процесса
  if (window.electronAPI && window.electronAPI.onUpdateStatus) {
    console.log('✅ Слушатель событий обновлений установлен');
    window.electronAPI.onUpdateStatus((status, data) => {
      console.log(`📡 Получено событие обновления: ${status}`, data);
      if (!ui.elements.updateStatus || !ui.elements.updateStatusText) {
        console.warn('⚠️ Элементы updateStatus или updateStatusText не найдены');
        return;
      }

      switch (status) {
        case 'checking':
          console.log('🔍 Статус: Проверка обновлений...');
          ui.elements.updateStatus.style.display = 'flex';
          ui.elements.updateStatus.className = 'update-status checking';
          ui.elements.updateStatusText.textContent = 'Проверка обновлений...';
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'none';
          }
          break;

        case 'available':
          console.log(`✅ Статус: Доступна версия ${data.version}`);
          ui.elements.updateStatus.className = 'update-status available';
          ui.elements.updateStatusText.textContent = `Доступна версия ${data.version}`;
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'block';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'none';
          }
          break;

        case 'not-available':
          console.log('ℹ️ Статус: Обновлений нет');
          ui.elements.updateStatus.className = 'update-status';
          ui.elements.updateStatusText.textContent = 'Обновлений нет';
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'block';
          }
          // Скрываем плашку через 5 секунд (увеличено чтобы успеть нажать)
          setTimeout(() => {
            if (ui.elements.updateStatus) {
              ui.elements.updateStatus.style.display = 'none';
            }
            if (ui.elements.forceUpdateBtn) {
              ui.elements.forceUpdateBtn.style.display = 'none';
            }
          }, 5000);
          break;

        case 'downloading':
          console.log(`📥 Статус: Загрузка ${data.percent}%`);
          ui.elements.updateStatus.className = 'update-status downloading';
          ui.elements.updateStatusText.textContent = `Загрузка: ${data.percent}%`;
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'none';
          }
          break;

        case 'downloaded':
          console.log('✅ Статус: Обновление готово');
          ui.elements.updateStatus.className = 'update-status available';
          ui.elements.updateStatusText.textContent = 'Обновление готово';
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'none';
          }
          break;

        case 'error':
          console.error('❌ Статус: Ошибка проверки');
          if (data && data.message) {
            console.error('❌ Сообщение ошибки:', data.message);
          }
          if (data && data.stack) {
            console.error('❌ Stack trace:', data.stack);
          }
          ui.elements.updateStatus.className = 'update-status error';
          ui.elements.updateStatusText.textContent = 'Ошибка проверки';
          if (ui.elements.downloadUpdateBtn) {
            ui.elements.downloadUpdateBtn.style.display = 'none';
          }
          if (ui.elements.forceUpdateBtn) {
            ui.elements.forceUpdateBtn.style.display = 'none';
          }
          // Скрываем плашку через 5 секунд (увеличено для чтения ошибки)
          setTimeout(() => {
            if (ui.elements.updateStatus) {
              ui.elements.updateStatus.style.display = 'none';
            }
          }, 5000);
          break;
      }
    });
  } else {
    console.warn('⚠️ electronAPI.onUpdateStatus недоступен');
  }

  // Функции работы с комнатами

  /**
   * Автоматическое переподключение к комнате после потери соединения
   */
  async function attemptReconnect() {
    // Проверяем, что мы в комнате и не выходим намеренно
    if (!currentRoomId || intentionalLeave || isReconnecting || !joined) {
      console.log('Переподключение отменено:', { currentRoomId, intentionalLeave, isReconnecting, joined });
      return;
    }
    
    // Дополнительная проверка: не пытаемся переподключиться, если только что подключились
    // (защита от ложных срабатываний при первом подключении)
    if (!myUserRef || !myId) {
      console.log('Переподключение отменено: пользователь еще не создан в комнате');
      return;
    }
    
    // Проверяем лимит попыток
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('Достигнут лимит попыток переподключения');
      ui.showToast('Не удалось восстановить соединение. Попробуйте войти в комнату заново.', 5000);
      reconnectAttempts = 0;
      return;
    }
    
    isReconnecting = true;
    reconnectAttempts++;
    
    console.log(`🔄 Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
    ui.showToast(`Переподключение... (попытка ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 3000);
    
    try {
      // Проверяем, существует ли еще комната
      const roomStillExists = await roomExists(db, currentRoomId);
      if (!roomStillExists) {
        console.log('Комната больше не существует');
        ui.showToast('Комната была удалена', 3000);
        await forceLeaveRoom(false);
        reconnectAttempts = 0;
        isReconnecting = false;
        return;
      }
      
      // Сохраняем текущие данные
      const savedRoomId = currentRoomId;
      const savedNickname = myNick;
      const savedMuted = muted;
      
      // Очищаем старое соединение (но не выходим из комнаты полностью)
      if (myUserRef) {
        try {
          // Отменяем onDisconnect перед удалением
          myUserRef.onDisconnect().cancel();
          await myUserRef.remove();
        } catch (e) {
          console.warn('Ошибка при очистке старого пользователя:', e);
        }
      }
      
      // Переподключаемся
      roomRef = getRoomRef(db, savedRoomId);
      webrtc.roomRef = roomRef;
      if (chat) {
        chat.roomRef = roomRef;
      }
      
      // Получаем Firebase userId
      const currentUser = authManager.getCurrentUser();
      const firebaseUserId = currentUser ? currentUser.uid : null;
      
      // Создаем нового пользователя в комнате
      const speakerMuted = webrtc.speakerMuted || false;
      myUserRef = createUserInRoom(roomRef, savedNickname, savedMuted, firebaseUserId, speakerMuted);
      myId = myUserRef.key;
      webrtc.myId = myId;
      speechDetector.setMyId(myId);
      
      // Настраиваем onDisconnect с увеличенным таймаутом
      myUserRef.onDisconnect().remove();
      
      // Переинициализируем слушатели
      setupListeners();
      
      // 🔧 FIX: Запускаем детектор речи после переподключения
      if (speechDetector && typeof speechDetector.startDetection === 'function') {
        speechDetector.startDetection();
        console.log('✅ Детектор речи запущен после переподключения');
      }
      
      console.log('✅ Переподключение успешно');
      ui.showToast('Соединение восстановлено', 2000);
      reconnectAttempts = 0; // Сбрасываем счетчик при успехе
      
    } catch (error) {
      console.error('Ошибка при переподключении:', error);
      
      // Если это последняя попытка, выходим из комнаты
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        ui.showToast('Не удалось восстановить соединение', 3000);
        await forceLeaveRoom(false);
        reconnectAttempts = 0;
      } else {
        // Пробуем еще раз через 3 секунды
        setTimeout(() => {
          attemptReconnect();
        }, 3000);
      }
    } finally {
      isReconnecting = false;
    }
  }

  /**
   * Запускает heartbeat для поддержания активности пользователя
   */
  function startHeartbeat() {
    // Останавливаем предыдущий heartbeat если есть
    stopHeartbeat();
    
    // Обновляем timestamp каждые 25 секунд (чаще для надежности)
    heartbeatInterval = setInterval(() => {
      if (myUserRef && joined) {
        // Обновляем lastActive для поддержания активности соединения
        myUserRef.child('lastActive').set(firebase.database.ServerValue.TIMESTAMP)
          .then(() => {
            // Дополнительно обновляем onDisconnect handler для продления времени жизни
            myUserRef.onDisconnect().remove();
            console.log('🔄 Heartbeat: соединение обновлено');
          })
          .catch(err => {
            console.warn('⚠️ Heartbeat error:', err);
            // Если heartbeat не работает, возможно соединение потеряно
            // Проверяем статус соединения
            db.ref('.info/connected').once('value').then(snap => {
              if (!snap.val()) {
                console.warn('⚠️ Firebase соединение потеряно, попытка переподключения...');
                // Соединение потеряно, но Firebase должен автоматически переподключиться
              }
            });
          });
      }
    }, 25000); // 25 секунд (чаще чем 30 для большей надежности)
    
    console.log('✅ Heartbeat started (interval: 25s)');
  }
  
  /**
   * Останавливает heartbeat
   */
  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      console.log('⏹️ Heartbeat stopped');
    }
  }

  /**
   * Запускает проверку присутствия пользователя в комнате
   * Проверяет каждые 2 минуты, что пользователь все еще в комнате
   */
  function startPresenceCheck() {
    // Останавливаем предыдущую проверку если есть
    stopPresenceCheck();
    
    // Проверяем присутствие каждые 2 минуты
    presenceCheckInterval = setInterval(async () => {
      if (myUserRef && myId && joined && roomRef) {
        try {
          // Проверяем, существует ли наша запись в комнате
          const snapshot = await myUserRef.once('value');
          if (!snapshot.exists()) {
            console.warn('⚠️ Пользователь не найден в комнате, восстанавливаем...');
            // Пытаемся восстановить запись
            const currentUser = authManager.getCurrentUser();
            const firebaseUserId = currentUser ? currentUser.uid : null;
            const speakerMuted = webrtc.speakerMuted || false;
            
            // Создаем новую запись с тем же ID
            await roomRef.child("users").child(myId).set({
              nick: myNick,
              mute: muted,
              speakerMuted: speakerMuted,
              userId: firebaseUserId,
              lastActive: firebase.database.ServerValue.TIMESTAMP
            });
            
            // Восстанавливаем onDisconnect
            myUserRef.onDisconnect().remove();
            
            console.log('✅ Запись пользователя восстановлена');
            ui.showToast('Соединение восстановлено', 2000);
          }
        } catch (err) {
          console.error('❌ Ошибка при проверке присутствия:', err);
        }
      }
    }, 120000); // 2 минуты
    
    console.log('✅ Presence check started (interval: 2min)');
  }

  /**
   * Останавливает проверку присутствия
   */
  function stopPresenceCheck() {
    if (presenceCheckInterval) {
      clearInterval(presenceCheckInterval);
      presenceCheckInterval = null;
      console.log('⏹️ Presence check stopped');
    }
  }

  /**
   * Покидает комнату
   */
  async function leaveRoom() {
    if (!joined) return;
    
    // Устанавливаем флаг намеренного выхода СРАЗУ, до любых других операций
    intentionalLeave = true;
    reconnectAttempts = 0; // Сбрасываем счетчик попыток
    
    // Останавливаем heartbeat и проверку присутствия
    stopHeartbeat();
    stopPresenceCheck();
    
    // Останавливаем мониторинг подключения СРАЗУ
    if (connectionManager) {
      connectionManager.cleanup();
    }
    
    // Сохраняем текущее состояние joinLock, чтобы не сломать другие операции
    const wasLocked = joinLock;
    if (!wasLocked) {
      joinLock = true;
    }
    try {
      // Передаем true, чтобы показать уведомление о выходе
      await forceLeaveRoom(true, 'Вы вышли из комнаты');
    } finally {
      if (!wasLocked) {
        joinLock = false;
      }
    }
  }

  /**
   * Принудительно покидает комнату
   * @param {boolean} showNotification - Показывать ли уведомление о выходе
   * @param {string} customMessage - Кастомное сообщение для уведомления (опционально)
   */
  async function forceLeaveRoom(showNotification = false, customMessage = null) {
    const wasJoined = joined;
    // Устанавливаем флаг намеренного выхода СРАЗУ, до любых операций
    intentionalLeave = true;
    
    // Останавливаем heartbeat и проверку присутствия
    stopHeartbeat();
    stopPresenceCheck();
    
    // Сохраняем ссылки перед очисткой
    const currentRoomRef = roomRef;
    const currentMyUserRef = myUserRef;
    const currentMyId = myId;
    
    // Обнуляем roomRef СРАЗУ, чтобы переподключение не сработало
    roomRef = null;
    
    // Удаляем пользователя из комнаты в Firebase
    if (currentMyUserRef && currentMyId) {
      try {
        // Отключаем onDisconnect обработчики ПЕРЕД удалением
        try {
          currentMyUserRef.onDisconnect().cancel();
        } catch (e) {
          // Игнорируем ошибки отмены onDisconnect
        }
        
        await currentMyUserRef.remove();
        console.log('Пользователь удален из комнаты:', currentMyId);
      } catch (error) {
        console.error('Ошибка при удалении пользователя из комнаты:', error);
        // Пытаемся удалить напрямую по ID, если ссылка не работает
        if (currentRoomRef && currentMyId) {
          try {
            await currentRoomRef.child("users").child(currentMyId).remove();
            console.log('Пользователь удален по ID:', currentMyId);
          } catch (err) {
            console.error('Ошибка при удалении пользователя по ID:', err);
          }
        }
      }
    } else if (currentRoomRef && currentMyId) {
      // Если ссылка на пользователя не сохранена, пытаемся удалить по ID
      try {
        await currentRoomRef.child("users").child(currentMyId).remove();
        console.log('Пользователь удален по ID (без ссылки):', currentMyId);
      } catch (err) {
        console.error('Ошибка при удалении пользователя по ID:', err);
      }
    }
    
    // Отключаем слушатели ПЕРЕД установкой joined = false
    // 🔧 FIX: Отключаем слушатели явно с сохраненными ссылками
    if (currentRoomRef) {
      if (currentRoomRef._customListeners) {
        if (currentRoomRef._customListeners.users) {
          currentRoomRef.child("users").off("value", currentRoomRef._customListeners.users);
        }
        if (currentRoomRef._customListeners.signals) {
          currentRoomRef.child("signals").off("child_added", currentRoomRef._customListeners.signals);
        }
        if (currentRoomRef._customListeners.messages) {
          currentRoomRef.child("messages").off("child_added", currentRoomRef._customListeners.messages);
        }
        currentRoomRef._customListeners = {};
      } else {
        // Fallback: отключаем все слушатели
        currentRoomRef.child("users").off();
        currentRoomRef.child("signals").off();
        currentRoomRef.child("messages").off();
      }
    }
    
    // Отменяем все активные попытки переподключения
    if (connectionManager) {
      connectionManager.cleanup();
    }
    
    // Останавливаем детекцию речи при выходе из комнаты
    if (speechDetector && typeof speechDetector.stopDetection === 'function') {
      speechDetector.stopDetection();
    }
    
    // Очищаем таймер обновления пользователей
    if (usersUpdateTimeout) {
      clearTimeout(usersUpdateTimeout);
      usersUpdateTimeout = null;
    }
    
    // ПОЛНОСТЬЮ очищаем вайтборд если открыт
    if (whiteboard) {
      console.log('[Whiteboard] Cleaning up on room leave');
      
      // Закрываем модальное окно
      if (whiteboard.isOpen) {
        whiteboard.close();
      }
      
      // Останавливаем все слушатели Firebase
      whiteboard.stopListening();
      
      // Очищаем все данные
      whiteboard.strokes = [];
      whiteboard.offlineBuffer = [];
      whiteboard.pointsBuffer = [];
      
      // Уничтожаем ссылку
      whiteboard = null;
      
      console.log('[Whiteboard] Cleanup complete');
    }
    
    // Очищаем ссылки
    myUserRef = null;
    myId = null;
    joined = false;
    
    // Скрываем панель участников
    if (ui.elements.usersPanel) {
      ui.elements.usersPanel.style.display = 'none';
    }
    
    ui.updateJoinButton(false);
    
    // Скрываем информацию о комнате
    ui.hideRoomInfo();
    
    // 🔧 FIX: Локально обновляем счетчик на карточке СРАЗУ при выходе
    if (currentRoomId) {
      const roomCard = document.querySelector(`.room-card[data-room-id="${currentRoomId}"]`);
      if (roomCard) {
        const usersCountEl = roomCard.querySelector('.room-card-users');
        if (usersCountEl) {
          // Получаем текущее значение и уменьшаем на 1 (вы вышли)
          const currentCount = parseInt(usersCountEl.textContent) || 0;
          const newCount = Math.max(0, currentCount - 1);
          usersCountEl.textContent = newCount;
          console.log(`✅ Счетчик локально обновлен при выходе: ${currentCount} → ${newCount}`);
        }
      }
    }
    
    // Сбрасываем текущую комнату
    currentRoomId = null;

    // Никнейм больше не изменяется пользователем
    
    // Обновляем список комнат с задержкой, чтобы Firebase успел обновить данные
    setTimeout(() => {
      loadRoomsList(false).catch(err => console.error('Ошибка при обновлении списка комнат:', err));
    }, 500);

    // Логируем выход из комнаты
    if (wasJoined && currentRoomId) {
      const currentUser = authManager?.getCurrentUser();
      if (currentUser) {
        const roomInfo = await getRoomInfo(db, currentRoomId).catch(() => null);
        await logger.logRoom('LEAVE', 'Выход из комнаты', {
          roomId: currentRoomId,
          roomName: roomInfo?.name || 'Неизвестно',
          userId: currentUser.uid,
          userEmail: currentUser.email,
          userNickname: myNick,
          reason: customMessage || 'Пользователь вышел',
          timestamp: Date.now()
        }).catch(() => {});
      }
    }
    
    // Показываем уведомление только если было запрошено и пользователь был в комнате
    if (wasJoined && showNotification) {
      playNotificationSound('leave');
      const message = customMessage || 'Вы вышли из комнаты';
      ui.showToast(message);
    }
    
    // Обнуляем currentRoomId после логирования
    const previousRoomId = currentRoomId;
    currentRoomId = null;

    // Слушатели уже отключены в forceLeaveRoom

    // Очищаем UI
    usersManager.clear();
    if (chat) {
    chat.clear();
    }
    previousUsersCount = 0;

    // Очищаем соединения
    if (webrtc) {
    webrtc.cleanup();
    }
    updateSpeechDetector();

    // Очищаем все ссылки (пользователь уже удален выше)
    myUserRef = null;
    myId = null;
    webrtc.roomRef = null;
    webrtc.myId = null;
    if (chat) {
    chat.roomRef = null;
    }
    
    // НЕ переинициализируем мониторинг - это предотвращает любые автоматические действия
    // Мониторинг будет переинициализирован только при следующем ручном подключении
    
    // Сбрасываем флаг намеренного выхода через большую задержку
    setTimeout(() => {
      intentionalLeave = false;
    }, 10000); // 10 секунд для полной гарантии
  }

  /**
   * Настраивает слушатели Firebase
   */
  function setupListeners() {
    if (!roomRef) return;

    // 🔧 FIX: Отключаем старые слушатели перед созданием новых
    // Если есть сохраненные слушатели, отключаем их явно
    if (roomRef._customListeners) {
      if (roomRef._customListeners.users) {
        roomRef.child("users").off("value", roomRef._customListeners.users);
      }
      if (roomRef._customListeners.signals) {
        roomRef.child("signals").off("child_added", roomRef._customListeners.signals);
      }
      if (roomRef._customListeners.messages) {
        roomRef.child("messages").off("child_added", roomRef._customListeners.messages);
      }
      roomRef._customListeners = {};
    } else {
      // Fallback: отключаем все слушатели
      roomRef.child("users").off();
      roomRef.child("signals").off();
      roomRef.child("messages").off();
    }

    // 🔧 FIX: Сохраняем ссылки на слушатели для последующей очистки
    const usersListener = snap => {
      // Debounce для предотвращения множественных обновлений
      if (usersUpdateTimeout) {
        clearTimeout(usersUpdateTimeout);
      }
      
      usersUpdateTimeout = setTimeout(() => {
        const users = snap.val() || {};
        const currentUsersCount = Object.keys(users).length;

      // Обновляем счетчик участников в шапке
      ui.updateUsersCount(currentUsersCount);
      
      // Звуки при изменении количества участников (только если уже в комнате)
      if (joined && previousUsersCount > 0 && previousUsersCount !== currentUsersCount) {
        const isMeInRoom = myId && users[myId];
        if (isMeInRoom) {
          if (currentUsersCount > previousUsersCount) {
            playNotificationSound('join');
          } else if (currentUsersCount < previousUsersCount) {
            playNotificationSound('leave');
          }
        }
      }
      
      previousUsersCount = currentUsersCount;

      // Обновляем состояния muted в детекторе речи
      speechDetector.updateUserMutedStates(users);

      usersManager.updateUsersList(users, (userId, volume) => {
        webrtc.setUserVolume(userId, volume);
      }, myId);

      // Комната больше не удаляется автоматически при выходе всех пользователей
      if (joined) {
        const count = Object.keys(users).length;
        if (count === 0 && roomRef) {
          if (chat) {
            chat.clear();
          }
          usersManager.clear();
        }
      }

      // Проверка на удаление пользователя администратором
      // Показываем уведомление только если это не намеренный выход пользователя
      if (joined && myUserRef && myId && !users[myId] && !intentionalLeave) {
        console.log('Пользователь удален из комнаты администратором');
        // Устанавливаем intentionalLeave перед вызовом, чтобы предотвратить повторные вызовы
        intentionalLeave = true;
        // Вызываем forceLeaveRoom с кастомным сообщением
        forceLeaveRoom(true, "Вы были выкинуты администратором!").catch(error => {
          console.error('Ошибка при выходе из комнаты после удаления администратором:', error);
        });
      }
        
        usersUpdateTimeout = null;
      }, 300); // Debounce 300ms для предотвращения лагов
    };

    // Слушатель сигналов WebRTC
    const signalsListener = snap => {
      const data = snap.val();
      if (!data || data.to !== myId) return;
      webrtc.handleSignal(data);
      snap.ref.remove().catch(() => {});
    };

    // Слушатель сообщений
    const messagesListener = snap => {
      const message = snap.val();
      console.log('🔔 Firebase: Получено сообщение из базы:', {
        hasMessage: !!message,
        hasFile: !!(message && message.file),
        messageKeys: message ? Object.keys(message) : [],
        fullMessage: message
      });
      if (message && chat) {
        // displayMessage теперь асинхронная
        chat.displayMessage(message).catch(error => {
          console.error('Ошибка при отображении сообщения:', error);
        });
      }
    };

    // 🔧 FIX: Регистрируем слушатели
    roomRef.child("users").on("value", usersListener);
    roomRef.child("signals").on("child_added", signalsListener);
    roomRef.child("messages").on("child_added", messagesListener);

    // 🔧 FIX: Сохраняем ссылки на слушатели для очистки
    if (!roomRef._customListeners) {
      roomRef._customListeners = {};
    }
    roomRef._customListeners.users = usersListener;
    roomRef._customListeners.signals = signalsListener;
    roomRef._customListeners.messages = messagesListener;
  }

  // Обработчики кнопок в title bar
  // Кнопка создания комнаты
  // Кнопка обновления списка комнат удалена, так как комнаты загружаются автоматически
  // if (ui.elements.refreshRoomsBtn) {
  //   ui.elements.refreshRoomsBtn.addEventListener("click", async () => {
  //     console.log('🔄 Кнопка обновления комнат нажата!');
  //     if (typeof loadRoomsList === 'function') {
  //       const btn = ui.elements.refreshRoomsBtn;
  //       const originalText = btn.textContent;
  //       btn.textContent = '⏳ Обновление...';
  //       btn.disabled = true;
  //       
  //       try {
  //         await loadRoomsList(true);
  //         console.log('✅ Комнаты обновлены через кнопку');
  //       } catch (error) {
  //         console.error('❌ Ошибка при обновлении комнат:', error);
  //       } finally {
  //         btn.textContent = originalText;
  //         btn.disabled = false;
  //       }
  //     } else {
  //       console.error('❌ Функция loadRoomsList не определена!');
  //     }
  //   });
  // }

  if (ui.elements.createRoomBtn) {
    ui.elements.createRoomBtn.addEventListener("click", () => {
      if (roomsManager) {
        roomsManager.showCreateModal();
      } else {
        console.error('❌ RoomsManager не инициализирован');
      }
    });
  }

  // Обработчики модального окна создания комнаты
  if (ui.elements.createRoomCloseBtn) {
    ui.elements.createRoomCloseBtn.addEventListener('click', () => {
      if (ui.elements.createRoomModal) {
        ui.elements.createRoomModal.classList.remove('show');
      }
    });
  }

  if (ui.elements.createRoomCancelBtn) {
    ui.elements.createRoomCancelBtn.addEventListener('click', () => {
      if (ui.elements.createRoomModal) {
        ui.elements.createRoomModal.classList.remove('show');
      }
    });
  }

  // Создание комнаты
  if (ui.elements.createRoomSubmitBtn && ui.elements.roomNameInput && ui.elements.roomIdDisplayInput) {
    ui.elements.createRoomSubmitBtn.addEventListener('click', async () => {
      if (roomsManager) {
        const roomId = ui.elements.roomIdDisplayInput.value.trim();
        const roomName = ui.elements.roomNameInput.value.trim();
        await roomsManager.createRoom(roomId, roomName);
      } else {
        console.error('❌ RoomsManager не инициализирован');
      }
    });
  }

  // Поддержка Enter для создания комнаты
  if (ui.elements.roomNameInput) {
    ui.elements.roomNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && ui.elements.createRoomSubmitBtn) {
        ui.elements.createRoomSubmitBtn.click();
      }
    });
  }

  // Закрытие модального окна создания комнаты при клике вне его
  if (ui.elements.createRoomModal) {
    ui.elements.createRoomModal.addEventListener('click', (e) => {
      if (e.target === ui.elements.createRoomModal) {
        ui.elements.createRoomModal.classList.remove('show');
      }
    });
  }

  // Кнопка поиска комнаты
  if (ui.elements.findRoomBtn) {
    ui.elements.findRoomBtn.addEventListener("click", () => {
      if (roomsManager) {
        roomsManager.showFindModal();
      } else {
        console.error('❌ RoomsManager не инициализирован');
      }
    });
  }

  // Кнопка добавления друга в title bar
  if (ui.elements.addFriendBtnTitle) {
    ui.elements.addFriendBtnTitle.addEventListener('click', () => {
      if (ui.elements.addFriendModal) {
        ui.elements.addFriendModal.classList.add('show');
        if (ui.elements.friendNicknameInput) {
          ui.elements.friendNicknameInput.value = '';
          ui.elements.friendNicknameInput.focus();
        }
        if (ui.elements.addFriendError) {
          ui.elements.addFriendError.textContent = '';
          ui.elements.addFriendError.style.display = 'none';
        }
      }
    });
  }
  
  // Закрытие модального окна добавления друга
  if (ui.elements.addFriendCloseBtn) {
    ui.elements.addFriendCloseBtn.addEventListener('click', () => {
      if (ui.elements.addFriendModal) {
        ui.elements.addFriendModal.classList.remove('show');
      }
    });
  }

  if (ui.elements.addFriendCancelBtn) {
    ui.elements.addFriendCancelBtn.addEventListener('click', () => {
      if (ui.elements.addFriendModal) {
        ui.elements.addFriendModal.classList.remove('show');
      }
    });
  }
  
  // Закрытие модального окна добавления друга при клике вне его
  if (ui.elements.addFriendModal) {
    ui.elements.addFriendModal.addEventListener('click', (e) => {
      if (e.target === ui.elements.addFriendModal) {
        ui.elements.addFriendModal.classList.remove('show');
      }
    });
  }
  
  // Поддержка Enter для отправки запроса в друзья
  if (ui.elements.friendNicknameInput) {
    ui.elements.friendNicknameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && ui.elements.addFriendSubmitBtn) {
        ui.elements.addFriendSubmitBtn.click();
      }
    });
  }

  // Закрытие модального окна поиска комнаты
  if (ui.elements.findRoomCloseBtn) {
    ui.elements.findRoomCloseBtn.addEventListener('click', () => {
      if (ui.elements.findRoomModal) {
        ui.elements.findRoomModal.classList.remove('show');
      }
    });
  }

  if (ui.elements.findRoomCancelBtn) {
    ui.elements.findRoomCancelBtn.addEventListener('click', () => {
      if (ui.elements.findRoomModal) {
        ui.elements.findRoomModal.classList.remove('show');
      }
    });
  }

  // Поиск и вход в комнату
  if (ui.elements.findRoomSubmitBtn && ui.elements.roomIdInput) {
    ui.elements.findRoomSubmitBtn.addEventListener('click', async () => {
      if (roomsManager) {
        const roomId = ui.elements.roomIdInput.value.trim();
        
        // Закрываем модальное окно
        if (ui.elements.findRoomModal) {
          ui.elements.findRoomModal.classList.remove('show');
        }
        
        // Входим в комнату
        await roomsManager.joinRoom(roomId);
      } else {
        console.error('❌ RoomsManager не инициализирован');
      }
    });
  }

  // Поддержка Enter для поиска комнаты
  if (ui.elements.roomIdInput) {
    ui.elements.roomIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && ui.elements.findRoomSubmitBtn) {
        ui.elements.findRoomSubmitBtn.click();
      }
    });
  }

  // Закрытие модального окна поиска комнаты при клике вне его
  if (ui.elements.findRoomModal) {
    ui.elements.findRoomModal.addEventListener('click', (e) => {
      if (e.target === ui.elements.findRoomModal) {
        ui.elements.findRoomModal.classList.remove('show');
      }
    });
  }

  // Функция загрузки списка комнат
  // Переменные currentRoomId и roomsListener объявлены выше

  // Старые функции loadRoomsList, renderRoomsList, showRoomContextMenu, startRoomsListener, stopRoomsListener
  // удалены - теперь используется RoomsManager

  // escapeHtml перенесена в utils/security.js

  // Обработчики контекстного меню
  if (ui.elements.roomContextLeave) {
    ui.elements.roomContextLeave.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (roomsManager && roomsManager.joined) {
        console.log('Выход из комнаты через RoomsManager');
        await roomsManager.leaveRoom();
      } else {
        console.log('Пользователь не в комнате или RoomsManager не инициализирован');
        ui.showToast('Вы не находитесь в комнате');
      }
      
      // Закрываем контекстное меню
      if (ui.elements.roomContextMenu) {
        ui.elements.roomContextMenu.style.display = 'none';
      }
    });
  }

  if (ui.elements.roomContextDelete) {
    ui.elements.roomContextDelete.addEventListener('click', async () => {
      const roomId = ui.elements.roomContextMenu?.dataset.roomId;
      if (!roomId) return;

      if (roomsManager) {
        await roomsManager.deleteRoom(roomId);
      } else {
        console.error('❌ RoomsManager не инициализирован');
      }

      if (ui.elements.roomContextMenu) {
        ui.elements.roomContextMenu.style.display = 'none';
      }
    });
  }

  // Обработчики контекстного меню участников
  if (ui.elements.userContextAddFriend) {
    console.log('✅ Регистрируем обработчик для кнопки "Добавить в друзья"');
    
    ui.elements.userContextAddFriend.addEventListener('click', async (e) => {
      console.log('🔵🔵🔵🔵🔵 КНОПКА "ДОБАВИТЬ В ДРУЗЬЯ" НАЖАТА! 🔵🔵🔵🔵🔵');
      e.stopPropagation();
      e.preventDefault();
      
      const userContextMenu = ui.elements.userContextMenu;
      if (!userContextMenu) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Контекстное меню не найдено!');
        ui.showToast('Ошибка: контекстное меню не найдено');
        return;
      }
      
      // Читаем все данные из dataset
      const userNickname = userContextMenu.dataset.userNickname;
      const firebaseUserId = userContextMenu.dataset.firebaseUserId;
      const userPushId = userContextMenu.dataset.userPushId;
      
      console.log('🔵🔵🔵 Чтение данных из dataset контекстного меню:');
      console.log('  - userNickname:', userNickname);
      console.log('  - firebaseUserId:', firebaseUserId);
      console.log('  - userPushId:', userPushId);
      console.log('  - Все атрибуты dataset:', {
        userNickname: userContextMenu.dataset.userNickname,
        firebaseUserId: userContextMenu.dataset.firebaseUserId,
        userPushId: userContextMenu.dataset.userPushId
      });
      
      if (!userNickname && !firebaseUserId) {
        console.error('❌ Данные пользователя не найдены в dataset контекстного меню');
        ui.showToast('Ошибка: данные пользователя не найдены');
        return;
      }
      
      // Закрываем контекстное меню
      userContextMenu.style.display = 'none';
      
      // Проверяем, инициализирован ли friendsManager
      if (!friendsManager) {
        console.error('❌ Менеджер друзей не инициализирован');
        ui.showToast('Ошибка. Перезагрузите приложение.');
        return;
      }
      
      console.log('🔵 Начинаем добавление в друзья участника:', { userNickname, firebaseUserId });
      console.log('🔵 friendsManager:', friendsManager);
      
      try {
        let result;
        
        // Если есть Firebase userId, используем его напрямую (более надежно)
        if (firebaseUserId) {
          console.log('🚀 Вызываем sendFriendRequestByUserId с Firebase userId...');
          result = await friendsManager.sendFriendRequestByUserId(firebaseUserId);
        } else {
          // Если нет userId, используем никнейм
          console.log('🚀 Вызываем sendFriendRequestByNickname (Firebase userId не найден)...');
          result = await friendsManager.sendFriendRequestByNickname(userNickname);
        }
        
        console.log('📥 Результат отправки запроса:', result);
        console.log('📥 Тип результата:', typeof result);
        console.log('📥 Результат.success:', result?.success);
        console.log('📥 Результат.error:', result?.error);
        
        // Всегда показываем уведомление с более надежной проверкой
        if (!result) {
          console.error('❌ Результат не получен');
          ui.showToast('Ошибка: не получен ответ от сервера');
        } else if (result.success === true) {
          console.log('✅ Запрос успешно отправлен');
          ui.showToast('Заявка отправлена!');
        } else if (result.error === 'Запрос уже отправлен') {
          console.log('⚠️ Запрос уже отправлен ранее');
          ui.showToast('Заявка уже отправлена');
        } else if (result.error === 'Вы уже друзья с этим пользователем') {
          console.log('⚠️ Пользователи уже друзья');
          ui.showToast('Вы уже друзья');
        } else {
          const errorMsg = result.error || 'Ошибка при отправке запроса';
          console.error('❌ Ошибка при отправке запроса:', errorMsg);
          ui.showToast(errorMsg, 5000, 'error');
        }
      } catch (error) {
        console.error('❌ ИСКЛЮЧЕНИЕ при отправке запроса в друзья:', error);
        console.error('Детали ошибки:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
        ui.showToast('Ошибка при отправке запроса: ' + (error.message || 'Неизвестная ошибка'), 5000, 'error');
      }
    });
    
    console.log('✅ Обработчик зарегистрирован');
  } else {
    console.error('❌ Элемент userContextAddFriend не найден!');
  }

  if (ui.elements.userContextVolume) {
    ui.elements.userContextVolume.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const userContextMenu = ui.elements.userContextMenu;
      if (!userContextMenu) return;
      
      const userPushId = userContextMenu.dataset.userPushId;
      if (!userPushId) return;
      
      // Закрываем контекстное меню
      userContextMenu.style.display = 'none';
      
      // Находим карточку участника по pushId
      const userCard = document.querySelector(`[data-user-id="${userPushId}"]`);
      if (!userCard) return;
      
      // Получаем обработчик из usersManager
      if (usersManager && usersManager.userCardHandlers) {
        const handler = usersManager.userCardHandlers.get(userCard);
        if (handler && handler.showVolumeMenu) {
          handler.showVolumeMenu();
        }
      }
    });
  }

  // Инициализация мониторинга подключения (после определения всех функций)
  connectionManager = new ConnectionManager(
    db,
    (status) => {
      // Если был намеренный выход, полностью игнорируем изменения статуса
      if (intentionalLeave) {
        return; // Не делаем ничего при намеренном выходе
      }
      
      // Если нет комнаты или пользователь не в комнате, только обновляем статус
      if (!roomRef || !joined) {
        ui.updateConnectionStatus(status);
        return;
      }
      
      // Обновляем статус подключения в UI
      ui.updateConnectionStatus(status);
      
      // Показываем уведомление при потере соединения
      if (status === 'disconnected' && joined && !intentionalLeave && roomRef) {
        ui.showToast("Потеряно подключение к серверу. Попытка переподключения...", CONSTANTS.TOAST_DURATION * 2);
      }
    },
    // Callback для автоматического переподключения
    async () => {
      if (!intentionalLeave && joined && currentRoomId) {
        console.log('🔄 Соединение восстановлено, запускаем переподключение...');
        await attemptReconnect();
      }
    }
  );
  connectionManager.init();
  
  // Устанавливаем начальный статус подключения
  db.ref('.info/connected').once('value', (snap) => {
    const isConnected = snap.val() === true;
    ui.updateConnectionStatus(isConnected ? 'connected' : 'disconnected');
  });

  // Запуск детектора речи
  speechDetector.startDetection();

  // Функция для установки обработчика выхода из аккаунта
  function setupLogoutHandler() {
    if (ui.elements.logoutBtn && authManager) {
      console.log('Устанавливаем обработчик для кнопки выхода');
      
      // Убеждаемся, что кнопка кликабельна
      ui.elements.logoutBtn.style.pointerEvents = 'auto';
      ui.elements.logoutBtn.style.cursor = 'pointer';
      ui.elements.logoutBtn.style.zIndex = '100';
      
      // Удаляем старые обработчики, если они есть (избегаем дублирования)
      const newBtn = ui.elements.logoutBtn.cloneNode(true);
      ui.elements.logoutBtn.parentNode.replaceChild(newBtn, ui.elements.logoutBtn);
      ui.elements.logoutBtn = newBtn;
      
      ui.elements.logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Кнопка выхода нажата');
        
        // Закрываем модальное окно настроек перед показом диалога подтверждения
        ui.hideProfileSettings();
        
        // Небольшая задержка для завершения анимации закрытия
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
          const confirmed = await ui.showConfirm('Вы уверены, что хотите выйти из аккаунта?');
          if (confirmed) {
            const currentUser = authManager.getCurrentUser();
            const wasInRoom = joined;
            const previousRoomId = currentRoomId;
            const userId = currentUser ? currentUser.uid : null;
            
            // ВАЖНО: Устанавливаем статус оффлайн ДО выхода из аккаунта,
            // иначе Firebase отклонит запрос из-за правил безопасности
            try {
              if (currentUser && db && userId) {
                console.log('Установка статуса offline перед выходом из аккаунта...');
                await setUserOnlineStatus(db, userId, false);
                console.log('Статус offline установлен успешно');
              }
            } catch (cleanupError) {
              console.error('Ошибка при установке статуса оффлайн:', cleanupError);
              // Продолжаем выход даже если не удалось установить статус
            }
            
            // Выходим из комнаты если были в ней (после установки статуса, но до выхода из аккаунта)
            if (joined) {
              try {
                await leaveRoom();
              } catch (leaveError) {
                console.error('Ошибка при выходе из комнаты:', leaveError);
                // Продолжаем выход даже если не удалось выйти из комнаты
              }
            }
            
            // 🚀 ОПТИМИЗАЦИЯ: Очищаем все слушатели и кэш перед выходом
            try {
              console.log('🧹 Очистка слушателей и кэша...');
              if (roomsManager) {
                roomsManager.cleanup(); // Полная очистка RoomsManager (слушатели + таймеры)
              }
              listenersManager.unregisterAll(); // Отписываемся от всех слушателей
              roomsCache.clear(); // Очищаем кэш комнат
              console.log('✅ Слушатели и кэш очищены');
            } catch (cleanupError) {
              console.error('Ошибка при очистке слушателей:', cleanupError);
            }
            
            // Логируем выход из приложения (до выхода из аккаунта)
            await logger.logRoom('EXIT_APP', 'Выход из приложения (logout)', {
              userId: userId,
              userEmail: currentUser ? currentUser.email : null,
              wasInRoom: wasInRoom,
              roomId: previousRoomId,
              timestamp: Date.now()
            }).catch(() => {});
            
            // Теперь выходим из аккаунта (после всех операций с базой данных)
            await authManager.signOut();
            logger.info('Пользователь вышел из аккаунта', { email: currentUser ? currentUser.email : null }).catch(() => {});
            
            // Очищаем данные в плашке пользователя
            ui.setNicknameDisplay('Загрузка...');
            ui.setUserAvatar(null, '');
            
            // Показываем окно авторизации
            showAuth();
          }
        } catch (error) {
          console.error('Ошибка при выходе из аккаунта:', error);
          ui.showToast('Ошибка при выходе из аккаунта');
        }
      });
      
      // Также добавляем обработчик через mousedown для более надежной работы
      ui.elements.logoutBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      
      console.log('Обработчик для кнопки выхода установлен');
    } else {
      console.warn('Кнопка выхода не найдена или authManager не инициализирован:', {
        logoutBtn: !!ui.elements.logoutBtn,
        authManager: !!authManager
      });
    }
  }


  // Логируем информацию о файле логов при запуске (если доступно, неблокирующее)
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getLogFilePath) {
    window.electronAPI.getLogFilePath().then(logPath => {
      logger.info('Файл логов создан', { path: logPath }).catch(() => {});
      console.log('Логи записываются в:', logPath);
    }).catch(error => {
      console.warn('Не удалось получить путь к файлу логов:', error);
    });
  }

  // Обработчик события закрытия приложения от main process
  if (window.electronAPI && window.electronAPI.onAppClosing) {
    window.electronAPI.onAppClosing(() => {
      console.log('🔴 Приложение закрывается, очистка ресурсов...');
      
      // 🔧 FIX: Очищаем все таймеры
      if (usersUpdateTimeout) {
        clearTimeout(usersUpdateTimeout);
        usersUpdateTimeout = null;
      }
      if (roomsUpdateTimeout) {
        clearTimeout(roomsUpdateTimeout);
        roomsUpdateTimeout = null;
      }
      if (updateRoomsListTimeout) {
        clearTimeout(updateRoomsListTimeout);
        updateRoomsListTimeout = null;
      }
      if (typeof autoLoadRoomsInterval !== 'undefined' && autoLoadRoomsInterval) {
        clearInterval(autoLoadRoomsInterval);
        autoLoadRoomsInterval = null;
      }
      
      // 🔧 FIX: Останавливаем слушатели Firebase
      if (roomsManager) {
        roomsManager.cleanup();
      }
      if (typeof listenersManager !== 'undefined' && listenersManager) {
        listenersManager.unregisterAll();
      }
      
      // 🔧 FIX: Останавливаем детекцию речи
      if (speechDetector && typeof speechDetector.stopDetection === 'function') {
        speechDetector.stopDetection();
      }
      
      // 🔧 FIX: Закрываем все WebRTC соединения через cleanup()
      if (webrtc && typeof webrtc.cleanup === 'function') {
        webrtc.cleanup();
      }
      
      // 🔧 FIX: Очищаем FriendsManager
      if (friendsManager && typeof friendsManager.cleanup === 'function') {
        friendsManager.cleanup();
      }
      
      // 🔧 FIX: Очищаем ConnectionManager
      if (connectionManager && typeof connectionManager.cleanup === 'function') {
        connectionManager.cleanup();
      }
      
      // 🔧 FIX: Отключаемся от Firebase с явной очисткой слушателей
      if (roomRef) {
        if (roomRef._customListeners) {
          if (roomRef._customListeners.users) {
            roomRef.child("users").off("value", roomRef._customListeners.users);
          }
          if (roomRef._customListeners.signals) {
            roomRef.child("signals").off("child_added", roomRef._customListeners.signals);
          }
          if (roomRef._customListeners.messages) {
            roomRef.child("messages").off("child_added", roomRef._customListeners.messages);
          }
          roomRef._customListeners = {};
        }
        roomRef.off();
      }
      
      // Устанавливаем статус offline
      if (authManager && authManager.isAuthenticated() && db) {
        const currentUser = authManager.getCurrentUser();
        if (currentUser) {
          setUserOnlineStatus(db, currentUser.uid, false);
        }
      }
      
      console.log('✅ Ресурсы очищены');
    });
  }
  
  // Обработчик закрытия окна
  // Примечание: onDisconnect() в setUserOnlineStatus уже обрабатывает автоматическую
  // установку статуса offline при отключении, но оставляем это как дополнительную меру
  window.addEventListener('beforeunload', (event) => {
    // Очищаем все таймеры для предотвращения утечек памяти
    if (usersUpdateTimeout) {
      clearTimeout(usersUpdateTimeout);
      usersUpdateTimeout = null;
    }
    if (roomsUpdateTimeout) {
      clearTimeout(roomsUpdateTimeout);
      roomsUpdateTimeout = null;
    }
    if (updateRoomsListTimeout) {
      clearTimeout(updateRoomsListTimeout);
      updateRoomsListTimeout = null;
    }
    
    // 🔧 FIX: Очищаем autoLoadRoomsInterval
    if (typeof autoLoadRoomsInterval !== 'undefined' && autoLoadRoomsInterval) {
      clearInterval(autoLoadRoomsInterval);
      autoLoadRoomsInterval = null;
    }
    
    // Останавливаем детекцию речи
    if (speechDetector && typeof speechDetector.stopDetection === 'function') {
      speechDetector.stopDetection();
    }
    
    // Пытаемся установить статус оффлайн при закрытии окна
    // onDisconnect() должен автоматически установить статус, но это дополнительная мера
    if (authManager && authManager.isAuthenticated() && db) {
      const currentUser = authManager.getCurrentUser();
      if (currentUser) {
        // Выполняем асинхронно, но не ждем завершения (beforeunload не поддерживает await)
        // onDisconnect() должен обработать это автоматически
        setUserOnlineStatus(db, currentUser.uid, false).catch(error => {
          // Игнорируем ошибки, так как onDisconnect() должен обработать это
        });
      }
    }
  });
});

