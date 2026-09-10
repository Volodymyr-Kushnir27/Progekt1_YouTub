import AdmZip from "adm-zip";

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value = "") {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? _;
  });
}

function readSharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) =>
    decodeXml([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((x) => x[1]).join("")),
  );
}

function readCells(rowXml, strings) {
  const cells = new Map();
  for (const match of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
    const attrs = match[1];
    const body = match[2] ?? "";
    const column = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1]?.toUpperCase();
    if (!column) continue;
    const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
    const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1];
    const inline = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((x) => x[1]).join("");
    let value = null;
    if (type === "s" && raw != null) value = strings[Number(raw)] ?? "";
    else if (type === "inlineStr") value = decodeXml(inline);
    else if (raw != null) value = Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw);
    cells.set(column, value);
  }
  return cells;
}

const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const norm = (value) => text(value).toLocaleLowerCase("uk-UA");

function number(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const match = text(value).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  if (date.getUTCFullYear() !== Number(match[3]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[1])) return null;
  return date.toISOString().slice(0, 10);
}

function workbookRows(localPath) {
  const zip = new AdmZip(localPath);
  const stringsEntry = zip.getEntry("xl/SharedStrings.xml") ?? zip.getEntry("xl/sharedStrings.xml");
  const sheetEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("ЗП: не знайдено xl/worksheets/sheet1.xml");
  const strings = stringsEntry ? readSharedStrings(stringsEntry.getData().toString("utf8")) : [];
  const xml = sheetEntry.getData().toString("utf8");
  return [...xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gi)].map((match) => ({
    sourceRow: Number(match[1].match(/\br="(\d+)"/i)?.[1] ?? 0),
    cells: readCells(match[2] ?? "", strings),
  }));
}

export function parse1cPayrollWorkbook(localPath, sourceFile = "Payroll.xlsx") {
  const rows = workbookRows(localPath);
  const expectedHeaders = ["сотрудник", "сумма", "сумма зп", "оклад", "процент зп", "сумма %", "план (мл)", "бонус за мл", "сумма, мл", "доп.премии", "количество дней"];
  const header = rows.find((row) => row.sourceRow === 1);
  const actualHeaders = [..."ABCDEFGHIJK"].map((column) => norm(header?.cells.get(column)));
  if (expectedHeaders.some((value, index) => actualHeaders[index] !== value)) {
    throw new Error("ЗП: структура заголовків A1:K1 не відповідає очікуваному звіту 1С");
  }

  const records = [];
  const summaries = [];
  let employee = null;
  let department = null;

  for (const row of rows.filter((item) => item.sourceRow >= 4)) {
    const label = text(row.cells.get("A"));
    if (!label) {
      employee = null;
      department = null;
      continue;
    }
    const payrollDate = parseDate(label);
    if (!payrollDate) {
      if (!employee) {
        employee = label;
        department = null;
        const planMl = number(row.cells.get("G"));
        const salesMl = number(row.cells.get("I"));
        const reportedShifts = number(row.cells.get("K"));
        if (planMl != null || salesMl != null || reportedShifts != null) {
          summaries.push({ employee, planMl, salesMl, reportedShifts,
            completionPercent: planMl > 0 && salesMl != null ? Number((salesMl * 100 / planMl).toFixed(2)) : null,
            sourceRow: String(row.sourceRow), sourceFile });
        }
      } else {
        department = label;
      }
      continue;
    }
    if (!employee || !department) {
      throw new Error(`ЗП рядок ${row.sourceRow}: дата не має працівника або торгової точки`);
    }
    const values = {
      revenueUah: number(row.cells.get("B")),
      salaryTotalUah: number(row.cells.get("C")),
      baseSalaryUah: number(row.cells.get("D")),
      commissionRate: number(row.cells.get("E")),
      commissionUah: number(row.cells.get("F")),
      shiftPlanMl: number(row.cells.get("G")),
      mlBonusUah: number(row.cells.get("H")),
      pointSalesMl: number(row.cells.get("I")),
      extraBonusUah: number(row.cells.get("J")),
      daysCount: number(row.cells.get("K")),
    };
    for (const key of ["salaryTotalUah", "baseSalaryUah", "shiftPlanMl", "daysCount"]) {
      if (values[key] == null) throw new Error(`ЗП рядок ${row.sourceRow}: відсутнє обов'язкове числове поле ${key}`);
    }
    records.push({
      payrollDate,
      employee,
      department,
      ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? 0])),
      sourceRow: String(row.sourceRow),
      sourceFile,
    });
  }

  if (!records.length) throw new Error("ЗП: не знайдено денних записів");
  const dates = [...new Set(records.map((row) => row.payrollDate))].sort();
  const keys = new Set();
  for (const row of records) {
    const key = `${row.payrollDate}|${norm(row.employee)}|${norm(row.department)}`;
    if (keys.has(key)) throw new Error(`ЗП: дубль ключа дата + працівник + відділ у рядку ${row.sourceRow}`);
    keys.add(key);
  }
  return {
    records,
    dateFrom: dates[0],
    dateTo: dates.at(-1),
    distinctDates: dates.length,
    employees: new Set(records.map((row) => norm(row.employee))).size,
    departments: new Set(records.map((row) => norm(row.department))).size,
    summaries,
  };
}
