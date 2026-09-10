import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { parse1cPlanWorkbook, parsePeriodRange } from "../src/importers/parse-1c-plan.js";
import { validatePlanSchema } from "../src/importers/import-telegram-plan.js";

const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function fixture(fileType) {
  const isMin = fileType === "PlanMin";
  const strings = [
    isMin ? "План минимум" : "План БНАЦ", "Продажи фактические", "Осталось", "На день", "%", "Дни простоя",
    ...(isMin ? ["Предыдущий период", "% изменения"] : []),
    "27.07-31.08", "27.07-02.08", ...(isMin ? ["27.07-02.08.25"] : []), "Львів", "АШАН", "ИТОГО",
  ];
  const index = (value) => strings.indexOf(value);
  const planIndex = index("27.07-31.08");
  const factIndex = index("27.07-02.08");
  const previousIndex = index("27.07-02.08.25");
  const regionIndex = index("Львів");
  const departmentIndex = index("АШАН");
  const totalIndex = index("ИТОГО");
  const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((x) => `<si><t>${escapeXml(x)}</t></si>`).join("")}</sst>`;
  const minHeader = isMin ? `<c r="I2" t="s"><v>${previousIndex}</v></c>` : "";
  const minPrevious = isMin ? `<c r="I3"><v>80</v></c><c r="I4"><v>20</v></c>` : "";
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="C1" t="s"><v>0</v></c></row>
    <row r="2"><c r="C2" t="s"><v>${planIndex}</v></c><c r="D2" t="s"><v>${factIndex}</v></c>${minHeader}</row>
    <row r="3"><c r="B3" s="12" t="s"><v>${regionIndex}</v></c><c r="C3"><v>1000</v></c><c r="D3"><v>100</v></c>${minPrevious}</row>
    <row r="4"><c r="B4" s="18" t="s"><v>${departmentIndex}</v></c><c r="C4"><v>500</v></c><c r="D4"><v>50</v></c>${minPrevious}</row>
    <row r="5"><c r="B5" s="12" t="s"><v>${totalIndex}</v></c><c r="C5"><v>1000</v></c></row>
  </sheetData></worksheet>`;
  const zip = new AdmZip();
  zip.addFile("xl/SharedStrings.xml", Buffer.from(shared));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheet));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-import-test-"));
  const file = path.join(dir, `${fileType}.xlsx`);
  zip.writeZip(file);
  return { file, dir };
}

test("parses plan and fact periods without a year using Telegram date", () => {
  assert.deepEqual(parsePeriodRange("27.07-02.08", "2026-08-04T00:00:00Z"), {
    start: "2026-07-27", end: "2026-08-02", source: "27.07-02.08",
  });
  assert.deepEqual(parsePeriodRange("27.07-02.08.25", "2026-08-04T00:00:00Z"), {
    start: "2025-07-27", end: "2025-08-02", source: "27.07-02.08.25",
  });
});

for (const fileType of ["PlanBNAC", "PlanMin"]) {
  test(`parses ${fileType} region and department rows`, () => {
    const { file, dir } = fixture(fileType);
    try {
      const result = parse1cPlanWorkbook(file, { fileType, referenceDate: "2026-08-04T00:00:00Z" });
      assert.equal(result.records.length, 2);
      assert.equal(result.records[0].objectType, "region");
      assert.equal(result.records[1].objectType, "department");
      assert.equal(result.records[1].department, "АШАН");
      assert.equal(result.records[1].planMonth, "2026-08-01");
      assert.equal(result.records[1].planType, fileType === "PlanBNAC" ? "bnac" : "minimum");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("validates every physical plan column before importing", () => {
  const columns = new Set(["snapshot_date", "plan_month", "plan_type", "object_type"]);
  assert.throws(() => validatePlanSchema(columns), /department_id.*region_id.*plan_ml/);
});
