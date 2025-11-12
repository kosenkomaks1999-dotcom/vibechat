/**
 * Тесты для модуля Chat
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ChatManager } from '../chat.js';
import { CONSTANTS } from '../constants.js';

describe('ChatManager', () => {
  let chat;
  let mockRoomRef;
  let mockChatMessages;
  let mockChatInput;
  let mockFileInput;

  beforeEach(() => {
    mockRoomRef = {
      child: jest.fn(() => ({
        push: jest.fn().mockResolvedValue({ key: 'msg-123' })
      }))
    };

    mockChatMessages = document.createElement('div');
    mockChatInput = document.createElement('input');
    mockFileInput = document.createElement('input');
    mockFileInput.type = 'file';

    chat = new ChatManager(mockRoomRef, 'TestUser', 'user-123', null);
    chat.initElements(mockChatMessages, mockChatInput, mockFileInput);
  });

  describe('constructor', () => {
    it('должен инициализировать все свойства', () => {
      const newChat = new ChatManager(null, 'User', 'user-id', null);
      expect(newChat.roomRef).toBeNull();
      expect(newChat.myNickname).toBe('User');
      expect(newChat.myUserId).toBe('user-id');
      expect(newChat.attachedFile).toBeNull();
      expect(newChat.lastMessageTime).toBe(0);
      expect(newChat.isSending).toBe(false);
      expect(newChat.avatarCache).toBeInstanceOf(Map);
    });
  });

  describe('initElements', () => {
    it('должен инициализировать DOM элементы', () => {
      const messages = document.createElement('div');
      const input = document.createElement('input');
      const fileInput = document.createElement('input');

      chat.initElements(messages, input, fileInput);

      expect(chat.chatMessages).toBe(messages);
      expect(chat.chatInput).toBe(input);
      expect(chat.fileInput).toBe(fileInput);
    });
  });

  describe('clear', () => {
    it('должен очищать чат', () => {
      const message1 = document.createElement('div');
      message1.className = 'chat-message';
      const message2 = document.createElement('div');
      message2.className = 'chat-message';
      mockChatMessages.appendChild(message1);
      mockChatMessages.appendChild(message2);

      chat.clear();

      expect(mockChatMessages.children.length).toBe(0);
    });

    it('должен показывать пустое состояние', () => {
      chat.clear();
      const emptyState = mockChatMessages.querySelector('.chat-empty-state');
      expect(emptyState).not.toBeNull();
    });
  });

  describe('showEmptyState', () => {
    it('должен показывать сообщение о пустом чате', () => {
      chat.showEmptyState();
      const emptyState = mockChatMessages.querySelector('.chat-empty-state');
      expect(emptyState).not.toBeNull();
      expect(emptyState.textContent).toContain('Нет сообщений');
    });
  });

  describe('removeFile', () => {
    it('должен удалять прикрепленный файл', () => {
      const mockFile = { name: 'test.jpg', size: 1000 };
      chat.attachedFile = mockFile;
      mockFileInput.value = 'test.jpg';

      chat.removeFile();

      expect(chat.attachedFile).toBeNull();
      expect(mockFileInput.value).toBe('');
    });

    it('должен скрывать превью файла', () => {
      const mockPreview = document.createElement('div');
      mockPreview.id = 'attachedFilePreview';
      mockPreview.style.display = 'block';
      document.body.appendChild(mockPreview);
      chat.filePreview = mockPreview;

      chat.removeFile();

      expect(mockPreview.style.display).toBe('none');
      document.body.removeChild(mockPreview);
    });
  });

  describe('generateAvatarColor', () => {
    it('должен генерировать цвет для аватара', () => {
      const color1 = chat.generateAvatarColor('User1');
      const color2 = chat.generateAvatarColor('User2');

      expect(color1).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(color2).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(color1).not.toBe(color2);
    });

    it('должен генерировать одинаковый цвет для одинакового никнейма', () => {
      const color1 = chat.generateAvatarColor('User');
      const color2 = chat.generateAvatarColor('User');

      expect(color1).toBe(color2);
    });
  });

  describe('formatFileSize', () => {
    it('должен форматировать размер файла в байтах', () => {
      expect(chat.formatFileSize(0)).toBe('0 B');
      expect(chat.formatFileSize(500)).toBe('500 B');
    });

    it('должен форматировать размер файла в килобайтах', () => {
      expect(chat.formatFileSize(1024)).toBe('1 KB');
      expect(chat.formatFileSize(1536)).toBe('1.5 KB');
    });

    it('должен форматировать размер файла в мегабайтах', () => {
      expect(chat.formatFileSize(1048576)).toBe('1 MB');
      expect(chat.formatFileSize(1572864)).toBe('1.5 MB');
    });
  });
});

