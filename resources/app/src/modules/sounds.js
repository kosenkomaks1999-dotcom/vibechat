/**
 * Модуль для звуковых уведомлений
 * Воспроизведение звуков при входе/выходе участников
 */

import { CONSTANTS } from './constants.js';

/**
 * Воспроизводит звуковое уведомление
 * @param {string} type - Тип уведомления ('join' или 'leave')
 */
export function playNotificationSound(type) {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    const config = CONSTANTS.NOTIFICATION_SOUNDS[type.toUpperCase()];
    if (!config) return;
    
    oscillator.frequency.setValueAtTime(config.START_FREQ, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      config.END_FREQ, 
      audioContext.currentTime + (config.DURATION * 0.67)
    );
    
    oscillator.type = 'sine';
    
    // Плавное появление и исчезновение
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      CONSTANTS.NOTIFICATION_SOUNDS.GAIN, 
      audioContext.currentTime + 0.01
    );
    gainNode.gain.linearRampToValueAtTime(
      0, 
      audioContext.currentTime + config.DURATION
    );
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + config.DURATION);
  } catch (error) {
    console.log('Не удалось воспроизвести звук уведомления:', error);
  }
}

