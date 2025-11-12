# Инструкция по загрузке на GitHub

## Шаг 1: Создайте репозиторий на GitHub

1. Откройте https://github.com
2. Войдите в аккаунт (или создайте новый)
3. Нажмите "+" в правом верхнем углу → "New repository"
4. Заполните:
   - Repository name: `vibechat`
   - Description: `VibeChat - голосовой чат приложение`
   - Выберите **Private** (если хотите приватный репозиторий)
   - НЕ добавляйте README, .gitignore, license
5. Нажмите "Create repository"
6. **ВАЖНО:** Скопируйте ваш GitHub username (он будет в URL)

## Шаг 2: Обновите package.json

Откройте `package.json` и замените:
```json
"owner": "YOUR_GITHUB_USERNAME"
```
на ваш реальный GitHub username, например:
```json
"owner": "ivan123"
```

## Шаг 3: Создайте Personal Access Token

1. GitHub → Settings (справа вверху, ваш аватар)
2. Developer settings (внизу слева)
3. Personal access tokens → Tokens (classic)
4. "Generate new token (classic)"
5. Заполните:
   - Note: `VibeChat Deploy`
   - Expiration: `No expiration` (или выберите срок)
   - Выберите права: **repo** (поставьте все галочки в разделе repo)
6. Нажмите "Generate token"
7. **ВАЖНО:** Скопируйте токен и сохраните в безопасном месте!

## Шаг 4: Загрузите проект

Откройте PowerShell в папке проекта и выполните команды:

### 4.1 Инициализация Git
```powershell
git init
```

### 4.2 Добавление файлов
```powershell
git add .
```

### 4.3 Первый коммит
```powershell
git commit -m "Initial commit - VibeChat v1.0.0"
```

### 4.4 Подключение к GitHub
Замените `YOUR_GITHUB_USERNAME` на ваш username:
```powershell
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/vibechat.git
```

### 4.5 Загрузка кода
```powershell
git branch -M main
git push -u origin main
```

При запросе авторизации:
- Username: ваш GitHub username
- Password: вставьте Personal Access Token (не пароль!)

## Шаг 5: Проверка

1. Откройте https://github.com/YOUR_GITHUB_USERNAME/vibechat
2. Вы должны увидеть все файлы проекта

## Что дальше?

После успешной загрузки на GitHub:
1. Установите зависимости: `npm install`
2. Настройте автообновления (следующая инструкция)
3. Создайте первый релиз

## Возможные проблемы

### "fatal: not a git repository"
Решение: Убедитесь что выполнили `git init`

### "Authentication failed"
Решение: Используйте Personal Access Token вместо пароля

### "remote origin already exists"
Решение: Выполните `git remote remove origin` и повторите шаг 4.4

### Файлы не загружаются
Решение: Проверьте `.gitignore`, возможно файлы игнорируются
