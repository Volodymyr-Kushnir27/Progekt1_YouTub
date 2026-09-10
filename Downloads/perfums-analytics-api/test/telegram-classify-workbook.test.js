import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  classifyWorkbook,
  detectFileType,
} from "../src/telegram/classify-workbook.js";

async function createWorkbook(dates) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "classify-xlsx-"));
  const localPath = path.join(directory, "input.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Дані");
  worksheet.addRow(["Дата"]);
  dates.forEach((date) => worksheet.addRow([date]));
  await workbook.xlsx.writeFile(localPath);
  return { directory, localPath };
}

test("detects supported report types from 1C file names", () => {
  assert.equal(detectFileType("ML (1).xlsx"), "ML");
  assert.equal(detectFileType("PlanMin.xlsx"), "PlanMin");
  assert.equal(detectFileType("PlanBNAC (1).xlsx"), "PlanBNAC");
  assert.equal(detectFileType("unknown.xlsx"), null);
  assert.equal(detectFileType("Адмін таблиця (Таїрова)(1).xlsx"), "AdminActions");
  assert.equal(detectFileType("Експерти _ Майстри — копия.xlsx"), "EmployeeStatuses");
});

test("classifies an incomplete month as weekly", async (t) => {
  const fixture = await createWorkbook(["01.07.2026", "26.07.2026"]);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const result = await classifyWorkbook({
    localPath: fixture.localPath,
    fileName: "ML.xlsx",
  });

  assert.deepEqual(result, {
    fileType: "ML",
    importMode: "weekly",
    month: "2026-07",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-26",
    distinctDates: 2,
    lastCalendarDay: 31,
  });
});

test("classifies a range through the calendar month end as monthly", async (t) => {
  const fixture = await createWorkbook([
    new Date(Date.UTC(2026, 5, 1)),
    new Date(Date.UTC(2026, 5, 30)),
  ]);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const result = await classifyWorkbook({
    localPath: fixture.localPath,
    fileName: "PlanBNAC (1).xlsx",
  });

  assert.equal(result.importMode, "monthly");
  assert.equal(result.month, "2026-06");
  assert.equal(result.dateTo, "2026-06-30");
});

test("classifies a workbook that contains a drawing", async (t) => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "telegram-classifier-"),
  );
  t.after(() => fs.rm(tempDirectory, { recursive: true, force: true }));

  const localPath = path.join(tempDirectory, "ML.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("ML");
  worksheet.addRow(["Дата", "Продаж"]);
  worksheet.addRow([new Date(Date.UTC(2026, 6, 1)), 100]);
  worksheet.addRow([new Date(Date.UTC(2026, 6, 7)), 120]);

  const imageId = workbook.addImage({
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XPN7WQAAAABJRU5ErkJggg==",
    extension: "png",
  });
  worksheet.addImage(imageId, "D1:D2");
  await workbook.xlsx.writeFile(localPath);

  const result = await classifyWorkbook({ localPath, fileName: "ML.xlsx" });

  assert.equal(result.fileType, "ML");
  assert.equal(result.importMode, "weekly");
  assert.equal(result.dateFrom, "2026-07-01");
  assert.equal(result.dateTo, "2026-07-07");
});

test("classification uses the drawing-safe streaming reader", async () => {
  const source = await fs.readFile(
    new URL("../src/telegram/classify-workbook.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /ExcelJS\.stream\.xlsx\.WorkbookReader/);
  assert.match(source, /isMissingWorkbookRelations/);
});

test("classifies 1C-style numeric Excel dates", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "classify-xlsx-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const localPath = path.join(directory, "ML.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("ML");
  worksheet.getCell("A1").value = "Дата";
  worksheet.getCell("A2").value = 46204;
  worksheet.getCell("A2").numFmt = "dd.mm.yyyy";
  worksheet.getCell("A3").value = 46234;
  worksheet.getCell("A3").numFmt = "dd.mm.yyyy";
  worksheet.getCell("B2").value = 1000;
  await workbook.xlsx.writeFile(localPath);

  const result = await classifyWorkbook({ localPath, fileName: "ML.xlsx" });

  assert.equal(result.importMode, "monthly");
  assert.equal(result.dateFrom, "2026-07-01");
  assert.equal(result.dateTo, "2026-07-31");
});

test("reads dates embedded in 1C text and formula results", async (t) => {
  const fixture = await createWorkbook([
    "Період: 01.08.2026 00:00:00",
    { formula: 'DATE(2026,8,12)', result: "12.08.2026 0:00:00" },
  ]);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const result = await classifyWorkbook({
    localPath: fixture.localPath,
    fileName: "PlanMin.xlsx",
  });

  assert.equal(result.importMode, "weekly");
  assert.equal(result.dateFrom, "2026-08-01");
  assert.equal(result.dateTo, "2026-08-12");
});
