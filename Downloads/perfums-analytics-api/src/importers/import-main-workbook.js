import ExcelJS from "exceljs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultFile = path.resolve(
  __dirname,
  "../../data/AI_Аналітик_Продажів_База_липень_2026_v3(1).xlsx"
);

const filePath = path.resolve(process.argv[2] || defaultFile);

const SHEETS = {
  sales: "ПРОДАЖІ_ВІДДІЛІВ",
  shifts: "ЗМІНИ_ПРОДАВЦІВ",
  payroll: "ЗАРПЛАТА_ПО_ДНЯХ",
  plans: "ПЛАНИ_ВІДДІЛІВ",
};

const REQUIRED_HEADERS = {
  [SHEETS.sales]: [
    "Дата",
    "Регіон",
    "Відділ",
    "Факт_продажу_мл",
    "Статус_даних",
  ],

  [SHEETS.shifts]: [
    "Дата",
    "Працівник",
    "Регіон",
    "Відділ",
    "Продаж_точки_мл",
    "Статус_зміни",
  ],

  [SHEETS.payroll]: [
    "Дата",
    "Працівник",
    "Регіон",
    "Відділ",
    "Виручка_грн",
    "Зарплата_всього_грн",
  ],

  [SHEETS.plans]: [
    "Дата_знімка",
    "Місяць_плану",
    "Тип_плану",
    "Тип_об’єкта",
    "Регіон",
    "Відділ_або_регіон",
    "План_періоду_мл",
  ],
};

function getText(value) {
  if (value == null) return "";

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if ("result" in value) {
      return getText(value.result);
    }

    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join("");
    }

    if ("text" in value) {
      return String(value.text);
    }
  }

  return String(value).trim();
}

function normalize(value) {
  return getText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getNumber(value) {
  if (value == null || value === "") return null;

  const raw =
    typeof value === "object" && value && "result" in value
      ? value.result
      : value;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  const parsed = Number(
    String(raw)
      .replace(/\s/g, "")
      .replace(",", ".")
  );

  return Number.isFinite(parsed) ? parsed : null;
}

function getIsoDate(value) {
  const raw =
    typeof value === "object" && value && "result" in value
      ? value.result
      : value;

  let date = raw;

  if (typeof raw === "number") {
    date = new Date(Math.round((raw - 25569) * 86400 * 1000));
  } else if (!(raw instanceof Date)) {
    const stringValue = getText(raw);

    const match = stringValue.match(
      /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/
    );

    if (match) {
      date = new Date(
        Date.UTC(
          Number(match[3]),
          Number(match[2]) - 1,
          Number(match[1])
        )
      );
    } else {
      date = new Date(stringValue);
    }
  }

  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function readSheet(workbook, sheetName) {
  const worksheet = workbook.getWorksheet(sheetName);

  if (!worksheet) {
    throw new Error(`У файлі немає аркуша «${sheetName}»`);
  }

  const headers = [];

  worksheet
    .getRow(1)
    .eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      headers[columnNumber] = getText(cell.value);
    });

  const missingHeaders = REQUIRED_HEADERS[sheetName].filter(
    (header) => !headers.includes(header)
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `Аркуш «${sheetName}»: відсутні колонки: ${missingHeaders.join(", ")}`
    );
  }

  const rows = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const record = {
      __row: rowNumber,
    };

    headers.forEach((header, columnNumber) => {
      if (header) {
        record[header] = row.getCell(columnNumber).value;
      }
    });

    const hasData = Object.entries(record).some(
      ([key, value]) => key !== "__row" && getText(value) !== ""
    );

    if (hasData) {
      rows.push(record);
    }
  });

  return rows;
}

function findDuplicates(rows, createKey) {
  const seen = new Map();
  const duplicates = [];

  for (const row of rows) {
    const key = createKey(row);

    if (!key || key.includes("null") || key.includes("||")) {
      continue;
    }

    if (seen.has(key)) {
      duplicates.push({
        key,
        rows: [seen.get(key), row.__row],
      });
    } else {
      seen.set(key, row.__row);
    }
  }

  return duplicates;
}

function addIssue(issues, severity, sheet, row, code, message) {
  issues.push({
    severity,
    sheet,
    row,
    code,
    message,
  });
}

