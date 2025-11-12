/**
 * Модуль обработчиков UI
 * Обработка кнопок, модальных окон, переключения вкладок
 */

import { errorHandler } from '../modules/error-handler.js';
import { updateUserMuteStatus } from '../modules/firebase.js';

/**
 * Класс для обработки UI событий
 */
export class UIHandlers {
  constructor(state, ui, devices, webrtc, speechDetector, updateSpeechDetectorCallback) {
    this.state = state;
    this.ui = ui;
    this.devices = devices;
    this.webrtc = webrtc;
    this.speechDetector = speechDetector;
    this.updateSpeechDetectorCallback = updateSpeechDetectorCallback;
  }

  /**
   * Инициализирует все UI обработчики
   */
  init() {
    this.setupWindowControls();
    this.setupAudioControls();
    this.setupDeviceSelectors();
    this.setupTabSwitchers();
    this.setupModalHandlers();
    this.setupBackgroundControls();
  }

  /**
   * Настраивает обработчики управления окном
   */
  setupWindowControls() {
    // Закрытие окна
    if (this.ui.elements.closeBtn) {
      this.ui.elements.closeBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.closeWindow) {
          window.electronAPI.closeWindow();
        }
      });
    }

    // Сворачивание окна
    if (this.ui.elements.minimizeBtn) {
      this.ui.elements.minimizeBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.minimizeWindow) {
          window.electronAPI.minimizeWindow();
        }
      });
    }

    // Закрытие окна авторизации
    if (this.ui.elements.authCloseBtn) {
      this.ui.elements.authCloseBtn.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.closeWindow) {
          window.electronAPI.closeWindow();
        }
      });
    }
  }

  /**
   * Настраивает обработчики аудио контролов
   */
  setupAudioControls() {
    // Переключение микрофона
    if (this.ui.elements.muteBtn) {
      this.ui.elements.muteBtn.addEventListener("click", () => {
        this.toggleMute();
      });

      // ПКМ для контекстного меню микрофона
      this.ui.elements.muteBtn.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const currentVolume = this.webrtc.getMicrophoneVolume();
        // Получаем ID текущего устройства из webrtc или devices
        const currentDeviceId = this.webrtc.getCurrentMicDeviceId() || this.devices.getSelectedMicId();
        await this.devices.showMicContextMenu(
          e,
          (volume) => {
            // Callback для изменения громкости микрофона
            this.webrtc.setMicrophoneVolume(volume);
          },
          async (deviceId) => {
            // Callback для изменения устройства
            if (this.state.joined && deviceId) {
              try {
                await this.webrtc.updateMicrophone(deviceId);
                if (this.updateSpeechDetectorCallback) {
                  this.updateSpeechDetectorCallback();
                }
                // Обновляем выбранное устройство в селекторе
                if (this.devices.micSelect) {
                  this.devices.micSelect.value = deviceId;
                }
              } catch (error) {
                errorHandler.handle(error, { operation: 'selectMicrophone' });
                this.ui.showToast('Ошибка при смене микрофона');
              }
            }
          },
          currentVolume,
          currentDeviceId
        );
      });
    }

    // Переключение динамиков
    if (this.ui.elements.speakerBtn) {
      this.ui.elements.speakerBtn.addEventListener("click", () => {
        this.toggleSpeaker();
      });

      // ПКМ для контекстного меню динамиков
      this.ui.elements.speakerBtn.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const currentVolume = this.webrtc.getMasterVolume();
        // Получаем ID текущего устройства из webrtc или devices
        const currentDeviceId = this.webrtc.getCurrentSpeakerDeviceId() || this.devices.getSelectedSpeakerId();
        await this.devices.showSpeakerContextMenu(
          e,
          (volume) => {
            // Callback для изменения общей громкости
            this.webrtc.setMasterVolume(volume);
          },
          async (deviceId) => {
            // Callback для изменения устройства
            if (deviceId) {
              try {
                this.webrtc.applySpeakerSelection(deviceId);
                // Обновляем выбранное устройство в селекторе
                if (this.devices.speakerSelect) {
                  this.devices.speakerSelect.value = deviceId;
                }
              } catch (error) {
                errorHandler.handle(error, { operation: 'selectSpeaker' });
                this.ui.showToast('Ошибка при смене динамиков');
              }
            }
          },
          currentVolume,
          currentDeviceId
        );
      });
    }
  }

  /**
   * Переключает состояние микрофона
   */
  toggleMute() {
    try {
      this.state.muted = !this.state.muted;
      this.webrtc.toggleMute(this.state.muted);
      this.ui.updateMuteButton(this.state.muted);
      
      // Обновляем статус в Firebase
      if (this.state.myUserRef) {
        updateUserMuteStatus(this.state.myUserRef, this.state.muted);
      }
      
      // Обновляем детектор речи
      if (this.updateSpeechDetectorCallback) {
        this.updateSpeechDetectorCallback();
      }
    } catch (error) {
      errorHandler.handle(error, { operation: 'toggleMute' });
    }
  }

  /**
   * Переключает состояние динамиков
   */
  toggleSpeaker() {
    try {
      const speakerMuted = this.webrtc.toggleSpeaker();
      this.ui.updateSpeakerButton(speakerMuted);
    } catch (error) {
      errorHandler.handle(error, { operation: 'toggleSpeaker' });
    }
  }

  /**
   * Настраивает обработчики выбора устройств
   */
  setupDeviceSelectors() {
    // Выбор динамиков
    if (this.devices.speakerSelect) {
      this.devices.speakerSelect.addEventListener('change', () => {
        try {
          this.webrtc.applySpeakerSelection(this.devices.speakerSelect.value);
        } catch (error) {
          errorHandler.handle(error, { operation: 'selectSpeaker' });
        }
      });
      this.webrtc.setSpeakerSelect(this.devices.speakerSelect);
    }

    // Выбор микрофона
    if (this.devices.micSelect) {
      this.devices.micSelect.addEventListener('change', async () => {
        try {
          if (this.state.joined) {
            const deviceId = this.devices.getSelectedMicId();
            await this.webrtc.updateMicrophone(deviceId);
            if (this.updateSpeechDetectorCallback) {
              this.updateSpeechDetectorCallback();
            }
          }
        } catch (error) {
          errorHandler.handle(error, { operation: 'selectMicrophone' });
          this.ui.showToast('Ошибка при смене микрофона');
        }
      });
    }
  }

  /**
   * Настраивает обработчики переключения вкладок
   */
  setupTabSwitchers() {
    // Переключение между вкладками Комнаты/Друзья
    if (this.ui.elements.roomsTab && this.ui.elements.friendsTab) {
      this.ui.elements.roomsTab.addEventListener('click', async () => {
        try {
          // При переключении на вкладку "Комнаты" проверяем, загружены ли комнаты
          const roomsListEl = this.ui.elements?.roomsList || document.getElementById('roomsList');
          if (roomsListEl && roomsListEl.children.length === 0) {
            // Вызываем callback для загрузки комнат, если он установлен
            if (this.loadRoomsListCallback) {
              await this.loadRoomsListCallback(true);
            }
          }

          this.ui.elements.roomsTab.classList.add('active');
          this.ui.elements.friendsTab.classList.remove('active');
          this.ui.elements.roomsContent.classList.add('active');
          this.ui.elements.friendsContent.classList.remove('active');
        } catch (error) {
          errorHandler.handle(error, { operation: 'switchToRoomsTab' });
        }
      });

      this.ui.elements.friendsTab.addEventListener('click', async () => {
        try {
          this.ui.elements.friendsTab.classList.add('active');
          this.ui.elements.roomsTab.classList.remove('active');
          this.ui.elements.friendsContent.classList.add('active');
          this.ui.elements.roomsContent.classList.remove('active');

          // Загружаем друзей при переключении на вкладку "Друзья"
          if (this.loadFriendsCallback) {
            await this.loadFriendsCallback();
          }
        } catch (error) {
          errorHandler.handle(error, { operation: 'switchToFriendsTab' });
        }
      });
    }
  }

  /**
   * Настраивает обработчики модальных окон
   */
  setupModalHandlers() {
    // Кнопка консоли разработчика
    if (this.ui.elements.consoleBtn) {
      this.ui.elements.consoleBtn.addEventListener('click', () => {
        if (this.ui.elements.devConsole) {
          this.ui.elements.devConsole.classList.toggle('show');
        }
      });
    }

    // Кнопка уведомлений
    if (this.ui.elements.notificationsBtn) {
      this.ui.elements.notificationsBtn.addEventListener('click', async () => {
        try {
          if (this.ui.elements.notificationsModal) {
            this.ui.elements.notificationsModal.classList.add('show');
            // Загружаем уведомления при открытии модального окна
            if (this.loadNotificationsCallback) {
              await this.loadNotificationsCallback();
            }
          }
        } catch (error) {
          errorHandler.handle(error, { operation: 'openNotifications' });
        }
      });
    }

    // Закрытие модальных окон
    this.setupModalCloseHandlers();
  }

  /**
   * Настраивает обработчики закрытия модальных окон
   */
  setupModalCloseHandlers() {
    // Закрытие модального окна уведомлений
    if (this.ui.elements.notificationsCloseBtn) {
      this.ui.elements.notificationsCloseBtn.addEventListener('click', () => {
        if (this.ui.elements.notificationsModal) {
          this.ui.elements.notificationsModal.classList.remove('show');
        }
      });
    }

    // Закрытие при клике вне модального окна
    if (this.ui.elements.notificationsModal) {
      this.ui.elements.notificationsModal.addEventListener('click', (e) => {
        if (e.target === this.ui.elements.notificationsModal) {
          this.ui.elements.notificationsModal.classList.remove('show');
        }
      });
    }
  }

  /**
   * Настраивает обработчики управления фоном
   */
  setupBackgroundControls() {
    // Кнопка смены фона
    if (this.ui.elements.changeBgBtn) {
      this.ui.elements.changeBgBtn.addEventListener('click', () => {
        if (this.ui.elements.bgSelector) {
          this.ui.elements.bgSelector.classList.toggle('show');
        }
      });
    }
  }

  /**
   * Устанавливает callback для загрузки списка комнат
   */
  setLoadRoomsListCallback(callback) {
    this.loadRoomsListCallback = callback;
  }

  /**
   * Устанавливает callback для загрузки друзей
   */
  setLoadFriendsCallback(callback) {
    this.loadFriendsCallback = callback;
  }

  /**
   * Устанавливает callback для загрузки уведомлений
   */
  setLoadNotificationsCallback(callback) {
    this.loadNotificationsCallback = callback;
  }
}

