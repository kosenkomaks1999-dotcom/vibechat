/**
 * Модуль для управления аудио устройствами
 * Микрофоны и динамики
 */

/**
 * Класс для управления устройствами
 */
export class DevicesManager {
  constructor() {
    this.micSelect = null;
    this.speakerSelect = null;
    this.micSelector = null;
    this.speakerSelector = null;
  }

  /**
   * Инициализирует элементы DOM
   */
  initElements() {
    this.micSelect = document.getElementById("micSelect");
    this.speakerSelect = document.getElementById("speakerSelect");
    this.micSelector = document.getElementById("micSelector");
    this.speakerSelector = document.getElementById("speakerSelector");
    
    this.populateMicList();
    this.populateSpeakerList();
    
    // Обновляем список при изменении устройств
    navigator.mediaDevices.ondevicechange = () => {
      // Сохраняем текущий выбор перед обновлением списков
      const currentMicId = this.getSelectedMicId();
      const currentSpeakerId = this.getSelectedSpeakerId();
      
      // Обновляем списки (они автоматически восстановят выбор из localStorage)
      this.populateMicList();
      this.populateSpeakerList();
      
      // Дополнительно убеждаемся, что выбор сохранен
      if (currentMicId) {
        this.saveSelectedMicId(currentMicId);
      }
      if (currentSpeakerId) {
        this.saveSelectedSpeakerId(currentSpeakerId);
      }
    };
  }

  /**
   * Заполняет список микрофонов
   */
  async populateMicList() {
    if (!this.micSelect) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === "audioinput");
      this.micSelect.innerHTML = "";
      
      // Загружаем сохраненный ID микрофона
      const savedMicId = localStorage.getItem('selectedMicrophoneId');
      
      mics.forEach(m => {
        const option = document.createElement("option");
        option.value = m.deviceId;
        option.text = m.label || `Microphone ${this.micSelect.options.length + 1}`;
        this.micSelect.appendChild(option);
      });
      
