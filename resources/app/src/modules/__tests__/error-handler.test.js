/**
 * Тесты для модуля error-handler.js
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ErrorHandler, AppError, ErrorCodes } from '../error-handler.js';

describe('ErrorHandler', () => {
  let errorHandler;
  let mockToastCallback;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
    mockToastCallback = jest.fn();
    errorHandler.setUIToastCallback(mockToastCallback);
  });

  describe('handle', () => {
    it('должен обрабатывать AppError', () => {
      const error = new AppError('Test error', ErrorCodes.UNKNOWN);
      const handled = errorHandler.handle(error);

      expect(handled).toBeInstanceOf(AppError);
      expect(handled.message).toBe('Test error');
      expect(mockToastCallback).toHaveBeenCalled();
    });

    it('должен обрабатывать обычную Error', () => {
      const error = new Error('Test error');
      const handled = errorHandler.handle(error);

      expect(handled).toBeInstanceOf(AppError);
      expect(handled.message).toBe('Test error');
      expect(mockToastCallback).toHaveBeenCalled();
    });

    it('должен обрабатывать строку', () => {
      const handled = errorHandler.handle('Test error');

      expect(handled).toBeInstanceOf(AppError);
      expect(handled.message).toBe('Test error');
      expect(mockToastCallback).toHaveBeenCalled();
    });

    it('должен добавлять контекст', () => {
      const error = new Error('Test error');
      const context = { operation: 'test', userId: '123' };
      const handled = errorHandler.handle(error, context);

      expect(handled.context).toEqual(context);
    });

    it('не должен показывать toast если showToast = false', () => {
      const error = new Error('Test error');
      errorHandler.handle(error, {}, { showToast: false });

      expect(mockToastCallback).not.toHaveBeenCalled();
    });
  });

  describe('handleSilent', () => {
    it('не должен показывать toast', () => {
      const error = new Error('Test error');
      errorHandler.handleSilent(error);

      expect(mockToastCallback).not.toHaveBeenCalled();
    });
  });

  describe('_detectErrorCode', () => {
    it('должен определять сетевые ошибки', () => {
      const error = new Error('Network error');
      const handled = errorHandler.handle(error);

      expect(handled.code).toBe(ErrorCodes.NETWORK);
    });

    it('должен определять ошибки авторизации', () => {
      const error = new Error('Auth failed');
      const handled = errorHandler.handle(error);

      expect(handled.code).toBe(ErrorCodes.AUTH_FAILED);
    });

    it('должен определять ошибки комнат', () => {
      const error = new Error('Room not found');
      const handled = errorHandler.handle(error);

      expect(handled.code).toBe(ErrorCodes.ROOM_NOT_FOUND);
    });

    it('должен определять ошибки файлов', () => {
      const error = new Error('File too large');
      const handled = errorHandler.handle(error);

      expect(handled.code).toBe(ErrorCodes.FILE_TOO_LARGE);
    });
  });

  describe('createError', () => {
    it('должен создавать AppError', () => {
      const error = errorHandler.createError('Test error', ErrorCodes.NETWORK, { test: true });

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCodes.NETWORK);
      expect(error.context).toEqual({ test: true });
    });
  });

  describe('wrapAsync', () => {
    it('должен обрабатывать ошибки в асинхронной функции', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = errorHandler.wrapAsync(fn);

      await expect(wrapped()).rejects.toThrow('Test error');
      expect(mockToastCallback).toHaveBeenCalled();
    });

    it('должен пропускать успешные вызовы', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const wrapped = errorHandler.wrapAsync(fn);

      const result = await wrapped();
      expect(result).toBe('success');
      expect(mockToastCallback).not.toHaveBeenCalled();
    });
  });
});

describe('AppError', () => {
  it('должен создавать ошибку с кодом', () => {
    const error = new AppError('Test error', ErrorCodes.NETWORK);

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCodes.NETWORK);
    expect(error.name).toBe('AppError');
  });

  it('должен сохранять контекст', () => {
    const context = { userId: '123', operation: 'test' };
    const error = new AppError('Test error', ErrorCodes.UNKNOWN, context);

    expect(error.context).toEqual(context);
  });

  it('должен сохранять оригинальную ошибку', () => {
    const originalError = new Error('Original error');
    const error = new AppError('Test error', ErrorCodes.UNKNOWN, null, originalError);

    expect(error.originalError).toBe(originalError);
  });

  it('должен преобразовываться в JSON', () => {
    const error = new AppError('Test error', ErrorCodes.NETWORK, { test: true });
    const json = error.toJSON();

    expect(json).toHaveProperty('name', 'AppError');
    expect(json).toHaveProperty('message', 'Test error');
    expect(json).toHaveProperty('code', ErrorCodes.NETWORK);
    expect(json).toHaveProperty('context', { test: true });
    expect(json).toHaveProperty('timestamp');
  });
});


