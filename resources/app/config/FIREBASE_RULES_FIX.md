# Исправление правил Firebase для friendRequests

## Проблема
Ошибка `PERMISSION_DENIED` при отправке запроса в друзья.

Пример ошибки:
```
PERMISSION_DENIED at /friendRequests/JuGfRFkpEeMk71bnlQf3pTDBC1E2/il56ibis40ZK7va0bjR1LU641jg2
```

## Причина
Правила Firebase не разрешали отправителю (`$fromUserId`) записывать запрос получателю (`$userId`).

## Решение

Обновлены правила для `friendRequests` в файле `firebase-rules.txt`:

```json
"friendRequests": {
  "$userId": {
    ".read": "auth != null && $userId == auth.uid",
    "$fromUserId": {
      ".write": "auth != null && auth.uid == $fromUserId",
      ".read": "auth != null && ($userId == auth.uid || auth.uid == $fromUserId)",
      ".validate": "newData.hasChildren(['fromUserId', 'fromNickname', 'timestamp', 'status']) && newData.child('status').isString() && newData.child('status').val() == 'pending' && newData.child('fromUserId').isString() && newData.child('fromUserId').val() == $fromUserId && newData.child('fromNickname').isString() && newData.child('timestamp').isNumber()"
    }
  }
}
```

## Изменения:

1. **Правило `.write` на уровне `$fromUserId`**: 
   - Разрешает запись только отправителю (`auth.uid == $fromUserId`)
   - Отправитель может создавать запросы в папке получателя

2. **Правило `.read` на уровне `$fromUserId`**: 
   - Добавлено для того, чтобы и отправитель, и получатель могли читать запрос
   - `$userId == auth.uid` - получатель может читать
   - `auth.uid == $fromUserId` - отправитель может читать (для проверки существующих запросов)

3. **Правило `.read` на уровне `$userId`**: 
   - Получатель может читать все запросы, адресованные ему

## Как применить:

1. Откройте [Firebase Console](https://console.firebase.google.com/)
2. Выберите ваш проект
3. Перейдите в **Realtime Database** → **Rules**
4. Скопируйте **ВСЕ** правила из файла `firebase-rules.txt` (начиная с `{` и заканчивая `}`)
5. Вставьте в редактор правил
6. Нажмите **"Publish"**

⚠️ **Важно**: Скопируйте ВСЕ правила, а не только секцию `friendRequests`, чтобы не сломать другие правила безопасности!

## Проверка после применения:

После применения правил должно работать:
- ✅ Отправитель может записать запрос получателю (`auth.uid == $fromUserId`)
- ✅ Получатель может читать запросы, адресованные ему (`$userId == auth.uid`)
- ✅ Отправитель может проверить, отправлен ли уже запрос (для предотвращения дублирования)

## Тестирование:

1. Пользователь A отправляет запрос пользователю B
2. Запрос должен успешно сохраниться в Firebase
3. Пользователь B должен получить уведомление о новом запросе
4. Оба пользователя могут видеть статус запроса
