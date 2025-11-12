const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { existsSync, mkdirSync } = require('fs');
const AppUpdater = require('./updater.cjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 500,       // Начальная ширина для окна авторизации
    height: 750,      // Начальная высота для окна авторизации (увеличено для формы регистрации с 4 полями)
    minWidth: 500,
    minHeight: 750,
    // Убраны ограничения maxWidth/maxHeight - теперь можно изменять размер
    frame: false,     // убираем стандартный title bar
    resizable: false, // Начинаем с фиксированного размера (будет изменен после авторизации)
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'), // Иконка окна приложения
    webPreferences: {
      // Улучшенная безопасность: отключаем прямой доступ к Node.js
      nodeIntegration: false,        // Отключено для безопасности
      contextIsolation: true,        // Включено для изоляции контекста
      webSecurity: true,              // Включаем веб-безопасность
      allowRunningInsecureContent: false,
      // КРИТИЧНО: Отключаем кэширование для загрузки новой версии
      cache: false,                   // Отключаем кэш
      // Preload скрипт для безопасного доступа к Electron API
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.center(); // Центрируем окно
  
  // КРИТИЧНО: Очищаем кэш сессии перед загрузкой
  win.webContents.session.clearCache().then(() => {
    console.log('Кэш очищен перед загрузкой');
    win.loadFile('index.html');
  }).catch(err => {
    console.error('Ошибка очистки кэша:', err);
    win.loadFile('index.html');
  });
  
  // win.webContents.openDevTools(); // если нужно открыть DevTools

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
    // Путь к корневой папке проекта
    const projectRoot = path.resolve(__dirname, '..', '..');
    const logDir = path.join(projectRoot, 'logs');
    
    // Создаем директорию логов, если её нет (тихо, без логирования)
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Имя файла с датой
    const today = new Date().toISOString().split('T')[0];
    return path.join(logDir, `vibechat-${today}.txt`);
  } catch (error) {
    // Fallback: используем текущую директорию
    const fallbackDir = path.join(__dirname, 'logs');
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
    // Путь к корневой папке проекта
    const projectRoot = path.resolve(__dirname, '..', '..');
    const logDir = path.join(projectRoot, 'logs');
    
    // Создаем директорию логов, если её нет
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Имя файла с датой
    const today = new Date().toISOString().split('T')[0];
    return path.join(logDir, `rooms-${today}.txt`);
  } catch (error) {
    // Fallback: используем текущую директорию
    const fallbackDir = path.join(__dirname, 'logs');
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

// Инициализируем систему логирования при старте (тихо, без блокировки)
const logPath = getLogFilePath();
const roomLogPath = getRoomLogFilePath();
const projectRoot = path.resolve(__dirname, '..', '..');
logDirPath = path.join(projectRoot, 'logs');
console.log('Логи записываются в:', logPath);
console.log('Логи комнат записываются в:', roomLogPath);

let updater = null;

app.whenReady().then(async () => {
  // КРИТИЧНО: Очищаем весь кэш приложения при запуске
  try {
    const session = require('electron').session;
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['appcache', 'serviceworkers', 'cachestorage']
    });
    console.log('✅ Кэш приложения полностью очищен при запуске');
  } catch (err) {
    console.error('⚠️ Ошибка очистки кэша:', err);
  }
  
  const win = createWindow();
  
  // Инициализация автообновления
  updater = new AppUpdater(win);
  
  // Проверка обновлений через 3 секунды после запуска
  setTimeout(() => {
    updater.checkForUpdates();
  }, 3000);
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


