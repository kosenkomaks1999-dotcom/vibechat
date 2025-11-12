/**
 * Модуль обработчиков чата
 * Обработка отправки сообщений, прикрепления файлов, очистки чата
 */

import { clearRoomMessages } from '../modules/firebase.js';
import { errorHandler, ErrorCodes } from '../modules/error-handler.js';
import { logger } from '../modules/logger.js';
import { loadModule } from '../utils/lazy-loader.js';

/**
 * Класс для обработки чата
 */
export class ChatHandlers {
  constructor(state, ui, chat) {
    this.state = state;
    this.ui = ui;
    this.chat = chat;
  }

  /**
   * Инициализирует обработчики чата
   */
  init() {
    this.setupSendMessageHandler();
    this.setupFileAttachmentHandler();
    this.setupClearChatHandler();
    this.setupEmojiPickerHandler();
  }

  /**
   * Настраивает обработчик отправки сообщений
   */
  setupSendMessageHandler() {
    // Кнопка отправки
    if (this.ui.elements.sendBtn) {
      this.ui.elements.sendBtn.addEventListener("click", () => {
        this.sendMessage();
      });
    }

    // Enter в поле ввода
    if (this.ui.elements.chatInput) {
      this.ui.elements.chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.sendMessage();
        }
      });
    }
  }

  /**
   * Отправляет сообщение
   */
  sendMessage() {
    try {
      if (!this.chat) {
        this.ui.showToast("Чат не инициализирован");
        return;
      }

      this.chat.sendMessage((msg) => {
        if (msg) {
          this.ui.showToast(msg);
        }
      });
    } catch (error) {
      errorHandler.handle(error, { operation: 'sendMessage' });
      this.ui.showToast('Ошибка при отправке сообщения');
    }
  }

  /**
   * Настраивает обработчик прикрепления файлов
   */
  setupFileAttachmentHandler() {
    // Кнопка прикрепления файла
    if (this.ui.elements.attachBtn) {
      this.ui.elements.attachBtn.addEventListener("click", () => {
        if (this.ui.elements.fileInput) {
          this.ui.elements.fileInput.click();
        }
      });
    }

    // Выбор файла
    if (this.ui.elements.fileInput) {
      this.ui.elements.fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file && this.chat) {
          try {
            this.chat.attachFile(file, (msg) => {
              if (msg) {
                this.ui.showToast(msg);
              }
            });
          } catch (error) {
            errorHandler.handle(error, { operation: 'attachFile', fileName: file.name });
            this.ui.showToast('Ошибка при прикреплении файла');
          }
        }
      });
    }
  }

  /**
   * Настраивает обработчик очистки чата
   */
  setupClearChatHandler() {
    if (!this.ui.elements.clearChatBtn) return;

    this.ui.elements.clearChatBtn.addEventListener("click", async () => {
      try {
        if (!this.chat) {
          this.ui.showToast("Чат не инициализирован");
          return;
        }

        if (this.state.joined && this.state.roomRef) {
          // Показываем подтверждение
          const confirmed = await this.ui.showConfirm(
            "Вы уверены, что хотите очистить все сообщения в чате?"
          );

          if (confirmed) {
            // Очищаем локально
            this.chat.clear();
            // Очищаем из Firebase
            try {
              await clearRoomMessages(this.state.roomRef);
              logger.info('Чат очищен', { roomId: this.state.currentRoomId }).catch(() => {});
            } catch (error) {
              errorHandler.handleSilent(error, { operation: 'clearRoomMessages' });
            }
            this.ui.showToast("Чат очищен");
          }
        } else {
          // Если не в комнате, просто очищаем локально
          this.chat.clear();
          this.ui.showToast("Чат очищен");
        }
      } catch (error) {
        errorHandler.handle(error, { operation: 'clearChat' });
        this.ui.showToast('Ошибка при очистке чата');
      }
    });
  }

  /**
   * Настраивает обработчик эмодзи пикера
   */
  setupEmojiPickerHandler() {
    if (!this.ui.elements.emojiBtn || !this.ui.elements.emojiPicker) return;

    // Открытие/закрытие эмодзи пикера
    this.ui.elements.emojiBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.ui.elements.emojiPicker.classList.toggle("show");
    });

    // Закрытие при клике вне пикера
    document.addEventListener("click", (e) => {
      if (
        this.ui.elements.emojiPicker &&
        !this.ui.elements.emojiPicker.contains(e.target) &&
        e.target !== this.ui.elements.emojiBtn
      ) {
        this.ui.elements.emojiPicker.classList.remove("show");
      }
    });
  }

  /**
   * Обновляет ссылку на чат
   */
  setChat(chat) {
    this.chat = chat;
  }
}

