/**
 * Модуль для встроенной консоли разработчика
 * Перехватывает и отображает все логи, ошибки и предупреждения
 */

import { getElementById } from '../utils/dom-cache.js';

export class DevConsole {
  constructor() {
    this.consoleEl = null;
    this.consoleContent = null;
    this.consoleBtn = null;
    this.consoleCloseBtn = null;
    this.consoleClearBtn = null;
    this.filterButtons = [];
    this.isVisible = false;
    this.logs = [];
    this.maxLogs = 30; // 🚨 КРИТИЧНО: Уменьшено до 30 для обычных логов (info, debug)
    this.currentFilter = 'all';
    this.userScrolled = false; // Флаг, указывающий, прокрутил ли пользователь консоль вручную
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console)
    };
    this.isInitialized = false;
    
    // Инициализируем после небольшой задержки, чтобы DOM был готов
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.init(), 100);
      });
    } else {
      setTimeout(() => this.init(), 100);
    }
  }

  /**
   * Инициализирует консоль
   */
  init() {
    // Используем кэшированные функции для оптимизации с fallback
    this.consoleEl = getElementById('devConsole') || document.getElementById('devConsole');
    this.consoleContent = getElementById('consoleContent') || document.getElementById('consoleContent');
    this.consoleBtn = getElementById('consoleBtn') || document.getElementById('consoleBtn');
    this.consoleCloseBtn = getElementById('consoleCloseBtn') || document.getElementById('consoleCloseBtn');
    this.consoleClearBtn = getElementById('consoleClearBtn') || document.getElementById('consoleClearBtn');
    
    if (!this.consoleEl || !this.consoleContent) {
      console.error('Консоль разработчика: элементы не найдены в DOM', {
        consoleEl: !!this.consoleEl,
        consoleContent: !!this.consoleContent,
        consoleBtn: !!this.consoleBtn
      });
      // Пробуем еще раз через небольшую задержку
      setTimeout(() => {
        if (!this.consoleEl || !this.consoleContent) {
          this.consoleEl = document.getElementById('devConsole');
          this.consoleContent = document.getElementById('consoleContent');
          this.consoleBtn = document.getElementById('consoleBtn');
          this.consoleCloseBtn = document.getElementById('consoleCloseBtn');
          this.consoleClearBtn = document.getElementById('consoleClearBtn');
          
          if (this.consoleEl && this.consoleContent) {
            console.log('✅ Консоль найдена после повторной попытки');
            this.setupEventListeners();
          }
        }
      }, 500);
      return;
    }
    
    this.setupEventListeners();
  }
  
  /**
   * Настраивает обработчики событий для консоли
   */
  setupEventListeners() {

    // Инициализируем кнопки
    if (this.consoleBtn) {
      this.consoleBtn.addEventListener('click', () => this.toggle());
    }

    if (this.consoleCloseBtn) {
      this.consoleCloseBtn.addEventListener('click', () => this.hide());
    }

    if (this.consoleClearBtn) {
      this.consoleClearBtn.addEventListener('click', () => this.clear());
    }

    // Инициализируем фильтры
    this.initFilters();

    // Делаем консоль перетаскиваемой
    this.makeDraggable();

    // Отслеживаем прокрутку пользователем
    this.setupScrollTracking();

    // Загружаем сохраненные логи из sessionStorage
    this.loadFromStorage();

    // Перехватываем console методы (после инициализации элементов)
    this.interceptConsole();

    // Логируем инициализацию
    this.originalConsole.log('✅ Встроенная консоль разработчика инициализирована');
    this.isInitialized = true;
  }

  /**
   * Инициализирует кнопки фильтров
   */
  initFilters() {
    const filterButtons = document.querySelectorAll('.console-filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const level = e.target.dataset.level;
        this.setFilter(level);
      });
      this.filterButtons.push(btn);
    });
  }

  /**
   * Устанавливает фильтр логов
   * @param {string} level - Уровень фильтра (all, error, warn, info, debug)
   */
  setFilter(level) {
    this.currentFilter = level;
    
    // Обновляем активные кнопки
    this.filterButtons.forEach(btn => {
      if (btn.dataset.level === level) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Перерисовываем логи
    this.renderLogs();
  }

  /**
   * Перехватывает методы console
   */
  interceptConsole() {
    const self = this;
    
    // 🚨 КРИТИЧНО: Ограничиваем частоту логирования для производительности
    let logThrottle = {};
    const THROTTLE_MS = 100; // Не чаще раза в 100ms для каждого типа
    
    const shouldLog = (level) => {
      const now = Date.now();
      if (!logThrottle[level] || (now - logThrottle[level]) > THROTTLE_MS) {
        logThrottle[level] = now;
        return true;
      }
      return false;
    };

    console.log = function(...args) {
      self.originalConsole.log.apply(console, args);
      if (shouldLog('info')) {
        self.addLog('info', args);
      }
    };

    console.error = function(...args) {
      self.originalConsole.error.apply(console, args);
      // Ошибки всегда логируем
      self.addLog('error', args);
    };

    console.warn = function(...args) {
      self.originalConsole.warn.apply(console, args);
      if (shouldLog('warn')) {
        self.addLog('warn', args);
      }
    };

    console.info = function(...args) {
      self.originalConsole.info.apply(console, args);
      if (shouldLog('info')) {
        self.addLog('info', args);
      }
    };

    console.debug = function(...args) {
      self.originalConsole.debug.apply(console, args);
      if (shouldLog('debug')) {
        self.addLog('debug', args);
      }
    };

    // Перехватываем ошибки
    window.addEventListener('error', (event) => {
      self.addLog('error', [
        `Uncaught ${event.error?.name || 'Error'}: ${event.message}`,
        event.error?.stack || event.filename + ':' + event.lineno
      ]);
    });

    // Перехватываем необработанные промисы
    window.addEventListener('unhandledrejection', (event) => {
      self.addLog('error', [
        `Unhandled Promise Rejection: ${event.reason}`,
        event.reason?.stack || ''
      ]);
    });
  }

  /**
   * Добавляет лог в консоль
   * @param {string} level - Уровень лога (info, error, warn, debug)
   * @param {Array} args - Аргументы для логирования
   */
  addLog(level, args) {
    if (!this.consoleContent) {
      // Если консоль еще не инициализирована, просто сохраняем в оригинальный console
      this.originalConsole[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](...args);
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp,
      level,
      message,
      raw: args
    };

    // ВСЕГДА сохраняем лог в массив, независимо от видимости
    this.logs.push(logEntry);

    // 🚨 КРИТИЧНО: Умная очистка логов для производительности
    // Ошибки и предупреждения сохраняем всегда, обычные логи ограничиваем до 30
    if (this.logs.length > this.maxLogs) {
      // Разделяем логи на важные (error, warn) и обычные (info, debug)
      const importantLogs = this.logs.filter(log => log.level === 'error' || log.level === 'warn');
      const regularLogs = this.logs.filter(log => log.level !== 'error' && log.level !== 'warn');
      
      // Оставляем только последние 30 обычных логов
      const trimmedRegularLogs = regularLogs.slice(-this.maxLogs);
      
      // Объединяем: все важные логи + последние 30 обычных
      this.logs = [...importantLogs, ...trimmedRegularLogs].sort((a, b) => a.id - b.id);
    }

    // Обновляем счетчик
    this.updateLogCount();

    // Сохраняем в sessionStorage
    this.saveToStorage();

    // Отображаем лог ТОЛЬКО если консоль видима И элемент существует
    if (this.isVisible && this.consoleContent) {
      // Используем requestAnimationFrame для гарантии, что DOM готов
      requestAnimationFrame(() => {
        if (this.consoleContent && this.isVisible) {
          this.renderLog(logEntry);
          
          // Автоматически прокручиваем вниз после рендеринга
          requestAnimationFrame(() => {
            this.scrollToBottomImmediate(true);
          });
        }
      });
    }
  }

  /**
   * Отображает один лог
   * @param {Object} logEntry - Запись лога
   */
  renderLog(logEntry) {
    if (!this.consoleContent) {
      console.error('Консоль: consoleContent не найден при попытке отобразить лог');
      return;
    }

    // Проверяем фильтр
    if (this.currentFilter !== 'all' && logEntry.level !== this.currentFilter) {
      return;
    }

    // Удаляем приветственное сообщение
    const welcome = this.consoleContent.querySelector('.console-welcome');
    if (welcome) {
      welcome.remove();
    }

    try {
      const logEl = document.createElement('div');
      logEl.className = `console-log console-log-${logEntry.level}`;
      logEl.setAttribute('data-log-id', logEntry.id);
      
      const timeEl = document.createElement('span');
      timeEl.className = 'console-log-time';
      timeEl.textContent = logEntry.timestamp;

      const levelEl = document.createElement('span');
      levelEl.className = `console-log-level console-log-level-${logEntry.level}`;
      levelEl.textContent = this.getLevelLabel(logEntry.level);

      const messageEl = document.createElement('div');
      messageEl.className = 'console-log-message';
      
      // Форматируем сообщение
      if (logEntry.raw && logEntry.raw.some(arg => typeof arg === 'object')) {
        // Если есть объекты, создаем более красивое отображение
        logEntry.raw.forEach(arg => {
          if (typeof arg === 'object') {
            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify(arg, null, 2);
            messageEl.appendChild(pre);
          } else {
            const span = document.createElement('span');
            span.textContent = String(arg) + ' ';
            messageEl.appendChild(span);
          }
        });
      } else {
        messageEl.textContent = logEntry.message || '';
      }

      logEl.appendChild(timeEl);
      logEl.appendChild(levelEl);
      logEl.appendChild(messageEl);

      // Добавляем элемент в DOM
      this.consoleContent.appendChild(logEl);
      
      // Проверяем, что элемент действительно добавлен
      if (!this.consoleContent.contains(logEl)) {
        console.error('Консоль: не удалось добавить элемент лога в DOM');
      }
    } catch (error) {
      console.error('Консоль: ошибка при отображении лога:', error);
      this.originalConsole.error('Ошибка рендеринга лога:', error);
    }
  }

  /**
   * Отображает все логи с учетом фильтра
   */
  renderLogs() {
    if (!this.consoleContent) {
      console.error('Консоль: consoleContent не найден при попытке отобразить логи');
      return;
    }

    // Очищаем контент
    this.consoleContent.innerHTML = '';

    if (!this.logs || this.logs.length === 0) {
      this.consoleContent.innerHTML = '<div class="console-welcome">Консоль готова к работе. Логи будут отображаться здесь.</div>';
      return;
    }

    // Фильтруем логи
    const filteredLogs = this.currentFilter === 'all' 
      ? this.logs 
      : this.logs.filter(log => log && log.level === this.currentFilter);

    if (filteredLogs.length === 0) {
      this.consoleContent.innerHTML = `<div class="console-welcome">Нет логов уровня "${this.currentFilter}"</div>`;
      return;
    }

    // Отображаем логи по одному
    filteredLogs.forEach((log, index) => {
      if (log) {
        this.renderLog(log);
      }
    });

    // Прокручиваем вниз после рендеринга (принудительно, игнорируя пользовательскую прокрутку)
    requestAnimationFrame(() => {
      this.scrollToBottomImmediate(true);
    });
  }

  /**
   * Получает метку уровня лога
   * @param {string} level - Уровень лога
   * @returns {string} Метка уровня
   */
  getLevelLabel(level) {
    const labels = {
      error: 'ERROR',
      warn: 'WARN',
      info: 'INFO',
      debug: 'DEBUG'
    };
    return labels[level] || level.toUpperCase();
  }

  /**
   * Обновляет счетчик логов
   */
  updateLogCount() {
    const countEl = document.getElementById('consoleLogCount');
    if (countEl) {
      const count = this.currentFilter === 'all' 
        ? this.logs.length 
        : this.logs.filter(log => log.level === this.currentFilter).length;
      countEl.textContent = count;
    }
  }

  /**
   * Мгновенная прокрутка вниз (используется при добавлении новых логов)
   * @param {boolean} ignoreUserScroll - Игнорировать ли пользовательскую прокрутку (для принудительной прокрутки)
   */
  scrollToBottomImmediate(ignoreUserScroll = false) {
    if (!this.consoleContent) {
      return;
    }
    
    // Проверяем, прокрутил ли пользователь вручную (только если не игнорируем)
    if (!ignoreUserScroll && this.userScrolled) {
      const isNearBottom = Math.abs(
        this.consoleContent.scrollHeight - 
        this.consoleContent.scrollTop - 
        this.consoleContent.clientHeight
      ) < 30;
      
      // Если пользователь не внизу, не прокручиваем автоматически
      if (!isNearBottom) {
        return;
      }
    }
    
    // Функция для прокрутки вниз
    const doScroll = () => {
      if (!this.consoleContent) return;
      
      try {
        // Получаем размеры
        const scrollHeight = this.consoleContent.scrollHeight;
        const clientHeight = this.consoleContent.clientHeight;
        const maxScroll = Math.max(0, scrollHeight - clientHeight);
        
        // Проверяем, что есть что прокручивать
        if (scrollHeight > clientHeight && maxScroll >= 0) {
          // Устанавливаем scrollTop напрямую
          this.consoleContent.scrollTop = maxScroll;
          
          // Проверяем результат
          const currentScroll = this.consoleContent.scrollTop;
          const diff = Math.abs(currentScroll - maxScroll);
          
          // Если прокрутка не сработала, пробуем альтернативный метод
          if (diff > 5) {
            // Пробуем установить максимальное значение
            this.consoleContent.scrollTop = scrollHeight;
            
            // Или используем scrollIntoView для последнего элемента
            const lastChild = this.consoleContent.lastElementChild;
            if (lastChild && lastChild !== this.consoleContent.querySelector('.console-welcome')) {
              lastChild.scrollIntoView({ behavior: 'auto', block: 'end' });
            }
          }
        }
      } catch (e) {
        console.error('Консоль: ошибка при прокрутке:', e);
      }
    };
    
    // Прокручиваем сразу
    doScroll();
    
    // Прокручиваем после следующего кадра
    requestAnimationFrame(() => {
      doScroll();
      requestAnimationFrame(() => {
        doScroll();
        // Еще одна проверка через небольшую задержку
        setTimeout(doScroll, 10);
      });
    });
    
    // Дополнительные попытки через задержки
    setTimeout(doScroll, 20);
    setTimeout(doScroll, 50);
  }

  /**
   * Прокручивает консоль вниз (с проверкой пользовательской прокрутки)
   */
  scrollToBottom(force = false) {
    if (!this.consoleContent) return;
    
    // Если принудительная прокрутка или пользователь был внизу
    if (force || !this.userScrolled) {
      this.scrollToBottomImmediate();
    }
  }

  /**
   * Показывает консоль
   */
  show() {
    if (!this.consoleEl || !this.consoleContent) {
      console.error('Консоль: элементы не найдены при попытке показать консоль');
      return;
    }

    // Показываем консоль
    this.consoleEl.style.display = 'flex'; // Используем flex вместо block для правильного отображения
    this.isVisible = true;
    this.userScrolled = false; // Сбрасываем флаг при открытии
    
    // Небольшая задержка для гарантии, что DOM обновился
    requestAnimationFrame(() => {
      // Отображаем все сохраненные логи
      this.renderLogs();
      this.updateLogCount();
      
      // Прокручиваем вниз после отображения
      requestAnimationFrame(() => {
        this.scrollToBottomImmediate(true);
        // Дополнительная прокрутка через небольшую задержку
        setTimeout(() => {
          this.scrollToBottomImmediate(true);
        }, 50);
      });
    });
  }

  /**
   * Скрывает консоль
   */
  hide() {
    if (this.consoleEl) {
      this.consoleEl.style.display = 'none';
      this.isVisible = false;
    }
  }

  /**
   * Переключает видимость консоли
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Очищает консоль
   */
  clear() {
    this.logs = [];
    if (this.consoleContent) {
      this.consoleContent.innerHTML = '<div class="console-welcome">Консоль очищена.</div>';
    }
    this.updateLogCount();
    this.saveToStorage();
  }

  /**
   * Настраивает отслеживание прокрутки пользователем
   */
  setupScrollTracking() {
    if (!this.consoleContent) return;

    let scrollTimeout;
    let isUserScrolling = false;
    
    this.consoleContent.addEventListener('wheel', () => {
      isUserScrolling = true;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isUserScrolling = false;
      }, 1000);
    });
    
    this.consoleContent.addEventListener('scroll', () => {
      // Если пользователь прокручивает вручную (не программно)
      if (isUserScrolling) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          const isAtBottom = Math.abs(
            this.consoleContent.scrollHeight - 
            this.consoleContent.scrollTop - 
            this.consoleContent.clientHeight
          ) < 5;
          this.userScrolled = !isAtBottom;
        }, 200);
      }
    });
  }

  /**
   * Делает консоль перетаскиваемой
   */
  makeDraggable() {
    if (!this.consoleEl) return;

    const header = this.consoleEl.querySelector('.dev-console-header');
    if (!header) return;

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    header.addEventListener('mousedown', (e) => {
      // Не перетаскиваем, если клик по кнопке
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }

      isDragging = true;
      initialX = e.clientX - this.consoleEl.offsetLeft;
      initialY = e.clientY - this.consoleEl.offsetTop;
      
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      // Ограничиваем перемещение в пределах окна
      const maxX = window.innerWidth - this.consoleEl.offsetWidth;
      const maxY = window.innerHeight - this.consoleEl.offsetHeight;

      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      this.consoleEl.style.left = currentX + 'px';
      this.consoleEl.style.top = currentY + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';
      }
    });
  }

  /**
   * Сохраняет логи в sessionStorage
   */
  saveToStorage() {
    try {
      // Сохраняем только последние 100 логов для экономии места
      const logsToSave = this.logs.slice(-100);
      sessionStorage.setItem('devConsoleLogs', JSON.stringify(logsToSave));
    } catch (e) {
      // Игнорируем ошибки сохранения
    }
  }

  /**
   * Загружает логи из sessionStorage
   */
  loadFromStorage() {
    try {
      const savedLogs = sessionStorage.getItem('devConsoleLogs');
      if (savedLogs) {
        this.logs = JSON.parse(savedLogs);
        this.updateLogCount();
      }
    } catch (e) {
      // Игнорируем ошибки загрузки
    }
  }

  /**
   * Экспортирует логи
   * @returns {string} Экспортированные логи в виде текста
   */
  exportLogs() {
    return this.logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`
    ).join('\n');
  }
}

// Создаем глобальный экземпляр консоли
export const devConsole = new DevConsole();

