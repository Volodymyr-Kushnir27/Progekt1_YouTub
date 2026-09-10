import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseEmployeeStatusesWorkbook } from "../src/importers/parse-employee-statuses.js";

test("parses the approved monthly master/expert layout", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "employee-statuses-"));
  t.after(() => fs.rm(directory, { recursive:true, force:true }));
  const localPath = path.join(directory, "statuses.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Лист1");
  sheet.getCell("A3").value = "ВЕРЕСЕНЬ";
  sheet.getCell("A4").value = "Всього: 1 майстра";
  sheet.getCell("A5").value = "Всього: 1 експертів";
  sheet.getCell("C3").value = "МАЙСТЕР";
  sheet.getCell("E3").value = "ЕКСПЕРТ";
  sheet.getCell("C4").value = "Душко Алена";
  sheet.getCell("E4").value = "Орехова Александра / Орехова София";
  await workbook.xlsx.writeFile(localPath);

  const parsed = await parseEmployeeStatusesWorkbook(localPath, "Експерти _ Майстри.xlsx", "2026-09-10T12:00:00Z");
  assert.equal(parsed.monthStart, "2026-09-01");
  assert.deepEqual(parsed.records.map(({employee,status}) => ({employee,status})), [
    { employee:"Душко Алена", status:"master" },
    { employee:"Орехова Александра", status:"expert" },
    { employee:"Орехова София", status:"expert" },
  ]);
  assert.deepEqual(parsed.warnings, ["у шапці експертів 1, у списку 2"]);
});
