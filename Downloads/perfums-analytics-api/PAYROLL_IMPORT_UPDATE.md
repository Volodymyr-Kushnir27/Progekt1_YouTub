# Telegram payroll import

This update adds automatic import of 1C payroll reports such as `ЗП 16-31 липень.xlsx`.

Install these files in the project root, preserving their paths:

```text
src/index.js
src/telegram/classify-workbook.js
src/importers/parse-1c-payroll.js
src/importers/import-telegram-payroll.js
test/import-telegram-payroll.test.js
```

Run:

```bash
npm test
```

The importer replaces the payroll rows inside the report's date range and then inserts the corrected daily rows. An identical file is ignored by SHA-256.

The payroll report does not contain a region. Departments are therefore resolved against existing departments and `department_aliases`. Import ML first. Unknown or ambiguous department names stop the transaction without changing payroll data.
