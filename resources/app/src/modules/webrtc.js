/**
 * Модуль для работы с WebRTC соединениями
 * Управляет P2P соединениями через SimplePeer
 */

import { CONSTANTS } from './constants.js';

/**
 * Класс для управления WebRTC соединениями
 */
export class WebRTCManager {
  constructor(roomRef, myId, onStreamReceived) {
    this.roomRef = roomRef;
    this.myId = myId;
    this.localStream = null;
    this.peers = {};
    this.audios = {};
    this.audioAnalysers = {};
    this.speakingStates = {};
    this.userVolumes = {};
    this.localAudioAnalyser = null;
    this.speakerMuted = false;
    this.speakerSelect = null;
    this.onStreamReceived = onStreamReceived;
    this.micGainNode = null; // GainNode для управления громкостью микрофона
    this.micVolume = 1.0; // Громкость микрофона (0-1)
    this.masterVolume = 1.0; // Общая громкость всех динамиков (0-1)
    this.currentMicDeviceId = null; // ID текущего выбранного микрофона
    this.currentSpeakerDeviceId = null; // ID текущего выбранного динамика
  }

  /**
   * Инициализирует микрофон
   * @param {string} deviceId - ID устройства микрофона (опционально)
   * @param {boolean} muted - Начальное состояние микрофона
   * @returns {Promise<MediaStream>} Promise с локальным потоком
   */
  async initMicrophone(deviceId = null, muted = false) {
    // Если deviceId не передан, пробуем загрузить из localStorage
    if (!deviceId) {
      deviceId = localStorage.getItem('selectedMicrophoneId');
    }
    
    // Останавливаем предыдущий стрим
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    
    // Закрываем предыдущий анализатор и gainNode
    if (this.localAudioAnalyser && this.localAudioAnalyser.audioContext) {
      try {
        this.localAudioAnalyser.audioContext.close();
      } catch (e) {}
      this.localAudioAnalyser = null;
    }
    this.micGainNode = null;
    
    try {
      const constraints = { 
        audio: deviceId ? { deviceId: { exact: deviceId } } : true 
      };
      
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream.getAudioTracks()[0].enabled = !muted;
      
      // Сохраняем ID текущего устройства микрофона
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack && audioTrack.getSettings) {
        const settings = audioTrack.getSettings();
        console.log('🎤 settings.deviceId:', settings.deviceId, 'запрошенный deviceId:', deviceId);
        
        // Если получили "default", используем запрошенный deviceId
        if (settings.deviceId === 'default' && deviceId && deviceId !== 'default') {
          this.currentMicDeviceId = deviceId;
          console.log('🎤 Используем запрошенный deviceId вместо "default":', deviceId);
        } else {
          this.currentMicDeviceId = settings.deviceId || deviceId || null;
        }
        
        // Проверяем, что мы получили именно то устройство, которое запрашивали
        if (deviceId && settings.deviceId && settings.deviceId !== deviceId && settings.deviceId !== 'default') {
          console.warn('⚠️ Запрошенное устройство недоступно, используется:', settings.deviceId);
        }
      } else {
        this.currentMicDeviceId = deviceId || null;
      }
      
      console.log('🎤 currentMicDeviceId установлен:', this.currentMicDeviceId);
      
      // Создаем анализатор для собственного микрофона
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = CONSTANTS.AUDIO_ANALYSER.FFT_SIZE;
        analyser.smoothingTimeConstant = CONSTANTS.AUDIO_ANALYSER.SMOOTHING_TIME_CONSTANT;
        
        // Создаем gainNode для управления громкостью микрофона
        this.micGainNode = audioContext.createGain();
        this.micGainNode.gain.value = this.micVolume;
        
        // Создаем MediaStreamDestination для отправки звука с примененной громкостью
        const destination = audioContext.createMediaStreamDestination();
        
        const source = audioContext.createMediaStreamSource(this.localStream);
        // Подключаем: source -> gainNode -> destination (для отправки) и analyser (для анализа)
        source.connect(this.micGainNode);
        this.micGainNode.connect(destination);
        this.micGainNode.connect(analyser);
        
        // Сохраняем destination для использования при обновлении потока
        this.localAudioAnalyser = { analyser, audioContext, destination };
        
        // Примечание: для применения громкости микрофона к отправляемому потоку
        // нужно использовать поток из destination при создании peer соединений
        // Это будет сделано автоматически при создании новых соединений
      } catch (err) {
        console.warn('Не удалось создать анализатор для собственного микрофона:', err);
      }
      
