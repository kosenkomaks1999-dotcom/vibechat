/**
 * Модуль обработчиков авторизации
 * Обработка входа, регистрации и выхода пользователей
 */

import { CONSTANTS } from '../modules/constants.js';
import { validateNicknameLength, validateNicknameFormat } from '../utils/security.js';
import { isNicknameTaken, reserveNickname, getEmailByNickname, setUserOnlineStatus } from '../modules/firebase.js';
import { errorHandler, ErrorCodes } from '../modules/error-handler.js';
import { logger } from '../modules/logger.js';

/**
 * Класс для обработки авторизации
 */
export class AuthHandlers {
  constructor(state, ui, authManager, db, auth, initAppCallback) {
    this.state = state;
    this.ui = ui;
    this.authManager = authManager;
    this.db = db;
    this.auth = auth;
    this.initAppCallback = initAppCallback;
  }

  /**
   * Инициализирует обработчики авторизации
   */
  init() {
    this.setupLoginHandler();
    this.setupRegisterHandler();
  }

  /**
   * Настраивает обработчик входа
   */
  setupLoginHandler() {
    if (!this.ui.elements.loginForm) return;

    this.ui.elements.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.ui.clearAuthErrors();
      
      const login = this.ui.elements.loginEmail.value.trim();
      const password = this.ui.elements.loginPassword.value;
      
      if (!login || !password) {
        this.ui.showLoginError('Заполните все поля');
        return;
      }
      
      this.ui.setLoginLoading(true);
      
      try {
        // Создаем функцию для получения email по никнейму
        const getEmailByNicknameFn = login.includes('@') 
          ? null 
          : async (nickname) => {
              try {
                return await getEmailByNickname(this.db, this.auth, nickname);
              } catch (error) {
                errorHandler.handleSilent(error, { operation: 'getEmailByNickname', nickname });
                return null;
              }
            };
        
        const result = await this.authManager.signIn(login, password, getEmailByNicknameFn);
        
        if (result.success) {
          const loginType = login.includes('@') ? 'email' : 'nickname';
          logger.info('Пользователь успешно вошел', { login, loginType }).catch(() => {});
          
          if (this.initAppCallback) {
            await this.initAppCallback();
          }
        } else {
          logger.warn('Ошибка входа', { login, error: result.error }).catch(() => {});
          errorHandler.handle(
            result.error || 'Ошибка входа',
            { operation: 'signIn', login },
            { code: ErrorCodes.AUTH_FAILED, userMessage: result.error }
          );
          this.ui.showLoginError(result.error);
        }
      } catch (error) {
        errorHandler.handle(error, { operation: 'login' });
        this.ui.showLoginError('Ошибка при входе. Попробуйте еще раз');
      } finally {
        this.ui.setLoginLoading(false);
      }
    });
  }

  /**
   * Настраивает обработчик регистрации
   */
  setupRegisterHandler() {
    if (!this.ui.elements.registerForm) return;

    this.ui.elements.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.ui.clearAuthErrors();
      
      const email = this.ui.elements.registerEmail.value.trim();
      const nickname = this.ui.elements.registerNickname.value.trim();
      const password = this.ui.elements.registerPassword.value;
      const passwordConfirm = this.ui.elements.registerPasswordConfirm.value;
      
      // Валидация полей
      if (!email || !nickname || !password || !passwordConfirm) {
        this.ui.showRegisterError('Заполните все поля');
        return;
      }
      
      // Валидация никнейма
      if (!validateNicknameLength(nickname, CONSTANTS.MAX_NICKNAME_LENGTH)) {
        this.ui.showRegisterError(`Никнейм должен быть от 1 до ${CONSTANTS.MAX_NICKNAME_LENGTH} символов`);
        return;
      }
      
      if (!validateNicknameFormat(nickname)) {
        this.ui.showRegisterError('Никнейм может содержать только буквы, цифры, дефис и подчеркивание');
        return;
      }
      
      // Валидация пароля
      if (password !== passwordConfirm) {
        this.ui.showRegisterError('Пароли не совпадают');
        return;
      }
      
      if (password.length < 6) {
        this.ui.showRegisterError('Пароль должен содержать минимум 6 символов');
        return;
      }
      
      this.ui.setRegisterLoading(true);
      
      try {
        // Проверяем, занят ли никнейм
        const nicknameTaken = await isNicknameTaken(this.db, nickname);
        if (nicknameTaken) {
          errorHandler.handle(
            'Никнейм уже занят',
            { operation: 'register', nickname },
            { code: ErrorCodes.NICKNAME_TAKEN }
          );
          this.ui.showRegisterError('Этот никнейм уже занят. Выберите другой');
          this.ui.setRegisterLoading(false);
          return;
        }
        
        // Регистрируем пользователя
        const result = await this.authManager.signUp(email, password);
        
        if (result.success && result.user) {
          // Сохраняем никнейм в Firebase
          try {
            await reserveNickname(this.db, nickname, result.user.uid, email);
            logger.info('Пользователь успешно зарегистрирован', { email, nickname }).catch(() => {});
            
            // Сохраняем никнейм в localStorage
            this.ui.saveNickname(nickname);
            
            if (this.initAppCallback) {
              await this.initAppCallback();
            }
          } catch (nicknameError) {
            errorHandler.handle(nicknameError, { operation: 'reserveNickname', nickname });
            // Если не удалось сохранить никнейм, все равно входим в приложение
            logger.warn('Не удалось сохранить никнейм', { error: nicknameError.message }).catch(() => {});
            if (this.initAppCallback) {
              await this.initAppCallback();
            }
          }
        } else {
          errorHandler.handle(
            result.error || 'Ошибка регистрации',
            { operation: 'register', email },
            { code: ErrorCodes.AUTH_FAILED, userMessage: result.error }
          );
          this.ui.showRegisterError(result.error);
        }
      } catch (error) {
        errorHandler.handle(error, { operation: 'register' });
        this.ui.showRegisterError('Ошибка при регистрации. Попробуйте еще раз');
      } finally {
        this.ui.setRegisterLoading(false);
      }
    });
  }

  /**
   * Настраивает обработчик выхода из аккаунта
   */
  setupLogoutHandler(leaveRoomCallback, showAuthCallback) {
    if (!this.ui.elements.logoutBtn || !this.authManager) {
      console.warn('Кнопка выхода не найдена или authManager не инициализирован');
      return;
    }
    
    // Убеждаемся, что кнопка кликабельна
    this.ui.elements.logoutBtn.style.pointerEvents = 'auto';
    this.ui.elements.logoutBtn.style.cursor = 'pointer';
    this.ui.elements.logoutBtn.style.zIndex = '100';
    
    // Удаляем старые обработчики, если они есть
    const newBtn = this.ui.elements.logoutBtn.cloneNode(true);
    this.ui.elements.logoutBtn.parentNode.replaceChild(newBtn, this.ui.elements.logoutBtn);
    this.ui.elements.logoutBtn = newBtn;
    
    this.ui.elements.logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Закрываем модальное окно настроек перед показом диалога подтверждения
      this.ui.hideProfileSettings();
      
      // Небольшая задержка для завершения анимации закрытия
      await new Promise(resolve => setTimeout(resolve, 300));
      
      try {
        const confirmed = await this.ui.showConfirm('Вы уверены, что хотите выйти из аккаунта?');
        if (confirmed) {
          const currentUser = this.authManager.getCurrentUser();
          const wasInRoom = this.state.joined;
          const previousRoomId = this.state.currentRoomId;
          const userId = currentUser ? currentUser.uid : null;
          
          // ВАЖНО: Устанавливаем статус оффлайн ДО выхода из аккаунта,
          // иначе Firebase отклонит запрос из-за правил безопасности
          try {
            if (currentUser && this.db && userId) {
              console.log('Установка статуса offline перед выходом из аккаунта...');
              await setUserOnlineStatus(this.db, userId, false);
              console.log('Статус offline установлен успешно');
            }
          } catch (cleanupError) {
            console.error('Ошибка при установке статуса оффлайн:', cleanupError);
            // Продолжаем выход даже если не удалось установить статус
          }
          
          // Выходим из комнаты если были в ней (после установки статуса, но до выхода из аккаунта)
          if (this.state.joined && leaveRoomCallback) {
            try {
              await leaveRoomCallback();
            } catch (leaveError) {
              console.error('Ошибка при выходе из комнаты:', leaveError);
              // Продолжаем выход даже если не удалось выйти из комнаты
            }
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
          await this.authManager.signOut();
          logger.info('Пользователь вышел из аккаунта', { email: currentUser ? currentUser.email : null }).catch(() => {});
          
          // Очищаем данные в плашке пользователя
          this.ui.setNicknameDisplay('Загрузка...');
          this.ui.setUserAvatar(null, '');
          
          // Показываем окно авторизации
          if (showAuthCallback) {
            showAuthCallback();
          }
        }
      } catch (error) {
        errorHandler.handle(error, { operation: 'logout' });
        this.ui.showToast('Ошибка при выходе из аккаунта');
      }
    });
  }
}


