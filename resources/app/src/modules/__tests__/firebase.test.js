/**
 * Тесты для модуля Firebase
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Мокаем Firebase
global.firebase = {
  initializeApp: jest.fn(),
  database: jest.fn(() => ({
    ref: jest.fn()
  })),
  auth: jest.fn()
};

describe('Firebase Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initFirebase', () => {
    it('должен инициализировать Firebase с конфигурацией', async () => {
      window.firebaseConfig = {
        apiKey: 'test-key',
        authDomain: 'test.firebaseapp.com',
        databaseURL: 'https://test.firebaseio.com',
        projectId: 'test-project'
      };

      const { initFirebase } = await import('../firebase.js');
      const result = initFirebase();

      expect(firebase.initializeApp).toHaveBeenCalledWith(window.firebaseConfig);
      expect(result.database).toBeDefined();
      expect(result.auth).toBeDefined();
    });

    it('должен выбрасывать ошибку если конфигурация не найдена', async () => {
      window.firebaseConfig = undefined;

      const { initFirebase } = await import('../firebase.js');
      
      expect(() => initFirebase()).toThrow('Firebase configuration not found');
    });
  });

  describe('getRoomRef', () => {
    it('должен создавать ссылку на комнату', async () => {
      const mockDb = {
        ref: jest.fn((path) => ({ path }))
      };

      const { getRoomRef } = await import('../firebase.js');
      const result = getRoomRef(mockDb, 'test-room');

      expect(mockDb.ref).toHaveBeenCalledWith('rooms/test-room');
      expect(result.path).toBe('rooms/test-room');
    });
  });

  describe('isNicknameTaken', () => {
    it('должен проверять занятость никнейма', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => true)
          }))
        }))
      };

      const { isNicknameTaken } = await import('../firebase.js');
      const result = await isNicknameTaken(mockDb, 'testuser');

      expect(result).toBe(true);
      expect(mockDb.ref).toHaveBeenCalledWith('nicknames/testuser');
    });

    it('должен возвращать false если никнейм свободен', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => false)
          }))
        }))
      };

      const { isNicknameTaken } = await import('../firebase.js');
      const result = await isNicknameTaken(mockDb, 'testuser');

      expect(result).toBe(false);
    });

    it('должен нормализовать никнейм (trim и lowercase)', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => false)
          }))
        }))
      };

      const { isNicknameTaken } = await import('../firebase.js');
      await isNicknameTaken(mockDb, '  TestUser  ');

      expect(mockDb.ref).toHaveBeenCalledWith('nicknames/testuser');
    });
  });

  describe('generateUniqueRoomId', () => {
    it('должен генерировать уникальный ID комнаты', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => false)
          }))
        }))
      };

      const { generateUniqueRoomId } = await import('../firebase.js');
      const roomId = await generateUniqueRoomId(mockDb);

      expect(roomId).toBeDefined();
      expect(typeof roomId).toBe('string');
      expect(roomId.length).toBeGreaterThan(0);
    });

    it('должен генерировать ID указанной длины', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => false)
          }))
        }))
      };

      const { generateUniqueRoomId } = await import('../firebase.js');
      const roomId = await generateUniqueRoomId(mockDb, 10);

      expect(roomId.length).toBe(10);
    });
  });

  describe('roomExists', () => {
    it('должен проверять существование комнаты', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => true)
          }))
        }))
      };

      const { roomExists } = await import('../firebase.js');
      const result = await roomExists(mockDb, 'test-room');

      expect(result).toBe(true);
    });

    it('должен возвращать false если комната не существует', async () => {
      const mockDb = {
        ref: jest.fn(() => ({
          once: jest.fn(() => Promise.resolve({
            exists: jest.fn(() => false)
          }))
        }))
      };

      const { roomExists } = await import('../firebase.js');
      const result = await roomExists(mockDb, 'nonexistent-room');

      expect(result).toBe(false);
    });
  });
});

