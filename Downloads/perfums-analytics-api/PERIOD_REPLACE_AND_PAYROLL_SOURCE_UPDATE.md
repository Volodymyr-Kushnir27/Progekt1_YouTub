# Period replace and payroll source update

## Що змінено

- Кожен ML-файл є повним джерелом даних для власного діапазону дат.
- Перед імпортом старі `employee_shifts` і `department_daily_sales` за цей діапазон видаляються в тій самій транзакції.
- Той самий ML-файл можна надіслати повторно: він буде повторно оброблений, а не відхилений за SHA-256.
- `/api/employees/performance` читає тільки `payroll_daily`.
- `from` і `to` обов'язкові для performance та payroll endpoints.
- API повертає готові `worked_days`, `plan_ml`, `sales_ml`, `completion_percent`, `salary_total_uah` і `source`.

## Встановлення

Розпакувати ZIP у корінь проєкту із заміною файлів, потім:

```bash
npm test
git add src/index.js src/importers/import-telegram-ml.js openapi.yaml test/import-telegram-ml-schema.test.js PERIOD_REPLACE_AND_PAYROLL_SOURCE_UPDATE.md
git commit -m "Replace ML periods and use payroll as performance source"
git push origin main
```

Після статусу `Live` на Render повторно надіслати ML-файли в хронологічному порядку. Кожен файл повністю замінить лише свій період.

Після зміни `openapi.yaml` оновити схему Action у GPT Builder. В інструкції асистента закріпити: для зарплати, робочих днів, плану, продажів і виконання використовувати тільки готові поля API з `source=payroll_daily`; не перераховувати й не змішувати з ML.
