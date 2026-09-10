import ExcelJS from "exceljs";

const FILE_TYPES = [
  { type: "AdminActions", pattern: /адм[іи]н.*таблиц/iu },
  { type: "EmployeeStatuses", pattern: /(?:експерт.*майстр|майстр.*експерт)/iu },
  { type: "EmployeePerformance", pattern: /(?:процент.*выполнения.*сотрудник|выполнение.*плана.*сотрудник)/iu },
  { type: "PlanBNAC", pattern: /план[\s_-]*бнац/iu },
  { type: "PlanMin", pattern: /план[\s_-]*минимум/iu },
  { type: "PlanBNAC", pattern: /plan[\s_-]*bnac/i },
  { type: "PlanMin", pattern: /plan[\s_-]*min/i },
  { type: "Payroll", pattern: /(?:^|[^\p{L}\p{N}])(?:зп|zp|зарплат[аыи]?)(?:[^\p{L}\p{N}]|$)/iu },
  { type: "ML", pattern: /(^|[^a-z])ml([^a-z]|$)/i },
  { type: "Payroll", pattern: /^(?:апрель|май|май|июнь|июль|август)(?:\s*\(\d+\))*\.xlsx$/iu },
];

function utcDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function dateFromExcelSerial(value) {
  if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;

  // Excel's default 1900 date system (including its historic leap-year bug)
  // maps cleanly when 1899-12-30 is used as day zero.
  const milliseconds = Math.round(value * 86400000);
  const date = new Date(Date.UTC(1899, 11, 30) + milliseconds);
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function isDateNumberFormat(numberFormat) {
  if (typeof numberFormat !== "string") return false;
  const normalized = numberFormat
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .toLowerCase();
  return /[dmy]/.test(normalized);
}

function textFromObject(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part?.text ?? "").join("");
  }
  if (typeof value.text === "string") return value.text;
  return null;
}

function dateFromCellValue(value, numberFormat) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return utcDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (value && typeof value === "object" && "result" in value) {
    return dateFromCellValue(value.result, numberFormat);
  }

  if (typeof value === "number") {
    return isDateNumberFormat(numberFormat)
      ? dateFromExcelSerial(value)
      : null;
  }

  if (typeof value !== "string") value = textFromObject(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  let match = text.match(/(?:^|\D)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\D|$)/);
  if (match) return utcDate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/);
  if (match) return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return dateKey(date).slice(0, 7);
}

export function detectFileType(fileName) {
  const normalized = String(fileName || "").normalize("NFKC");
  return FILE_TYPES.find(({ pattern }) => pattern.test(normalized))?.type ?? null;
}

export async function classifyWorkbook({ localPath, fileName }) {
  const fileType = detectFileType(fileName);
  if (!fileType) {
    throw new Error(`Не вдалося визначити тип файла «${fileName || "без назви"}»`);
  }

  // The monthly master/expert register contains a month name, not calendar
  // dates. Its dedicated parser validates the period and layout.
  if (fileType === "EmployeeStatuses") {
    return { fileType, importMode: "monthly" };
  }

  const uniqueDates = new Map();
  const collectDate = (cell) => {
    const date = dateFromCellValue(cell.value, cell.numFmt);
    if (date) uniqueDates.set(dateKey(date), date);
  };
  // Use the streaming reader because some 1C exports contain malformed drawing
  // relationships. The regular Workbook reader reconciles those relationships
  // before ignoreNodes is applied and can crash while reading `anchors`.
  // Classification only needs cell values, and the streaming reader does not
  // build the drawings model.
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(localPath, {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "cache",
    worksheets: "emit",
  });

  try {
    for await (const worksheet of workbook) {
      for await (const row of worksheet) {
        row.eachCell({ includeEmpty: false }, collectDate);
      }
    }
  } catch (error) {
    // ExcelJS 4.4 can fail in WorkbookReader on some valid workbooks (notably
    // files generated on macOS) when workbook relationships are emitted in an
    // unexpected ZIP order. Fall back only for that reader bug. The streaming
    // path remains the default for malformed 1C drawing relationships.
    const isMissingWorkbookRelations =
      error instanceof TypeError &&
      /undefined \(reading ['"]sheets['"]\)/.test(error.message);
    if (!isMissingWorkbookRelations) throw error;

    uniqueDates.clear();
    const fallbackWorkbook = new ExcelJS.Workbook();
    await fallbackWorkbook.xlsx.readFile(localPath, {
      ignoreNodes: ["drawing", "picture"],
    });
    fallbackWorkbook.eachSheet((worksheet) => {
      worksheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, collectDate);
      });
    });
  }

  const dates = [...uniqueDates.values()].sort((a, b) => a - b);
  if (!dates.length) {
    throw new Error(`У файлі «${fileName}» не знайдено календарних дат`);
  }

  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const months = [...new Set(dates.map(monthKey))];
  if (months.length !== 1) {
    throw new Error(
      `Файл «${fileName}» містить дати з кількох місяців: ${months.join(", ")}`,
    );
  }

  const lastCalendarDay = new Date(
    Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const isFullCalendarRange =
    firstDate.getUTCDate() === 1 && lastDate.getUTCDate() === lastCalendarDay;

  return {
    fileType,
    importMode: isFullCalendarRange ? "monthly" : "weekly",
    month: months[0],
    dateFrom: dateKey(firstDate),
    dateTo: dateKey(lastDate),
    distinctDates: dates.length,
    lastCalendarDay,
  };
}
