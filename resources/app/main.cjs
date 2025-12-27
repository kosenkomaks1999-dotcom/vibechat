// Загружаем переменные окружения из .env файла
require('dotenv').config();

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { existsSync, mkdirSync } = require('fs');
const AppUpdater = require('./updater.cjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,      // Начальная ширина
    height: 720,      // Начальная высота
    minWidth: 1000,   // Минимальная ширина
    minHeight: 600,   // Минимальная высота
    // Убраны ограничения maxWidth/maxHeight - теперь можно изменять размер
    frame: false,     // убираем стандартный title bar
    resizable: true,  // Разрешаем изменение размера
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'), // Иконка окна приложения
    webPreferences: {
      // Улучшенная безопасность: отключаем прямой доступ к Node.js
      nodeIntegration: false,        // Отключено для безопасности
      contextIsolation: true,        // Включено для изоляции контекста
      webSecurity: true,              // Включаем веб-безопасность
      allowRunningInsecureContent: false,
      // Preload скрипт для безопасного доступа к Electron API
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.center(); // Центрируем окно
  
  // Загружаем приложение
  win.loadFile(path.join(__dirname, 'index.html'));
  
  // Открываем DevTools только в режиме разработки (npm start)
  if (!app.isPackaged) {
    win.webContents.openDevTools();
    console.log('🔧 DevTools открыты (режим разработки)');
  }

  // Открываем внешние ссылки в системном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Проверяем, что это внешняя ссылка (http/https)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' }; // Предотвращаем открытие в Electron
    }
    return { action: 'allow' };
  });

  // Перехватываем клики по ссылкам для открытия в системном браузере
  win.webContents.on('will-navigate', (event, url) => {
    // Если это внешняя ссылка, открываем в системном браузере
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Обработчик для закрытия окна
  ipcMain.on('close-window', () => {
    // Отправляем событие в renderer для очистки ресурсов
    if (win && !win.isDestroyed()) {
      win.webContents.send('app-closing');
      // Даем время на очистку ресурсов
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.close();
        }
      }, 500);
    }
  });
  
  // Обработчик события закрытия окна
  win.on('close', (event) => {
    // Предотвращаем закрытие для очистки ресурсов
    if (!win.isReadyToClose) {
      event.preventDefault();
      win.webContents.send('app-closing');
      // Даем время на очистку
      setTimeout(() => {
        win.isReadyToClose = true;
        win.close();
      }, 500);
    }
  });

  // Обработчик для сворачивания окна
  ipcMain.on('minimize-window', () => {
    win.minimize();
  });

  // Обработчик для изменения размера окна
  ipcMain.on('set-window-size', (event, width, height, center = true) => {
    if (win && !win.isDestroyed()) {
      win.setSize(width, height, false);
      // Устанавливаем минимальные размеры для окна авторизации
      win.setMinimumSize(500, 550);
      if (center) {
        win.center();
      }
      // Предотвращаем изменение размера окна пользователем
      win.setResizable(false);
    }
  });

  // Обработчик для восстановления размера окна
  ipcMain.on('restore-window-size', (event, width, height, minWidth, minHeight, resizable = true) => {
    if (win && !win.isDestroyed()) {
      win.setSize(width, height, false);
      if (minWidth && minHeight) {
        win.setMinimumSize(minWidth, minHeight);
      }
      win.setResizable(resizable);
      win.center();
    }
  });
  
  return win;
}

// Глобальная переменная для хранения пути к папке логов
let logDirPath = null;

// Функция получения пути к файлу логов (без лишнего логирования для производительности)
function getLogFilePath() {
  try {
    // Используем userData для логов (работает и в dev, и в production)
    const logDir = path.join(app.getPath('userData'), 'logs');
    
    // Создаем директорию логов, если её нет (тихо, без логирования)
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Имя файла с датой
    const today = new Date().toISOString().split('T')[0];
    return path.join(logDir, `vibechat-${today}.txt`);
  } catch (error) {
    console.error('Ошибка создания пути к логам:', error);
    // Fallback: используем temp директорию
    const fallbackDir = path.join(app.getPath('temp'), 'vibechat-logs');
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    const today = new Date().toISOString().split('T')[0];
    return path.join(fallbackDir, `vibechat-${today}.txt`);
  }
}

// Обработчик записи в лог файл
ipcMain.handle('write-log', async (event, logLine) => {
  try {
    const logFilePath = getLogFilePath();
    const logEntry = logLine + '\n';
    
    // Асинхронная запись в файл (append)
    await fs.appendFile(logFilePath, logEntry, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Ошибка записи в лог файл:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Обработчик чтения лог файла
ipcMain.handle('read-log-file', async (event) => {
  try {
    const logFilePath = getLogFilePath();
    
    if (!existsSync(logFilePath)) {
      return '';
    }
    
    const content = await fs.readFile(logFilePath, 'utf8');
    return content;
  } catch (error) {
    console.error('Ошибка чтения лог файла:', error);
    return '';
  }
});

// Обработчик получения пути к файлу логов
ipcMain.handle('get-log-file-path', async (event) => {
  return getLogFilePath();
});



// Функция получения пути к файлу логов комнат
function getRoomLogFilePath() {
  try {
    // Используем userData для логов (работает и в dev, и в production)
    const logDir = path.join(app.getPath('userData'), 'logs');
    
    // Создаем директорию логов, если её нет
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Имя файла с датой
    const today = new Date().toISOString().split('T')[0];
    return path.join(logDir, `rooms-${today}.txt`);
  } catch (error) {
    console.error('Ошибка создания пути к логам комнат:', error);
    // Fallback: используем temp директорию
    const fallbackDir = path.join(app.getPath('temp'), 'vibechat-logs');
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true });
    }
    const today = new Date().toISOString().split('T')[0];
    return path.join(fallbackDir, `rooms-${today}.txt`);
  }
}

// Обработчик записи в лог файл комнат
ipcMain.handle('write-room-log', async (event, logLine) => {
  try {
    const logFilePath = getRoomLogFilePath();
    
    // Асинхронная запись в файл (append)
    await fs.appendFile(logFilePath, logLine, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Ошибка записи в лог файл комнат:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Инициализация путей к логам будет выполнена после app.whenReady()

let updater = null;



app.whenReady().then(async () => {
  // Инициализируем систему логирования после готовности app
  const logPath = getLogFilePath();
  const roomLogPath = getRoomLogFilePath();
  logDirPath = path.join(app.getPath('userData'), 'logs');
  console.log('Логи записываются в:', logPath);
  console.log('Логи комнат записываются в:', roomLogPath);
  
  const win = createWindow();
  
  // Инициализация автообновления
  updater = new AppUpdater(win);
  
  // Обработчики IPC для обновлений
  ipcMain.on('check-for-updates', () => {
    if (updater) {
      updater.checkForUpdates();
    }
  });
  
  ipcMain.on('download-update', () => {
    if (updater) {
      updater.downloadUpdate();
    }
  });
  
  ipcMain.on('force-download-update', () => {
    if (updater) {
      updater.forceDownload();
    }
  });
});

app.on('window-all-closed', () => {
  // Принудительно завершаем все процессы
  console.log('🔴 Все окна закрыты, завершение приложения...');
  app.quit();
});

app.on('before-quit', () => {
  console.log('🔴 Приложение завершается...');
});

app.on('will-quit', () => {
  console.log('🔴 Завершение всех процессов...');
  // Удаляем все IPC слушатели
  ipcMain.removeAllListeners();
});


