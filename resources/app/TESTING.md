# Тестирование VibeChat

## Настройка

Тесты используют Jest для unit-тестирования. Для установки зависимостей:

```bash
npm install
```

## Запуск тестов

### Запуск всех тестов
```bash
npm test
```

### Запуск тестов в watch режиме
```bash
npm run test:watch
```

### Запуск тестов с покрытием
```bash
npm run test:coverage
```

## Структура тестов

Тесты расположены рядом с модулями, которые они тестируют:

```
src/
  utils/
    __tests__/
      error-handler.test.js
      security.test.js
  modules/
    __tests__/
      constants.test.js
```

## Покрытие тестами

Текущее покрытие тестами:
- ✅ Модуль обработки ошибок (`error-handler.js`)
- ✅ Модуль безопасности (`security.js`)
- ✅ Константы приложения (`constants.js`)

## Написание новых тестов

### Пример теста

```javascript
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../my-module.js';

describe('myModule', () => {
  describe('myFunction', () => {
    it('должен возвращать правильное значение', () => {
      const result = myFunction('input');
      expect(result).toBe('expected');
    });
  });
});
```

### Запуск конкретного теста

```bash
npm test -- error-handler.test.js
```

## Конфигурация Jest

Конфигурация Jest находится в `package.json`:

- `testEnvironment: "jsdom"` - для тестирования DOM API
- `extensionsToTreatAsEsm: [".js"]` - поддержка ES модулей
- `moduleNameMapper` - маппинг путей модулей

## Покрытие кода

Отчет о покрытии кода генерируется в папке `coverage/` после запуска `npm run test:coverage`.

## Лучшие практики

1. **Именование тестов**: Используйте описательные имена, которые объясняют что тестируется
2. **Один тест - одна проверка**: Каждый тест должен проверять одну вещь
3. **Изоляция тестов**: Тесты не должны зависеть друг от друга
4. **Моки**: Используйте моки для внешних зависимостей (Firebase, DOM API и т.д.)

## TODO

- [ ] Добавить тесты для модуля авторизации (`auth.js`)
- [ ] Добавить тесты для модуля чата (`chat.js`)
- [ ] Добавить тесты для модуля Firebase (`firebase.js`)
- [ ] Добавить интеграционные тесты
- [ ] Добавить E2E тесты (Playwright/Cypress)

