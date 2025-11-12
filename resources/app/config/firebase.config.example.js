// Firebase Configuration Template
// Скопируйте этот файл как firebase.config.js и заполните своими данными Firebase

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
};

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
} else {
  // Для использования в браузере/Electron
  window.firebaseConfig = firebaseConfig;
}

