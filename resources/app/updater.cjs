/**
 * Модуль автообновления приложения
 * Использует electron-updater для проверки и установки обновлений с GitHub
 */

const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

// Настройки автообновления
autoUpdater.autoDownload = false; // Не скачивать автоматически
autoUpdater.autoInstallOnAppQuit = true; // Установить при выходе

class AppUpdater {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupListeners();
  }

  setupListeners() {
    // Проверка обновлений
    autoUpdater.on('checking-for-update', () => {
      console.log('🔍 Проверка обновлений...');
      this.sendStatusToWindow('Проверка обновлений...');
    });

    // Обновление доступно
    autoUpdater.on('update-available', (info) => {
      console.log('✅ Доступно обновление:', info.version);
      this.sendStatusToWindow(`Доступна новая версия ${info.version}`);
      
      // Показываем диалог
      dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Доступно обновление',
        message: `Доступна новая версия ${info.version}`,
        detail: 'Хотите скачать и установить обновление?',
        buttons: ['Да', 'Позже'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          // Пользователь нажал "Да"
          autoUpdater.downloadUpdate();
        }
      });
    });

    // Обновление не доступно
    autoUpdater.on('update-not-available', (info) => {
      console.log('ℹ️ Обновлений нет. Текущая версия:', info.version);
      this.sendStatusToWindow('Приложение обновлено');
    });

    // Ошибка при проверке
    autoUpdater.on('error', (err) => {
      console.error('❌ Ошибка автообновления:', err);
      this.sendStatusToWindow('Ошибка проверки обновлений');
    });

    // Прогресс скачивания
    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent);
      console.log(`📥 Скачивание: ${percent}%`);
      this.sendStatusToWindow(`Скачивание обновления: ${percent}%`);
    });

    // Обновление скачано
    autoUpdater.on('update-downloaded', (info) => {
      console.log('✅ Обновление скачано:', info.version);
      this.sendStatusToWindow('Обновление готово к установке');
      
      // Показываем диалог
      dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        title: 'Обновление готово',
        message: 'Обновление скачано и готово к установке',
        detail: 'Приложение будет перезапущено для установки обновления',
        buttons: ['Перезапустить сейчас', 'Позже'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          // Пользователь нажал "Перезапустить"
          autoUpdater.quitAndInstall(false, true);
        }
      });
    });
  }

  // Отправка статуса в окно приложения
  sendStatusToWindow(text) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', text);
    }
  }

  // Проверить обновления
  checkForUpdates() {
    autoUpdater.checkForUpdates();
  }

  // Проверить обновления вручную (по кнопке)
  checkForUpdatesManual() {
    autoUpdater.checkForUpdates().then(result => {
      if (!result || !result.updateInfo) {
        dialog.showMessageBox(this.mainWindow, {
          type: 'info',
          title: 'Проверка обновлений',
          message: 'У вас установлена последняя версия',
          buttons: ['OK']
        });
      }
    }).catch(err => {
      dialog.showMessageBox(this.mainWindow, {
        type: 'error',
        title: 'Ошибка',
        message: 'Не удалось проверить обновления',
        detail: err.message,
        buttons: ['OK']
      });
    });
  }
}

module.exports = AppUpdater;
