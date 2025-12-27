/**
 * Модуль для управления совместным вайтбордом
 * Collaborative Whiteboard для рисования в реальном времени
 */

// Константы
const MAX_STROKES = 1000; // Максимальное количество штрихов
const MAX_DATA_SIZE = 500 * 1024; // 500 КБ в байтах
const BATCH_INTERVAL = 75; // Интервал батчинга в мс (50-100мс)
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

/**
 * Класс для управления вайтбордом
 */
export class WhiteboardManager {
  constructor(roomRef, myUserId, myNickname, ui = null) {
    this.roomRef = roomRef;
    this.roomId = roomRef ? roomRef.key : null; // Сохраняем ID комнаты для проверки
    this.myUserId = myUserId;
    this.myNickname = myNickname;
    this.ui = ui;
    
    // DOM элементы
    this.modal = null;
    this.canvas = null;
    this.context = null;
    
    // Текущие настройки
    this.currentTool = 'marker'; // По умолчанию маркер (убрали pen)
    this.currentColor = '#000000';
    this.currentSize = 15; // Размер по умолчанию для маркера
    
    console.log('[WhiteboardManager] Constructor called with defaults:', {
      tool: this.currentTool,
      color: this.currentColor,
      size: this.currentSize,
      roomId: this.roomId
    });
    
    // Состояние
    this.isOpen = false;
    this.isDrawing = false;
    this.isConnected = true; // Статус соединения с Firebase
    
    // Компоненты (будут инициализированы позже)
    this.drawingEngine = null;
    this.firebaseSync = null;
    
    // Хранилище штрихов
    this.strokes = [];
    
    // Буфер для офлайн режима
    this.offlineBuffer = [];
    
    // Батчинг точек
    this.pointsBuffer = [];
    this.batchTimer = null;
    
    // Сохраняем ссылки на обработчики для корректного удаления
    this.eventHandlers = {
      close: null,
      tools: [],
      colors: [],
      sizeSlider: null,
      clear: null,
      save: null,
      modalClick: null
    };
  }

  /**
   * Инициализирует DOM элементы
   */
  initElements() {
    this.modal = document.getElementById('whiteboardModal');
    this.canvas = document.getElementById('whiteboardCanvas');
    
    if (!this.canvas) {
      console.error('Canvas element not found');
      this.showError('Элемент Canvas не найден');
      return false;
    }
    
    // Проверяем поддержку Canvas
    if (!this.canvas.getContext) {
      console.error('Canvas not supported');
      this.showError('Ваш браузер не поддерживает Canvas');
      return false;
    }
    
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    
    if (!this.context) {
      console.error('Failed to get 2d context');
      this.showError('Не удалось инициализировать Canvas');
      return false;
    }
    
    // Устанавливаем белый фон
    this.context.fillStyle = '#FFFFFF';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    return true;
  }

