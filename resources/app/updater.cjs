/**
 * Модуль автообновления приложения
 * Использует electron-updater для проверки и установки обновлений с GitHub
 */

const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

// Настройки автообновления
autoUpdater.autoDownload = false; // Не скачивать автоматически
autoUpdater.autoInstallOnAppQuit = true; // Установить при выходе

// Настройка для публичного репозитория
// Токен НЕ нужен для публичных релизов
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'kosenkomaks1999-dotcom',
  repo: 'vibechat'
});

console.log('✅ Автообновление настроено для публичного репозитория');

class AppUpdater {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupListeners();
  }

  setupListeners() {
    // Проверка обновлений
    autoUpdater.on('checking-for-update', () => {
      console.log('🔍 Проверка обновлений...');
      this.sendStatusToWindow('checking');
    });

    // Обновление доступно
    autoUpdater.on('update-available', (info) => {
      console.log('✅ Доступно обновление:', info.version);
      this.sendStatusToWindow('available', { version: info.version });
    });

    // Обновление не доступно
    autoUpdater.on('update-not-available', (info) => {
      console.log('ℹ️ Обновлений нет. Текущая версия:', info.version);
      this.sendStatusToWindow('not-available');
    });

    // Ошибка при проверке
    autoUpdater.on('error', (err) => {
      console.error('❌ Ошибка автообновления:', err);
      console.error('❌ Сообщение ошибки:', err.message);
      if (err.stack) {
        console.error('❌ Stack trace:', err.stack);
      }
      this.sendStatusToWindow('error', { 
        message: err.message,
        stack: err.stack 
      });
    });

    // Прогресс скачивания
    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent);
      console.log(`📥 Скачивание: ${percent}%`);
      this.sendStatusToWindow('downloading', { percent });
    });

    // Обновление скачано
    autoUpdater.on('update-downloaded', (info) => {
      console.log('✅ Обновление скачано:', info.version);
      this.sendStatusToWindow('downloaded', { version: info.version });
      
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
  sendStatusToWindow(status, data = {}) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', status, data);
    }
  }

  // Проверить обновления
  checkForUpdates() {
    console.log('🔍 Ручная проверка обновлений...');
    console.log('📋 Настройки autoUpdater:');
    console.log('  - autoDownload:', autoUpdater.autoDownload);
    console.log('  - autoInstallOnAppQuit:', autoUpdater.autoInstallOnAppQuit);
    console.log('  - allowPrerelease:', autoUpdater.allowPrerelease);
    console.log('  - allowDowngrade:', autoUpdater.allowDowngrade);
    
    // Отправляем статус начала проверки
    this.sendStatusToWindow('checking');
    
    autoUpdater.checkForUpdates().then(result => {
      console.log('✅ Результат проверки обновлений:', result);
    }).catch(err => {
      console.error('❌ Ошибка проверки обновлений:', err);
      console.error('❌ Сообщение:', err.message);
      if (err.stack) {
        console.error('❌ Stack:', err.stack);
      }
      this.sendStatusToWindow('error', { 
        message: err.message,
        stack: err.stack 
      });
    });
  }

  // Загрузить обновление
  downloadUpdate() {
    console.log('📥 Начало загрузки обновления...');
    autoUpdater.downloadUpdate();
  }

  // Принудительно загрузить текущую версию
  forceDownload() {
    console.log('🔄 Принудительная загрузка текущей версии...');
    
    // Включаем allowDowngrade чтобы можно было "обновиться" на ту же версию
    autoUpdater.allowDowngrade = true;
    
    // Отправляем статус начала проверки
    this.sendStatusToWindow('checking');
    
    // Проверяем обновления
    autoUpdater.checkForUpdates().then(result => {
      console.log('✅ Результат проверки:', result);
      
      // Даже если версия та же, пытаемся скачать
      if (result && result.updateInfo) {
        console.log('📥 Начинаем загрузку версии:', result.updateInfo.version);
        this.sendStatusToWindow('downloading', { percent: 0 });
        autoUpdater.downloadUpdate().catch(err => {
          console.error('❌ Ошибка загрузки:', err);
          this.sendStatusToWindow('error', { 
            message: 'Не удалось загрузить обновление',
            stack: err.stack 
          });
        });
      } else {
        console.log('ℹ️ Информация об обновлении недоступна');
        this.sendStatusToWindow('not-available');
      }
    }).catch(err => {
      console.error('❌ Ошибка при принудительной загрузке:', err);
      this.sendStatusToWindow('error', { 
        message: err.message,
        stack: err.stack 
      });
    }).finally(() => {
      // Возвращаем настройку обратно
      autoUpdater.allowDowngrade = false;
    });
  }
}

module.exports = AppUpdater;
