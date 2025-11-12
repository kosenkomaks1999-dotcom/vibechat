/**
 * Модуль для детекции речи
 * Отслеживание активности микрофона участников
 */

import { CONSTANTS } from './constants.js';

/**
 * Класс для детекции речи
 */
export class SpeechDetector {
  constructor(audioAnalysers, speakingStates, localAudioAnalyser, localStream, myId, muted) {
    this.audioAnalysers = audioAnalysers;
    this.speakingStates = speakingStates;
    this.localAudioAnalyser = localAudioAnalyser;
    this.localStream = localStream;
    this.myId = myId;
    this.muted = muted;
    this.onSpeakingChange = null;
    this.userMutedStates = {}; // Кэш состояний muted пользователей
    this.animationFrameId = null; // ID текущего requestAnimationFrame
  }

  /**
   * Устанавливает callback для изменения состояния речи
   * @param {Function} callback - Функция (userId, isSpeaking)
   */
  setOnSpeakingChange(callback) {
    this.onSpeakingChange = callback;
  }

  /**
   * Обновляет состояние микрофона
   * @param {boolean} muted - Выключен ли микрофон
   */
  setMuted(muted) {
    this.muted = muted;
  }

  /**
   * Обновляет локальный анализатор
   * @param {Object} localAudioAnalyser - Локальный анализатор
   * @param {MediaStream} localStream - Локальный поток
   */
  updateLocalAnalyser(localAudioAnalyser, localStream) {
    this.localAudioAnalyser = localAudioAnalyser;
    this.localStream = localStream;
  }

  /**
   * Обновляет состояния muted пользователей
   * @param {Object} users - Объект с данными пользователей {userId: {mute: boolean}}
   */
  updateUserMutedStates(users) {
    this.userMutedStates = {};
    Object.entries(users).forEach(([userId, data]) => {
      this.userMutedStates[userId] = data.mute || false;
    });
  }

  /**
   * Проверяет активность речи участника
   * @param {string} userId - ID участника
   * @param {Object} analyserData - Данные анализатора
   * @param {boolean} isMuted - Выключен ли микрофон
   * @returns {boolean} Говорит ли участник
   */
  checkUserSpeaking(userId, analyserData, isMuted) {
    if (!analyserData || !analyserData.analyser) return false;
    if (isMuted) return false;
    
    const analyser = analyserData.analyser;
    
    // Time domain data
    const timeDataArray = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeDataArray);
    
    // Вычисляем RMS
    let sum = 0;
    for (let i = 0; i < timeDataArray.length; i++) {
      const normalized = (timeDataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / timeDataArray.length);
    
    // Frequency data
    const freqDataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqDataArray);
    const maxFreq = Math.max(...freqDataArray);
    
    // Гистерезис
    const wasSpeaking = this.speakingStates[userId] || false;
    const { RMS_THRESHOLD_ON, RMS_THRESHOLD_OFF, FREQ_THRESHOLD_ON, FREQ_THRESHOLD_OFF } = CONSTANTS.SPEECH_DETECTION;
    
    let isSpeaking = false;
    
    if (wasSpeaking) {
      isSpeaking = (rms > RMS_THRESHOLD_OFF) && (maxFreq > FREQ_THRESHOLD_OFF);
    } else {
      isSpeaking = (rms > RMS_THRESHOLD_ON) && (maxFreq > FREQ_THRESHOLD_ON);
    }
    
    if (isSpeaking !== wasSpeaking) {
      this.speakingStates[userId] = isSpeaking;
      if (this.onSpeakingChange) {
        this.onSpeakingChange(userId, isSpeaking);
      }
    }
    
    return isSpeaking;
  }

  /**
   * Запускает цикл проверки активности речи (оптимизированный)
   */
  startDetection() {
    // Останавливаем предыдущий цикл, если он был запущен
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    let lastCheck = 0;
    
    const check = () => {
      // Ограничение частоты проверки
      const now = Date.now();
      if (now - lastCheck < CONSTANTS.SPEECH_CHECK_INTERVAL) {
        this.animationFrameId = requestAnimationFrame(check);
        return;
      }
      lastCheck = now;
      
      // Проверяем других участников (только не muted)
      Object.keys(this.audioAnalysers).forEach(userId => {
        const analyserData = this.audioAnalysers[userId];
        
        // Используем кэшированное состояние muted вместо DOM запроса
        const isMuted = this.userMutedStates[userId] || false;
        
        // Пропускаем проверку для muted пользователей для оптимизации
        if (!isMuted) {
          this.checkUserSpeaking(userId, analyserData, isMuted);
        }
      });
      
      // Проверяем собственную активность
      if (this.localAudioAnalyser && this.localAudioAnalyser.analyser && this.myId) {
        if (!this.muted && this.localStream && 
            this.localStream.getAudioTracks()[0] && 
            this.localStream.getAudioTracks()[0].enabled) {
          this.checkUserSpeaking(this.myId, this.localAudioAnalyser, false);
        } else {
          // Микрофон выключен, убираем подсветку
          if (this.speakingStates[this.myId]) {
            this.speakingStates[this.myId] = false;
            if (this.onSpeakingChange) {
              this.onSpeakingChange(this.myId, false);
            }
          }
        }
      }
      
      this.animationFrameId = requestAnimationFrame(check);
    };
    
    check();
  }

  /**
   * Останавливает цикл проверки активности речи
   */
  stopDetection() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

