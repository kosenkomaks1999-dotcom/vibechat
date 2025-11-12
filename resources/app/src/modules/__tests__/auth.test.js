/**
 * Тесты для модуля auth.js
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../auth.js';

// Мокаем Firebase
const mockAuth = {
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  currentUser: null,
  onAuthStateChanged: jest.fn((callback) => {
    // Симулируем вызов callback сразу
    callback(mockAuth.currentUser);
    return () => {}; // unsubscribe функция
  })
};

describe('AuthManager', () => {
  let authManager;

  beforeEach(() => {
    jest.clearAllMocks();
    authManager = new AuthManager(mockAuth);
  });

  describe('signUp', () => {
    it('должен успешно регистрировать пользователя', async () => {
      const mockUser = { uid: '123', email: 'test@test.com' };
      mockAuth.createUserWithEmailAndPassword.mockResolvedValue({
        user: mockUser
      });

      const result = await authManager.signUp('test@test.com', 'password123');

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(mockAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith('test@test.com', 'password123');
    });

    it('должен обрабатывать ошибку email уже используется', async () => {
      const error = { code: 'auth/email-already-in-use' };
      mockAuth.createUserWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signUp('test@test.com', 'password123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Этот email уже используется');
    });

    it('должен обрабатывать ошибку слабого пароля', async () => {
      const error = { code: 'auth/weak-password' };
      mockAuth.createUserWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signUp('test@test.com', '123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Пароль слишком слабый (минимум 6 символов)');
    });

    it('должен обрабатывать ошибку неверного email', async () => {
      const error = { code: 'auth/invalid-email' };
      mockAuth.createUserWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signUp('invalid-email', 'password123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Неверный формат email');
    });
  });

  describe('signIn', () => {
    it('должен успешно входить по email', async () => {
      const mockUser = { uid: '123', email: 'test@test.com' };
      mockAuth.signInWithEmailAndPassword.mockResolvedValue({
        user: mockUser
      });

      const result = await authManager.signIn('test@test.com', 'password123');

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(mockAuth.signInWithEmailAndPassword).toHaveBeenCalledWith('test@test.com', 'password123');
    });

    it('должен входить по никнейму если передан getEmailByNickname', async () => {
      const mockUser = { uid: '123', email: 'test@test.com' };
      const mockGetEmailByNickname = jest.fn().mockResolvedValue('test@test.com');
      mockAuth.signInWithEmailAndPassword.mockResolvedValue({
        user: mockUser
      });

      const result = await authManager.signIn('testuser', 'password123', mockGetEmailByNickname);

      expect(result.success).toBe(true);
      expect(mockGetEmailByNickname).toHaveBeenCalledWith('testuser');
      expect(mockAuth.signInWithEmailAndPassword).toHaveBeenCalledWith('test@test.com', 'password123');
    });

    it('должен обрабатывать ошибку неверных данных', async () => {
      const error = { code: 'auth/wrong-password' };
      mockAuth.signInWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signIn('test@test.com', 'wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Неверный логин или пароль');
    });

    it('должен обрабатывать ошибку пользователь не найден', async () => {
      const error = { code: 'auth/user-not-found' };
      mockAuth.signInWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signIn('test@test.com', 'password123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Неверный логин или пароль');
    });

    it('должен обрабатывать сетевую ошибку', async () => {
      const error = { code: 'auth/network-request-failed' };
      mockAuth.signInWithEmailAndPassword.mockRejectedValue(error);

      const result = await authManager.signIn('test@test.com', 'password123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ошибка сети. Проверьте подключение к интернету');
    });
  });

  describe('signOut', () => {
    it('должен успешно выходить из аккаунта', async () => {
      mockAuth.signOut.mockResolvedValue();

      const result = await authManager.signOut();

      expect(result.success).toBe(true);
      expect(mockAuth.signOut).toHaveBeenCalled();
    });

    it('должен обрабатывать ошибку выхода', async () => {
      const error = new Error('Sign out failed');
      mockAuth.signOut.mockRejectedValue(error);

      const result = await authManager.signOut();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sign out failed');
    });
  });

  describe('getCurrentUser', () => {
    it('должен возвращать текущего пользователя', () => {
      const mockUser = { uid: '123', email: 'test@test.com' };
      mockAuth.currentUser = mockUser;

      const user = authManager.getCurrentUser();

      expect(user).toEqual(mockUser);
    });

    it('должен возвращать null если пользователь не авторизован', () => {
      mockAuth.currentUser = null;

      const user = authManager.getCurrentUser();

      expect(user).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('должен возвращать true если пользователь авторизован', () => {
      mockAuth.currentUser = { uid: '123' };

      expect(authManager.isAuthenticated()).toBe(true);
    });

    it('должен возвращать false если пользователь не авторизован', () => {
      mockAuth.currentUser = null;

      expect(authManager.isAuthenticated()).toBe(false);
    });
  });

  describe('onAuthStateChanged', () => {
    it('должен подписываться на изменения состояния авторизации', () => {
      const callback = jest.fn();
      authManager.onAuthStateChanged(callback);

      expect(mockAuth.onAuthStateChanged).toHaveBeenCalled();
    });

    it('должен возвращать функцию отписки', () => {
      const callback = jest.fn();
      const unsubscribe = authManager.onAuthStateChanged(callback);

      expect(typeof unsubscribe).toBe('function');
    });
  });
});


