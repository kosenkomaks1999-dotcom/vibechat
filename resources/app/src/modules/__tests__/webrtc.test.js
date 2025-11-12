/**
 * Тесты для модуля WebRTC
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WebRTCManager } from '../webrtc.js';
import { CONSTANTS } from '../constants.js';

describe('WebRTCManager', () => {
  let webrtc;
  let mockRoomRef;
  let mockOnStreamReceived;

  beforeEach(() => {
    mockRoomRef = {
      child: jest.fn(() => ({
        push: jest.fn()
      }))
    };
    mockOnStreamReceived = jest.fn();
    webrtc = new WebRTCManager(mockRoomRef, 'test-id', mockOnStreamReceived);
  });

  describe('constructor', () => {
    it('должен инициализировать все свойства', () => {
      expect(webrtc.roomRef).toBe(mockRoomRef);
      expect(webrtc.myId).toBe('test-id');
      expect(webrtc.localStream).toBeNull();
      expect(webrtc.peers).toEqual({});
      expect(webrtc.audios).toEqual({});
      expect(webrtc.audioAnalysers).toEqual({});
      expect(webrtc.speakingStates).toEqual({});
      expect(webrtc.userVolumes).toEqual({});
      expect(webrtc.localAudioAnalyser).toBeNull();
      expect(webrtc.speakerMuted).toBe(false);
    });
  });

  describe('toggleMute', () => {
    it('должен переключать состояние микрофона', () => {
      const mockTrack = {
        enabled: true
      };
      webrtc.localStream = {
        getAudioTracks: jest.fn(() => [mockTrack])
      };

      webrtc.toggleMute(true);
      expect(mockTrack.enabled).toBe(false);

      webrtc.toggleMute(false);
      expect(mockTrack.enabled).toBe(true);
    });

    it('должен обрабатывать отсутствие локального стрима', () => {
      webrtc.localStream = null;
      expect(() => webrtc.toggleMute(true)).not.toThrow();
    });
  });

  describe('toggleSpeaker', () => {
    it('должен переключать состояние динамиков', () => {
      const mockAudio1 = { muted: false };
      const mockAudio2 = { muted: false };
      webrtc.audios = {
        'user1': mockAudio1,
        'user2': mockAudio2
      };

      const result = webrtc.toggleSpeaker();
      expect(result).toBe(true);
      expect(mockAudio1.muted).toBe(true);
      expect(mockAudio2.muted).toBe(true);
      expect(webrtc.speakerMuted).toBe(true);

      const result2 = webrtc.toggleSpeaker();
      expect(result2).toBe(false);
      expect(mockAudio1.muted).toBe(false);
      expect(mockAudio2.muted).toBe(false);
      expect(webrtc.speakerMuted).toBe(false);
    });

    it('должен обрабатывать пустой список аудио', () => {
      webrtc.audios = {};
      const result = webrtc.toggleSpeaker();
      expect(result).toBe(true);
      expect(webrtc.speakerMuted).toBe(true);
    });
  });

  describe('setUserVolume', () => {
    it('должен устанавливать громкость для пользователя', () => {
      const mockAudio = { volume: 1 };
      webrtc.audios['user1'] = mockAudio;

      webrtc.setUserVolume('user1', 0.5);
      expect(webrtc.userVolumes['user1']).toBe(0.5);
      expect(mockAudio.volume).toBe(0.5);
    });

    it('должен сохранять громкость даже если аудио еще не создано', () => {
      webrtc.setUserVolume('user2', 0.7);
      expect(webrtc.userVolumes['user2']).toBe(0.7);
    });
  });

  describe('applySpeakerSelection', () => {
    it('должен применять выбор динамиков ко всем аудио элементам', async () => {
      const mockAudio1 = {
        setSinkId: jest.fn().mockResolvedValue(undefined)
      };
      const mockAudio2 = {
        setSinkId: jest.fn().mockResolvedValue(undefined)
      };
      webrtc.audios = {
        'user1': mockAudio1,
        'user2': mockAudio2
      };

      await webrtc.applySpeakerSelection('device-id-123');

      expect(mockAudio1.setSinkId).toHaveBeenCalledWith('device-id-123');
      expect(mockAudio2.setSinkId).toHaveBeenCalledWith('device-id-123');
    });

    it('должен обрабатывать аудио без setSinkId', () => {
      const mockAudio = {};
      webrtc.audios = {
        'user1': mockAudio
      };

      expect(() => webrtc.applySpeakerSelection('device-id')).not.toThrow();
    });

    it('должен игнорировать пустой deviceId', () => {
      const mockAudio = {
        setSinkId: jest.fn()
      };
      webrtc.audios = {
        'user1': mockAudio
      };

      webrtc.applySpeakerSelection(null);
      expect(mockAudio.setSinkId).not.toHaveBeenCalled();
    });
  });

  describe('handlePeerClose', () => {
    it('должен очищать все ресурсы при закрытии соединения', () => {
      const mockAudio = {
        pause: jest.fn(),
        remove: jest.fn()
      };
      const mockAnalyser = {
        audioContext: {
          close: jest.fn()
        }
      };

      webrtc.audios['user1'] = mockAudio;
      webrtc.audioAnalysers['user1'] = mockAnalyser;
      webrtc.speakingStates['user1'] = true;
      webrtc.peers['user1'] = {};

      webrtc.handlePeerClose('user1');

      expect(mockAudio.pause).toHaveBeenCalled();
      expect(mockAudio.remove).toHaveBeenCalled();
      expect(mockAnalyser.audioContext.close).toHaveBeenCalled();
      expect(webrtc.audios['user1']).toBeUndefined();
      expect(webrtc.audioAnalysers['user1']).toBeUndefined();
      expect(webrtc.speakingStates['user1']).toBeUndefined();
      expect(webrtc.peers['user1']).toBeUndefined();
    });

    it('должен обрабатывать отсутствие ресурсов', () => {
      expect(() => webrtc.handlePeerClose('nonexistent')).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('должен очищать все ресурсы', () => {
      const mockTrack = {
        stop: jest.fn()
      };
      webrtc.localStream = {
        getTracks: jest.fn(() => [mockTrack])
      };

      const mockAudio = {
        pause: jest.fn(),
        remove: jest.fn()
      };
      const mockPeer = {
        destroy: jest.fn()
      };
      const mockAnalyser = {
        audioContext: {
          close: jest.fn()
        }
      };

      webrtc.audios['user1'] = mockAudio;
      webrtc.peers['user1'] = mockPeer;
      webrtc.audioAnalysers['user1'] = mockAnalyser;

      webrtc.cleanup();

      expect(mockTrack.stop).toHaveBeenCalled();
      expect(mockPeer.destroy).toHaveBeenCalled();
      expect(mockAudio.pause).toHaveBeenCalled();
      expect(mockAudio.remove).toHaveBeenCalled();
      expect(webrtc.localStream).toBeNull();
      expect(webrtc.peers).toEqual({});
      expect(webrtc.audios).toEqual({});
      expect(webrtc.audioAnalysers).toEqual({});
    });
  });

  describe('getSpeechAnalysisData', () => {
    it('должен возвращать данные для анализа речи', () => {
      const mockAnalyser = { analyser: {}, audioContext: {} };
      webrtc.audioAnalysers['user1'] = mockAnalyser;
      webrtc.speakingStates['user1'] = true;
      webrtc.localAudioAnalyser = { analyser: {}, audioContext: {} };
      webrtc.localStream = {};

      const data = webrtc.getSpeechAnalysisData();

      expect(data.audioAnalysers).toEqual(webrtc.audioAnalysers);
      expect(data.speakingStates).toEqual(webrtc.speakingStates);
      expect(data.localAudioAnalyser).toBe(webrtc.localAudioAnalyser);
      expect(data.localStream).toBe(webrtc.localStream);
    });
  });
});

