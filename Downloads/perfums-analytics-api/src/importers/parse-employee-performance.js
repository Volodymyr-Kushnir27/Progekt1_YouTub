import { readFirstSheetRows } from "./read-xlsx-xml.js";

const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function parseEmployeePerformanceWorkbook(localPath, sourceFile) {
  const rows = readFirstSheetRows(localPath);
  const periodText = text(rows.find((row) => row.rowNumber === 2)?.values[0]);
  const dates = [...periodText.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  if (dates.length < 2 || dates[0].slice(0, 7) !== dates[1].slice(0, 7)) {
    throw new Error("Персональний місячний звіт: не вдалося визначити один календарний місяць");
  }
  const header = rows.find((row) => row.rowNumber === 5)?.values.map(text) ?? [];
  const employeeColumn = header.findIndex((x) => /сотрудник/i.test(x));
  const shiftsColumn = header.findIndex((x) => /кол-во дней/i.test(x));
  const salesColumn = header.findIndex((x) => /реализац.*мл/i.test(x));
  const percentColumn = header.findIndex((x) => /процент/i.test(x));
  if ([employeeColumn, shiftsColumn, percentColumn].some((x) => x < 0)) {
    throw new Error("Персональний місячний звіт: невідомі заголовки колонок");
  }
  const records = [];
  for (const row of rows.filter((item) => item.rowNumber > 5)) {
    const employee = text(row.values[employeeColumn]);
    if (!employee || /^(?:итог|разом|усього|всього)$/i.test(employee)) break;
    const reportedShifts = number(row.values[shiftsColumn]);
    const completionPercent = number(row.values[percentColumn]);
    const salesMl = salesColumn >= 0 ? number(row.values[salesColumn]) : null;
    if (reportedShifts == null || completionPercent == null) continue;
    records.push({ employee, reportedShifts, salesMl, completionPercent,
      planMl: salesMl != null && completionPercent > 0 ? salesMl * 100 / completionPercent : null,
      sourceFile, sourceRow: row.rowNumber });
  }
  if (!records.length) throw new Error("Персональний місячний звіт: немає рядків працівників");
  return { monthStart: `${dates[0].slice(0, 7)}-01`, dateFrom: dates[0], dateTo: dates[1], records };
}
