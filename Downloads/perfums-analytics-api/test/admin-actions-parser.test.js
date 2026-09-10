import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseAdminActionsWorkbook } from "../src/importers/parse-admin-actions.js";

test("parses the approved admin template and only imports manual weekly fields", async (t) => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"admin-actions-"));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,"Адмін таблиця.xlsx");
  const wb=new ExcelJS.Workbook(), ws=wb.addWorksheet("Контроль");
  ws.getCell("B2").value="ТАЇРОВА"; ws.getCell("B3").value="СЕРПЕНЬ";
  ws.getCell("A5").value="Ціль регіону на серпень 2026"; ws.getCell("B5").value="120 літрів";
  ws.getCell("G6").value="Таблиця збереження та покращення результатів продавців";
  ws.getCell("I7").value="03.08 - 09.08"; ws.getCell("L7").value="10.08 - 16.08";
  ws.getCell("D8").value="ПІБ продавця / статус";
  ws.getCell("D9").value="Коваленко Ірина / майстер"; ws.getCell("E9").value="Панорама";
  ws.getCell("F9").value="130%"; ws.getCell("G9").value="План дій"; ws.getCell("K9").value="Виконано";
  ws.getCell("L9").value="999%"; ws.getCell("M9").value="999%";
  await wb.xlsx.writeFile(file);
  const parsed=await parseAdminActionsWorkbook(file,"Адмін таблиця.xlsx",new Date("2026-08-13"));
  assert.equal(parsed.reportMonth,"2026-08-01"); assert.equal(parsed.items.length,1);
  assert.equal(parsed.items[0].weeks[1].completedText,"Виконано");
  assert.equal("actualResult" in parsed.items[0].weeks,false);
  assert.equal("expectedResult" in parsed.items[0].weeks,false);
});
