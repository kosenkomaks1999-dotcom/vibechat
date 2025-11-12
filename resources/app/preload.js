/**
 * Preload скрипт для безопасного доступа к Electron API
 * Этот скрипт выполняется в изолированном контексте перед загрузкой страницы
 */

const { contextBridge, ipcRenderer } = require('electron');

// Предоставляем безопасный API для рендерера
contextBridge.exposeInMainWorld('electronAPI', {
  // Закрытие окна
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Сворачивание окна
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  
  // Изменение размера окна
  setWindowSize: (width, height, center = true) => ipcRenderer.send('set-window-size', width, height, center),
  
  // Восстановление размера окна
  restoreWindowSize: (width, height, minWidth, minHeight, resizable = true) => 
    ipcRenderer.send('restore-window-size', width, height, minWidth, minHeight, resizable),
  
  // Запись в лог файл
  writeLog: (logLine) => ipcRenderer.invoke('write-log', logLine),
  
  // Запись в лог файл комнат
  writeRoomLog: (logLine) => ipcRenderer.invoke('write-room-log', logLine),
  
  // Чтение лог файла
  readLogFile: () => ipcRenderer.invoke('read-log-file'),
  
  // Получение пути к файлу логов
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  
  // Обработчик события закрытия приложения
  onAppClosing: (callback) => ipcRenderer.on('app-closing', callback),
});