async function main() {
  console.log("\nПеревіряю файл:");
  console.log(filePath);

  try {
    await fs.access(filePath);
  } catch {
    throw new Error(
      `Файл не знайдено: ${filePath}\nПеревірте назву файлу в папці data.`
    );
  }

  const fileBytes = await fs.readFile(filePath);

  const sha256 = crypto
    .createHash("sha256")
    .update(fileBytes)
    .digest("hex");

  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(fileBytes);

  const [
    employeesResult,
    departmentsResult,
    employeeAliasesResult,
    departmentAliasesResult,
  ] = await Promise.all([
    pool.query(`
      SELECT id, full_name, normalized_name
      FROM public.employees
    `),

    pool.query(`
      SELECT
        d.id,
        d.name,
        d.normalized_name,
        r.name AS region_name,
        r.normalized_name AS region_normalized
      FROM public.departments d
      JOIN public.regions r
        ON r.id = d.region_id
    `),

    pool.query(`
      SELECT employee_id, normalized_alias
      FROM public.employee_aliases
    `),

    pool.query(`
      SELECT department_id, normalized_alias
      FROM public.department_aliases
    `),
  ]);

  const employeeById = new Map(
    employeesResult.rows.map((employee) => [
      String(employee.id),
      employee,
    ])
  );

  const employeeMap = new Map(
    employeesResult.rows.map((employee) => [
      normalize(employee.normalized_name || employee.full_name),
      employee,
    ])
  );

  for (const alias of employeeAliasesResult.rows) {
    const employee = employeeById.get(String(alias.employee_id));

    if (employee) {
      employeeMap.set(
        normalize(alias.normalized_alias),
        employee
      );
    }
  }

  const departmentById = new Map(
    departmentsResult.rows.map((department) => [
      String(department.id),
      department,
    ])
  );

  const departmentMap = new Map();

  for (const department of departmentsResult.rows) {
    const key = [
      normalize(
        department.region_normalized ||
          department.region_name
      ),
      normalize(
        department.normalized_name ||
          department.name
      ),
    ].join("|");

    departmentMap.set(key, department);
  }

  for (const alias of departmentAliasesResult.rows) {
    const department = departmentById.get(
      String(alias.department_id)
    );

    if (department) {
      const key = [
        normalize(
          department.region_normalized ||
            department.region_name
        ),
        normalize(alias.normalized_alias),
      ].join("|");

      departmentMap.set(key, department);
    }
  }

  const data = {};

  for (const [key, sheetName] of Object.entries(SHEETS)) {
    data[key] = readSheet(workbook, sheetName);
  }

  const issues = [];

  function validateDepartment(
    row,
    sheet,
    regionColumn = "Регіон",
    departmentColumn = "Відділ"
  ) {
    const region = normalize(row[regionColumn]);
    const department = normalize(row[departmentColumn]);

    const key = `${region}|${department}`;

    if (!departmentMap.has(key)) {
      addIssue(
        issues,
        "ERROR",
        sheet,
        row.__row,
        "UNKNOWN_DEPARTMENT",
        `${getText(row[regionColumn])} → ${getText(
          row[departmentColumn]
        )}`
      );
    }
  }

  function validateEmployee(row, sheet) {
    const employeeName = normalize(row.Працівник);

    if (!employeeMap.has(employeeName)) {
      addIssue(
        issues,
        "ERROR",
        sheet,
        row.__row,
        "UNKNOWN_EMPLOYEE",
        getText(row.Працівник)
      );
    }
  }

  function validateDate(row, sheet, column) {
    if (!getIsoDate(row[column])) {
      addIssue(
        issues,
        "ERROR",
        sheet,
        row.__row,
        "INVALID_DATE",
        `${column}: ${getText(row[column])}`
      );
    }
  }

  function validateNonnegative(
    row,
    sheet,
    column,
    required = false
  ) {
    const value = getNumber(row[column]);

    if (
      (required && value == null) ||
      (value != null && value < 0)
    ) {
      addIssue(
        issues,
        "ERROR",
        sheet,
        row.__row,
        "INVALID_NUMBER",
        `${column}: ${getText(row[column])}`
      );
    }
  }

  for (const row of data.sales) {
    validateDate(row, SHEETS.sales, "Дата");
    validateDepartment(row, SHEETS.sales);

    validateNonnegative(
      row,
      SHEETS.sales,
      "Факт_продажу_мл",
      normalize(row.Статус_даних) !== "missing"
    );

    validateNonnegative(
      row,
      SHEETS.sales,
      "Подарунки_мл"
    );
  }

  for (const row of data.shifts) {
    validateDate(row, SHEETS.shifts, "Дата");
    validateEmployee(row, SHEETS.shifts);
    validateDepartment(row, SHEETS.shifts);

    validateNonnegative(
      row,
      SHEETS.shifts,
      "План_зміни_мл"
    );

    validateNonnegative(
      row,
      SHEETS.shifts,
      "Продаж_точки_мл"
    );
  }

  for (const row of data.payroll) {
    validateDate(row, SHEETS.payroll, "Дата");
    validateEmployee(row, SHEETS.payroll);
    validateDepartment(row, SHEETS.payroll);

    const payrollColumns = [
  "Виручка_грн",
  "Зарплата_всього_грн",
  "Оклад_грн",
  "Сума_відсотка_грн",
  "Бонус_за_мл_грн",
];

for (const column of payrollColumns) {
  validateNonnegative(row, SHEETS.payroll, column);
}

// Додаткова премія може бути від’ємною:
// від’ємне значення означає штраф або утримання.
const additionalBonus = getNumber(
  row["Додаткова_премія_грн"]
);

if (
  getText(row["Додаткова_премія_грн"]) !== "" &&
  additionalBonus == null
) {
  addIssue(
    issues,
    "ERROR",
    SHEETS.payroll,
    row.__row,
    "INVALID_NUMBER",
    `Додаткова_премія_грн: ${getText(
      row["Додаткова_премія_грн"]
    )}`
  );
}
  }

  for (const row of data.plans) {
    validateDate(
      row,
      SHEETS.plans,
      "Дата_знімка"
    );

    validateDate(
      row,
      SHEETS.plans,
      "Місяць_плану"
    );

    validateNonnegative(
      row,
      SHEETS.plans,
      "План_періоду_мл",
      true
    );

    if (
      normalize(row["Тип_об’єкта"]) === "department"
    ) {
      validateDepartment(
        row,
        SHEETS.plans,
        "Регіон",
        "Відділ_або_регіон"
      );
    }
  }

  const duplicateGroups = [
    [
      SHEETS.sales,
      findDuplicates(
        data.sales,
        (row) =>
          `${getIsoDate(row.Дата)}|${normalize(
            row.Регіон
          )}|${normalize(row.Відділ)}`
      ),
    ],

    [
      SHEETS.shifts,
      findDuplicates(
        data.shifts,
        (row) =>
          `${getIsoDate(row.Дата)}|${normalize(
            row.Працівник
          )}|${normalize(row.Регіон)}|${normalize(
            row.Відділ
          )}`
      ),
    ],

    [
      SHEETS.payroll,
      findDuplicates(
        data.payroll,
        (row) =>
          `${getIsoDate(row.Дата)}|${normalize(
            row.Працівник
          )}|${normalize(row.Регіон)}|${normalize(
            row.Відділ
          )}`
      ),
    ],

    [
      SHEETS.plans,
      findDuplicates(
        data.plans,
        (row) =>
          `${getIsoDate(
            row.Дата_знімка
          )}|${getIsoDate(
            row.Місяць_плану
          )}|${normalize(
            row.Тип_плану
          )}|${normalize(
            row["Тип_об’єкта"]
          )}|${normalize(
            row.Регіон
          )}|${normalize(
            row.Відділ_або_регіон
          )}`
      ),
    ],
  ];

  for (const [sheet, duplicates] of duplicateGroups) {
    for (const duplicate of duplicates) {
      addIssue(
        issues,
        "ERROR",
        sheet,
        duplicate.rows.join(","),
        "DUPLICATE_KEY",
        duplicate.key
      );
    }
  }

  const errors = issues.filter(
    (issue) => issue.severity === "ERROR"
  );

  console.log(
    "\n=== DRY RUN: запис у PostgreSQL не виконувався ==="
  );

  console.table([
    {
      sheet: SHEETS.sales,
      rows: data.sales.length,
    },
    {
      sheet: SHEETS.shifts,
      rows: data.shifts.length,
    },
    {
      sheet: SHEETS.payroll,
      rows: data.payroll.length,
    },
    {
      sheet: SHEETS.plans,
      rows: data.plans.length,
    },
  ]);

  console.log({
    file: path.basename(filePath),
    sha256,
    errors: errors.length,
    warnings: issues.length - errors.length,
  });

  if (issues.length > 0) {
    console.table(issues.slice(0, 50));
  }

  if (issues.length > 50) {
    console.log(
      `Показано перші 50 із ${issues.length} проблем.`
    );
  }

  if (errors.length > 0) {
    console.log(
      "\n❌ Перевірку не пройдено. Дані поки не імпортуйте."
    );
  } else {
    console.log(
      "\n✅ Перевірку пройдено. Можна переходити до запису в базу."
    );
  }

  process.exitCode = errors.length > 0 ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(
      "\n❌ Dry-run завершився помилкою:"
    );

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });