# Імпорт PlanBNAC і PlanMin

Замініть або додайте файли з архіву зі збереженням структури папок, потім виконайте:

```bash
npm test

git add src/index.js \
  src/importers/import-telegram-ml.js \
  src/importers/import-telegram-plan.js \
  src/importers/parse-1c-plan.js \
  test/import-telegram-plan.test.js

git commit -m "Import BNAC and minimum plans from Telegram"
git push origin main
```

Після статусу Render `Live` надішліть спочатку `PlanBNAC.xlsx`, потім `PlanMin.xlsx`.

Ознака успіху в Telegram:

```text
✅ PlanBNAC.xlsx імпортовано
✅ PlanMin.xlsx імпортовано
```

Обидва типи записуються в `department_plan_snapshots`. Нові регіони та відділи створюються автоматично. Рядок відділу без числового плану пропускається та відображається в повідомленні бота.
