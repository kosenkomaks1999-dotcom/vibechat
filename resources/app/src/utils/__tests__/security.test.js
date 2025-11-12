/**
 * Тесты для модуля security.js
 */

import { describe, it, expect } from '@jest/globals';
import { escapeHtml, validateMessageLength, validateFileSize, validateNicknameLength, validateNicknameFormat } from '../security.js';

describe('security', () => {
  describe('escapeHtml', () => {
    it('должен экранировать HTML теги', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('должен экранировать амперсанд', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('должен экранировать кавычки', () => {
      expect(escapeHtml('He said "hello"')).toBe('He said &quot;hello&quot;');
    });

    it('должен обрабатывать null и undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('должен обрабатывать обычный текст', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('validateMessageLength', () => {
    it('должен возвращать true для валидной длины', () => {
      expect(validateMessageLength('Hello', 10)).toBe(true);
    });

    it('должен возвращать false для слишком длинного сообщения', () => {
      expect(validateMessageLength('A'.repeat(201), 200)).toBe(false);
    });

    it('должен возвращать false для пустой строки', () => {
      expect(validateMessageLength('', 10)).toBe(false);
    });

    it('должен возвращать true для сообщения максимальной длины', () => {
      expect(validateMessageLength('A'.repeat(200), 200)).toBe(true);
    });
  });

  describe('validateFileSize', () => {
    it('должен возвращать true для валидного размера файла', () => {
      expect(validateFileSize(1024 * 1024, 10 * 1024 * 1024)).toBe(true);
    });

    it('должен возвращать false для слишком большого файла', () => {
      expect(validateFileSize(11 * 1024 * 1024, 10 * 1024 * 1024)).toBe(false);
    });

    it('должен возвращать true для файла максимального размера', () => {
      expect(validateFileSize(10 * 1024 * 1024, 10 * 1024 * 1024)).toBe(true);
    });

    it('должен возвращать true для пустого файла', () => {
      expect(validateFileSize(0, 10 * 1024 * 1024)).toBe(true);
    });
  });

  describe('validateNicknameLength', () => {
    it('должен возвращать true для валидного никнейма', () => {
      expect(validateNicknameLength('TestUser', 15)).toBe(true);
    });

    it('должен возвращать false для слишком длинного никнейма', () => {
      expect(validateNicknameLength('A'.repeat(16), 15)).toBe(false);
    });

    it('должен возвращать false для пустого никнейма', () => {
      expect(validateNicknameLength('', 15)).toBe(false);
      expect(validateNicknameLength('   ', 15)).toBe(false);
    });

    it('должен обрезать пробелы', () => {
      expect(validateNicknameLength('  TestUser  ', 15)).toBe(true);
    });
  });

  describe('validateNicknameFormat', () => {
    it('должен принимать латинские буквы', () => {
      expect(validateNicknameFormat('TestUser')).toBe(true);
    });

    it('должен принимать кириллические буквы', () => {
      expect(validateNicknameFormat('ТестЮзер')).toBe(true);
    });

    it('должен принимать цифры', () => {
      expect(validateNicknameFormat('User123')).toBe(true);
    });

    it('должен принимать дефис и подчеркивание', () => {
      expect(validateNicknameFormat('Test-User_123')).toBe(true);
    });

    it('должен отклонять специальные символы', () => {
      expect(validateNicknameFormat('Test@User')).toBe(false);
      expect(validateNicknameFormat('Test!User')).toBe(false);
      expect(validateNicknameFormat('Test User')).toBe(false);
    });

    it('должен отклонять пустую строку', () => {
      expect(validateNicknameFormat('')).toBe(false);
      expect(validateNicknameFormat('   ')).toBe(false);
    });

    it('должен обрезать пробелы', () => {
      expect(validateNicknameFormat('  TestUser  ')).toBe(true);
    });
  });
});
