/**
 * Тесты для констант приложения
 */

import { describe, it, expect } from '@jest/globals';
import { CONSTANTS } from '../constants.js';

describe('CONSTANTS', () => {
  it('должен содержать MAX_MESSAGES', () => {
    expect(CONSTANTS.MAX_MESSAGES).toBeDefined();
    expect(typeof CONSTANTS.MAX_MESSAGES).toBe('number');
    expect(CONSTANTS.MAX_MESSAGES).toBeGreaterThan(0);
  });

  it('должен содержать MAX_MESSAGE_LENGTH', () => {
    expect(CONSTANTS.MAX_MESSAGE_LENGTH).toBeDefined();
    expect(typeof CONSTANTS.MAX_MESSAGE_LENGTH).toBe('number');
    expect(CONSTANTS.MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
  });

  it('должен содержать MAX_FILE_SIZE', () => {
    expect(CONSTANTS.MAX_FILE_SIZE).toBeDefined();
    expect(typeof CONSTANTS.MAX_FILE_SIZE).toBe('number');
    expect(CONSTANTS.MAX_FILE_SIZE).toBeGreaterThan(0);
  });

  it('должен содержать MAX_USERS', () => {
    expect(CONSTANTS.MAX_USERS).toBeDefined();
    expect(typeof CONSTANTS.MAX_USERS).toBe('number');
    expect(CONSTANTS.MAX_USERS).toBeGreaterThan(0);
  });

  it('должен содержать SPEECH_DETECTION с правильной структурой', () => {
    expect(CONSTANTS.SPEECH_DETECTION).toBeDefined();
    expect(CONSTANTS.SPEECH_DETECTION.RMS_THRESHOLD_ON).toBeDefined();
    expect(CONSTANTS.SPEECH_DETECTION.RMS_THRESHOLD_OFF).toBeDefined();
    expect(CONSTANTS.SPEECH_DETECTION.FREQ_THRESHOLD_ON).toBeDefined();
    expect(CONSTANTS.SPEECH_DETECTION.FREQ_THRESHOLD_OFF).toBeDefined();
    
    expect(CONSTANTS.SPEECH_DETECTION.RMS_THRESHOLD_ON).toBeGreaterThan(0);
    expect(CONSTANTS.SPEECH_DETECTION.RMS_THRESHOLD_OFF).toBeGreaterThan(0);
  });

  it('должен содержать AUDIO_ANALYSER с правильной структурой', () => {
    expect(CONSTANTS.AUDIO_ANALYSER).toBeDefined();
    expect(CONSTANTS.AUDIO_ANALYSER.FFT_SIZE).toBeDefined();
    expect(CONSTANTS.AUDIO_ANALYSER.SMOOTHING_TIME_CONSTANT).toBeDefined();
    
    expect(CONSTANTS.AUDIO_ANALYSER.FFT_SIZE).toBeGreaterThan(0);
    expect(CONSTANTS.AUDIO_ANALYSER.SMOOTHING_TIME_CONSTANT).toBeGreaterThanOrEqual(0);
    expect(CONSTANTS.AUDIO_ANALYSER.SMOOTHING_TIME_CONSTANT).toBeLessThanOrEqual(1);
  });

  it('должен содержать NOTIFICATION_SOUNDS с правильной структурой', () => {
    expect(CONSTANTS.NOTIFICATION_SOUNDS).toBeDefined();
    expect(CONSTANTS.NOTIFICATION_SOUNDS.JOIN).toBeDefined();
    expect(CONSTANTS.NOTIFICATION_SOUNDS.LEAVE).toBeDefined();
    expect(CONSTANTS.NOTIFICATION_SOUNDS.GAIN).toBeDefined();
    
    expect(CONSTANTS.NOTIFICATION_SOUNDS.JOIN.START_FREQ).toBeGreaterThan(0);
    expect(CONSTANTS.NOTIFICATION_SOUNDS.JOIN.END_FREQ).toBeGreaterThan(0);
    expect(CONSTANTS.NOTIFICATION_SOUNDS.GAIN).toBeGreaterThan(0);
    expect(CONSTANTS.NOTIFICATION_SOUNDS.GAIN).toBeLessThanOrEqual(1);
  });

  it('должен содержать DEFAULT_NICKNAME', () => {
    expect(CONSTANTS.DEFAULT_NICKNAME).toBeDefined();
    expect(typeof CONSTANTS.DEFAULT_NICKNAME).toBe('string');
    expect(CONSTANTS.DEFAULT_NICKNAME.length).toBeGreaterThan(0);
  });

  it('должен содержать MAX_NICKNAME_LENGTH', () => {
    expect(CONSTANTS.MAX_NICKNAME_LENGTH).toBeDefined();
    expect(typeof CONSTANTS.MAX_NICKNAME_LENGTH).toBe('number');
    expect(CONSTANTS.MAX_NICKNAME_LENGTH).toBeGreaterThan(0);
  });

  it('должен содержать MESSAGE_RATE_LIMIT', () => {
    expect(CONSTANTS.MESSAGE_RATE_LIMIT).toBeDefined();
    expect(typeof CONSTANTS.MESSAGE_RATE_LIMIT).toBe('number');
    expect(CONSTANTS.MESSAGE_RATE_LIMIT).toBeGreaterThan(0);
  });

  it('должен содержать TOAST_DURATION', () => {
    expect(CONSTANTS.TOAST_DURATION).toBeDefined();
    expect(typeof CONSTANTS.TOAST_DURATION).toBe('number');
    expect(CONSTANTS.TOAST_DURATION).toBeGreaterThan(0);
  });

  it('должен содержать ROOM_ID_PATTERN', () => {
    expect(CONSTANTS.ROOM_ID_PATTERN).toBeDefined();
    expect(CONSTANTS.ROOM_ID_PATTERN).toBeInstanceOf(RegExp);
  });

  it('ROOM_ID_PATTERN должен валидировать правильные ID комнат', () => {
    expect(CONSTANTS.ROOM_ID_PATTERN.test('Room123')).toBe(true);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('room-123')).toBe(true);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('room_123')).toBe(true);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('ABC123')).toBe(true);
  });

  it('ROOM_ID_PATTERN должен отклонять неправильные ID комнат', () => {
    expect(CONSTANTS.ROOM_ID_PATTERN.test('Room 123')).toBe(false);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('room@123')).toBe(false);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('room#123')).toBe(false);
    expect(CONSTANTS.ROOM_ID_PATTERN.test('')).toBe(false);
  });
});

