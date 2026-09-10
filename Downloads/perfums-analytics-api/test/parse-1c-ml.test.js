import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { parse1cMlWorkbook, summarizeMlRecords } from "../src/importers/parse-1c-ml.js";

test("parses the region > department > employee > date hierarchy from 1C ML", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ml-1c-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "ML.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Звіт");
  const add = (level, values) => { const row = sheet.addRow(values); row.outlineLevel = level; };
  add(1, ["Одеса"]);
  add(2, ["Фонтан Sky"]);
  add(3, ["Палій Богдана"]);
  add(4, ["31.07.2026 00:00:00", null, null, 250, 310, null, 5, null, -60, 124]);
  add(4, ["01.08.2026 00:00:00", null, null, 250, 275, null, 0, null, -25, 110]);
  await workbook.xlsx.writeFile(localPath);

  const rows = parse1cMlWorkbook(localPath, "ML.xlsx");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: "2026-07-31", region: "Одеса", department: "Фонтан Sky", employee: "Палій Богдана",
    planMl: 250, salesMl: 310, giftsMl: 5, deltaMl: -60, completionPercent: 124,
    sourceFile: "ML.xlsx", sourceRow: 4,
  });
  assert.deepEqual(summarizeMlRecords(rows), {
    records: 2, dates: 2, dateFrom: "2026-07-31", dateTo: "2026-08-01", months: ["2026-07", "2026-08"],
  });
});

test("parses compact 1C ML layout with empty service columns", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ml-1c-compact-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "ML.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Звіт");
  const add = (level, values) => { const row = sheet.addRow(values); row.outlineLevel = level; };
  add(1, ["Одеса"]); add(2, ["КОПЕЙКА/ИЗМАИЛ"]); add(3, ["КАРП ЕЛЕНА"]);
  add(4, ["05.08.2026 23:11:31", null, 185, null, 110, 0, null, 75, 59.46]);
  await workbook.xlsx.writeFile(localPath);
  const [row] = parse1cMlWorkbook(localPath, "ML.xlsx");
  assert.equal(row.planMl, 185);
  assert.equal(row.salesMl, 110);
  assert.equal(row.giftsMl, 0);
  assert.equal(row.deltaMl, 75);
  assert.equal(row.completionPercent, 59.46);
});
