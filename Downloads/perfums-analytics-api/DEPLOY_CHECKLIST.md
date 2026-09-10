# Контрольний список розгортання

## До deploy

- [ ] Створено резервну копію Supabase.
- [ ] Виконано `sql/001_production_upgrade.sql` без помилок.
- [ ] Security Advisor не показує `RLS Disabled in Public`.
- [ ] Секрети відсутні в GitHub.

## Render

- [ ] Deploy завершився успішно.
- [ ] `GET /api/health` повертає `database: connected`.
- [ ] У логах немає помилок SQL або відсутніх змінних.

## Telegram

- [ ] Weekly ML оновлює лише діапазон файла.
- [ ] Повторний той самий файл повертає «вже імпортовано».
- [ ] Monthly ML повністю замінює місяць.
- [ ] Помилка в ПІБ/відділі зупиняє імпорт і не створює довідник.
- [ ] Payroll і плани імпортуються транзакційно.

## GPT Action

- [ ] Вставлено актуальний `openapi.yaml`.
- [ ] Bearer API key налаштований.
- [ ] `listEmployees?q=Полторак` знаходить працівника.
- [ ] `getEmployeeMonthlyPerformance` повертає офіційні місячні показники.
- [ ] `getEmployeePayroll` повертає зарплату.
- [ ] `getEmployeePayrollDaily` повертає денні рядки.
- [ ] При недоступному API GPT не вигадує цифри.
