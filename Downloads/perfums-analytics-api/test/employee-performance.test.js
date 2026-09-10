import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { parseEmployeePerformanceWorkbook } from "../src/importers/parse-employee-performance.js";
import { detectFileType } from "../src/telegram/classify-workbook.js";

test("detects historical payroll and employee performance names", () => {
  assert.equal(detectFileType("апрель(2).xlsx"), "Payroll");
  assert.equal(detectFileType("Процент_выполнения_плана_по_сотрудникам_апрель_2026.xlsx"), "EmployeePerformance");
  assert.equal(detectFileType("План_БНАЦ_апрель_2026.xlsx"), "PlanBNAC");
  assert.equal(detectFileType("План_минимум_апрель_2026.xlsx"), "PlanMin");
});

test("parses official employee monthly performance XML", () => {
  const file = path.resolve("../../upload/Процент_выполнения_плана_по_сотрудникам_апрель_2026(2).xlsx");
  const parsed = parseEmployeePerformanceWorkbook(file, path.basename(file));
  assert.equal(parsed.monthStart, "2026-04-01");
  assert.ok(parsed.records.length > 40);
  assert.equal(parsed.records[0].employee, "ДУШКО АЛЕНА");
  assert.equal(parsed.records[0].salesMl, 5672);
});