      // Сохраняем выбранный микрофон в localStorage
      if (this.currentMicDeviceId && this.currentMicDeviceId !== 'default') {
        localStorage.setItem('selectedMicrophoneId', this.currentMicDeviceId);
        console.log('💾 Микрофон автоматически сохранен в localStorage:', this.currentMicDeviceId.substring(0, 20) + '...');
      }
      
      return this.localStream;
    } catch (err) {
      throw new Error("Разрешите доступ к микрофону!");
    }
  }

  /**
   * Создает P2P соединение с другим пользователем
   * @param {string} otherId - ID другого пользователя
   * @param {boolean} initiator - Инициирует ли это соединение
   */
  createPeer(otherId, initiator) {
    // Если peer уже существует и не уничтожен, не создаем новый
    if (this.peers[otherId] && !this.peers[otherId].destroyed) {
      return;
    }
    
    // Очищаем старый peer если он был уничтожен
    if (this.peers[otherId]) {
      this.handlePeerClose(otherId);
    }
    
    // Используем поток с примененной громкостью, если доступен
    let streamToSend = this.localStream;
    if (this.localAudioAnalyser && this.localAudioAnalyser.destination) {
      streamToSend = this.localAudioAnalyser.destination.stream;
    }
    
    const peer = new SimplePeer({ 
      initiator, 
      trickle: true, 
      stream: streamToSend,
      config: {
        iceServers: [
          // Альтернативные STUN серверы
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.voiparound.com' },
          { urls: 'stun:stun.voipbuster.com' },
          { urls: 'stun:openrelay.metered.ca:80' },
          { urls: 'stun:relay.webwormhole.io' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      }
    });
    
    let reconnectTimeout = null;
    
    peer.on("signal", signal => {
      if (this.roomRef && this.myId) {
        this.roomRef.child("signals").push({ 
          from: this.myId, 
          to: otherId, 
          signal 
        });
      }
    });
    
    peer.on("stream", stream => {
      this.handleRemoteStream(otherId, stream);
    });
    
    peer.on("close", () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      this.handlePeerClose(otherId);
    });
    
    peer.on("error", err => {
      console.warn('WebRTC error:', err);
      
      // Очищаем ресурсы сразу
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      
      // Уничтожаем peer
      try {
        peer.destroy();
      } catch (e) {
        console.warn('Error destroying peer:', e);
      }
      
      // Удаляем из peers сразу
      delete this.peers[otherId];
      
      // АВТОМАТИЧЕСКОЕ ПЕРЕПОДКЛЮЧЕНИЕ ОТКЛЮЧЕНО
      // Peer соединение будет восстановлено только при следующем ручном подключении
    });
    
    this.peers[otherId] = peer;
  }

  /**
   * Обрабатывает входящий поток от другого пользователя
   * @param {string} userId - ID пользователя
   * @param {MediaStream} stream - Аудио поток
   */
  handleRemoteStream(userId, stream) {
    // Очищаем старый audio если существует
    if (this.audios[userId]) {
      try {
        this.audios[userId].pause();
        this.audios[userId].srcObject = null;
        this.audios[userId].remove();
      } catch (e) {
        console.warn('Error removing old audio:', e);
      }
    }
    
    // Очищаем старый анализатор если существует
    if (this.audioAnalysers[userId]) {
      try {
        this.audioAnalysers[userId].audioContext.close();
      } catch (e) {
        console.warn('Error closing old audio context:', e);
      }
      delete this.audioAnalysers[userId];
    }
    
    const audio = document.createElement("audio");
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.controls = false;
    audio.dataset.userId = userId; // Сохраняем userId для применения masterVolume
    // Применяем общую громкость и индивидуальную громкость пользователя
    const userVolume = this.userVolumes[userId] !== undefined ? this.userVolumes[userId] : 1;
    audio.volume = this.masterVolume * userVolume;
    audio.muted = this.speakerMuted;
    
    document.body.appendChild(audio);
    this.audios[userId] = audio;
    
    // Применяем выбранные динамики
    // Пробуем получить из: 1) текущего сохраненного ID, 2) select элемента, 3) localStorage
    const speakerDeviceId = this.currentSpeakerDeviceId || 
                           (this.speakerSelect && this.speakerSelect.value) ||
                           localStorage.getItem('selectedSpeakerId');
    if (speakerDeviceId && audio.setSinkId) {
      audio.setSinkId(speakerDeviceId).catch(err => {
        console.warn('Не удалось установить динамики:', err);
      });
    }
    
    // Создаем анализатор для отслеживания аудио активности
    let audioContext = null;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = CONSTANTS.AUDIO_ANALYSER.FFT_SIZE;
      analyser.smoothingTimeConstant = CONSTANTS.AUDIO_ANALYSER.SMOOTHING_TIME_CONSTANT;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      this.audioAnalysers[userId] = { analyser, audioContext };
      this.speakingStates[userId] = false;
    } catch (err) {
      console.warn('Не удалось создать анализатор аудио для участника:', err);
      // Закрываем контекст если создание анализатора не удалось
      if (audioContext) {
        try {
          audioContext.close();
        } catch (e) {
          console.warn('Ошибка при закрытии audioContext:', e);
        }
      }
    }
    
    if (this.onStreamReceived) {
      this.onStreamReceived(userId, stream);
    }
  }

  /**
   * Обрабатывает закрытие соединения
   * @param {string} userId - ID пользователя
   */
  handlePeerClose(userId) {
    if (this.audios[userId]) {
      this.audios[userId].pause();
      this.audios[userId].remove();
      delete this.audios[userId];
    }
    
    if (this.audioAnalysers[userId]) {
      try {
        this.audioAnalysers[userId].audioContext.close();
      } catch (e) {}
      delete this.audioAnalysers[userId];
    }
    
    delete this.speakingStates[userId];
    delete this.peers[userId];
  }

  /**
   * Обрабатывает WebRTC сигнал
   * @param {Object} data - Данные сигнала
   */
  handleSignal(data) {
    if (!this.peers[data.from]) {
      this.createPeer(data.from, false);
    }
    this.peers[data.from]?.signal(data.signal);
  }

  /**
   * Обновляет микрофон (при смене устройства)
   * @param {string} deviceId - ID нового устройства
   */
  async updateMicrophone(deviceId) {
    console.log('🎤 updateMicrophone вызван с deviceId:', deviceId);
    
    if (this.localStream) {
      // Сохраняем старый трек ДО изменения стрима
      const oldTrack = this.localStream.getAudioTracks()[0];
      if (!oldTrack) return;
      
      // Сохраняем текущее состояние muted
      const wasMuted = !oldTrack.enabled;
      
      console.log('🎤 Инициализация микрофона с deviceId:', deviceId);
      await this.initMicrophone(deviceId, wasMuted);
      console.log('🎤 Микрофон инициализирован, currentMicDeviceId:', this.currentMicDeviceId);
      
      // Сохраняем новый deviceId (уже сохранен в initMicrophone, но на всякий случай)
      if (!this.currentMicDeviceId) {
        this.currentMicDeviceId = deviceId;
      }
      
      // Обновляем стрим для всех пиров - используем поток из destination с примененной громкостью
      let streamToUse = this.localStream;
      if (this.localAudioAnalyser && this.localAudioAnalyser.destination) {
        streamToUse = this.localAudioAnalyser.destination.stream;
      }
      
      const newTrack = streamToUse.getAudioTracks()[0];
      if (newTrack && oldTrack) {
        Object.values(this.peers).forEach(peer => {
          if (peer && !peer.destroyed) {
            try {
              // Получаем senders из RTCPeerConnection для замены трека
              if (peer._pc) {
                const senders = peer._pc.getSenders();
                const audioSender = senders.find(sender => 
                  sender.track && sender.track.kind === 'audio'
                );
                
                if (audioSender && audioSender.replaceTrack) {
                  audioSender.replaceTrack(newTrack).catch(err => {
                    console.warn('Ошибка при замене трека:', err);
                  });
                } else if (typeof peer.replaceTrack === 'function') {
                  // Альтернативный способ через SimplePeer API
                  peer.replaceTrack(oldTrack, newTrack, streamToUse);
                }
              }
            } catch (err) {
              console.warn('Error replacing track:', err);
            }
          }
        });
      }
      
      // Останавливаем старый трек после замены
      if (oldTrack && oldTrack !== newTrack && oldTrack.readyState !== 'ended') {
        oldTrack.stop();
      }
    }
  }

  /**
   * Переключает состояние микрофона
   * @param {boolean} muted - Новое состояние
   */
  toggleMute(muted) {
    if (this.localStream) {
      this.localStream.getAudioTracks()[0].enabled = !muted;
    }
  }

  /**
   * Переключает состояние динамиков
   */
  toggleSpeaker() {
    this.speakerMuted = !this.speakerMuted;
    
    Object.values(this.audios).forEach(audio => {
      if (audio) {
        audio.muted = this.speakerMuted;
      }
    });
    
    return this.speakerMuted;
  }

  /**
   * Устанавливает громкость для пользователя
   * @param {string} userId - ID пользователя
   * @param {number} volume - Громкость (0-1)
   */
  setUserVolume(userId, volume) {
    this.userVolumes[userId] = volume;
    if (this.audios[userId]) {
      // Учитываем общую громкость при установке индивидуальной
      this.audios[userId].volume = this.masterVolume * volume;
    }
  }

  /**
   * Применяет выбранные динамики ко всем аудио элементам
   * @param {string} deviceId - ID устройства динамиков
   */
  applySpeakerSelection(deviceId) {
    if (!deviceId) return;
    
    // Сохраняем ID текущего устройства динамиков
    this.currentSpeakerDeviceId = deviceId;
    
    Object.values(this.audios).forEach(audio => {
      if (audio && audio.setSinkId) {
        audio.setSinkId(deviceId).catch(err => {
          console.warn('Не удалось установить динамики:', err);
        });
      }
    });
  }

  /**
   * Получает ID текущего выбранного микрофона
   * @returns {string|null} ID микрофона
   */
  getCurrentMicDeviceId() {
    return this.currentMicDeviceId;
  }

  /**
   * Получает ID текущего выбранного динамика
   * @returns {string|null} ID динамика
   */
  getCurrentSpeakerDeviceId() {
    return this.currentSpeakerDeviceId;
  }

  /**
   * Устанавливает элемент выбора динамиков
   * @param {HTMLElement} speakerSelect - Select элемент для динамиков
   */
  setSpeakerSelect(speakerSelect) {
    this.speakerSelect = speakerSelect;
  }

  /**
   * Устанавливает громкость микрофона
   * @param {number} volume - Громкость микрофона (0-1)
   */
  setMicrophoneVolume(volume) {
    this.micVolume = Math.max(0, Math.min(1, volume));
    if (this.micGainNode) {
      this.micGainNode.gain.value = this.micVolume;
      // Примечание: изменение громкости микрофона применяется через gainNode
      // и будет использоваться при создании новых peer соединений
      // Для существующих соединений требуется переподключение для применения изменений
    }
  }

  /**
   * Получает текущую громкость микрофона
   * @returns {number} Громкость микрофона (0-1)
   */
  getMicrophoneVolume() {
    return this.micVolume;
  }

  /**
   * Устанавливает общую громкость всех динамиков
   * @param {number} volume - Общая громкость (0-1)
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    // Применяем к всем аудио элементам
    Object.values(this.audios).forEach(audio => {
      if (audio) {
        // Учитываем индивидуальную громкость пользователя
        const userVolume = this.userVolumes[audio.dataset?.userId] !== undefined 
          ? this.userVolumes[audio.dataset.userId] 
          : 1;
        audio.volume = this.masterVolume * userVolume;
      }
    });
  }

  /**
   * Получает текущую общую громкость динамиков
   * @returns {number} Общая громкость (0-1)
   */
  getMasterVolume() {
    return this.masterVolume;
  }

  /**
   * Очищает все соединения
   */
  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    
    if (this.localAudioAnalyser && this.localAudioAnalyser.audioContext) {
      try {
        this.localAudioAnalyser.audioContext.close();
      } catch (e) {}
      this.localAudioAnalyser = null;
    }
    
    Object.entries(this.peers).forEach(([id, peer]) => {
      peer.destroy();
      if (this.audios[id]) {
        this.audios[id].pause();
        this.audios[id].remove();
        delete this.audios[id];
      }
      if (this.audioAnalysers[id]) {
        try {
          this.audioAnalysers[id].audioContext.close();
        } catch (e) {}
        delete this.audioAnalysers[id];
      }
      delete this.peers[id];
    });
    
    this.peers = {};
    this.audios = {};
    this.audioAnalysers = {};
    this.speakingStates = {};
  }

  /**
   * Получает данные для анализа речи
   * @returns {Object} Данные анализаторов и состояний
   */
  getSpeechAnalysisData() {
    return {
      audioAnalysers: this.audioAnalysers,
      speakingStates: this.speakingStates,
      localAudioAnalyser: this.localAudioAnalyser,
      localStream: this.localStream
    };
  }
}