  /**
   * Открывает вайтборд
   */
  open() {
    if (this.isOpen) {
      console.log('[open] Whiteboard already open');
      return;
    }
    
    console.log(`[open] Opening whiteboard for room: ${this.roomId}`);
    
    // КРИТИЧЕСКИ ВАЖНО: Останавливаем все старые слушатели перед открытием
    this.stopListening();
    
    if (!this.initElements()) {
      console.error('[open] Failed to initialize whiteboard elements');
      return;
    }
    
    // ПОЛНОСТЬЮ очищаем canvas
    if (this.context) {
      console.log('[open] Clearing canvas');
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.fillStyle = '#FFFFFF';
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // ПОЛНОСТЬЮ очищаем все локальные данные
    this.strokes = [];
    this.offlineBuffer = [];
    this.pointsBuffer = [];
    
    console.log('[open] Local data cleared');
    
    this.modal.style.display = 'flex';
    this.isOpen = true;
    
    // Изменяем размер canvas под окно с соотношением 16:9
    this.resizeTimeout = setTimeout(() => {
      if (this.isOpen && this.resizeCanvas && typeof this.resizeCanvas === 'function') {
        this.resizeCanvas();
      }
    }, 100);
    
    // Добавляем обработчик изменения размера окна
    this.resizeHandler = () => {
      if (this.isOpen && this.resizeCanvas && typeof this.resizeCanvas === 'function') {
        this.resizeCanvas();
      }
    };
    window.addEventListener('resize', this.resizeHandler);
    
    // Инициализируем DrawingEngine
    this.drawingEngine = new DrawingEngine(
      this.canvas,
      this.context,
      () => ({
        tool: this.currentTool,
        color: this.currentColor,
        size: this.currentSize
      })
    );
    
    // Настраиваем callback для завершенных штрихов
    this.drawingEngine.setOnStrokeComplete((stroke) => {
      this.onStrokeDrawn(stroke);
    });
    
    // Настраиваем обработчики рисования
    this.drawingEngine.setupEventHandlers();
    
    // Инициализируем обработчики событий UI
    this.setupEventHandlers();
    
    // КРИТИЧНО: Сбрасываем UI к дефолтным настройкам
    this.resetUI();
    
    // Загружаем существующие штрихи из Firebase
    console.log('[open] Loading existing strokes...');
    this.loadExistingStrokes();
    
    // Начинаем слушать изменения
    console.log('[open] Starting listeners...');
    this.startListening();
    
    console.log('[open] Whiteboard opened successfully');
  }

  /**
   * Закрывает вайтборд
   */
  close() {
    if (!this.isOpen) return;
    
    this.modal.style.display = 'none';
    this.isOpen = false;
    
    // Отменяем таймер resize если он есть
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    
    // Удаляем обработчик изменения размера окна
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Останавливаем слушатель Firebase
    this.stopListening();
    
    // Очищаем обработчики событий
    this.removeEventHandlers();
    
    // ПОЛНОСТЬЮ очищаем canvas
    if (this.context && this.canvas) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.fillStyle = '#FFFFFF';
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    // Очищаем DrawingEngine
    if (this.drawingEngine) {
      this.drawingEngine.removeEventHandlers();
      this.drawingEngine = null;
    }
    
    // Очищаем все локальные данные
    this.strokes = [];
    this.offlineBuffer = [];
    this.pointsBuffer = [];
    
    console.log('Whiteboard closed and cleared');
  }

  /**
   * Устанавливает инструмент рисования
   * @param {string} tool - 'marker', 'eraser'
   */
  setTool(tool) {
    // Проверяем, что инструмент валиден (только marker или eraser)
    if (tool !== 'marker' && tool !== 'eraser') {
      console.warn('Invalid tool:', tool, '- using marker instead');
      tool = 'marker';
    }
    
    this.currentTool = tool;
    
    // Обновляем визуальное выделение кнопок
    document.querySelectorAll('.whiteboard-tool-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    const toolBtn = document.querySelector(`[data-tool="${tool}"]`);
    if (toolBtn) {
      toolBtn.classList.add('active');
    }
    
    // Устанавливаем размер по умолчанию для инструмента
    if (tool === 'marker') {
      this.setSize(Math.max(this.currentSize, 10));
    } else if (tool === 'eraser') {
      this.setSize(Math.max(this.currentSize, 10));
    }
    
    console.log('Tool changed to:', tool);
  }

  /**
   * Устанавливает цвет
   * @param {string} color - Hex color
   */
  setColor(color) {
    this.currentColor = color;
    
    // Обновляем визуальное выделение кнопок
    document.querySelectorAll('.whiteboard-color-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    const colorBtn = document.querySelector(`[data-color="${color}"]`);
    if (colorBtn) {
      colorBtn.classList.add('active');
    }
    
    console.log('Color changed to:', color);
  }

  /**
   * Устанавливает размер кисти
   * @param {number} size - 10-50
   */
  setSize(size) {
    // Ограничиваем размер для всех инструментов одинаково
    size = Math.max(10, Math.min(50, size));
    
    this.currentSize = size;
    
    // Обновляем отображение значения
    const sizeValue = document.getElementById('whiteboardSizeValue');
    if (sizeValue) {
      sizeValue.textContent = size;
    }
    
    // Обновляем слайдер
    const slider = document.getElementById('whiteboardSizeSlider');
    if (slider) {
      slider.value = size;
    }
    
    console.log('Size changed to:', size);
  }

  /**
   * Очищает доску (для всех участников)
   */
  async clear() {
    // Показываем диалог подтверждения
    let confirmed = false;
    
    if (this.ui && this.ui.showConfirm) {
      confirmed = await this.ui.showConfirm('Очистить доску для всех участников?');
    } else {
      // Fallback на системный диалог если ui не передан
      confirmed = confirm('Очистить доску для всех участников?');
    }
    
    if (!confirmed) return;
    
    // Очищаем локально
    this.strokes = [];
    if (this.drawingEngine) {
      this.drawingEngine.clearCanvas();
    }
    
    // Удаляем все штрихи из Firebase
    if (this.roomRef) {
      this.roomRef.child('whiteboard/strokes').remove();
    }
    
    console.log('Whiteboard cleared');
  }

  /**
   * Сохраняет доску как PNG
   */
  saveAsPNG() {
    try {
      // Создаем временный canvas с белым фоном
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempContext = tempCanvas.getContext('2d');
      
      // Заливаем белым фоном
      tempContext.fillStyle = '#FFFFFF';
      tempContext.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      // Копируем содержимое основного canvas
      tempContext.drawImage(this.canvas, 0, 0);
      
      // Конвертируем в PNG
      tempCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        // Генерируем имя файла с датой и временем
        const now = new Date();
        const filename = `whiteboard-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.png`;
        
        link.href = url;
        link.download = filename;
        link.click();
        
        // Освобождаем память
        URL.revokeObjectURL(url);
        
        console.log('Whiteboard saved as:', filename);
      }, 'image/png');
    } catch (error) {
      console.error('Error saving whiteboard:', error);
      alert('Ошибка при сохранении доски');
    }
  }

  /**
   * Сбрасывает UI к дефолтным настройкам
   */
  resetUI() {
    console.log('[resetUI] Resetting UI to defaults');
    
    // Сбрасываем активные кнопки инструментов
    document.querySelectorAll('.whiteboard-tool-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Активируем дефолтный инструмент (marker)
    const markerBtn = document.querySelector('[data-tool="marker"]');
    if (markerBtn) {
      markerBtn.classList.add('active');
    }
    
    // Сбрасываем активные кнопки цветов
    document.querySelectorAll('.whiteboard-color-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Активируем дефолтный цвет (черный)
    const blackBtn = document.querySelector('[data-color="#000000"]');
    if (blackBtn) {
      blackBtn.classList.add('active');
    }
    
    // Сбрасываем слайдер размера
    const sizeSlider = document.getElementById('whiteboardSizeSlider');
    if (sizeSlider) {
      sizeSlider.value = this.currentSize;
    }
    
    // Обновляем отображение размера
    const sizeValue = document.getElementById('whiteboardSizeValue');
    if (sizeValue) {
      sizeValue.textContent = this.currentSize;
    }
    
    console.log('[resetUI] UI reset complete:', {
      tool: this.currentTool,
      color: this.currentColor,
      size: this.currentSize
    });
  }

  /**
   * Настраивает обработчики событий
   */
  setupEventHandlers() {
    // Сначала удаляем старые обработчики (если есть)
    this.removeEventHandlers();
    
    // Кнопка закрытия
    const closeBtn = document.getElementById('whiteboardCloseBtn');
    if (closeBtn) {
      this.eventHandlers.close = () => this.close();
      closeBtn.addEventListener('click', this.eventHandlers.close);
    }
    
    // Кнопки инструментов
    document.querySelectorAll('.whiteboard-tool-btn').forEach(btn => {
      const handler = (e) => {
        const tool = e.currentTarget.dataset.tool;
        this.setTool(tool);
      };
      this.eventHandlers.tools.push({ btn, handler });
      btn.addEventListener('click', handler);
    });
    
    // Кнопки цветов
    document.querySelectorAll('.whiteboard-color-btn').forEach(btn => {
      const handler = (e) => {
        const color = e.currentTarget.dataset.color;
        this.setColor(color);
      };
      this.eventHandlers.colors.push({ btn, handler });
      btn.addEventListener('click', handler);
    });
    
    // Слайдер размера
    const sizeSlider = document.getElementById('whiteboardSizeSlider');
    if (sizeSlider) {
      this.eventHandlers.sizeSlider = (e) => {
        this.setSize(parseInt(e.target.value));
      };
      sizeSlider.addEventListener('input', this.eventHandlers.sizeSlider);
    }
    
    // Кнопка очистки
    const clearBtn = document.getElementById('whiteboardClearBtn');
    if (clearBtn) {
      this.eventHandlers.clear = () => this.clear();
      clearBtn.addEventListener('click', this.eventHandlers.clear);
    }
    
    // Кнопка сохранения
    const saveBtn = document.getElementById('whiteboardSaveBtn');
    if (saveBtn) {
      this.eventHandlers.save = () => this.saveAsPNG();
      saveBtn.addEventListener('click', this.eventHandlers.save);
    }
    
    // Закрытие по клику вне модального окна
    if (this.modal) {
      this.eventHandlers.modalClick = (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      };
      this.modal.addEventListener('click', this.eventHandlers.modalClick);
    }
  }

  /**
   * Удаляет обработчики событий
   */
  removeEventHandlers() {
    // Кнопка закрытия
    const closeBtn = document.getElementById('whiteboardCloseBtn');
    if (closeBtn && this.eventHandlers.close) {
      closeBtn.removeEventListener('click', this.eventHandlers.close);
    }
    
    // Кнопки инструментов
    this.eventHandlers.tools.forEach(({ btn, handler }) => {
      btn.removeEventListener('click', handler);
    });
    this.eventHandlers.tools = [];
    
    // Кнопки цветов
    this.eventHandlers.colors.forEach(({ btn, handler }) => {
      btn.removeEventListener('click', handler);
    });
    this.eventHandlers.colors = [];
    
    // Слайдер размера
    const sizeSlider = document.getElementById('whiteboardSizeSlider');
    if (sizeSlider && this.eventHandlers.sizeSlider) {
      sizeSlider.removeEventListener('input', this.eventHandlers.sizeSlider);
    }
    
    // Кнопка очистки
    const clearBtn = document.getElementById('whiteboardClearBtn');
    if (clearBtn && this.eventHandlers.clear) {
      clearBtn.removeEventListener('click', this.eventHandlers.clear);
    }
    
    // Кнопка сохранения
    const saveBtn = document.getElementById('whiteboardSaveBtn');
    if (saveBtn && this.eventHandlers.save) {
      saveBtn.removeEventListener('click', this.eventHandlers.save);
    }
    
    // Закрытие по клику вне модального окна
    if (this.modal && this.eventHandlers.modalClick) {
      this.modal.removeEventListener('click', this.eventHandlers.modalClick);
    }
  }

  /**
   * Обработчик нарисованного штриха
   * @param {Object} stroke - Штрих
   */
  onStrokeDrawn(stroke) {
    // Валидация штриха
    if (!this.validateStroke(stroke)) {
      console.error('Invalid stroke data:', stroke);
      return;
    }
    
    // Добавляем userId и nickname
    stroke.userId = this.myUserId;
    stroke.nickname = this.myNickname;
    
    // Сохраняем локально
    this.strokes.push(stroke);
    
    // Проверяем лимит штрихов
    this.enforceStrokeLimit();
    
    // Отправляем в Firebase (с обработкой офлайн режима)
    if (this.isConnected) {
      this.publishStroke(stroke);
    } else {
      // Буферизуем для отправки при восстановлении соединения
      this.offlineBuffer.push(stroke);
      console.log('Stroke buffered (offline mode)');
    }
  }
  
  /**
   * Валидирует штрих
   * @param {Object} stroke - Штрих для валидации
   * @returns {boolean} true если штрих валиден
   */
  validateStroke(stroke) {
    if (!stroke || typeof stroke !== 'object') return false;
    
    // Проверяем обязательные поля
    if (!stroke.id || !stroke.tool || !stroke.color || !stroke.size || !Array.isArray(stroke.points)) {
      return false;
    }
    
    // Проверяем размер
    if (stroke.size < 1 || stroke.size > 50) return false;
    
    // Проверяем цвет (hex формат)
    if (!/^#[0-9A-F]{6}$/i.test(stroke.color)) return false;
    
    // Проверяем точки
    if (stroke.points.length === 0 || stroke.points.length > 500) return false;
    
    // Валидируем каждую точку
    for (const point of stroke.points) {
      if (!this.validatePoint(point)) return false;
    }
    
    return true;
  }
  
  /**
   * Валидирует точку
   * @param {Object} point - Точка {x, y}
   * @returns {boolean} true если точка валидна
   */
  validatePoint(point) {
    if (!point || typeof point !== 'object') return false;
    
    const x = point.x;
    const y = point.y;
    
    // Проверяем, что координаты числа
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    
    // Проверяем, что координаты в пределах canvas (используем текущие размеры)
    if (x < 0 || x > this.canvas.width || y < 0 || y > this.canvas.height) return false;
    
    // Проверяем, что координаты не NaN или Infinity
    if (!isFinite(x) || !isFinite(y)) return false;
    
    return true;
  }
  
  /**
   * Применяет ограничение на количество штрихов
   * Удаляет самые старые штрихи если превышен лимит
   */
  enforceStrokeLimit() {
    if (this.strokes.length <= MAX_STROKES) return;
    
    console.log(`Stroke limit exceeded (${this.strokes.length}/${MAX_STROKES}), removing oldest strokes`);
    
    // Сортируем по timestamp
    this.strokes.sort((a, b) => a.timestamp - b.timestamp);
    
    // Удаляем самые старые штрихи
    const toRemove = this.strokes.length - MAX_STROKES;
    const removedStrokes = this.strokes.splice(0, toRemove);
    
    // Удаляем из Firebase
    if (this.roomRef && this.isConnected) {
      const strokesRef = this.roomRef.child('whiteboard/strokes');
      removedStrokes.forEach(stroke => {
        strokesRef.child(stroke.id).remove().catch(err => {
          console.error('Error removing old stroke:', err);
        });
      });
    }
  }
  
  /**
   * Проверяет размер данных и удаляет старые штрихи если превышен лимит
   */
  checkDataSize() {
    const dataSize = JSON.stringify(this.strokes).length;
    
    if (dataSize > MAX_DATA_SIZE) {
      console.warn(`Data size limit exceeded (${dataSize}/${MAX_DATA_SIZE} bytes)`);
      
      // Удаляем 10% самых старых штрихов
      const toRemove = Math.ceil(this.strokes.length * 0.1);
      this.strokes.sort((a, b) => a.timestamp - b.timestamp);
      const removedStrokes = this.strokes.splice(0, toRemove);
      
      // Удаляем из Firebase
      if (this.roomRef && this.isConnected) {
        const strokesRef = this.roomRef.child('whiteboard/strokes');
        removedStrokes.forEach(stroke => {
          strokesRef.child(stroke.id).remove().catch(err => {
            console.error('Error removing stroke:', err);
          });
        });
      }
    }
  }

  /**
   * Загружает существующие штрихи из Firebase
   */
  loadExistingStrokes() {
    if (!this.roomRef) {
      console.log('[loadExistingStrokes] No roomRef');
      return;
    }
    
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    const currentRoomId = this.roomId; // Сохраняем ID текущей комнаты
    
    console.log(`[loadExistingStrokes] Loading strokes for room: ${currentRoomId}`);
    
    strokesRef.once('value', (snapshot) => {
      // ПРОВЕРКА: Убеждаемся, что мы все еще в той же комнате
      if (this.roomId !== currentRoomId) {
        console.warn(`[loadExistingStrokes] Room changed! Expected ${currentRoomId}, but now ${this.roomId}. Ignoring strokes.`);
        return;
      }
      
      const strokesData = snapshot.val();
      if (!strokesData) {
        console.log(`[loadExistingStrokes] No strokes found for room ${currentRoomId}`);
        return;
      }
      
      // Преобразуем объект в массив и валидируем
      const allStrokes = Object.values(strokesData);
      this.strokes = allStrokes.filter(stroke => this.validateStroke(stroke));
      
      console.log(`[loadExistingStrokes] Loaded ${this.strokes.length} strokes for room ${currentRoomId}`);
      
      // Показываем детали первых 3 штрихов для отладки
      if (this.strokes.length > 0) {
        console.log('[loadExistingStrokes] First strokes details:');
        this.strokes.slice(0, 3).forEach((stroke, index) => {
          console.log(`  Stroke ${index + 1}:`, {
            id: stroke.id,
            tool: stroke.tool,
            color: stroke.color,
            points: stroke.points.length,
            userId: stroke.userId,
            nickname: stroke.nickname,
            timestamp: new Date(stroke.timestamp).toLocaleString()
          });
        });
      }
      
      // Применяем лимит штрихов
      if (this.strokes.length > MAX_STROKES) {
        console.warn(`Loaded ${this.strokes.length} strokes, exceeds limit. Keeping newest ${MAX_STROKES}`);
        this.strokes.sort((a, b) => b.timestamp - a.timestamp);
        this.strokes = this.strokes.slice(0, MAX_STROKES);
      }
      
      // Отрисовываем все штрихи
      if (this.drawingEngine) {
        console.log(`[loadExistingStrokes] Drawing ${this.strokes.length} strokes on canvas`);
        this.drawingEngine.drawAllStrokes(this.strokes);
      }
      
      console.log(`[loadExistingStrokes] Complete for room ${this.roomId}`);
      
      // Проверяем размер данных
      this.checkDataSize();
    }).catch(error => {
      console.error('[loadExistingStrokes] Error:', error);
      this.handleFirebaseError(error);
    });
  }

  /**
   * Отправляет штрих в Firebase
   * @param {Object} stroke - Штрих
   */
  publishStroke(stroke) {
    if (!this.roomRef) return;
    
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    strokesRef.child(stroke.id).set(stroke).catch(error => {
      console.error('Error publishing stroke:', error);
      this.handleFirebaseError(error);
      
      // Буферизуем для повторной отправки
      if (!this.offlineBuffer.find(s => s.id === stroke.id)) {
        this.offlineBuffer.push(stroke);
      }
    });
  }
  
  /**
   * Обрабатывает ошибки Firebase
   * @param {Error} error - Ошибка
   */
  handleFirebaseError(error) {
    console.error('Firebase error:', error);
    
    // Проверяем тип ошибки
    if (error.code === 'PERMISSION_DENIED') {
      this.showError('Нет прав доступа к доске');
      this.isConnected = false;
    } else if (error.message && error.message.includes('network')) {
      this.showError('Потеряно соединение с сервером');
      this.isConnected = false;
      this.showReconnecting();
    } else {
      this.showError('Ошибка при работе с доской');
    }
  }
  
  /**
   * Показывает индикатор переподключения
   */
  showReconnecting() {
    if (this.ui && this.ui.showToast) {
      this.ui.showToast('Переподключение...', 2000, 'warning');
    }
    
    // Пытаемся переподключиться
    this.attemptReconnect();
  }
  
  /**
   * Пытается переподключиться к Firebase
   */
  attemptReconnect() {
    if (!this.roomRef) return;
    
    // Проверяем соединение через попытку чтения данных
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    
    strokesRef.once('value').then(() => {
      // Успешное чтение = соединение восстановлено
      console.log('Reconnected to Firebase');
      this.isConnected = true;
      
      if (this.ui && this.ui.showToast) {
        this.ui.showToast('Соединение восстановлено', 2000, 'success');
      }
      
      // Отправляем буферизованные штрихи
      this.flushOfflineBuffer();
    }).catch((error) => {
      // Ошибка чтения = нет соединения
      console.log('Still disconnected, retrying in 3 seconds...', error);
      // Повторяем попытку через 3 секунды
      setTimeout(() => this.attemptReconnect(), 3000);
    });
  }
  
  /**
   * Отправляет буферизованные штрихи после восстановления соединения
   */
  flushOfflineBuffer() {
    if (this.offlineBuffer.length === 0) return;
    
    console.log(`Flushing ${this.offlineBuffer.length} buffered strokes`);
    
    // Ограничиваем количество отправляемых штрихов (максимум 50)
    const toSend = this.offlineBuffer.splice(0, 50);
    
    toSend.forEach(stroke => {
      this.publishStroke(stroke);
    });
    
    // Если еще остались штрихи, отправляем их через 1 секунду
    if (this.offlineBuffer.length > 0) {
      setTimeout(() => this.flushOfflineBuffer(), 1000);
    }
  }
  
  /**
   * Показывает сообщение об ошибке
   * @param {string} message - Текст ошибки
   */
  showError(message) {
    if (this.ui && this.ui.showToast) {
      this.ui.showToast(message, 3000, 'error');
    } else {
      console.error(message);
    }
  }

  /**
   * Начинает слушать изменения в Firebase
   */
  startListening() {
    if (!this.roomRef) return;
    
    // КРИТИЧЕСКИ ВАЖНО: Сначала останавливаем старые слушатели
    this.stopListening();
    
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    const currentRoomId = this.roomId; // Сохраняем ID текущей комнаты
    
    // Слушаем новые штрихи
    this.childAddedListener = strokesRef.on('child_added', (snapshot) => {
      // ПРОВЕРКА: Убеждаемся, что мы все еще в той же комнате
      if (this.roomId !== currentRoomId) {
        console.log('Room changed, ignoring stroke');
        return;
      }
      
      const stroke = snapshot.val();
      
      // Валидируем штрих
      if (!this.validateStroke(stroke)) {
        console.warn('Received invalid stroke:', stroke);
        return;
      }
      
      // Пропускаем свои штрихи (они уже нарисованы)
      if (stroke.userId === this.myUserId) return;
      
      // Проверяем, не загружен ли уже этот штрих
      const exists = this.strokes.find(s => s.id === stroke.id);
      if (exists) return;
      
      // Добавляем в массив
      this.strokes.push(stroke);
      
      // Применяем лимит штрихов
      this.enforceStrokeLimit();
      
      // Отрисовываем
      if (this.drawingEngine) {
        this.drawingEngine.drawStroke(stroke);
      }
    }, (error) => {
      console.error('Error listening to strokes:', error);
      this.handleFirebaseError(error);
    });
    
    // Слушаем удаление всех штрихов (очистка доски)
    this.valueListener = strokesRef.on('value', (snapshot) => {
      // ПРОВЕРКА: Убеждаемся, что мы все еще в той же комнате
      if (this.roomId !== currentRoomId) {
        console.log('Room changed, ignoring value update');
        return;
      }
      
      const strokesData = snapshot.val();
      
      // Если данных нет - доска была очищена
      if (!strokesData || Object.keys(strokesData).length === 0) {
        this.strokes = [];
        if (this.drawingEngine) {
          this.drawingEngine.clearCanvas();
        }
      }
    }, (error) => {
      console.error('Error listening to strokes value:', error);
      this.handleFirebaseError(error);
    });
    
    // Статус соединения отслеживается через обработку ошибок при отправке штрихов
    // (убрали .info/connected так как это вызывает ошибку с child())
    
    console.log(`Started listening to Firebase for room ${this.roomId}`);
  }
  
  /**
   * Очищает доску (вызывается извне когда комната пустая)
   * 
   * Используйте этот метод в вашем коде:
   * if (usersInRoom === 0) {
   *   whiteboardManager.clearWhiteboardIfEmpty();
   * }
   */
  clearWhiteboardIfEmpty() {
    if (!this.roomRef) return;
    
    console.log('Clearing whiteboard (room is empty)');
    
    // Очищаем локально
    this.strokes = [];
    if (this.drawingEngine) {
      this.drawingEngine.clearCanvas();
    }
    
    // Удаляем все штрихи из Firebase
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    strokesRef.remove().then(() => {
      console.log('Whiteboard cleared successfully');
    }).catch(error => {
      console.error('Error clearing whiteboard:', error);
    });
  }

  /**
   * Останавливает слушатель Firebase
   */
  stopListening() {
    if (!this.roomRef) return;
    
    const strokesRef = this.roomRef.child('whiteboard/strokes');
    
    // Отключаем все слушатели для этой ссылки
    strokesRef.off('child_added');
    strokesRef.off('value');
    
    console.log(`Stopped listening to Firebase for room ${this.roomId}`);
  }
}


/**
 * Класс для обработки рисования на Canvas
 */
export class DrawingEngine {
  constructor(canvas, context, getCurrentSettings) {
    this.canvas = canvas;
    this.context = context;
    this.getCurrentSettings = getCurrentSettings; // Функция для получения текущих настроек (tool, color, size)
    
    // Текущий штрих
    this.currentStroke = null;
    this.isDrawing = false;
    
    // Callback для отправки штриха
    this.onStrokeComplete = null;
    
    // Батчинг точек
    this.pointsBuffer = [];
    this.batchTimer = null;
    this.lastBatchTime = 0;
    
    // Сохраняем ссылки на обработчики для удаления
    this.handlers = {
      mousedown: null,
      mousemove: null,
      mouseup: null,
      mouseleave: null,
      touchstart: null,
      touchmove: null,
      touchend: null,
      touchcancel: null
    };
  }

  /**
   * Устанавливает callback для завершенного штриха
   * @param {Function} callback - Функция (stroke)
   */
  setOnStrokeComplete(callback) {
    this.onStrokeComplete = callback;
  }

  /**
   * Получает координаты относительно canvas
   * @param {Event} e - Mouse или Touch событие
   * @returns {Object} {x, y}
   */
  getCoordinates(e) {
    const rect = this.canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
      // Touch событие
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      // Mouse событие
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    // Вычисляем координаты относительно canvas (CSS размер)
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    
    // Пересчитываем координаты с учетом масштабирования
    // rect.width/height - отображаемый размер (CSS)
    // canvas.width/height - внутреннее разрешение
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    return {
      x: canvasX * scaleX,
      y: canvasY * scaleY
    };
  }

  /**
   * Обработчик начала рисования
   * @param {Event} e - Mouse или Touch событие
   */
  onMouseDown(e) {
    e.preventDefault();
    
    const coords = this.getCoordinates(e);
    this.startStroke(coords.x, coords.y);
  }

  /**
   * Обработчик движения мыши
   * @param {Event} e - Mouse или Touch событие
   */
  onMouseMove(e) {
    if (!this.isDrawing) return;
    
    e.preventDefault();
    
    const coords = this.getCoordinates(e);
    this.addPoint(coords.x, coords.y);
  }

  /**
   * Обработчик окончания рисования
   * @param {Event} e - Mouse или Touch событие
   */
  onMouseUp(e) {
    if (!this.isDrawing) return;
    
    e.preventDefault();
    
    this.endStroke();
  }

  /**
   * Начинает новый штрих
   * @param {number} x - Координата X
   * @param {number} y - Координата Y
   */
  startStroke(x, y) {
    // Валидация координат
    if (!this.validateCoordinates(x, y)) {
      console.warn('Invalid start coordinates:', x, y);
      return;
    }
    
    const settings = this.getCurrentSettings();
    
    console.log('[startStroke] Starting new stroke with settings:', settings);
    
    this.isDrawing = true;
    this.currentStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      tool: settings.tool,
      color: settings.tool === 'eraser' ? '#FFFFFF' : settings.color,
      size: settings.size,
      points: [{x, y}],
      timestamp: Date.now()
    };
    
    console.log('[startStroke] Created stroke:', {
      tool: this.currentStroke.tool,
      color: this.currentStroke.color,
      size: this.currentStroke.size
    });
    
    // Начинаем рисовать
    this.context.beginPath();
    this.context.moveTo(x, y);
    
    // Инициализируем буфер точек
    this.pointsBuffer = [];
    this.lastBatchTime = Date.now();
  }

  /**
   * Добавляет точку к текущему штриху
   * @param {number} x - Координата X
   * @param {number} y - Координата Y
   */
  addPoint(x, y) {
    if (!this.currentStroke) return;
    
    // Валидация координат
    if (!this.validateCoordinates(x, y)) {
      console.warn('Invalid coordinates:', x, y);
      return;
    }
    
    // Добавляем точку в буфер
    this.pointsBuffer.push({x, y});
    
    // Рисуем линию немедленно для плавности
    this.context.lineTo(x, y);
    this.context.strokeStyle = this.currentStroke.color;
    this.context.lineWidth = this.currentStroke.size;
    this.context.lineCap = 'round';
    this.context.lineJoin = 'round';
    this.context.stroke();
    
    // Батчинг: добавляем точки в штрих каждые BATCH_INTERVAL мс
    const now = Date.now();
    if (now - this.lastBatchTime >= BATCH_INTERVAL) {
      this.flushPointsBuffer();
      this.lastBatchTime = now;
    }
  }
  
  /**
   * Валидирует координаты
   * @param {number} x - Координата X
   * @param {number} y - Координата Y
   * @returns {boolean} true если координаты валидны
   */
  validateCoordinates(x, y) {
    // Проверяем, что координаты числа
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    
    // Проверяем, что координаты в пределах canvas (используем текущие размеры)
    if (x < 0 || x > this.canvas.width || y < 0 || y > this.canvas.height) return false;
    
    // Проверяем, что координаты не NaN или Infinity
    if (!isFinite(x) || !isFinite(y)) return false;
    
    return true;
  }
  
  /**
   * Сбрасывает буфер точек в текущий штрих
   */
  flushPointsBuffer() {
    if (this.pointsBuffer.length === 0 || !this.currentStroke) return;
    
    // Добавляем все точки из буфера в штрих
    this.currentStroke.points.push(...this.pointsBuffer);
    
    // Ограничиваем количество точек в штрихе (макс 500)
    if (this.currentStroke.points.length > 500) {
      // Оставляем только последние 500 точек (это нормальное поведение для длинных линий)
      this.currentStroke.points = this.currentStroke.points.slice(-500);
    }
    
    // Очищаем буфер
    this.pointsBuffer = [];
  }

  /**
   * Завершает текущий штрих
   */
  endStroke() {
    if (!this.currentStroke) return;
    
    this.isDrawing = false;
    
    // Сбрасываем оставшиеся точки из буфера
    this.flushPointsBuffer();
    
    // Отправляем завершенный штрих через callback
    if (this.onStrokeComplete && this.currentStroke.points.length > 1) {
      this.onStrokeComplete(this.currentStroke);
    }
    
    this.currentStroke = null;
    this.pointsBuffer = [];
  }

  /**
   * Настраивает обработчики событий
   */
  setupEventHandlers() {
    // Сначала удаляем старые обработчики
    this.removeEventHandlers();
    
    // Создаем и сохраняем обработчики
    this.handlers.mousedown = (e) => this.onMouseDown(e);
    this.handlers.mousemove = (e) => this.onMouseMove(e);
    this.handlers.mouseup = (e) => this.onMouseUp(e);
    this.handlers.mouseleave = (e) => this.onMouseUp(e);
    this.handlers.touchstart = (e) => this.onMouseDown(e);
    this.handlers.touchmove = (e) => this.onMouseMove(e);
    this.handlers.touchend = (e) => this.onMouseUp(e);
    this.handlers.touchcancel = (e) => this.onMouseUp(e);
    
    // Mouse события
    this.canvas.addEventListener('mousedown', this.handlers.mousedown);
    this.canvas.addEventListener('mousemove', this.handlers.mousemove);
    this.canvas.addEventListener('mouseup', this.handlers.mouseup);
    this.canvas.addEventListener('mouseleave', this.handlers.mouseleave);
    
    // Touch события для планшетов
    this.canvas.addEventListener('touchstart', this.handlers.touchstart);
    this.canvas.addEventListener('touchmove', this.handlers.touchmove);
    this.canvas.addEventListener('touchend', this.handlers.touchend);
    this.canvas.addEventListener('touchcancel', this.handlers.touchcancel);
    
    console.log('[DrawingEngine] Event handlers attached');
  }

  /**
   * Удаляет обработчики событий
   */
  removeEventHandlers() {
    if (!this.canvas) return;
    
    // Удаляем все обработчики
    if (this.handlers.mousedown) {
      this.canvas.removeEventListener('mousedown', this.handlers.mousedown);
      this.canvas.removeEventListener('mousemove', this.handlers.mousemove);
      this.canvas.removeEventListener('mouseup', this.handlers.mouseup);
      this.canvas.removeEventListener('mouseleave', this.handlers.mouseleave);
      this.canvas.removeEventListener('touchstart', this.handlers.touchstart);
      this.canvas.removeEventListener('touchmove', this.handlers.touchmove);
      this.canvas.removeEventListener('touchend', this.handlers.touchend);
      this.canvas.removeEventListener('touchcancel', this.handlers.touchcancel);
      
      console.log('[DrawingEngine] Event handlers removed');
    }
    
    // Очищаем ссылки
    this.handlers = {
      mousedown: null,
      mousemove: null,
      mouseup: null,
      mouseleave: null,
      touchstart: null,
      touchmove: null,
      touchend: null,
      touchcancel: null
    };
  }

  /**
   * Отрисовывает один штрих
   * @param {Object} stroke - Объект штриха
   */
  drawStroke(stroke) {
    if (!stroke || !stroke.points || stroke.points.length < 2) return;
    
    this.context.beginPath();
    this.context.strokeStyle = stroke.color;
    this.context.lineWidth = stroke.size;
    this.context.lineCap = 'round';
    this.context.lineJoin = 'round';
    
    // Начинаем с первой точки
    this.context.moveTo(stroke.points[0].x, stroke.points[0].y);
    
    // Рисуем линии через все точки
    for (let i = 1; i < stroke.points.length; i++) {
      this.context.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    
    this.context.stroke();
  }

  /**
   * Отрисовывает все штрихи
   * @param {Array} strokes - Массив штрихов
   */
  drawAllStrokes(strokes) {
    // Очищаем canvas
    this.clearCanvas();
    
    // Оптимизация для большого количества штрихов
    if (strokes.length > 500) {
      console.log('Optimizing rendering for', strokes.length, 'strokes');
      this.drawStrokesOptimized(strokes);
    } else {
      // Используем requestAnimationFrame для плавной отрисовки
      requestAnimationFrame(() => {
        strokes.forEach(stroke => {
          this.drawStroke(stroke);
        });
      });
    }
  }
  
  /**
   * Оптимизированная отрисовка для большого количества штрихов
   * @param {Array} strokes - Массив штрихов
   */
  drawStrokesOptimized(strokes) {
    const BATCH_SIZE = 50; // Рисуем по 50 штрихов за раз
    let currentIndex = 0;
    
    const drawBatch = () => {
      const endIndex = Math.min(currentIndex + BATCH_SIZE, strokes.length);
      
      for (let i = currentIndex; i < endIndex; i++) {
        this.drawStroke(strokes[i]);
      }
      
      currentIndex = endIndex;
      
      // Если еще есть штрихи, продолжаем в следующем кадре
      if (currentIndex < strokes.length) {
        requestAnimationFrame(drawBatch);
      } else {
        console.log('Finished rendering', strokes.length, 'strokes');
      }
    };
    
    requestAnimationFrame(drawBatch);
  }

  /**
   * Изменяет размер canvas с сохранением соотношения 16:9
   */
  resizeCanvas() {
    if (!this.canvas || !this.modal) return;
    
    const container = this.canvas.parentElement;
    if (!container) return;
    
    // Получаем размеры контейнера
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Вычисляем размеры canvas с соотношением 16:9
    let canvasWidth, canvasHeight;
    const aspectRatio = 16 / 9;
    
    if (containerWidth / containerHeight > aspectRatio) {
      // Контейнер шире чем нужно - ограничиваем по высоте
      canvasHeight = containerHeight;
      canvasWidth = canvasHeight * aspectRatio;
    } else {
      // Контейнер выше чем нужно - ограничиваем по ширине
      canvasWidth = containerWidth;
      canvasHeight = canvasWidth / aspectRatio;
    }
    
    // Округляем размеры
    const newWidth = Math.floor(canvasWidth);
    const newHeight = Math.floor(canvasHeight);
    
    // Проверяем, нужно ли изменять размер
    if (this.canvas.width === newWidth && this.canvas.height === newHeight) {
      return; // Размер не изменился
    }
    
    // Сохраняем текущие штрихи
    const savedStrokes = [...this.strokes];
    
    // Устанавливаем новые размеры (это очистит canvas)
    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    
    // Устанавливаем CSS размеры
    this.canvas.style.width = newWidth + 'px';
    this.canvas.style.height = newHeight + 'px';
    
    // Заливаем белым фоном
    this.context.fillStyle = '#FFFFFF';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Перерисовываем все штрихи
    if (savedStrokes.length > 0) {
      console.log(`Redrawing ${savedStrokes.length} strokes after resize`);
      savedStrokes.forEach(stroke => {
        this.drawStroke(stroke);
      });
    }
    
    console.log(`Canvas resized to ${this.canvas.width}x${this.canvas.height}`);
  }

  /**
   * Очищает canvas
   */
  clearCanvas() {
    this.context.fillStyle = '#FFFFFF';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
