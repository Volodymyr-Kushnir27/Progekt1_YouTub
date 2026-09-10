import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { parse1cPayrollWorkbook } from "../src/importers/parse-1c-payroll.js";
import { validatePayrollSchema } from "../src/importers/import-telegram-payroll.js";
import { detectFileType } from "../src/telegram/classify-workbook.js";

const payrollColumns = new Set([
  "payroll_date", "employee_id", "department_id", "revenue_uah", "salary_total_uah",
  "base_salary_uah", "commission_rate", "commission_uah", "shift_plan_ml", "point_sales_ml",
  "ml_bonus_uah", "extra_bonus_uah", "days_count", "source_row", "updated_at",
]);

test("detects payroll file names", () => {
  assert.equal(detectFileType("ЗП 16-31 липень.xlsx"), "Payroll");
  assert.equal(detectFileType("ZP_01-15.xlsx"), "Payroll");
  assert.equal(detectFileType("Зарплата серпень.xlsx"), "Payroll");
});

test("accepts the actual payroll schema", () => {
  assert.doesNotThrow(() => validatePayrollSchema(payrollColumns));
});

test("reports missing payroll columns before import", () => {
  assert.throws(() => validatePayrollSchema(new Set(["payroll_date"])), /employee_id.*department_id.*revenue_uah/);
});

test("parses employee, department and daily payroll hierarchy", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "payroll-xlsx-"));
  const file = path.join(directory, "ЗП 16-31.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Лист1");
  sheet.addRow(["Сотрудник", "Сумма", "Сумма ЗП", "Оклад", "Процент ЗП", "Сумма %", "План (мл)", "Бонус за мл", "Сумма, мл", "Доп.премии", "Количество дней"]);
  sheet.addRow(["Торговая точка"]);
  sheet.addRow(["По дням"]);
  sheet.addRow([]);
  sheet.addRow(["Тест Працівник", 3000, 900, 400, 40, 600, 500, 150, 200, 50, 2]);
  sheet.addRow(["Тест Відділ", 3000, 900, 400, 40, 600, 500, 150, 200, 50, 2]);
  sheet.addRow(["16.07.2026", 1000, 300, 200, 20, 200, 250, 0, 80, 0, 1]);
  sheet.addRow(["17.07.2026", 2000, 600, 200, 20, 400, 250, 150, 120, 50, 1]);
  await workbook.xlsx.writeFile(file);
  const result = parse1cPayrollWorkbook(file, path.basename(file));
  assert.equal(result.records.length, 2);
  assert.equal(result.dateFrom, "2026-07-16");
  assert.equal(result.dateTo, "2026-07-17");
  assert.deepEqual(result.summaries[0], {
    employee: "Тест Працівник", planMl: 500, salesMl: 200, reportedShifts: 2,
    completionPercent: 40, sourceRow: "5", sourceFile: "ЗП 16-31.xlsx",
  });
  assert.deepEqual(result.records[1], {
    payrollDate: "2026-07-17", employee: "Тест Працівник", department: "Тест Відділ",
    revenueUah: 2000, salaryTotalUah: 600, baseSalaryUah: 200, commissionRate: 20,
    commissionUah: 400, shiftPlanMl: 250, mlBonusUah: 150, pointSalesMl: 120,
    extraBonusUah: 50, daysCount: 1, sourceRow: "8", sourceFile: "ЗП 16-31.xlsx",
  });
});
