/**
 * Модуль обработчиков профиля пользователя
 * Управление настройками профиля, аватара, никнейма
 */

import { CONSTANTS } from '../modules/constants.js';
import {
  getUserNickname,
  getUserAvatar,
  saveUserAvatar,
  updateUserNickname,
  isNicknameTaken,
  reserveNickname
} from '../modules/firebase.js';
import { validateNicknameLength, validateNicknameFormat } from '../utils/security.js';
import { errorHandler, ErrorCodes } from '../modules/error-handler.js';
import { logger } from '../modules/logger.js';

/**
 * Функция конвертации файла в base64
 */
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
 */
async function compressImage(file, maxSizeKB = 150, maxWidth = 512, maxHeight = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const canvasToBase64 = (quality) => {
          return canvas.toDataURL('image/jpeg', quality);
        };
        
        const getBase64SizeKB = (base64Str) => {
          return (base64Str.length * 3 / 4 - (base64Str.match(/=/g) || []).length) / 1024;
        };
        
        let quality = 0.8;
        let base64 = canvasToBase64(quality);
        let sizeKB = getBase64SizeKB(base64);
        
        if (sizeKB <= maxSizeKB) {
          URL.revokeObjectURL(objectUrl);
          resolve(base64);
          return;
        }
        
        const step = 0.1;
        const minQuality = 0.3;
        
        while (quality > minQuality && sizeKB > maxSizeKB) {
          quality -= step;
          base64 = canvasToBase64(quality);
          sizeKB = getBase64SizeKB(base64);
        }
        
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

/**
 * Класс для обработки профиля пользователя
 */
export class ProfileHandlers {
  constructor(state, ui, authManager, db) {
    this.state = state;
    this.ui = ui;
    this.authManager = authManager;
    this.db = db;
    this.currentAvatarUrl = null;
    this.currentAvatarFile = null;
    this.originalAvatarUrl = null;
  }

  /**
   * Инициализирует обработчики профиля
   */
  init() {
    this.setupProfileSettingsHandlers();
    this.setupAvatarHandlers();
    this.setupNicknameHandlers();
  }

  /**
   * Настраивает обработчики настроек профиля
   */
  setupProfileSettingsHandlers() {
    // Открытие модального окна настроек профиля
    if (this.ui.elements.userProfileSettingsBtn && this.authManager) {
      this.ui.elements.userProfileSettingsBtn.addEventListener('click', async () => {
        const currentUser = this.authManager.getCurrentUser();
        if (currentUser) {
          try {
            const nickname = await getUserNickname(this.db, currentUser.uid);
            if (this.ui.elements.profileNicknameInput) {
              this.ui.elements.profileNicknameInput.value = nickname || '';
            }
            
            if (currentUser.email) {
              this.ui.setProfileEmail(currentUser.email);
            }
            
            const avatarUrl = await getUserAvatar(this.db, currentUser.uid);
            this.currentAvatarUrl = avatarUrl;
            this.originalAvatarUrl = avatarUrl;
            this.currentAvatarFile = null;
            this.ui.updateAvatarPreview(avatarUrl, nickname || 'Не установлен');
          } catch (error) {
            errorHandler.handle(error, { operation: 'loadProfileData' });
          }
          
          this.ui.showProfileSettings();
        }
      });
    }

    // Закрытие модального окна
    const resetProfileSettings = () => {
      this.currentAvatarUrl = this.originalAvatarUrl;
      this.currentAvatarFile = null;
      this.ui.clearProfileError();
    };

    if (this.ui.elements.profileSettingsCloseBtn) {
      this.ui.elements.profileSettingsCloseBtn.addEventListener('click', () => {
        resetProfileSettings();
        this.ui.hideProfileSettings();
      });
    }

    if (this.ui.elements.profileSettingsCancelBtn) {
      this.ui.elements.profileSettingsCancelBtn.addEventListener('click', () => {
        resetProfileSettings();
        this.ui.hideProfileSettings();
      });
    }
  }

  /**
   * Настраивает обработчики аватара
   */
  setupAvatarHandlers() {
    // Загрузка аватара
    if (this.ui.elements.profileAvatarUploadBtn && this.ui.elements.profileAvatarInput) {
      this.ui.elements.profileAvatarUploadBtn.addEventListener('click', () => {
        this.ui.elements.profileAvatarInput.click();
      });

      this.ui.elements.profileAvatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 7 * 1024 * 1024) {
          errorHandler.handle(
            'Файл слишком большой',
            { operation: 'uploadAvatar' },
            { code: ErrorCodes.FILE_TOO_LARGE, userMessage: 'Размер файла должен быть не более 7MB' }
          );
          this.ui.showProfileError('Размер файла должен быть не более 7MB');
          return;
        }

        if (!file.type.startsWith('image/')) {
          errorHandler.handle(
            'Неподдерживаемый тип файла',
            { operation: 'uploadAvatar' },
            { code: ErrorCodes.INVALID_FILE_TYPE, userMessage: 'Выберите изображение' }
          );
          this.ui.showProfileError('Выберите изображение');
          return;
        }

        try {
          this.ui.showToast('Сжатие изображения...');
          
          const compressedBase64 = await compressImage(file, 150, 512, 512);
          
          this.currentAvatarUrl = compressedBase64;
          this.currentAvatarFile = file;
          
          const nickname = this.ui.elements.profileNicknameInput ? this.ui.elements.profileNicknameInput.value.trim() : '';
          this.ui.updateAvatarPreview(compressedBase64, nickname || 'Не установлен');
          this.ui.clearProfileError();
        } catch (error) {
          errorHandler.handle(error, { operation: 'compressAvatar' });
          this.ui.showProfileError('Ошибка при обработке изображения');
        }
      });
    }

    // Удаление аватара
    if (this.ui.elements.profileAvatarRemoveBtn) {
      this.ui.elements.profileAvatarRemoveBtn.addEventListener('click', () => {
        this.currentAvatarUrl = null;
        this.currentAvatarFile = null;
        const nickname = this.ui.elements.profileNicknameInput ? this.ui.elements.profileNicknameInput.value.trim() : '';
        this.ui.updateAvatarPreview(null, nickname || 'Не установлен');
        if (this.ui.elements.profileAvatarInput) {
          this.ui.elements.profileAvatarInput.value = '';
        }
      });
    }
  }

  /**
   * Настраивает обработчики никнейма
   */
  setupNicknameHandlers() {
    // Сохранение настроек профиля
    if (this.ui.elements.profileSettingsSaveBtn && this.authManager) {
      this.ui.elements.profileSettingsSaveBtn.addEventListener('click', async () => {
        const currentUser = this.authManager.getCurrentUser();
        if (!currentUser) {
          this.ui.showProfileError('Пользователь не авторизован');
          return;
        }

        this.ui.clearProfileError();

        const newNickname = this.ui.elements.profileNicknameInput ? this.ui.elements.profileNicknameInput.value.trim() : '';
        let oldNickname = this.state.myNick;
        if (!oldNickname || oldNickname === CONSTANTS.DEFAULT_NICKNAME) {
          oldNickname = await getUserNickname(this.db, currentUser.uid) || null;
        }

        // Валидация никнейма
        if (!newNickname) {
          this.ui.showProfileError('Никнейм не может быть пустым');
          return;
        }

        if (!validateNicknameLength(newNickname, CONSTANTS.MAX_NICKNAME_LENGTH)) {
          this.ui.showProfileError(`Никнейм должен быть от 1 до ${CONSTANTS.MAX_NICKNAME_LENGTH} символов`);
          return;
        }

        if (!validateNicknameFormat(newNickname)) {
          this.ui.showProfileError('Никнейм может содержать только буквы, цифры, дефис и подчеркивание');
          return;
        }

        try {
          // Проверяем, изменился ли никнейм
          if (oldNickname && newNickname.toLowerCase() !== oldNickname.toLowerCase()) {
            const nicknameTaken = await isNicknameTaken(this.db, newNickname);
            if (nicknameTaken) {
              errorHandler.handle(
                'Никнейм уже занят',
                { operation: 'updateNickname', newNickname },
                { code: ErrorCodes.NICKNAME_TAKEN }
              );
              this.ui.showProfileError('Этот никнейм уже занят. Выберите другой');
              return;
            }

            await updateUserNickname(this.db, currentUser.uid, oldNickname, newNickname);
            this.state.myNick = newNickname;
            this.ui.setNicknameDisplay(newNickname);
            this.ui.saveNickname(newNickname);
            logger.info('Никнейм обновлен', { oldNickname, newNickname }).catch(() => {});
          } else if (!oldNickname) {
            const nicknameTaken = await isNicknameTaken(this.db, newNickname);
            if (nicknameTaken) {
              errorHandler.handle(
                'Никнейм уже занят',
                { operation: 'setNickname', newNickname },
                { code: ErrorCodes.NICKNAME_TAKEN }
              );
              this.ui.showProfileError('Этот никнейм уже занят. Выберите другой');
              return;
            }
            
            await reserveNickname(this.db, newNickname, currentUser.uid, currentUser.email);
            this.state.myNick = newNickname;
            this.ui.setNicknameDisplay(newNickname);
            this.ui.saveNickname(newNickname);
            logger.info('Никнейм установлен', { newNickname }).catch(() => {});
          }

          // Сохраняем аватар
          if (this.currentAvatarFile !== null) {
            await saveUserAvatar(this.db, currentUser.uid, this.currentAvatarUrl);
            this.originalAvatarUrl = this.currentAvatarUrl;
            logger.info('Аватар обновлен').catch(() => {});
          } else {
            const existingAvatar = await getUserAvatar(this.db, currentUser.uid);
            if (this.currentAvatarUrl === null && existingAvatar !== null) {
              await saveUserAvatar(this.db, currentUser.uid, null);
              this.originalAvatarUrl = null;
              logger.info('Аватар удален').catch(() => {});
            }
          }

          // Обновляем отображение
          this.ui.setUserAvatar(this.currentAvatarUrl, newNickname);
          this.ui.setNicknameDisplay(newNickname);

          if (this.state.chat) {
            this.state.chat.myNickname = newNickname;
          }

          this.currentAvatarFile = null;
          this.ui.hideProfileSettings();
          this.ui.showToast('Настройки профиля сохранены');
        } catch (error) {
          errorHandler.handle(error, { operation: 'saveProfile' });
          this.ui.showProfileError('Ошибка при сохранении настроек. Попробуйте еще раз.');
        }
      });
    }
  }
}


