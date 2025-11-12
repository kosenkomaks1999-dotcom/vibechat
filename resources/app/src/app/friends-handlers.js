/**
 * Модуль обработчиков друзей
 * Обработка добавления друзей, уведомлений, приглашений
 */

import { errorHandler, ErrorCodes } from '../modules/error-handler.js';
import { logger } from '../modules/logger.js';

/**
 * Класс для обработки друзей
 */
export class FriendsHandlers {
  constructor(state, ui, friendsManager, roomHandlers) {
    this.state = state;
    this.ui = ui;
    this.friendsManager = friendsManager;
    this.roomHandlers = roomHandlers;
  }

  /**
   * Инициализирует обработчики друзей
   */
  init() {
    this.setupAddFriendHandler();
    this.setupAddFriendModalHandlers();
    this.setupNotificationsHandler();
    this.setupFriendListHandlers();
  }

  /**
   * Настраивает обработчик добавления друга
   */
  setupAddFriendHandler() {
    // Кнопка добавления друга в title bar
    if (this.ui.elements.addFriendBtnTitle) {
      this.ui.elements.addFriendBtnTitle.addEventListener('click', () => {
        this.showAddFriendModal();
      });
    }

    // Кнопка отправки запроса в друзья
    if (this.ui.elements.addFriendSubmitBtn) {
      this.ui.elements.addFriendSubmitBtn.addEventListener('click', async () => {
        await this.handleAddFriend();
      });
    }

    // Поддержка Enter для отправки запроса
    if (this.ui.elements.friendNicknameInput) {
      this.ui.elements.friendNicknameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && this.ui.elements.addFriendSubmitBtn) {
          this.ui.elements.addFriendSubmitBtn.click();
        }
      });
    }
  }

  /**
   * Показывает модальное окно добавления друга
   */
  showAddFriendModal() {
    if (this.ui.elements.addFriendModal) {
      this.ui.elements.addFriendModal.classList.add('show');
      if (this.ui.elements.friendNicknameInput) {
        this.ui.elements.friendNicknameInput.value = '';
        this.ui.elements.friendNicknameInput.focus();
      }
      if (this.ui.elements.addFriendError) {
        this.ui.elements.addFriendError.textContent = '';
        this.ui.elements.addFriendError.style.display = 'none';
      }
    }
  }

  /**
   * Обрабатывает добавление друга
   */
  async handleAddFriend() {
    try {
      if (!this.friendsManager) {
        this.ui.showToast('Система друзей не инициализирована');
        return;
      }

      const nickname = this.ui.elements.friendNicknameInput?.value.trim();
      if (!nickname) {
        this.showAddFriendError('Введите никнейм друга');
        return;
      }

      // Очищаем предыдущие ошибки
      this.clearAddFriendError();

      // Отправляем запрос через FriendsManager
      const result = await this.friendsManager.sendFriendRequestByNickname(nickname);

      if (result.success) {
        this.ui.showToast(`Запрос в друзья отправлен пользователю ${nickname}`);
        // Закрываем модальное окно
        if (this.ui.elements.addFriendModal) {
          this.ui.elements.addFriendModal.classList.remove('show');
        }
        // Очищаем поле ввода
        if (this.ui.elements.friendNicknameInput) {
          this.ui.elements.friendNicknameInput.value = '';
        }
      } else {
        errorHandler.handle(
          result.error || 'Ошибка при отправке запроса',
          { operation: 'addFriend', nickname },
          { code: ErrorCodes.VALIDATION_ERROR, userMessage: result.error }
        );
        this.showAddFriendError(result.error || 'Ошибка при отправке запроса');
      }
    } catch (error) {
      errorHandler.handle(error, { operation: 'addFriend' });
      this.showAddFriendError('Ошибка при добавлении друга');
    }
  }

  /**
   * Показывает ошибку в модальном окне добавления друга
   */
  showAddFriendError(message) {
    if (this.ui.elements.addFriendError) {
      this.ui.elements.addFriendError.textContent = message;
      this.ui.elements.addFriendError.style.display = 'block';
    }
  }

  /**
   * Очищает ошибку в модальном окне добавления друга
   */
  clearAddFriendError() {
    if (this.ui.elements.addFriendError) {
      this.ui.elements.addFriendError.textContent = '';
      this.ui.elements.addFriendError.style.display = 'none';
    }
  }

  /**
   * Настраивает обработчики модального окна добавления друга
   */
  setupAddFriendModalHandlers() {
    // Закрытие модального окна
    if (this.ui.elements.addFriendCloseBtn) {
      this.ui.elements.addFriendCloseBtn.addEventListener('click', () => {
        if (this.ui.elements.addFriendModal) {
          this.ui.elements.addFriendModal.classList.remove('show');
        }
      });
    }

    if (this.ui.elements.addFriendCancelBtn) {
      this.ui.elements.addFriendCancelBtn.addEventListener('click', () => {
        if (this.ui.elements.addFriendModal) {
          this.ui.elements.addFriendModal.classList.remove('show');
        }
      });
    }

    // Закрытие при клике вне модального окна
    if (this.ui.elements.addFriendModal) {
      this.ui.elements.addFriendModal.addEventListener('click', (e) => {
        if (e.target === this.ui.elements.addFriendModal) {
          this.ui.elements.addFriendModal.classList.remove('show');
        }
      });
    }
  }

  /**
   * Настраивает обработчики уведомлений
   */
  setupNotificationsHandler() {
    // Обработка уже настроен в UIHandlers, здесь можно добавить специфичную логику
  }

  /**
   * Настраивает обработчики списка друзей
   */
  setupFriendListHandlers() {
    // Обработчики для действий с друзьями (принятие/отклонение запросов и т.д.)
    // реализуются через FriendsManager
  }

  /**
   * Обновляет ссылку на FriendsManager
   */
  setFriendsManager(friendsManager) {
    this.friendsManager = friendsManager;
  }
}

