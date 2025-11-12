/**
 * Модуль жизненного цикла приложения
 * Управляет инициализацией и завершением работы приложения
 */

import { appState } from './state.js';
import { errorHandler, ERROR_CODES } from '../utils/error-handler.js';
import { logger } from '../modules/logger.js';
import { getUserNickname, getUserAvatar, setUserOnlineStatus } from '../modules/firebase.js';
import { CONSTANTS } from '../modules/constants.js';

/**
 * Показывает окно авторизации
 * @param {Object} ui - UIManager
 */
export function showAuth(ui) {
  logger.info('Показано окно авторизации').catch(() => {});
  
  // Изменяем размер окна под форму авторизации
  if (window.electronAPI && window.electronAPI.setWindowSize) {
    window.electronAPI.setWindowSize(500, 750, true);
  }
  
  ui.showAuthWindow();
}

/**
 * Инициализирует приложение после авторизации
 * @param {Object} params - Параметры инициализации
 * @param {Object} params.ui - UIManager
 * @param {Object} params.db - Firebase database
 * @param {Object} params.authManager - AuthManager
 * @param {Object} params.chat - ChatManager
 * @param {Function} params.onInitComplete - Callback после инициализации
 */
export async function initApp({ ui, db, authManager, chat, onInitComplete }) {
  try {
    logger.info('Инициализация приложения').catch(() => {});
    
    // Восстанавливаем размер окна для основного приложения
    if (window.electronAPI && window.electronAPI.restoreWindowSize) {
      window.electronAPI.restoreWindowSize(1200, 650, 1065, 550, true);
    }
    
    // Скрываем окно авторизации
    const authWindow = document.getElementById('authWindow');
    if (authWindow) {
      authWindow.style.display = 'none';
      authWindow.classList.remove('show');
    }
    
    // Показываем основное приложение
    const appContent = document.getElementById('appContent');
    if (appContent) {
      appContent.style.display = 'flex';
      appContent.style.opacity = '1';
      appContent.style.visibility = 'visible';
      appContent.classList.add('show');
      appContent.style.position = 'relative';
      appContent.style.zIndex = '10';
    }
    
    // Обновляем информацию о пользователе
    if (authManager) {
      const currentUser = authManager.getCurrentUser();
      if (currentUser && currentUser.email) {
        await loadUserProfile({ ui, db, currentUser, chat });
        
        // Устанавливаем онлайн статус
        await setUserOnlineStatus(db, currentUser.uid, true);
      } else {
        logger.warn('Пользователь не найден при инициализации приложения').catch(() => {});
      }
    }
    
    if (onInitComplete) {
      onInitComplete();
    }
    
    logger.info('Инициализация приложения завершена').catch(() => {});
  } catch (error) {
    errorHandler.handle(error, { action: 'initApp' }, { showToUser: true });
  }
}

/**
 * Загружает профиль пользователя
 * @param {Object} params - Параметры
 * @param {Object} params.ui - UIManager
 * @param {Object} params.db - Firebase database
 * @param {Object} params.currentUser - Текущий пользователь
 * @param {Object} params.chat - ChatManager
 */
async function loadUserProfile({ ui, db, currentUser, chat }) {
  try {
    // Загружаем никнейм из Firebase
    const savedNickname = await getUserNickname(db, currentUser.uid);
    if (savedNickname) {
      ui.setNicknameDisplay(savedNickname);
      ui.saveNickname(savedNickname);
      appState.myNick = savedNickname;
      logger.info('Никнейм загружен из Firebase', { nickname: savedNickname }).catch(() => {});
    } else {
      ui.setNicknameDisplay('Не установлен');
      appState.myNick = CONSTANTS.DEFAULT_NICKNAME;
      logger.warn('Никнейм не найден в Firebase').catch(() => {});
    }
    
    // Загружаем аватар пользователя
    try {
      const avatarUrl = await getUserAvatar(db, currentUser.uid);
      ui.setUserAvatar(avatarUrl, savedNickname || 'Не установлен');
    } catch (avatarError) {
      errorHandler.handle(avatarError, { action: 'loadUserAvatar' }, { showToUser: false });
      ui.setUserAvatar(null, savedNickname || 'Не установлен');
    }
    
    // Обновляем email в профиле пользователя, если его там нет
    try {
      const userEmailSnapshot = await db.ref(`users/${currentUser.uid}/email`).once('value');
      if (!userEmailSnapshot.exists() && currentUser.email) {
        await db.ref(`users/${currentUser.uid}/email`).set(currentUser.email);
        logger.info('Email обновлен в профиле пользователя', { email: currentUser.email }).catch(() => {});
      }
    } catch (emailError) {
      errorHandler.handle(emailError, { action: 'updateUserEmail' }, { showToUser: false });
    }
    
    // Обновляем никнейм в чате, если он инициализирован
    if (chat) {
      chat.myNickname = savedNickname || CONSTANTS.DEFAULT_NICKNAME;
    }
    
    logger.info('Пользователь вошел в приложение', { email: currentUser.email }).catch(() => {});
  } catch (error) {
    errorHandler.handle(error, { action: 'loadUserProfile' }, { showToUser: false });
    ui.setNicknameDisplay('Ошибка загрузки');
    ui.setUserAvatar(null, 'Не установлен');
    appState.myNick = CONSTANTS.DEFAULT_NICKNAME;
  }
}

/**
 * Скрывает splash screen и показывает нужное окно
 * @param {boolean} isAuthorized - Авторизован ли пользователь
 * @param {Object} ui - UIManager
 * @param {Function} onShowAuth - Callback для показа авторизации
 * @param {Function} onShowApp - Callback для показа приложения
 */
export function hideSplashAndShow(isAuthorized, ui, onShowAuth, onShowApp) {
  const splashScreen = document.getElementById('splashScreen');
  
  if (splashScreen && !splashScreen.classList.contains('fade-out')) {
    splashScreen.classList.add('fade-out');
    
    setTimeout(() => {
      if (splashScreen && splashScreen.parentNode) {
        splashScreen.remove();
      }
      
      if (isAuthorized) {
        if (onShowApp) {
          onShowApp();
        }
      } else {
        if (onShowAuth) {
          onShowAuth();
        }
      }
    }, 1200);
  } else {
    if (isAuthorized) {
      if (onShowApp) {
        onShowApp();
      }
    } else {
      if (onShowAuth) {
        onShowAuth();
      }
    }
  }
}

/**
 * Очищает ресурсы при выходе
 * @param {Object} params - Параметры
 * @param {Object} params.db - Firebase database
 * @param {Object} params.authManager - AuthManager
 */
export async function cleanup({ db, authManager }) {
  try {
    // Устанавливаем офлайн статус
    if (authManager && authManager.isAuthenticated()) {
      const currentUser = authManager.getCurrentUser();
      if (currentUser && db) {
        await setUserOnlineStatus(db, currentUser.uid, false);
      }
    }
    
    // Очищаем состояние
    appState.reset();
    
    logger.info('Очистка ресурсов завершена').catch(() => {});
  } catch (error) {
    errorHandler.handle(error, { action: 'cleanup' }, { showToUser: false });
  }
}

