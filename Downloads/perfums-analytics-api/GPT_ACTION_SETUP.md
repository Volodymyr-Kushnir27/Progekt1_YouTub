# Налаштування GPT Action

## 1. Локальна перевірка Supabase

Додайте у `.env` секрет для Action:

```env
ACTION_API_KEY=довгий_випадковий_секрет
```

Згенерувати його можна командою:

```bash
openssl rand -hex 32
```

Запустіть API:

```bash
npm install
npm start
```

В іншому вікні Terminal виконайте, підставивши свій секрет:

```bash
export PERFUMS_ACTION_KEY='ваш_ACTION_API_KEY'

curl -s http://localhost:3000/api/health
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" http://localhost:3000/api/meta
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" "http://localhost:3000/api/departments?q=Фонтан"
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" "http://localhost:3000/api/sales/daily?from=2026-07-01&to=2026-07-31&department=Фонтан&limit=100"
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" "http://localhost:3000/api/plans?month=2026-07-01&object_type=department&latest=true"
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" "http://localhost:3000/api/employees/performance?from=2026-07-01&to=2026-07-31&limit=20"
```

## 2. Публічний HTTPS API

GPT Action не може звертатися до `localhost`. Розгорніть API на Render, Railway, Vercel або іншому сервісі з публічним HTTPS URL. У змінних середовища хостингу задайте всі `PG*` змінні та `ACTION_API_KEY`.

Перевірте:

```bash
curl -s https://ВАШ-ДОМЕН/api/health
curl -s -H "Authorization: Bearer $PERFUMS_ACTION_KEY" https://ВАШ-ДОМЕН/api/meta
```

## 3. Додавання дії у GPT

1. У `openapi.yaml` замініть `https://REPLACE-WITH-YOUR-PUBLIC-API-DOMAIN` на публічний HTTPS URL без `/` у кінці.
2. Відкрийте редактор GPT → **Налаштувати** → **Дії** → **Створити нову дію**.
3. У полі автентифікації виберіть **API Key**.
4. Тип автентифікації: **Bearer**.
5. Вставте те саме значення `ACTION_API_KEY`.
6. Вставте вміст `openapi.yaml` у поле схеми.
7. Збережіть і протестуйте спочатку `getDatabaseMeta`.

## 4. Контрольні запити до GPT

- «До якої дати в базі є продажі та скільки рядків у кожному наборі даних?»
- «Знайди всі відділи, у назві яких є Фонтан».
- «Покажи продажі відділу Фонтан Скай по днях за останній доступний тиждень».
- «Які відділи мають найнижче виконання мінімального плану за останнім знімком?»
- «Покажи 10 продавців із найнижчим виконанням плану зміни за липень 2026».

GPT має спочатку викликати `getDatabaseMeta`, якщо користувач просить «станом на зараз» або «за останній період», а потім передавати фактичну останню дату в інші методи.