      // Восстанавливаем выбранный микрофон
      if (savedMicId && mics.some(m => m.deviceId === savedMicId)) {
        console.log('🔄 Восстановление микрофона из localStorage:', savedMicId.substring(0, 20) + '...');
        this.micSelect.value = savedMicId;
      } else if (savedMicId) {
        console.warn('⚠️ Сохраненный микрофон не найден в списке устройств');
      }
    } catch (err) {
      console.error('Ошибка при получении списка микрофонов:', err);
    }
  }

  /**
   * Заполняет список динамиков
   */
  async populateSpeakerList() {
    if (!this.speakerSelect) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const speakers = devices.filter(d => d.kind === "audiooutput");
      this.speakerSelect.innerHTML = "";
      
      // Загружаем сохраненный ID динамиков
      const savedSpeakerId = localStorage.getItem('selectedSpeakerId');
      
      speakers.forEach(s => {
        const option = document.createElement("option");
        option.value = s.deviceId;
        option.text = s.label || `Speaker ${this.speakerSelect.options.length + 1}`;
        this.speakerSelect.appendChild(option);
      });
      
      // Восстанавливаем выбранные динамики
      if (savedSpeakerId && speakers.some(s => s.deviceId === savedSpeakerId)) {
        this.speakerSelect.value = savedSpeakerId;
      }
    } catch (err) {
      console.error('Ошибка при получении списка динамиков:', err);
    }
  }

  /**
   * Получает выбранный ID микрофона
   * @returns {string|null} ID микрофона
   */
  getSelectedMicId() {
    // Сначала пробуем получить из select
    if (this.micSelect && this.micSelect.value) {
      return this.micSelect.value;
    }
    // Если select пустой, пробуем загрузить из localStorage
    return localStorage.getItem('selectedMicrophoneId');
  }
  
  /**
   * Сохраняет выбранный ID микрофона
   * @param {string} deviceId - ID микрофона
   */
  saveSelectedMicId(deviceId) {
    if (deviceId) {
      localStorage.setItem('selectedMicrophoneId', deviceId);
      console.log('💾 Микрофон сохранен в localStorage:', deviceId.substring(0, 20) + '...');
    }
  }

  /**
   * Получает выбранный ID динамиков
   * @returns {string|null} ID динамиков
   */
  getSelectedSpeakerId() {
    // Сначала пробуем получить из select
    if (this.speakerSelect && this.speakerSelect.value) {
      return this.speakerSelect.value;
    }
    // Если select пустой, пробуем загрузить из localStorage
    return localStorage.getItem('selectedSpeakerId');
  }
  
  /**
   * Сохраняет выбранный ID динамиков
   * @param {string} deviceId - ID динамиков
   */
  saveSelectedSpeakerId(deviceId) {
    if (deviceId) {
      localStorage.setItem('selectedSpeakerId', deviceId);
      console.log('Динамики сохранены:', deviceId);
    }
  }

  /**
   * Получает список доступных микрофонов
   * @returns {Promise<Array>} Массив микрофонов
   */
  async getMicrophones() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === "audioinput");
    } catch (err) {
      console.error('Ошибка при получении списка микрофонов:', err);
      return [];
    }
  }

  /**
   * Получает список доступных динамиков
   * @returns {Promise<Array>} Массив динамиков
   */
  async getSpeakers() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === "audiooutput");
    } catch (err) {
      console.error('Ошибка при получении списка динамиков:', err);
      return [];
    }
  }

  /**
   * Показывает контекстное меню микрофона
   * @param {Event} e - Событие клика
   * @param {Function} onVolumeChange - Callback для изменения громкости
   * @param {Function} onDeviceChange - Callback для изменения устройства
   * @param {number} currentVolume - Текущая громкость микрофона
   * @param {string} currentDeviceId - ID текущего выбранного микрофона
   */
  async showMicContextMenu(e, onVolumeChange, onDeviceChange, currentVolume = 1.0, currentDeviceId = null) {
    console.log('🎤 showMicContextMenu вызван, currentDeviceId:', currentDeviceId);
    
    // Удаляем предыдущее меню, если есть
    const existingMenu = document.getElementById('micContextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Создаем контекстное меню
    const menu = document.createElement('div');
    menu.id = 'micContextMenu';
    menu.className = 'friend-context-menu audio-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.style.zIndex = '10000';

    // Заголовок "Выбрать микрофон"
    const deviceLabel = document.createElement('div');
    deviceLabel.className = 'context-menu-item';
    deviceLabel.style.pointerEvents = 'none';
    deviceLabel.style.color = 'rgba(255, 255, 255, 1)';
    deviceLabel.style.fontSize = '10px';
    deviceLabel.style.padding = '4px 6px';
    deviceLabel.style.textAlign = 'center';
    deviceLabel.textContent = 'Микрофон';
    menu.appendChild(deviceLabel);

    // Контейнер для выбора устройства
    const deviceContainer = document.createElement('div');
    deviceContainer.style.padding = '4px 6px';

    // Создаем select для выбора микрофона
    const deviceSelect = document.createElement('select');
    deviceSelect.className = 'context-menu-select';

    // Предотвращаем закрытие меню при клике на select
    deviceSelect.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    deviceSelect.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    deviceSelect.addEventListener('focus', (event) => {
      event.stopPropagation();
    });

    // Добавляем обработчик изменения
    deviceSelect.addEventListener('change', async (event) => {
      event.stopPropagation();
      const selectedDeviceId = event.target.value;
      console.log('🔄 Микрофон изменен в меню на:', selectedDeviceId);
      if (onDeviceChange && selectedDeviceId) {
        await onDeviceChange(selectedDeviceId);
      }
      // Не закрываем меню после выбора устройства
    });

    // Загружаем список микрофонов
    try {
      const microphones = await this.getMicrophones();
      if (microphones.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Микрофоны не найдены';
        option.disabled = true;
        deviceSelect.appendChild(option);
      } else {
        microphones.forEach((mic, index) => {
          const option = document.createElement('option');
          option.value = mic.deviceId;
          // Показываем полное название устройства
          let label = mic.label || `Microphone ${index + 1}`;
          option.textContent = label;
          option.title = label; // Добавляем tooltip с полным названием
          // Выбираем текущее устройство или первое по умолчанию
          if (currentDeviceId && mic.deviceId === currentDeviceId) {
            option.selected = true;
            console.log('✅ Выбран текущий микрофон:', label);
          } else if (!currentDeviceId && index === 0) {
            option.selected = true;
            console.log('⚠️ currentDeviceId не передан, выбран первый микрофон:', label);
          }
          deviceSelect.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Ошибка при загрузке микрофонов:', err);
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Ошибка загрузки';
      option.disabled = true;
      deviceSelect.appendChild(option);
    }

    deviceContainer.appendChild(deviceSelect);
    menu.appendChild(deviceContainer);

    // Разделитель
    const separator = document.createElement('div');
    separator.style.height = '1px';
    separator.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    separator.style.margin = '2px 0';
    menu.appendChild(separator);

    // Заголовок "Громкость микрофона"
    const volumeLabel = document.createElement('div');
    volumeLabel.className = 'context-menu-item';
    volumeLabel.style.pointerEvents = 'none';
    volumeLabel.style.color = 'rgba(255, 255, 255, 1)';
    volumeLabel.style.fontSize = '10px';
    volumeLabel.style.padding = '4px 6px';
    volumeLabel.style.textAlign = 'center';
    volumeLabel.textContent = 'Громкость';
    menu.appendChild(volumeLabel);

    // Контейнер для слайдера громкости
    const volumeContainer = document.createElement('div');
    volumeContainer.style.padding = '6px 8px';
    volumeContainer.style.display = 'flex';
    volumeContainer.style.alignItems = 'center';
    volumeContainer.style.gap = '4px';
    volumeContainer.style.flexDirection = 'column';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = currentVolume;
    slider.style.width = '100%';
    slider.style.height = '4px';
    slider.style.cursor = 'pointer';
    slider.className = 'user-volume';
    
    const volumeValue = document.createElement('span');
    volumeValue.textContent = Math.round(currentVolume * 100) + '%';
    volumeValue.style.width = '100%';
    volumeValue.style.textAlign = 'center';
    volumeValue.style.fontSize = '10px';
    volumeValue.style.color = 'rgba(255, 255, 255, 0.7)';
    volumeValue.style.marginTop = '2px';

    slider.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      volumeValue.textContent = Math.round(value * 100) + '%';
      if (onVolumeChange) {
        onVolumeChange(value);
      }
    });

    volumeContainer.appendChild(slider);
    volumeContainer.appendChild(volumeValue);
    menu.appendChild(volumeContainer);

    document.body.appendChild(menu);

    // Позиционируем меню с проверкой границ
    // Сначала устанавливаем позицию по клику, чтобы меню отобразилось и мы могли получить его размеры
    menu.style.display = 'block';
    
    // Теперь получаем реальные размеры меню и корректируем позицию
    setTimeout(() => {
      const menuRect = menu.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const menuWidth = menuRect.width;
      const menuHeight = menuRect.height;
      
      // Вычисляем позицию с учетом границ окна
      let menuLeft = e.pageX;
      let menuTop = e.pageY;
      
      // Проверяем правую границу
      if (menuLeft + menuWidth > windowWidth) {
        menuLeft = windowWidth - menuWidth - 10; // Отступ 10px от края
      }
      
      // Проверяем левую границу
      if (menuLeft < 10) {
        menuLeft = 10;
      }
      
      // Проверяем нижнюю границу
      if (menuTop + menuHeight > windowHeight) {
        menuTop = windowHeight - menuHeight - 10; // Отступ 10px от края
      }
      
      // Проверяем верхнюю границу
      if (menuTop < 10) {
        menuTop = 10;
      }
      
      menu.style.left = menuLeft + 'px';
      menu.style.top = menuTop + 'px';
    }, 0);

    // Закрываем меню при клике вне его
    const closeMenu = (event) => {
      // Не закрываем меню если клик был на select или его опции
      if (event.target.closest('.context-menu-select') || event.target.closest('select')) {
        return;
      }
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  /**
   * Показывает контекстное меню динамиков
   * @param {Event} e - Событие клика
   * @param {Function} onVolumeChange - Callback для изменения общей громкости
   * @param {Function} onDeviceChange - Callback для изменения устройства
   * @param {number} currentVolume - Текущая общая громкость
   * @param {string} currentDeviceId - ID текущего выбранного динамика
   */
  async showSpeakerContextMenu(e, onVolumeChange, onDeviceChange, currentVolume = 1.0, currentDeviceId = null) {
    // Удаляем предыдущее меню, если есть
    const existingMenu = document.getElementById('speakerContextMenu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Создаем контекстное меню
    const menu = document.createElement('div');
    menu.id = 'speakerContextMenu';
    menu.className = 'friend-context-menu audio-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.style.zIndex = '10000';

    // Заголовок "Выбрать динамики"
    const deviceLabel = document.createElement('div');
    deviceLabel.className = 'context-menu-item';
    deviceLabel.style.pointerEvents = 'none';
    deviceLabel.style.color = 'rgba(255, 255, 255, 1)';
    deviceLabel.style.fontSize = '10px';
    deviceLabel.style.padding = '4px 6px';
    deviceLabel.style.textAlign = 'center';
    deviceLabel.textContent = 'Динамики';
    menu.appendChild(deviceLabel);

    // Контейнер для выбора устройства
    const deviceContainer = document.createElement('div');
    deviceContainer.style.padding = '4px 6px';

    // Создаем select для выбора динамиков
    const deviceSelect = document.createElement('select');
    deviceSelect.className = 'context-menu-select';

    // Предотвращаем закрытие меню при клике на select
    deviceSelect.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    deviceSelect.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    deviceSelect.addEventListener('focus', (event) => {
      event.stopPropagation();
    });

    // Добавляем обработчик изменения
    deviceSelect.addEventListener('change', async (event) => {
      event.stopPropagation();
      const selectedDeviceId = event.target.value;
      if (onDeviceChange && selectedDeviceId) {
        await onDeviceChange(selectedDeviceId);
      }
      // Не закрываем меню после выбора устройства
    });

    // Загружаем список динамиков
    try {
      const speakers = await this.getSpeakers();
      if (speakers.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Динамики не найдены';
        option.disabled = true;
        deviceSelect.appendChild(option);
      } else {
        speakers.forEach((speaker, index) => {
          const option = document.createElement('option');
          option.value = speaker.deviceId;
          // Показываем полное название устройства
          let label = speaker.label || `Speaker ${index + 1}`;
          option.textContent = label;
          option.title = label; // Добавляем tooltip с полным названием
          // Выбираем текущее устройство или первое по умолчанию
          if (currentDeviceId && speaker.deviceId === currentDeviceId) {
            option.selected = true;
          } else if (!currentDeviceId && index === 0) {
            option.selected = true;
          }
          deviceSelect.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Ошибка при загрузке динамиков:', err);
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Ошибка загрузки';
      option.disabled = true;
      deviceSelect.appendChild(option);
    }

    deviceContainer.appendChild(deviceSelect);
    menu.appendChild(deviceContainer);

    // Разделитель
    const separator = document.createElement('div');
    separator.style.height = '1px';
    separator.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    separator.style.margin = '2px 0';
    menu.appendChild(separator);

    // Заголовок "Общая громкость"
    const volumeLabel = document.createElement('div');
    volumeLabel.className = 'context-menu-item';
    volumeLabel.style.pointerEvents = 'none';
    volumeLabel.style.color = 'rgba(255, 255, 255, 1)';
    volumeLabel.style.fontSize = '10px';
    volumeLabel.style.padding = '4px 6px';
    volumeLabel.style.textAlign = 'center';
    volumeLabel.textContent = 'Громкость';
    menu.appendChild(volumeLabel);

    // Контейнер для слайдера громкости
    const volumeContainer = document.createElement('div');
    volumeContainer.style.padding = '6px 8px';
    volumeContainer.style.display = 'flex';
    volumeContainer.style.alignItems = 'center';
    volumeContainer.style.gap = '4px';
    volumeContainer.style.flexDirection = 'column';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = currentVolume;
    slider.style.width = '100%';
    slider.style.height = '4px';
    slider.style.cursor = 'pointer';
    slider.className = 'user-volume';
    
    const volumeValue = document.createElement('span');
    volumeValue.textContent = Math.round(currentVolume * 100) + '%';
    volumeValue.style.width = '100%';
    volumeValue.style.textAlign = 'center';
    volumeValue.style.fontSize = '10px';
    volumeValue.style.color = 'rgba(255, 255, 255, 0.7)';
    volumeValue.style.marginTop = '2px';

    slider.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      volumeValue.textContent = Math.round(value * 100) + '%';
      if (onVolumeChange) {
        onVolumeChange(value);
      }
    });

    volumeContainer.appendChild(slider);
    volumeContainer.appendChild(volumeValue);
    menu.appendChild(volumeContainer);

    document.body.appendChild(menu);

    // Позиционируем меню с проверкой границ
    // Сначала устанавливаем позицию по клику, чтобы меню отобразилось и мы могли получить его размеры
    menu.style.display = 'block';
    
    // Теперь получаем реальные размеры меню и корректируем позицию
    setTimeout(() => {
      const menuRect = menu.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const menuWidth = menuRect.width;
      const menuHeight = menuRect.height;
      
      // Вычисляем позицию с учетом границ окна
      let menuLeft = e.pageX;
      let menuTop = e.pageY;
      
      // Проверяем правую границу
      if (menuLeft + menuWidth > windowWidth) {
        menuLeft = windowWidth - menuWidth - 10; // Отступ 10px от края
      }
      
      // Проверяем левую границу
      if (menuLeft < 10) {
        menuLeft = 10;
      }
      
      // Проверяем нижнюю границу
      if (menuTop + menuHeight > windowHeight) {
        menuTop = windowHeight - menuHeight - 10; // Отступ 10px от края
      }
      
      // Проверяем верхнюю границу
      if (menuTop < 10) {
        menuTop = 10;
      }
      
      menu.style.left = menuLeft + 'px';
      menu.style.top = menuTop + 'px';
    }, 0);

    // Закрываем меню при клике вне его
    const closeMenu = (event) => {
      // Не закрываем меню если клик был на select или его опции
      if (event.target.closest('.context-menu-select') || event.target.closest('select')) {
        return;
      }
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 0);
  }

  /**
   * Показывает селектор микрофона (старый метод, оставлен для совместимости)
   */
  showMicSelector() {
    if (this.micSelector) {
      this.micSelector.classList.add('show');
    }
  }

  /**
   * Показывает селектор динамиков (старый метод, оставлен для совместимости)
   */
  showSpeakerSelector() {
    if (this.speakerSelector) {
      this.speakerSelector.classList.add('show');
    }
  }

  /**
   * Скрывает селектор микрофона
   */
  hideMicSelector() {
    if (this.micSelector) {
      this.micSelector.classList.remove('show');
    }
  }

  /**
   * Скрывает селектор динамиков
   */
  hideSpeakerSelector() {
    if (this.speakerSelector) {
      this.speakerSelector.classList.remove('show');
    }
  }

  /**
   * Устанавливает обработчики для закрытия селекторов
   */
  setupCloseHandlers() {
    // Закрытие селектора микрофона
    const micCloseBtn = this.micSelector ? this.micSelector.querySelector(".device-close-btn") : null;
    if (micCloseBtn) {
      micCloseBtn.addEventListener('click', () => {
        this.hideMicSelector();
      });
    }

    // Закрытие селектора динамиков
    const speakerCloseBtn = this.speakerSelector ? this.speakerSelector.querySelector(".device-close-btn") : null;
    if (speakerCloseBtn) {
      speakerCloseBtn.addEventListener('click', () => {
        this.hideSpeakerSelector();
      });
    }

    // Закрытие при клике вне селектора
    if (this.micSelector) {
      this.micSelector.addEventListener('click', (e) => {
        if (e.target === this.micSelector) {
          this.hideMicSelector();
        }
      });
    }

    if (this.speakerSelector) {
      this.speakerSelector.addEventListener('click', (e) => {
        if (e.target === this.speakerSelector) {
          this.hideSpeakerSelector();
        }
      });
    }
  }
}

