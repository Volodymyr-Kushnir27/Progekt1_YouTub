import ExcelJS from "exceljs";

const MONTHS = new Map([
  ["січень", 1], ["январь", 1], ["лютий", 2], ["февраль", 2],
  ["березень", 3], ["март", 3], ["квітень", 4], ["апрель", 4],
  ["травень", 5], ["май", 5], ["червень", 6], ["июнь", 6],
  ["липень", 7], ["июль", 7], ["серпень", 8], ["август", 8],
  ["вересень", 9], ["сентябрь", 9], ["жовтень", 10], ["октябрь", 10],
  ["листопад", 11], ["ноябрь", 11], ["грудень", 12], ["декабрь", 12],
]);

const text = (cell) => String(cell?.text ?? cell?.value ?? "").trim();
const iso = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function reportMonth(worksheet, referenceDate) {
  const monthText = text(worksheet.getCell("B3")).normalize("NFKC").toLocaleLowerCase("uk-UA");
  const month = MONTHS.get(monthText);
  if (!month) throw new Error(`Адмін-таблиця: невідомий місяць «${monthText || "порожньо"}» у B3`);
  const yearText = [text(worksheet.getCell("A5")), text(worksheet.getCell("B5"))].join(" ");
  let year = Number(yearText.match(/\b(20\d{2})\b/)?.[1]);
  if (!year) {
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate ?? Date.now());
    year = ref.getUTCFullYear();
    if (month > ref.getUTCMonth() + 2) year -= 1;
  }
  return { year, month, value: iso(year, month, 1) };
}

function parsePeriod(value, year, month) {
  const values = String(value).match(/\d{1,2}/g)?.map(Number) ?? [];
  if (values.length < 4) return null;
  const [startDay, startMonth, endDay, endMonth] = values;
  if (startMonth !== month || endMonth !== month) throw new Error(`Адмін-таблиця: період «${value}» не належить місяцю звіту`);
  return { weekStart: iso(year, month, startDay), weekEnd: iso(year, month, endDay) };
}

function sectionFor(title) {
  const value = title.toLocaleLowerCase("uk-UA");
  if (!value.startsWith("таблиця ")) return null;
  if (value.includes("збереження") && value.includes("продавц")) return { subjectType: "employee", category: "preserve_improve" };
  if (value.includes("проблематики продавц")) return { subjectType: "employee", category: "problem_employee" };
  if (value.includes("проблематики відділ")) return { subjectType: "department", category: "problem_department" };
  return null;
}

function employeeParts(value) {
  const status = value.match(/(?:\/\s*([^/]+)|\(([^)]+статус[^)]*)\))\s*$/iu);
  return {
    subject: value.replace(/(?:\/\s*[^/]+|\s*\([^)]*статус[^)]*\))\s*$/iu, "").trim(),
    status: (status?.[1] ?? status?.[2] ?? "").trim() || null,
  };
}

export async function parseAdminActionsWorkbook(localPath, sourceFile, referenceDate = new Date()) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(localPath, { ignoreNodes: ["drawing", "picture"] });
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Адмін-таблиця: немає першого аркуша");
  const month = reportMonth(worksheet, referenceDate);
  const region = text(worksheet.getCell("B2"));
  if (!region) throw new Error("Адмін-таблиця: у B2 не вказано регіон");

  const items = [];
  for (let titleRow = 1; titleRow <= worksheet.rowCount; titleRow += 1) {
    const title = text(worksheet.getCell(titleRow, 7));
    const section = sectionFor(title);
    if (!section) continue;
    const periodRow = titleRow + 1;
    const headerRow = titleRow + 2;
    const weeks = [];
    for (let column = 8; column <= 19; column += 1) {
      const period = parsePeriod(text(worksheet.getCell(periodRow, column)), month.year, month.month);
      if (period) weeks.push({ ...period, completedColumn: column - 1 });
    }
    if (!weeks.length) throw new Error(`Адмін-таблиця: не знайдено тижневих періодів біля рядка ${titleRow}`);

    for (let row = headerRow + 1; row <= worksheet.rowCount; row += 1) {
      const employeeCell = text(worksheet.getCell(row, 4));
      const departmentCell = text(worksheet.getCell(row, 5));
      const rawSubject = section.subjectType === "employee" ? employeeCell : departmentCell;
      if (!rawSubject) break;
      const parsedEmployee = section.subjectType === "employee" ? employeeParts(rawSubject) : { subject: rawSubject, status: null };
      items.push({
        ...section,
        sourceRow: row,
        sourceSubjectText: rawSubject,
        subject: parsedEmployee.subject,
        statusText: parsedEmployee.status,
        departmentText: section.subjectType === "employee" ? departmentCell : rawSubject,
        targetText: text(worksheet.getCell(row, 6)) || null,
        actionPlan: text(worksheet.getCell(row, 7)) || null,
        weeks: weeks.map((week) => ({ ...week, completedText: text(worksheet.getCell(row, week.completedColumn)) || null })),
      });
    }
  }
  if (!items.length) throw new Error("Файл не відповідає затвердженому шаблону адмін-таблиці");
  return {
    sourceFile, sourceSheet: worksheet.name, reportMonth: month.value, region,
    previousYearResultText: text(worksheet.getCell("B4")) || null,
    regionGoalText: text(worksheet.getCell("B5")) || null,
    items,
  };
}
