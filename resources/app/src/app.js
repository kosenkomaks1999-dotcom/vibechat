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
  const APP_VERSION = '1.1.0-performance-fix-v3';
  
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
    // Ширина увеличена на треть: 900 -> 1200, 800 -> 1065
    if (window.electronAPI && window.electronAPI.restoreWindowSize) {
      window.electronAPI.restoreWindowSize(1200, 650, 1065, 550, true);
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
        
      // Устанавливаем онлайн статус
      await setUserOnlineStatus(db, currentUser.uid, true);
      } else {
        console.warn('Пользователь не найден при инициализации приложения');
      }
    }
    
    // Загружаем список комнат после инициализации пользователя
    // Используем несколько задержек для надежности: сначала ждем готовности UI, потом загружаем данные
    setTimeout(async () => {
      try {
        const currentUser = authManager?.getCurrentUser();
        if (!currentUser) {
          console.warn('⚠️ Пользователь не авторизован в initApp, список комнат не загружен');
          return;
        }
        
        console.log('🔵 Инициализация загрузки списка комнат для пользователя:', currentUser.uid);
        console.log('🔵 Проверка состояния db:', !!db);
        console.log('🔵 Проверка loadRoomsList:', typeof loadRoomsList);
        
        // ВАЖНО: Убеждаемся, что вкладка "Комнаты" активна и контент виден при входе
        const roomsTab = document.getElementById('roomsTab');
        const roomsContent = document.getElementById('roomsContent');
        const friendsTab = document.getElementById('friendsTab');
        const friendsContent = document.getElementById('friendsContent');
        
        console.log('🔵 Проверка элементов UI:', {
          roomsTab: !!roomsTab,
          roomsContent: !!roomsContent,
          roomsList: !!ui.elements.roomsList,
          roomsEmpty: !!ui.elements.roomsEmpty
        });
        
        if (roomsTab && roomsContent) {
          console.log('✅ Активируем вкладку "Комнаты" при входе в приложение...');
          // Активируем вкладку "Комнаты"
          roomsTab.classList.add('active');
          roomsContent.classList.add('active');
          // Деактивируем вкладку "Друзья"
          if (friendsTab) friendsTab.classList.remove('active');
          if (friendsContent) friendsContent.classList.remove('active');
          console.log('✅ Вкладка "Комнаты" активирована');
        } else {
          console.error('❌ Элементы вкладок не найдены:', {
            roomsTab: !!roomsTab,
            roomsContent: !!roomsContent
          });
          // Если элементы не найдены, пробуем еще раз через 500ms
          setTimeout(() => {
            console.log('🔄 Повторная попытка активации вкладки...');
            const retryRoomsTab = document.getElementById('roomsTab');
            const retryRoomsContent = document.getElementById('roomsContent');
            if (retryRoomsTab && retryRoomsContent) {
              retryRoomsTab.classList.add('active');
              retryRoomsContent.classList.add('active');
              loadRoomsList().catch(err => console.error('Ошибка при повторной загрузке комнат:', err));
              startRoomsListener();
            }
          }, 500);
        }
        
        // Ждем еще немного, чтобы убедиться, что UI полностью готов
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Пытаемся загрузить комнаты сразу после инициализации
        // Функции могут быть еще не определены, поэтому используем проверку
        console.log('🔵 Попытка загрузки комнат из initApp...');
        
        // Ждем, пока функции будут определены (максимум 5 секунд)
        let attempts = 0;
        const maxAttempts = 10;
        const tryLoad = async () => {
          attempts++;
          if (typeof loadRoomsList === 'function' && typeof startRoomsListener === 'function') {
            console.log('✅ Функции найдены, загружаем комнаты из initApp...');
            try {
              isInitialLoad = true;
              await loadRoomsList(true);
              await new Promise(resolve => setTimeout(resolve, 1000));
              roomsListInitialized = true;
              if (!roomsListener) {
                startRoomsListener();
              }
              setTimeout(() => {
                isInitialLoad = false;
              }, 2000);
              console.log('✅ Комнаты загружены из initApp');
            } catch (error) {
              console.error('❌ Ошибка загрузки комнат из initApp:', error.message || error);
              if (error.stack) console.error(error.stack);
            }
          } else if (attempts < maxAttempts) {
            setTimeout(tryLoad, 500);
          } else {
            console.log('⏳ Функции еще не определены, будет использована автоматическая загрузка');
          }
        };
        
        tryLoad();
        
        console.log('=== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ЗАВЕРШЕНА ===');
      } catch (error) {
        console.error('❌ Ошибка при загрузке списка комнат в initApp:', error);
        console.error('Детали ошибки:', error.message, error.code, error.stack);
      }
    }, 500); // Увеличена задержка до 500ms для надежности
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

  // Простая функция скрытия splash screen и показа нужного окна
  let splashProcessed = false;
  function hideSplashAndShow(isAuthorized) {
    // Защита от повторных вызовов
    if (splashProcessed) return;
    splashProcessed = true;

    // Скрываем splash screen с анимацией
    if (splashScreen && !splashScreen.classList.contains('fade-out')) {
      splashScreen.classList.add('fade-out');
      
      // После завершения анимации (1.2 секунды)
      setTimeout(() => {
        // Удаляем splash screen из DOM
        if (splashScreen && splashScreen.parentNode) {
          splashScreen.remove();
        }
        
        // Показываем нужное окно
        if (isAuthorized) {
          // Пользователь авторизован - показываем основное приложение
          initApp();
        } else {
          // Пользователь не авторизован - показываем окно авторизации
          showAuth();
        }
      }, 1200);
    } else {
      // Если splash screen уже скрыт или удален, сразу показываем нужное окно
      if (isAuthorized) {
        initApp();
      } else {
        showAuth();
      }
    }
  }

  // Проверка авторизации при загрузке
  if (authManager) {
    // Минимальное время показа splash screen - 2 секунды
    const minSplashTime = 2000;
    const splashStartTime = Date.now();
    let authStateResolved = false;
    
    // ВРЕМЕННО: Принудительно выходим из аккаунта для тестирования
    // Раскомментируйте следующую строку, если нужно всегда показывать окно авторизации
    // authManager.signOut().then(() => console.log('Принудительный выход из аккаунта'));
    
    // Подписываемся на изменения состояния авторизации
    // onAuthStateChanged срабатывает сразу при подписке с текущим состоянием пользователя
    authManager.onAuthStateChanged((user) => {
      // Игнорируем повторные вызовы (только первый вызов)
      if (authStateResolved) {
        console.log('onAuthStateChanged вызван повторно, игнорируем');
        return;
      }
      authStateResolved = true;
      
      // Проверяем, авторизован ли пользователь
      // user будет null если пользователь не авторизован
      const isAuthorized = user !== null && user !== undefined;
      
      console.log('=== ПРОВЕРКА АВТОРИЗАЦИИ ===');
      console.log('user:', user);
      console.log('isAuthorized:', isAuthorized);
      
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
      
      // Вычисляем сколько времени прошло
      const elapsed = Date.now() - splashStartTime;
      const remainingTime = Math.max(0, minSplashTime - elapsed);
      
      console.log('Ожидаем', remainingTime, 'ms перед показом окна');
      
      // Ждем оставшееся время (минимум 2 секунды), затем скрываем splash и показываем нужное окно
      setTimeout(() => {
        if (isAuthorized) {
          console.log('>>> Показываем ОСНОВНОЕ ПРИЛОЖЕНИЕ (пользователь авторизован)');
          logger.info('Показываем основное приложение', { email: user.email }).catch(() => {});
          hideSplashAndShow(true);
        } else {
          console.log('>>> Показываем ОКНО АВТОРИЗАЦИИ (пользователь НЕ авторизован)');
          logger.info('Показываем окно авторизации').catch(() => {});
          hideSplashAndShow(false);
        }
      }, remainingTime);
    });
  } else {
    // Если authManager не инициализирован, просто показываем окно авторизации через 2 секунды
    console.log('authManager не инициализирован, показываем окно авторизации');
    setTimeout(() => {
      hideSplashAndShow(false);
    }, 2000);
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
      console.log('🔄 Нажата кнопка принудительного обновления');
      if (window.electronAPI && window.electronAPI.forceDownloadUpdate) {
        console.log('✅ Начинаем принудительную загрузку');
        // Меняем текст на "Обновляется..."
        if (ui.elements.updateStatusText) {
          ui.elements.updateStatusText.textContent = 'Обновляется...';
        }
        if (ui.elements.forceUpdateBtn) {
          ui.elements.forceUpdateBtn.style.display = 'none';
        }
        window.electronAPI.forceDownloadUpdate();
      } else {
        console.error('❌ electronAPI.forceDownloadUpdate недоступен');
      }
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
   * Показывает модальное окно создания комнаты
   */
  function showCreateRoomModal() {
    if (joined) {
      ui.showToast("Сначала выйдите из текущей комнаты");
      return;
    }

    // Генерируем ID комнаты
    generateUniqueRoomId(db, 8).then(roomId => {
      if (ui.elements.createRoomModal && ui.elements.roomIdDisplayInput) {
        ui.elements.roomIdDisplayInput.value = roomId;
        ui.elements.createRoomModal.classList.add('show');
        if (ui.elements.roomNameInput) {
          ui.elements.roomNameInput.value = '';
          ui.elements.roomNameInput.focus();
        }
        if (ui.elements.createRoomError) {
          ui.elements.createRoomError.textContent = '';
          ui.elements.createRoomError.style.display = 'none';
        }
      }
    }).catch(error => {
      console.error('Ошибка при генерации ID комнаты:', error);
      ui.showToast('Ошибка при создании комнаты');
    });
  }

  /**
   * Создает новую комнату с названием
   */
  async function createRoomWithName(roomId, roomName) {
    if (joinLock) return;
    if (joined) {
      return;
    }

    if (!roomName || !roomName.trim()) {
      if (ui.elements.createRoomError) {
        ui.elements.createRoomError.textContent = 'Введите название комнаты';
        ui.elements.createRoomError.style.display = 'block';
      }
      return;
    }

    joinLock = true;
    try {
      // Никнейм загружается из Firebase, проверяем что он установлен
      if (!myNick || myNick === CONSTANTS.DEFAULT_NICKNAME) {
        ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        joinLock = false;
        return;
      }

      const currentUser = authManager.getCurrentUser();
      if (!currentUser) {
        ui.showToast("Пользователь не авторизован");
        joinLock = false;
        return;
      }

      // Создаем комнату с названием и создателем
      console.log('Создание комнаты:', { roomId, roomName: roomName.trim(), creatorId: currentUser.uid });
      const createdRoomRef = await createRoomWithNameFirebase(db, roomId, roomName.trim(), currentUser.uid);
      console.log('Комната успешно создана в Firebase:', createdRoomRef.key);
      
      // Проверяем, что комната действительно создана
      const roomSnapshot = await createdRoomRef.once('value');
      if (roomSnapshot.exists()) {
        console.log('Подтверждение: комната существует в Firebase:', roomSnapshot.val());
        // Логируем создание комнаты
        await logger.logRoom('CREATE', 'Комната создана', {
          roomId: roomId,
          roomName: roomName.trim(),
          creatorId: currentUser.uid,
          creatorEmail: currentUser.email,
          createdAt: Date.now(),
          roomData: roomSnapshot.val()
        }).catch(() => {});
      } else {
        console.error('ОШИБКА: комната не найдена в Firebase после создания!');
        await logger.logRoom('CREATE', 'ОШИБКА: комната не найдена после создания', {
          roomId: roomId,
          roomName: roomName.trim(),
          creatorId: currentUser.uid,
          error: 'Room not found after creation'
        }).catch(() => {});
      }
      
      // Убеждаемся, что чат инициализирован
      if (!chat) {
        chat = new ChatManager(null, myNick, currentUser.uid, db);
        chat.initElements(
          ui.elements.chatMessages,
          ui.elements.chatInput,
          ui.elements.fileInput
        );
        chat.showEmptyState();
      }
      
      if (chat) {
        chat.myNickname = myNick;
      }

      // Инициализация микрофона
      const deviceId = devices.getSelectedMicId();
      await webrtc.initMicrophone(deviceId, muted);
      updateSpeechDetector(); // Обновляем детектор речи
      
      // Применяем сохраненные динамики
      const savedSpeakerId = devices.getSelectedSpeakerId();
      if (savedSpeakerId) {
        webrtc.applySpeakerSelection(savedSpeakerId);
      }

      roomRef = getRoomRef(db, roomId);
      console.log(`[JOIN ROOM] Setting roomRef to: ${roomRef.key}`);
      webrtc.roomRef = roomRef;
      if (chat) {
        chat.roomRef = roomRef;
      }

      // Проверяем, не создаем ли мы дубликат пользователя
      const existingUsers = await roomRef.child("users").once("value");
      const existingUsersData = existingUsers.val() || {};
      
      // Проверяем, нет ли уже пользователя с таким же ID
      if (myId && existingUsersData[myId]) {
        await roomRef.child("users").child(myId).remove().catch(() => {});
      }

      // Получаем Firebase userId для сохранения в комнате
      const currentUserForRoom = authManager.getCurrentUser();
      const firebaseUserId = currentUserForRoom ? currentUserForRoom.uid : null;
      
      console.log('🔵 Создание записи пользователя в комнате:', { 
        roomId, 
        myNick, 
        muted, 
        firebaseUserId,
        currentUser: currentUserForRoom
      });
      
      if (!firebaseUserId) {
        console.warn('⚠️ ВНИМАНИЕ: Firebase userId не найден! Это может помешать добавлению в друзья через ПКМ.');
      }
      
      try {
        const speakerMuted = webrtc.speakerMuted || false;
        myUserRef = createUserInRoom(roomRef, myNick, muted, firebaseUserId, speakerMuted);
        myId = myUserRef.key;
        webrtc.myId = myId;
        speechDetector.setMyId(myId);
        console.log('✅ Пользователь добавлен в комнату:', { 
          pushId: myId, 
          firebaseUserId: firebaseUserId,
          nickname: myNick 
        });
      } catch (userError) {
        console.error('❌ Ошибка при добавлении пользователя в комнату:', userError);
        console.error('Детали ошибки:', {
          code: userError.code,
          message: userError.message,
          stack: userError.stack
        });
        ui.showToast('Ошибка при создании комнаты: ' + (userError.message || 'Неизвестная ошибка'));
        joinLock = false;
        throw userError;
      }

      // Настраиваем onDisconnect с задержкой - пользователь удаляется только если
      // соединение не восстановилось в течение 30 секунд
      // Это дает время на автоматическое переподключение
      myUserRef.onDisconnect().remove();

      joined = true;
      intentionalLeave = false;
      reconnectAttempts = 0; // Сбрасываем счетчик при успешном подключении
      
      // Устанавливаем текущую комнату
      currentRoomId = roomId;
      console.log('✅ Установлен currentRoomId при создании комнаты:', roomId, 'joined:', joined);
      
      ui.updateJoinButton(true);
      if (chat) {
      chat.clear();
      }
      clearRoomMessages(roomRef);
      
      // Показываем панель участников
      if (ui.elements.usersPanel) {
        ui.elements.usersPanel.style.display = 'flex';
      }
      
      // Обновляем отображение ID комнаты
      ui.updateRoomId(roomId);
      
      // Переинициализируем мониторинг подключения
      if (connectionManager) {
        connectionManager.cleanup();
        connectionManager.init();
      }

      // Обновляем счетчик участников
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        ui.updateUsersCount(count);
        previousUsersCount = count;
        
        // АВТООЧИСТКА: Если мы единственный пользователь - очищаем старую доску
        if (count === 1) {
          console.log(`[AUTO-CLEAR] Room was empty, clearing old whiteboard data`);
          roomRef.child('whiteboard/strokes').remove().then(() => {
            console.log(`[AUTO-CLEAR] Old whiteboard data cleared successfully`);
          }).catch(err => {
            console.error(`[AUTO-CLEAR] Error clearing old data:`, err);
          });
        }
      });

      setupListeners();
      playNotificationSound('join');
      ui.showToast(`Комната "${roomName}" создана`);
      
      // Обновляем список комнат после создания
      // Используем небольшую задержку, чтобы дать Firebase время сохранить данные
      setTimeout(() => {
        // Слушатель должен обновить автоматически, но на всякий случай вызываем явно
        // Используем force = false, чтобы не создавать дубликаты логов
        loadRoomsList(false).catch(err => console.error('Ошибка при обновлении списка комнат:', err));
      }, 300);

      // Закрываем модальное окно
      if (ui.elements.createRoomModal) {
        ui.elements.createRoomModal.classList.remove('show');
      }

      // Список комнат обновляется автоматически через слушатель

    } catch (err) {
      console.error('❌ ОШИБКА при создании комнаты:', err);
      console.error('Детали ошибки:', {
        code: err.code,
        message: err.message,
        stack: err.stack,
        roomId: roomId,
        roomName: roomName
      });
      
      // Показываем более подробное сообщение об ошибке
      let errorMessage = "Ошибка при создании комнаты";
      if (err.code) {
        errorMessage += ` (${err.code})`;
      }
      if (err.message) {
        errorMessage += `: ${err.message}`;
      }
      ui.showToast(errorMessage, 5000, 'error');
      
      if (ui.elements.createRoomError) {
        ui.elements.createRoomError.textContent = errorMessage;
        ui.elements.createRoomError.style.display = 'block';
      }
    } finally {
      joinLock = false;
    }
  }

  /**
   * Присоединяется к существующей комнате по ID
   */
  async function findAndJoinRoom(roomId) {
    if (joinLock) return;
    // Если уже в комнате, просто выходим (не переподключаемся!)
    if (joined) {
      return; // Просто выходим, не переподключаемся
    }
    joinLock = true;
    try {
      if (!roomId || !roomId.trim()) {
        ui.showToast("Введите Room ID");
        joinLock = false;
        return;
      }

      roomId = roomId.trim();

      // Никнейм загружается из Firebase, проверяем что он установлен
      if (!myNick || myNick === CONSTANTS.DEFAULT_NICKNAME) {
        ui.showToast("Никнейм не загружен. Перезайдите в аккаунт.");
        joinLock = false;
        return;
      }

      // Проверяем существование комнаты
      const exists = await roomExists(db, roomId);
      if (!exists) {
        ui.showToast("Комната не существует");
        joinLock = false;
        return;
      }

      // Убеждаемся, что чат инициализирован перед присоединением к комнате
      if (!chat && authManager) {
        const currentUser = authManager.getCurrentUser();
        if (currentUser) {
          chat = new ChatManager(null, myNick, currentUser.uid, db);
          chat.initElements(
            ui.elements.chatMessages,
            ui.elements.chatInput,
            ui.elements.fileInput
          );
          chat.showEmptyState();
        }
      }
      
      // Никнейм уже загружен из Firebase
      if (chat) {
        chat.myNickname = myNick;
      }

      // Инициализация микрофона
      const deviceId = devices.getSelectedMicId();
      await webrtc.initMicrophone(deviceId, muted);
      updateSpeechDetector(); // Обновляем детектор речи
      
      // Применяем сохраненные динамики
      const savedSpeakerId = devices.getSelectedSpeakerId();
      if (savedSpeakerId) {
        webrtc.applySpeakerSelection(savedSpeakerId);
      }

      roomRef = getRoomRef(db, roomId);
      console.log(`[JOIN ROOM] Setting roomRef to: ${roomRef.key}`);
      webrtc.roomRef = roomRef;
      if (chat) {
      chat.roomRef = roomRef;
      }
      webrtc.myId = myId;

      // Проверка лимита пользователей
      const usersSnap = await roomRef.child("users").once("value");
      const existingUsersDataForJoin = usersSnap.val() || {};
      
      // Проверяем, нет ли уже пользователя с таким же ID (если мы уже были в комнате)
      if (myId && existingUsersDataForJoin[myId]) {
        // Удаляем старую запись перед созданием новой
        await roomRef.child("users").child(myId).remove().catch(() => {});
      }
      
      // Пересчитываем количество пользователей после удаления дубликата
      const usersAfterCleanup = await roomRef.child("users").once("value");
      if (usersAfterCleanup.numChildren() >= CONSTANTS.MAX_USERS) {
        ui.showToast(`Комната заполнена (макс ${CONSTANTS.MAX_USERS} участников)`);
        joinLock = false;
        return;
      }

      // Получаем Firebase userId для сохранения в комнате
      const currentUserForJoin = authManager.getCurrentUser();
      const firebaseUserIdJoin = currentUserForJoin ? currentUserForJoin.uid : null;
      
      console.log('🔵 Присоединение к комнате - создание записи пользователя:', {
        roomId,
        myNick,
        muted,
        firebaseUserId: firebaseUserIdJoin
      });
      
      if (!firebaseUserIdJoin) {
        console.warn('⚠️ ВНИМАНИЕ: Firebase userId не найден при присоединении к комнате!');
      }
      
      const speakerMuted = webrtc.speakerMuted || false;
      myUserRef = createUserInRoom(roomRef, myNick, muted, firebaseUserIdJoin, speakerMuted);
      myId = myUserRef.key;
      webrtc.myId = myId;
      speechDetector.setMyId(myId);
      
      console.log('✅ Пользователь добавлен в комнату (присоединение):', {
        pushId: myId,
        firebaseUserId: firebaseUserIdJoin,
        nickname: myNick
      });

      // Настраиваем onDisconnect с задержкой - пользователь удаляется только если
      // соединение не восстановилось в течение 30 секунд
      // Это дает время на автоматическое переподключение
      myUserRef.onDisconnect().remove();
      // Комната больше не удаляется автоматически при выходе всех пользователей

      joined = true;
      intentionalLeave = false; // Сбрасываем флаг при успешном подключении
      reconnectAttempts = 0; // Сбрасываем счетчик при успешном подключении
      
      // Устанавливаем текущую комнату
      currentRoomId = roomId;
      console.log('✅ Установлен currentRoomId при входе в комнату:', roomId, 'joined:', joined);
      
      // Логируем вход в комнату
      const currentUser = authManager.getCurrentUser();
      if (currentUser) {
        const roomInfo = await getRoomInfo(db, roomId).catch(() => null);
        await logger.logRoom('ENTER', 'Вход в комнату', {
          roomId: roomId,
          roomName: roomInfo?.name || 'Неизвестно',
          userId: currentUser.uid,
          userEmail: currentUser.email,
          userNickname: myNick,
          timestamp: Date.now()
        }).catch(() => {});
      }
      
      ui.updateJoinButton(true);
      if (chat) {
      chat.clear();
      }
      
      // Показываем панель участников
      if (ui.elements.usersPanel) {
        ui.elements.usersPanel.style.display = 'flex';
      }
      
      // Обновляем отображение ID комнаты
      ui.updateRoomId(roomId);
      
      // Переинициализируем мониторинг подключения при подключении к комнате
      if (connectionManager) {
        connectionManager.cleanup();
        connectionManager.init();
      }

      // Удаляем старые сообщения и очищаем доску если комната была пуста
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        ui.updateUsersCount(count);
        previousUsersCount = count;
        
        if (count === 1) {
          clearRoomMessages(roomRef);
          
          // АВТООЧИСТКА: Очищаем старую доску
          console.log(`[AUTO-CLEAR] Room was empty, clearing old whiteboard data`);
          roomRef.child('whiteboard/strokes').remove().then(() => {
            console.log(`[AUTO-CLEAR] Old whiteboard data cleared successfully`);
          }).catch(err => {
            console.error(`[AUTO-CLEAR] Error clearing old data:`, err);
          });
        }
      });
      
      // Обновляем список комнат после входа
      // Используем небольшую задержку, чтобы дать Firebase время обновить данные
      setTimeout(() => {
        // Слушатель должен обновить автоматически, но на всякий случай вызываем явно
        // Используем force = false, чтобы не создавать дубликаты логов
        loadRoomsList(false).catch(err => console.error('Ошибка при обновлении списка комнат:', err));
      }, 300);

      // Счетчик участников
      roomRef.child("users").once("value").then(snap => {
        const count = snap.numChildren();
        ui.updateUsersCount(count);
        previousUsersCount = count;
      });

      setupListeners();

      // Создаем соединения с существующими участниками
      usersSnap.forEach(child => {
        const otherId = child.key;
        if (otherId !== myId) {
          webrtc.createPeer(otherId, true);
        }
      });

      playNotificationSound('join');

    } catch (err) {
      console.error(err);
      ui.showToast("Ошибка при присоединении к комнате");
    } finally {
      joinLock = false;
    }
  }

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
   * Покидает комнату
   */
  async function leaveRoom() {
    if (!joined) return;
    
    // Устанавливаем флаг намеренного выхода СРАЗУ, до любых других операций
    intentionalLeave = true;
    reconnectAttempts = 0; // Сбрасываем счетчик попыток
    
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
    // чтобы избежать срабатывания переподключения
    if (currentRoomRef) {
      currentRoomRef.child("users").off();
      currentRoomRef.child("signals").off();
      currentRoomRef.child("messages").off();
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
    
    // Сбрасываем текущую комнату
    currentRoomId = null;

    // Никнейм больше не изменяется пользователем
    
    // Обновляем список комнат
    await loadRoomsList();

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

    // Отключаем старые слушатели перед созданием новых
    roomRef.child("users").off();
    roomRef.child("signals").off();
    roomRef.child("messages").off();

    // Слушатель пользователей с debounce для предотвращения лагов
    roomRef.child("users").on("value", snap => {
      // Debounce для предотвращения множественных обновлений
      if (usersUpdateTimeout) {
        clearTimeout(usersUpdateTimeout);
      }
      
      usersUpdateTimeout = setTimeout(() => {
        const users = snap.val() || {};
        const currentUsersCount = Object.keys(users).length;

      // Обновляем счетчик участников
      if (joined) {
        ui.updateUsersCount(currentUsersCount);
      }

      // Обновляем список комнат при изменении количества участников
      // Это обновит количество участников в карточке комнаты
      if (joined && previousUsersCount !== currentUsersCount) {
        // Список комнат обновляется автоматически через слушатель комнат
        // Не вызываем loadRoomsList здесь, чтобы избежать дублирования
        // Слушатель комнат автоматически обновит список при изменении количества пользователей
      }

      // Звуки при изменении количества участников
      if (joined && previousUsersCount > 0 && previousUsersCount !== currentUsersCount) {
        const isMeInRoom = myId && users[myId];
        if (isMeInRoom) {
          if (currentUsersCount > previousUsersCount) {
            playNotificationSound('join');
          } else if (currentUsersCount < previousUsersCount) {
            playNotificationSound('leave');
          }
        }
        previousUsersCount = currentUsersCount;
      }

      // Обновляем состояния muted в детекторе речи
      speechDetector.updateUserMutedStates(users);

      usersManager.updateUsersList(users, (userId, volume) => {
        webrtc.setUserVolume(userId, volume);
      }, myId); // Передаем myId, чтобы скрыть кнопку "Добавить в друзья" для самого себя

      if (joined) {
        const count = Object.keys(users).length;
        ui.updateUsersCount(count);
        previousUsersCount = count;

        // Комната больше не удаляется автоматически при выходе всех пользователей
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
      }, 300); // Debounce 300ms для предотвращения лагов
    });

    // Слушатель сигналов WebRTC
    roomRef.child("signals").on("child_added", snap => {
      const data = snap.val();
      if (!data || data.to !== myId) return;
      webrtc.handleSignal(data);
      snap.ref.remove().catch(() => {});
    });

    // Слушатель сообщений
    roomRef.child("messages").on("child_added", snap => {
      const message = snap.val();
      if (message && chat) {
        // displayMessage теперь асинхронная
        chat.displayMessage(message).catch(error => {
          console.error('Ошибка при отображении сообщения:', error);
        });
      }
    });
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
    ui.elements.createRoomBtn.addEventListener("click", showCreateRoomModal);
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
      const roomId = ui.elements.roomIdDisplayInput.value.trim();
      const roomName = ui.elements.roomNameInput.value.trim();
      
      if (!roomName) {
        if (ui.elements.createRoomError) {
          ui.elements.createRoomError.textContent = 'Введите название комнаты';
          ui.elements.createRoomError.style.display = 'block';
        }
        return;
      }

      await createRoomWithName(roomId, roomName);
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
      if (ui.elements.findRoomModal) {
        ui.elements.findRoomModal.classList.add('show');
        if (ui.elements.roomIdInput) {
          ui.elements.roomIdInput.value = '';
          ui.elements.roomIdInput.focus();
        }
        if (ui.elements.findRoomError) {
          ui.elements.findRoomError.textContent = '';
          ui.elements.findRoomError.style.display = 'none';
        }
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
      const roomId = ui.elements.roomIdInput.value.trim();
      
      if (!roomId) {
        if (ui.elements.findRoomError) {
          ui.elements.findRoomError.textContent = 'Введите ID комнаты';
          ui.elements.findRoomError.style.display = 'block';
        }
        return;
      }

      try {
        // Закрываем модальное окно
        if (ui.elements.findRoomModal) {
          ui.elements.findRoomModal.classList.remove('show');
        }

        // Входим в комнату
        await findAndJoinRoom(roomId);
      } catch (error) {
        console.error('Ошибка при поиске комнаты:', error);
        if (ui.elements.findRoomError) {
          ui.elements.findRoomError.textContent = 'Ошибка при подключении к комнате';
          ui.elements.findRoomError.style.display = 'block';
        }
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

  // 🚀 ОПТИМИЗИРОВАННАЯ функция загрузки списка комнат с кэшированием
  async function loadRoomsList(force = false) {
    try {
      console.log('=== НАЧАЛО ЗАГРУЗКИ КОМНАТ ===');
      
      if (!db) {
        console.error('❌ База данных не инициализирована!');
        throw new Error('База данных не инициализирована');
      }
      
      const currentUser = authManager?.getCurrentUser();
      if (!currentUser) {
        console.error('❌ Пользователь не авторизован!');
        throw new Error('Пользователь не авторизован');
      }
      
      console.log('✅ Пользователь авторизован:', currentUser.uid);
      
      // 🚀 ОПТИМИЗАЦИЯ: Используем кэш, если force=false
      let allRooms;
      if (force) {
        console.log('🔄 Принудительная загрузка (force=true), игнорируем кэш');
        roomsCache.invalidate();
      }
      
      // Загружаем данные через кэш
      allRooms = await roomsCache.get(async () => {
        console.log('📡 Запрос к Firebase: db.ref("rooms").once("value")...');
        const snapshot = await db.ref("rooms").once('value');
        return snapshot.val() || {};
      });
      
      const allRoomsCount = Object.keys(allRooms).length;
      
      console.log(`✅ Получено комнат из Firebase: ${allRoomsCount}`);
      
      // Фильтруем комнаты: показываем только те, где пользователь создатель ИЛИ участник
      const filteredRooms = {};
      const currentUserId = currentUser.uid;
      
      Object.entries(allRooms).forEach(([roomId, roomData]) => {
        const isCreator = roomData?.creatorId === currentUserId;
        
        // Проверяем, является ли пользователь участником комнаты
        let isParticipant = false;
        if (roomData?.users) {
          const users = roomData.users;
          isParticipant = Object.values(users).some(user => user.userId === currentUserId);
        }
        
        // Показываем комнату, если пользователь создатель или участник
        if (isCreator || isParticipant) {
          filteredRooms[roomId] = roomData;
          console.log(`  ✅ ${roomId}: "${roomData?.name || 'БЕЗ ИМЕНИ'}" (создатель: ${isCreator ? 'ДА' : 'НЕТ'}, участник: ${isParticipant ? 'ДА' : 'НЕТ'})`);
        } else {
          console.log(`  ❌ ${roomId}: "${roomData?.name || 'БЕЗ ИМЕНИ'}" - пропущена (пользователь не создатель и не участник)`);
        }
      });
      
      const rooms = filteredRooms;
      const roomsCount = Object.keys(rooms).length;
      
      console.log(`📊 После фильтрации: ${roomsCount} комнат из ${allRoomsCount}`);
      
      if (roomsCount === 0 && allRoomsCount > 0) {
        console.log('⚠️ После фильтрации комнаты не найдены - пользователь не является создателем или участником ни одной комнаты');
      }
      
      // Логируем
      if (force) {
        await logger.logRoom('LOAD', 'Загрузка списка комнат при входе в приложение', {
          userId: currentUser.uid,
          userEmail: currentUser.email,
          allRoomsCount: allRoomsCount,
          filteredRoomsCount: roomsCount,
          rooms: Object.keys(rooms).map(roomId => ({
            roomId: roomId,
            name: rooms[roomId]?.name,
            creatorId: rooms[roomId]?.creatorId,
            usersCount: rooms[roomId]?.users ? Object.keys(rooms[roomId].users).length : 0
          }))
        }).catch(() => {});
      }
      
      // Инициализируем UI элементы ПЕРЕД рендерингом
      if (ui.initElements && typeof ui.initElements === 'function') {
        ui.initElements();
      }
      
      // Убеждаемся, что элементы существуют
      let roomsListEl = ui.elements?.roomsList || document.getElementById('roomsList') || document.querySelector('.rooms-list');
      const roomsEmptyEl = ui.elements?.roomsEmpty || document.getElementById('roomsEmpty') || document.querySelector('.rooms-empty');
      
      // Если элемент не найден, пробуем еще раз
      if (!roomsListEl) {
        console.warn('⚠️ Элемент roomsList не найден сразу, ждем 100ms...');
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Переинициализируем элементы
        if (ui.initElements && typeof ui.initElements === 'function') {
          ui.initElements();
        }
        
        roomsListEl = ui.elements?.roomsList || document.getElementById('roomsList') || document.querySelector('.rooms-list');
      }
      
      if (!roomsListEl) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Элемент roomsList не найден!');
        console.error('Попытка найти элемент через DOM...');
        // Последняя попытка через 500ms
        setTimeout(() => {
          const retryEl = document.getElementById('roomsList') || document.querySelector('.rooms-list');
          if (retryEl) {
            console.log('✅ Элемент найден при повторной попытке');
            if (!ui.elements) ui.elements = {};
            ui.elements.roomsList = retryEl;
            renderRoomsList(rooms);
          } else {
            console.error('❌ Элемент все еще не найден! Проверьте HTML структуру.');
          }
        }, 500);
        return;
      }
      
      // ОТОБРАЖАЕМ КОМНАТЫ НЕМЕДЛЕННО
      console.log(`✅ Отображение ${roomsCount} комнат...`);
      console.log('🔵 Данные комнат перед рендерингом:', JSON.stringify(rooms, null, 2));
      
      // Принудительно скрываем пустое состояние перед рендерингом
      if (roomsCount > 0 && roomsEmptyEl) {
        console.log('🔵 Скрываем пустое состояние перед рендерингом');
        roomsEmptyEl.style.display = 'none';
      }
      
      // Рендерим комнаты
      renderRoomsList(rooms);
      
      // Проверяем результат через небольшую задержку
      setTimeout(() => {
        const renderedCount = roomsListEl ? roomsListEl.children.length : 0;
        console.log(`🔵 Проверка после рендеринга: отрендерено ${renderedCount} комнат из ${roomsCount}`);
        
        if (renderedCount === 0 && roomsCount > 0) {
          console.error('❌ ПРОБЛЕМА: Комнаты не отрендерились! Повторная попытка через 300ms...');
          // Принудительно скрываем пустое состояние
          if (roomsEmptyEl) {
            roomsEmptyEl.style.display = 'none';
          }
          // Переинициализируем элементы перед повторным рендерингом
          if (ui.initElements && typeof ui.initElements === 'function') {
            ui.initElements();
          }
          setTimeout(() => {
            renderRoomsList(rooms);
            const retryRenderedCount = roomsListEl ? roomsListEl.children.length : 0;
            console.log(`🔵 Повторная проверка: отрендерено ${retryRenderedCount} комнат`);
          }, 300);
        } else if (renderedCount > 0) {
          console.log(`✅ Успешно отрендерено ${renderedCount} комнат!`);
          // Убеждаемся, что пустое состояние скрыто
          if (roomsEmptyEl) {
            roomsEmptyEl.style.display = 'none';
          }
        }
      }, 300);
      
      console.log('=== ЗАГРУЗКА КОМНАТ ЗАВЕРШЕНА ===');
      
    } catch (error) {
      console.error('❌ ОШИБКА при загрузке комнат:', error);
      console.error('Детали:', error.message, error.stack);
      renderRoomsList({});
      throw error; // Пробрасываем ошибку для обработчика кнопки
    }
  }
  
  // Старый механизм автоматических кликов удален - теперь используем прямой вызов loadRoomsList()

  function renderRoomsList(rooms) {
    const roomsCount = Object.keys(rooms || {}).length;
    console.log('🔵 renderRoomsList вызвана, комнат:', roomsCount);
    console.log('🔵 Данные комнат для рендеринга:', rooms);
    
    // Принудительная инициализация элементов UI перед использованием
    if (ui.initElements && typeof ui.initElements === 'function') {
      console.log('🔵 Инициализируем элементы UI перед рендерингом...');
      ui.initElements();
    }
    
    if (!ui.elements || !ui.elements.roomsList || !ui.elements.roomsEmpty) {
      console.warn('⚠️ Элементы списка комнат не найдены:', {
        uiElements: !!ui.elements,
        roomsList: !!ui.elements?.roomsList,
        roomsEmpty: !!ui.elements?.roomsEmpty
      });
      
      // Пытаемся найти элементы напрямую
      const roomsListDirect = document.getElementById('roomsList') || document.querySelector('.rooms-list');
      const roomsEmptyDirect = document.getElementById('roomsEmpty') || document.querySelector('.rooms-empty');
      
      if (roomsListDirect && roomsEmptyDirect) {
        console.log('✅ Элементы найдены напрямую через DOM, используем их');
        if (!ui.elements) ui.elements = {};
        ui.elements.roomsList = roomsListDirect;
        ui.elements.roomsEmpty = roomsEmptyDirect;
      } else {
        console.error('❌ Элементы не найдены даже напрямую, повторная попытка через 200ms...');
        // Повторная попытка через небольшую задержку
        setTimeout(() => {
          if (ui.initElements) {
            ui.initElements();
          }
          const retryRoomsList = document.getElementById('roomsList') || document.querySelector('.rooms-list');
          const retryRoomsEmpty = document.getElementById('roomsEmpty') || document.querySelector('.rooms-empty');
          if (retryRoomsList && retryRoomsEmpty) {
            if (!ui.elements) ui.elements = {};
            ui.elements.roomsList = retryRoomsList;
            ui.elements.roomsEmpty = retryRoomsEmpty;
            renderRoomsList(rooms);
          } else {
            console.error('❌ Элементы все еще не найдены после повторной попытки');
          }
        }, 200);
        return;
      }
    }
    
    console.log('Элементы UI найдены, начинаем рендеринг списка комнат');

    const roomsArray = Object.entries(rooms || {}).map(([roomId, roomData]) => {
      const usersCount = roomData.users ? Object.keys(roomData.users).length : 0;
      console.log(`Комната ${roomId}: ${usersCount} участников`);
      return {
        id: roomId,
        name: roomData.name || 'Без названия',
        creatorId: roomData.creatorId,
        usersCount: usersCount
      };
    });

    console.log('Массив комнат для отображения:', roomsArray.length);

    if (roomsArray.length === 0) {
      console.log('Нет комнат для отображения, показываем пустое состояние');
      ui.elements.roomsList.innerHTML = '';
      // Показываем пустое состояние по центру контейнера
      if (ui.elements.roomsEmpty) {
        ui.elements.roomsEmpty.style.display = 'flex';
      }
      return;
    }
    
    // 🔧 FIX: Скрываем пустое состояние один раз (было дублирование)
    if (ui.elements.roomsEmpty) {
      ui.elements.roomsEmpty.style.display = 'none';
      console.log('🔵 Пустое состояние скрыто (есть комнаты для отображения)');
    }

    console.log('Очищаем список и отображаем', roomsArray.length, 'комнат');
    
    // Используем DocumentFragment для оптимизации DOM операций
    const fragment = document.createDocumentFragment();

    let renderedCount = 0;
    roomsArray.forEach((room, index) => {
      console.log(`🔵 Рендеринг комнаты ${index + 1}/${roomsArray.length}: ${room.id} (${room.name})`);
      
      const roomCard = document.createElement('div');
      roomCard.className = 'room-card';
      roomCard.dataset.roomId = room.id;
      if (currentRoomId === room.id) {
        roomCard.classList.add('active');
      }

      roomCard.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-name">${escapeHtml(room.name)}</div>
          <div class="room-card-users">${room.usersCount}</div>
        </div>
      `;

      // Обработчик клика для входа в комнату
      roomCard.addEventListener('click', async (e) => {
        if (e.button === 0) { // Левый клик
          if (room.id !== currentRoomId) {
            await findAndJoinRoom(room.id);
          }
        }
      });

      // Обработчик правого клика для контекстного меню
      roomCard.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showRoomContextMenu(e, room.id, room.creatorId);
      });

      try {
        fragment.appendChild(roomCard);
        renderedCount++;
        console.log(`✅ Комната ${room.id} добавлена в fragment (${renderedCount}/${roomsArray.length})`);
      } catch (appendError) {
        console.error(`❌ Ошибка при добавлении комнаты ${room.id} в fragment:`, appendError);
      }
    });
    
    // Добавляем все комнаты одной операцией для оптимизации DOM
    ui.elements.roomsList.innerHTML = '';
    ui.elements.roomsList.appendChild(fragment);
    
    console.log('✅ Список комнат отрендерен, добавлено карточек:', renderedCount, 'из', roomsArray.length);
    console.log('🔵 Элемент roomsList содержит детей:', ui.elements.roomsList.children.length);
    console.log('🔵 Элемент roomsList видим:', {
      display: window.getComputedStyle(ui.elements.roomsList).display,
      visibility: window.getComputedStyle(ui.elements.roomsList).visibility,
      opacity: window.getComputedStyle(ui.elements.roomsList).opacity,
      height: window.getComputedStyle(ui.elements.roomsList).height,
      width: window.getComputedStyle(ui.elements.roomsList).width
    });
    
    // Финальная проверка: если комнаты не отрендерились, попробуем еще раз
    if (renderedCount === 0 && roomsArray.length > 0) {
      console.error('❌ КРИТИЧЕСКАЯ ПРОБЛЕМА: Комнаты не отрендерились!');
      console.error('Попытка повторного рендеринга через 300ms...');
      setTimeout(() => {
        console.log('🔄 Повторный рендеринг списка комнат...');
        renderRoomsList(rooms);
      }, 300);
    }
    
    // Убеждаемся, что контейнер комнат виден
    const roomsContent = document.getElementById('roomsContent');
    if (roomsContent) {
      const computedStyle = window.getComputedStyle(roomsContent);
      console.log('roomsContent найден, стили:', {
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity,
        hasActiveClass: roomsContent.classList.contains('active')
      });
      
      // НЕ переключаем вкладки автоматически - пользователь может быть на вкладке "Друзья"
      // Список комнат обновляется в фоне, но вкладка остается той, которую выбрал пользователь
    } else {
      console.warn('⚠️ roomsContent элемент не найден!');
    }
  }

  function showRoomContextMenu(e, roomId, creatorId) {
    if (!ui.elements.roomContextMenu) {
      console.warn('roomContextMenu элемент не найден');
      return;
    }

    const currentUser = authManager.getCurrentUser();
    if (!currentUser) {
      console.warn('Пользователь не авторизован');
      return;
    }

    console.log('showRoomContextMenu вызвана:', {
      roomId,
      creatorId,
      currentUserUid: currentUser.uid,
      joined,
      currentRoomId
    });

    // Показываем кнопку удаления только для создателя
    if (ui.elements.roomContextDelete) {
      if (creatorId === currentUser.uid) {
        ui.elements.roomContextDelete.style.display = 'block';
        console.log('Кнопка удаления показана (создатель комнаты)');
      } else {
        ui.elements.roomContextDelete.style.display = 'none';
        console.log('Кнопка удаления скрыта (не создатель)');
      }
    } else {
      console.warn('roomContextDelete элемент не найден');
    }

    // Показываем кнопку выхода только если пользователь в этой комнате
    if (ui.elements.roomContextLeave) {
      console.log('Проверка кнопки выхода:', {
        joined: joined,
        currentRoomId: currentRoomId,
        roomId: roomId,
        условие: joined && currentRoomId && currentRoomId === roomId
      });
      
      if (joined && currentRoomId && currentRoomId === roomId) {
        ui.elements.roomContextLeave.style.display = 'block';
        console.log('✅ Кнопка выхода ПОКАЗАНА для комнаты:', roomId);
      } else {
        ui.elements.roomContextLeave.style.display = 'none';
        console.log('❌ Кнопка выхода СКРЫТА:', {
          причина: !joined ? 'не подключен' : 
                   !currentRoomId ? 'нет currentRoomId' : 
                   currentRoomId !== roomId ? 'не эта комната' : 'неизвестно'
        });
      }
    } else {
      console.error('❌ roomContextLeave элемент НЕ НАЙДЕН в DOM!');
    }

    // Позиционируем меню
    ui.elements.roomContextMenu.style.display = 'block';
    ui.elements.roomContextMenu.style.left = e.pageX + 'px';
    ui.elements.roomContextMenu.style.top = e.pageY + 'px';
    ui.elements.roomContextMenu.dataset.roomId = roomId;
    console.log('Контекстное меню показано в позиции:', { x: e.pageX, y: e.pageY });

    // Закрываем меню при клике вне его
    const closeMenu = (event) => {
      if (ui.elements.roomContextMenu && !ui.elements.roomContextMenu.contains(event.target)) {
        ui.elements.roomContextMenu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  // escapeHtml перенесена в utils/security.js

  // 🚀 ОПТИМИЗИРОВАННЫЙ слушатель комнат с менеджером подписок
  function startRoomsListener() {
    if (!db) {
      console.error('База данных не инициализирована для слушателя комнат');
      return;
    }
    
    // Проверяем, что пользователь авторизован перед установкой слушателя
    const currentUser = authManager?.getCurrentUser();
    if (!currentUser) {
      console.warn('⚠️ Пользователь не авторизован, слушатель комнат не запущен');
      return;
    }
    
    // 🚀 ОПТИМИЗАЦИЯ: Используем менеджер слушателей для предотвращения дубликатов
    if (listenersManager.has('rooms')) {
      console.warn('⚠️ Слушатель комнат уже зарегистрирован, пропускаем');
      return;
    }

    console.log('🔵 Запуск слушателя комнат в реальном времени');
    
    const roomsRef = db.ref("rooms");
    let isFirstListenerEvent = true; // Флаг первого события слушателя
    
    // Debounce для обновления списка (не чаще раза в секунду)
    const scheduleUpdate = (roomId = null, roomData = null, action = 'update') => {
      // 🚀 ОПТИМИЗАЦИЯ: Обновляем кэш напрямую для мгновенного отклика
      if (roomId && action === 'remove') {
        roomsCache.updateRoom(roomId, null);
      } else if (roomId && roomData) {
        roomsCache.updateRoom(roomId, roomData);
      } else {
        // Если нет конкретной комнаты, инвалидируем весь кэш
        roomsCache.invalidate();
      }
      
      if (roomsUpdateTimeout) return; // Уже запланировано
      roomsUpdateTimeout = setTimeout(() => {
        roomsUpdateTimeout = null;
        loadRoomsList(); // Перезагружаем список (будет использован кэш)
      }, 1000); // 1 секунда debounce
    };
    
    // Callback'и для событий
    const onChildAdded = (snap) => {
      if (isInitialLoad || (isFirstListenerEvent && roomsListInitialized)) {
        isFirstListenerEvent = false;
        return;
      }
      isFirstListenerEvent = false;
      
      const roomId = snap.key;
      const roomData = snap.val();
      console.log('🔵 [LISTENER] Новая комната добавлена:', roomId);
      scheduleUpdate(roomId, roomData, 'add');
    };
    
    const onChildChanged = (snap) => {
      if (isInitialLoad) return;
      const roomId = snap.key;
      const roomData = snap.val();
      console.log('🔵 [LISTENER] Комната изменена:', roomId);
      scheduleUpdate(roomId, roomData, 'change');
    };
    
    const onChildRemoved = (snap) => {
      if (isInitialLoad) return;
      const roomId = snap.key;
      console.log('🔵 [LISTENER] Комната удалена:', roomId);
      scheduleUpdate(roomId, null, 'remove');
    };
    
    // 🚀 ОПТИМИЗАЦИЯ: Регистрируем все события через менеджер
    listenersManager.registerMultiple('rooms', roomsRef, [
      { event: 'child_added', callback: onChildAdded },
      { event: 'child_changed', callback: onChildChanged },
      { event: 'child_removed', callback: onChildRemoved }
    ]);
    
    console.log('✅ Слушатели комнат запущены через менеджер');
  }

  function stopRoomsListener() {
    // 🚀 ОПТИМИЗАЦИЯ: Используем менеджер для отписки
    if (listenersManager.has('rooms')) {
      listenersManager.unregister('rooms');
      console.log('✅ Слушатель комнат остановлен');
    }
  }
  
  // АВТОМАТИЧЕСКАЯ ЗАГРУЗКА КОМНАТ ПРИ ИНИЦИАЛИЗАЦИИ ПРИЛОЖЕНИЯ
  // Вызываем загрузку комнат сразу после определения всех функций
  // Используем проверку состояния приложения через небольшие интервалы
  let autoLoadRoomsInterval = null;
  let autoLoadRoomsAttempts = 0;
  const MAX_AUTO_LOAD_ATTEMPTS = 30; // 30 попыток = 15 секунд максимум
  
  const tryAutoLoadRooms = async () => {
    autoLoadRoomsAttempts++;
    
    // Если комнаты уже загружены, останавливаем попытки
    if (roomsListInitialized) {
      console.log('✅ Комнаты уже загружены, останавливаем автоматическую загрузку');
      if (autoLoadRoomsInterval) {
        clearInterval(autoLoadRoomsInterval);
        autoLoadRoomsInterval = null;
      }
      return;
    }
    
    // Проверяем, что пользователь авторизован
    const currentUser = authManager?.getCurrentUser();
    if (!currentUser) {
      if (autoLoadRoomsAttempts < MAX_AUTO_LOAD_ATTEMPTS) {
        // Тихо ждем авторизации без лишних логов
        return;
      } else {
        // Пользователь просто еще не авторизовался - это нормально
        if (autoLoadRoomsInterval) {
          clearInterval(autoLoadRoomsInterval);
          autoLoadRoomsInterval = null;
        }
        return;
      }
    }
    
    // Проверяем, что приложение показано
    const appContent = document.getElementById('appContent');
    if (!appContent || appContent.style.display === 'none') {
      if (autoLoadRoomsAttempts < MAX_AUTO_LOAD_ATTEMPTS) {
        console.log(`⏳ Ожидание инициализации приложения... (попытка ${autoLoadRoomsAttempts}/${MAX_AUTO_LOAD_ATTEMPTS})`);
        return;
      } else {
        console.warn('⚠️ Приложение не инициализировано после всех попыток, останавливаем автоматическую загрузку');
        if (autoLoadRoomsInterval) {
          clearInterval(autoLoadRoomsInterval);
          autoLoadRoomsInterval = null;
        }
        return;
      }
    }
    
    // Проверяем, что функции определены
    if (typeof loadRoomsList !== 'function' || typeof startRoomsListener !== 'function') {
      if (autoLoadRoomsAttempts < MAX_AUTO_LOAD_ATTEMPTS) {
        console.log(`⏳ Ожидание определения функций загрузки... (попытка ${autoLoadRoomsAttempts}/${MAX_AUTO_LOAD_ATTEMPTS})`);
        return;
      } else {
        console.error('❌ Функции загрузки не определены после всех попыток!');
        if (autoLoadRoomsInterval) {
          clearInterval(autoLoadRoomsInterval);
          autoLoadRoomsInterval = null;
        }
        return;
      }
    }
    
    // Все проверки пройдены, загружаем комнаты
    console.log('🚀 Автоматическая загрузка комнат при входе в приложение...');
    
    // Останавливаем интервал
    if (autoLoadRoomsInterval) {
      clearInterval(autoLoadRoomsInterval);
      autoLoadRoomsInterval = null;
    }
    
    try {
      // Устанавливаем флаг начальной загрузки ПЕРЕД загрузкой
      isInitialLoad = true;
      console.log('🔵 Флаг isInitialLoad установлен в true');
      
      // Загружаем комнаты
      console.log('🔵 Вызов loadRoomsList(true)...');
      await loadRoomsList(true);
      console.log('✅ loadRoomsList завершена');
      
      // Проверяем, что комнаты действительно отрендерились
      const roomsListEl = ui.elements?.roomsList || document.getElementById('roomsList');
      const renderedCount = roomsListEl ? roomsListEl.children.length : 0;
      console.log(`🔵 Проверка после загрузки: отрендерено ${renderedCount} комнат`);
      
      // Ждем немного, чтобы убедиться, что рендеринг завершен
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Еще раз проверяем рендеринг
      const finalRenderedCount = roomsListEl ? roomsListEl.children.length : 0;
      console.log(`🔵 Финальная проверка: отрендерено ${finalRenderedCount} комнат`);
      
      // Помечаем, что загрузка выполнена ПЕРЕД запуском слушателя
      // Это предотвратит перезапись данных слушателем
      roomsListInitialized = true;
      console.log('✅ roomsListInitialized установлен в true');
      
      // Запускаем слушатель для обновлений в реальном времени ТОЛЬКО после загрузки
      // и после установки флага roomsListInitialized
      if (!roomsListener) {
        console.log('🔵 Запуск слушателя комнат после начальной загрузки...');
        startRoomsListener();
      }
      
      // Через задержку снимаем флаг начальной загрузки
      // Это позволит слушателю обрабатывать последующие изменения
      setTimeout(() => {
        isInitialLoad = false;
        console.log('✅ Начальная загрузка завершена, слушатель активен (isInitialLoad = false)');
      }, 2000); // Увеличена задержка до 2 секунд
      
      console.log('✅ Комнаты успешно загружены при входе в приложение');
    } catch (error) {
      console.error('❌ Ошибка при автоматической загрузке комнат:', error.message || error);
      if (error.stack) console.error(error.stack);
      // Запускаем слушатель даже при ошибке
      try {
        if (!roomsListener) {
          startRoomsListener();
        }
        isInitialLoad = false;
        roomsListInitialized = true; // Помечаем, что попытка была
      } catch (listenerError) {
        console.error('❌ Ошибка при запуске слушателя:', listenerError.message || listenerError);
        if (listenerError.stack) console.error(listenerError.stack);
      }
    }
  };
  
  // Запускаем проверку сразу и затем каждые 500ms
  console.log('🔵 Запуск автоматической загрузки комнат...');
  tryAutoLoadRooms(); // Первая попытка сразу
  autoLoadRoomsInterval = setInterval(tryAutoLoadRooms, 500); // Затем каждые 500ms
  
  // Останавливаем через максимум 15 секунд
  setTimeout(() => {
    if (autoLoadRoomsInterval) {
      clearInterval(autoLoadRoomsInterval);
      autoLoadRoomsInterval = null;
    }
    // Убрано предупреждение - это нормальная ситуация при медленном соединении
  }, MAX_AUTO_LOAD_ATTEMPTS * 500);

  // Обработчики контекстного меню
  if (ui.elements.roomContextLeave) {
    ui.elements.roomContextLeave.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const roomId = ui.elements.roomContextMenu?.dataset.roomId;
      console.log('Кнопка "Выйти из комнаты" нажата, roomId:', roomId, 'currentRoomId:', currentRoomId, 'joined:', joined);
      
      // Проверяем, что пользователь находится в этой комнате
      if (joined && currentRoomId && currentRoomId === roomId) {
        console.log('Выход из комнаты:', roomId);
        await leaveRoom();
      } else {
        console.log('Пользователь не в этой комнате или не подключен');
        ui.showToast('Вы не находитесь в этой комнате');
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

      const currentUser = authManager.getCurrentUser();
      if (!currentUser) return;

      // Проверяем, является ли пользователь создателем
      const isCreator = await isRoomCreator(db, roomId, currentUser.uid);
      if (!isCreator) {
        ui.showToast('Только создатель комнаты может её удалить');
        if (ui.elements.roomContextMenu) {
          ui.elements.roomContextMenu.style.display = 'none';
        }
        return;
      }

      // Если мы в этой комнате, сначала выходим
      if (joined && currentRoomId === roomId) {
        await leaveRoom();
      }

      try {
        await deleteRoomById(db, roomId);
        ui.showToast('Комната удалена');
        await loadRoomsList();
      } catch (error) {
        console.error('Ошибка при удалении комнаты:', error);
        ui.showToast('Ошибка при удалении комнаты');
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
              stopRoomsListener(); // Останавливаем слушатель комнат
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
      if (typeof stopRoomsListener === 'function') {
        stopRoomsListener();
      }
      if (typeof listenersManager !== 'undefined' && listenersManager) {
        listenersManager.unregisterAll();
      }
      
      // 🔧 FIX: Останавливаем детекцию речи
      if (speechDetector && typeof speechDetector.stopDetection === 'function') {
        speechDetector.stopDetection();
      }
      
      // Закрываем все WebRTC соединения
      if (webrtc) {
        Object.values(webrtc.peers).forEach(peer => {
          if (peer && !peer.destroyed) {
            peer.destroy();
          }
        });
        
        // Останавливаем локальный стрим
        if (webrtc.localStream) {
          webrtc.localStream.getTracks().forEach(track => track.stop());
        }
      }
      
      // Отключаемся от Firebase
      if (roomRef) {
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

