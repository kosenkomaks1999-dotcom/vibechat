/**
 * Модуль для работы с авторизацией
 * Регистрация, вход, выход пользователей через Firebase Authentication
 */

/**
 * Класс для управления авторизацией
 */
export class AuthManager {
  constructor(auth) {
    this.auth = auth;
    this.currentUser = null;
  }

  /**
   * Регистрирует нового пользователя
   * @param {string} email - Email пользователя
   * @param {string} password - Пароль пользователя
   * @returns {Promise<Object>} Promise с данными пользователя
   */
  async signUp(email, password) {
    try {
      const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
      this.currentUser = userCredential.user;
      return { success: true, user: userCredential.user };
    } catch (error) {
      let errorMessage = 'Ошибка при регистрации';
      
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'Этот email уже используется';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Неверный формат email';
          break;
        case 'auth/weak-password':
          errorMessage = 'Пароль слишком слабый (минимум 6 символов)';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Регистрация через email/password отключена';
          break;
        default:
          errorMessage = error.message || 'Неизвестная ошибка';
      }
      
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Входит в аккаунт пользователя по email или никнейму
   * @param {string} login - Email или никнейм пользователя
   * @param {string} password - Пароль пользователя
   * @param {Function} getEmailByNickname - Функция для получения email по никнейму (опционально)
   * @returns {Promise<Object>} Promise с данными пользователя
   */
  async signIn(login, password, getEmailByNickname = null) {
    try {
      let email = login.trim();
      
      // Проверяем, является ли введенное значение email или никнеймом
      const isEmail = email.includes('@');
      
      // Если это не email, пытаемся найти email по никнейму
      if (!isEmail && getEmailByNickname) {
        console.log('Попытка входа по никнейму:', email);
        const emailByNickname = await getEmailByNickname(email);
        console.log('Результат поиска email по никнейму:', emailByNickname);
        if (!emailByNickname) {
          // Никнейм не найден
          console.log('Никнейм не найден или email не найден для никнейма:', email);
          return { success: false, error: 'Неверный логин или пароль' };
        }
        email = emailByNickname;
        console.log('Используется email для входа:', email);
      } else if (!isEmail) {
        // Если функция получения email не предоставлена, показываем ошибку
        console.error('Функция получения email по никнейму не предоставлена');
        return { success: false, error: 'Для входа по никнейму требуется подключение к базе данных' };
      }
      
      // Выполняем вход через email
      const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
      this.currentUser = userCredential.user;
      return { success: true, user: userCredential.user };
    } catch (error) {
      // Для безопасности всегда показываем одинаковое сообщение об ошибке
      // Это предотвращает утечку информации о существовании аккаунтов
      let errorMessage = 'Неверный логин или пароль';
      
      switch (error.code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          // Все ошибки аутентификации показываем одинаково
          errorMessage = 'Неверный логин или пароль';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Неверный формат email';
          break;
        case 'auth/user-disabled':
          errorMessage = 'Аккаунт заблокирован. Обратитесь к администратору';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Слишком много попыток входа. Попробуйте позже';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Ошибка сети. Проверьте подключение к интернету';
          break;
        default:
          // Для всех остальных ошибок тоже показываем общее сообщение
          errorMessage = 'Неверный логин или пароль';
      }
      
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Выходит из аккаунта
   * @returns {Promise<Object>} Promise с результатом выхода
   */
  async signOut() {
    try {
      await this.auth.signOut();
      this.currentUser = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Ошибка при выходе' };
    }
  }

  /**
   * Получает текущего пользователя
   * @returns {Object|null} Текущий пользователь или null
   */
  getCurrentUser() {
    return this.auth.currentUser;
  }

  /**
   * Проверяет, авторизован ли пользователь
   * @returns {boolean} true если пользователь авторизован
   */
  isAuthenticated() {
    return this.auth.currentUser !== null;
  }

  /**
   * Подписывается на изменения состояния авторизации
   * @param {Function} callback - Функция обратного вызова (user) => {}
   * @returns {Function} Функция отписки
   */
  onAuthStateChanged(callback) {
    return this.auth.onAuthStateChanged(callback);
  }
}

