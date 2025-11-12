// Firebase Configuration
// ВНИМАНИЕ: Этот файл содержит секретные данные и НЕ должен быть закоммичен в репозиторий!
// Используйте firebase.config.example.js как шаблон для создания своего конфига.

const firebaseConfig = {
  apiKey: "AIzaSyB_Bv6SQXTyC3meXH8u6apjz8NxMxkMkvw",
  authDomain: "voicechat-af036.firebaseapp.com",
  databaseURL: "https://voicechat-af036-default-rtdb.firebaseio.com",
  projectId: "voicechat-af036",
};

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
} else {
  // Для использования в браузере/Electron
  window.firebaseConfig = firebaseConfig;
}

