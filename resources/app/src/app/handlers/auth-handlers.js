/**
 * Обработчики событий авторизации
 */

import { errorHandler, ERROR_CODES } from '../../utils/error-handler.js';
import { validateNicknameLength, validateNicknameFormat } from '../../utils/security.js';
import { CONSTANTS } from '../../modules/constants.js';
import { isNicknameTaken, reserveNickname, getEmailByNickname } from '../../modules/firebase.js';
import { logger } from '../../modules/logger.js';

/**
 * Настраивает обработчики форм авторизации
 * @param {Object} params - Параметры
 * @param {Object} params.ui - UIManager
 * @param {Object} params.authManager - AuthManager
 * @param {Object} params.db - Firebase database
 * @param {Object} params.auth - Firebase auth
 * @param {Function} params.onAuthSuccess - Callback при успешной авторизации
 */
export function setupAuthHandlers({ ui, authManager, db, auth, onAuthSuccess }) {
  if (!authManager) {
    console.warn('AuthManager не инициализирован, обработчики авторизации не настроены');
    return;
  }

  // Обработчик формы входа
  if (ui.elements.loginForm) {
    ui.elements.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      ui.clearAuthErrors();

      const login = ui.elements.loginEmail.value.trim();
      const password = ui.elements.loginPassword.value;

      if (!login || !password) {
        ui.showLoginError('Заполните все поля');
        return;
      }

      ui.setLoginLoading(true);

      try {
        // Создаем функцию для получения email по никнейму
        const getEmailByNicknameFn = login.includes('@')
          ? null
          : async (nickname) => {
              try {
                return await getEmailByNickname(db, auth, nickname);
              } catch (error) {
                errorHandler.handle(error, { action: 'getEmailByNickname', nickname }, { showToUser: false });
                return null;
              }
            };

        const result = await authManager.signIn(login, password, getEmailByNicknameFn);

        if (result.success) {
          const loginType = login.includes('@') ? 'email' : 'nickname';
          await logger.info('Пользователь успешно вошел', { login, loginType });
          
          if (onAuthSuccess) {
            onAuthSuccess();
          }
        } else {
          await logger.warn('Ошибка входа', { login, error: result.error });
          errorHandler.handle(
            new Error(result.error),
            { action: 'signIn', login },
            { code: ERROR_CODES.AUTH_FAILED, showToUser: true }
          );
          ui.showLoginError(result.error);
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'signIn', login }, { showToUser: true });
        ui.showLoginError('Ошибка при входе. Попробуйте еще раз.');
      } finally {
        ui.setLoginLoading(false);
      }
    });
  }

  // Обработчик формы регистрации
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

      try {
        // Проверяем, занят ли никнейм
        const nicknameTaken = await isNicknameTaken(db, nickname);
        if (nicknameTaken) {
          ui.setRegisterLoading(false);
          errorHandler.handle(
            new Error('Никнейм уже занят'),
            { action: 'register', nickname },
            { code: ERROR_CODES.NICKNAME_TAKEN, showToUser: true }
          );
          ui.showRegisterError('Этот никнейм уже занят. Выберите другой');
          return;
        }

        // Регистрируем пользователя
        const result = await authManager.signUp(email, password);

        if (result.success && result.user) {
          try {
            // Сохраняем никнейм в Firebase
            await reserveNickname(db, nickname, result.user.uid, email);
            await logger.info('Пользователь успешно зарегистрирован', { email, nickname });

            // Сохраняем никнейм в localStorage
            ui.saveNickname(nickname);

            if (onAuthSuccess) {
              onAuthSuccess();
            }
          } catch (nicknameError) {
            errorHandler.handle(nicknameError, { action: 'reserveNickname', nickname }, { showToUser: false });
            // Если не удалось сохранить никнейм, все равно входим в приложение
            await logger.warn('Не удалось сохранить никнейм', { error: nicknameError.message });
            
            if (onAuthSuccess) {
              onAuthSuccess();
            }
          }
        } else {
          errorHandler.handle(
            new Error(result.error),
            { action: 'signUp', email },
            { code: ERROR_CODES.AUTH_FAILED, showToUser: true }
          );
          ui.showRegisterError(result.error);
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'register', email, nickname }, { showToUser: true });
        ui.showRegisterError('Ошибка при регистрации. Попробуйте еще раз.');
      } finally {
        ui.setRegisterLoading(false);
      }
    });
  }
}

