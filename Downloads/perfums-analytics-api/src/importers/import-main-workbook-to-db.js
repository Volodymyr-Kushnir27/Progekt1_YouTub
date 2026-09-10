import ExcelJS from "exceljs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pool } from "../db.js";

const SHEETS = {
  sales: "ПРОДАЖІ_ВІДДІЛІВ",
  shifts: "ЗМІНИ_ПРОДАВЦІВ",
  payroll: "ЗАРПЛАТА_ПО_ДНЯХ",
  plans: "ПЛАНИ_ВІДДІЛІВ",
};

const argv = process.argv.slice(2);
const checkSchemaOnly = argv.includes("--check-schema");
const createMissingReferences = argv.includes("--create-missing-references");
const modeIndex = argv.indexOf("--mode");
const mode = modeIndex >= 0 ? argv[modeIndex + 1] : "weekly";
const batchSizeIndex = argv.indexOf("--batch-size");
const batchSize = batchSizeIndex >= 0 ? Number(argv[batchSizeIndex + 1]) : 200;
const fileArg = argv.find((arg, index) =>
  !arg.startsWith("--") && index !== modeIndex + 1 && index !== batchSizeIndex + 1
);

if (!checkSchemaOnly && !fileArg) throw new Error("Вкажіть шлях до Excel-файлу.");
if (!checkSchemaOnly && !["weekly", "monthly"].includes(mode)) {
  throw new Error("--mode має бути weekly або monthly.");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  throw new Error("--batch-size має бути цілим числом від 1 до 500.");
}

const text = (value) => {
  if (value == null) return "";
  if (typeof value === "object" && value && "result" in value) return text(value.result);
  if (typeof value === "object" && Array.isArray(value?.richText)) return value.richText.map((x) => x.text).join("");
  if (typeof value === "object" && value && "text" in value) return String(value.text).trim();
  return String(value).trim();
};
const norm = (value) => text(value).normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
const number = (value) => {
  if (value == null || value === "") return null;
  const raw = typeof value === "object" && value && "result" in value ? value.result : value;
  const parsed = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const date = (value) => {
  const raw = typeof value === "object" && value && "result" in value ? value.result : value;
  let d = raw;
  if (typeof raw === "number") d = new Date(Math.round((raw - 25569) * 86400 * 1000));
  else if (!(raw instanceof Date)) {
    const match = text(raw).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    d = match ? new Date(Date.UTC(+match[3], +match[2] - 1, +match[1])) : new Date(text(raw));
  }
  return d instanceof Date && !Number.isNaN(d.valueOf()) ? d.toISOString().slice(0, 10) : null;
};
const bool = (value) => ["так", "yes", "true", "1"].includes(norm(value));
const dataStatus = (value) => {
  const status = norm(value);
  if (["дані відсутні", "missing"].includes(status)) return "missing";
  if (["підтверджений нуль", "confirmed_zero"].includes(status)) return "confirmed_zero";
  if (["потребує перевірки", "needs_review"].includes(status)) return "needs_review";
  return "available";
};
const objectType = (value) => {
  const type = norm(value);
  if (["department", "відділ", "отдел"].includes(type)) return "department";
  if (["region", "регіон", "регион"].includes(type)) return "region";
  return type;
};
const planType = (value) => {
  const type = norm(value);
  if (["minimum", "мінімум", "минимум", "мін", "мин"].includes(type)) return "minimum";
  if (["bnac", "бнац"].includes(type)) return "bnac";
  return type;
};
const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

function readSheet(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`Немає аркуша «${sheetName}».`);
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, i) => { headers[i] = text(cell.value); });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { __row: rowNumber };
    headers.forEach((header, i) => { if (header) record[header] = row.getCell(i).value; });
    if (Object.entries(record).some(([key, value]) => key !== "__row" && text(value))) rows.push(record);
  });
  return rows;
}

const tableSpecs = {
  sales: {
    tableCandidates: ["department_sales", "sales", "department_daily_sales"],
    key: ["sale_date", "department_id"],
    fields: {
      sale_date: ["Дата", date], department_id: [null],
      actual_sales_ml: ["Факт_продажу_мл", number], sales_ml: ["Факт_продажу_мл", number], gifts_ml: ["Подарунки_мл", number],
      employee_count: ["Кількість_працівників", number], employees_count: ["Кількість_працівників", number],
      all_shift_employees: ["Усі_працівники_зміни", text], analysis_sellers: ["Продавці_для_аналізу", text],
      excluded_employees: ["Виключені_працівники", text], data_status: ["Статус_даних", dataStatus],
      source_period: ["Період_джерела", text], source_file: ["Файл_джерело", text], source_rows: ["Рядки_джерела", text],
    },
  },
  shifts: {
    tableCandidates: ["employee_shifts", "shifts", "seller_shifts"],
    key: ["shift_date", "employee_id", "department_id"],
    fields: {
      shift_date: ["Дата", date], employee_id: [null], department_id: [null], role: ["Роль", text],
      include_employee: ["Враховувати_продавця", bool], include_seller: ["Враховувати_продавця", bool],
      shift_plan_ml: ["План_зміни_мл", number], point_sales_ml: ["Продаж_точки_мл", number], gifts_ml: ["Подарунки_мл", number],
      plan_completion_percent: ["Виконання_плану_зміни_%", number], shift_plan_completion_percent: ["Виконання_плану_зміни_%", number],
      shift_status: ["Статус_зміни", text], data_status: ["Статус_зміни", dataStatus], metric_type: ["Тип_показника", text], source_period: ["Період_джерела", text],
      source_file: ["Файл_джерело", text], source_row: ["Рядок_джерела", number],
    },
  },
  payroll: {
    tableCandidates: ["daily_payroll", "employee_daily_payroll", "payroll"],
    key: ["payroll_date", "employee_id", "department_id"],
    fields: {
      payroll_date: ["Дата", date], employee_id: [null], department_id: [null], role: ["Роль", text],
      include_employee: ["Враховувати_продавця", bool], include_seller: ["Враховувати_продавця", bool],
      revenue_uah: ["Виручка_грн", number], revenue_grn: ["Виручка_грн", number], total_salary_uah: ["Зарплата_всього_грн", number], salary_total_uah: ["Зарплата_всього_грн", number],
      total_salary_grn: ["Зарплата_всього_грн", number], base_salary_uah: ["Оклад_грн", number], base_salary_grn: ["Оклад_грн", number],
      percentage_rate: ["Ставка_відсотка", number], commission_rate: ["Ставка_відсотка", number], percentage_amount_uah: ["Сума_відсотка_грн", number], percentage_amount_grn: ["Сума_відсотка_грн", number], commission_uah: ["Сума_відсотка_грн", number],
      shift_plan_ml: ["План_зміни_мл", number], point_sales_ml: ["Продаж_точки_мл", number], bonus_per_ml_uah: ["Бонус_за_мл_грн", number],
      bonus_per_ml_grn: ["Бонус_за_мл_грн", number], ml_bonus_uah: ["Бонус_за_мл_грн", number], additional_bonus_uah: ["Додаткова_премія_грн", number], additional_bonus_grn: ["Додаткова_премія_грн", number], extra_bonus_uah: ["Додаткова_премія_грн", number],
      days_count: ["Кількість_днів", number], source_period: ["Період_джерела", text], source_file: ["Файл_джерело", text], source_row: ["Рядок_джерела", number],
    },
  },
  plans: {
    tableCandidates: ["plans", "department_plans", "sales_plans"],
    key: ["snapshot_date", "plan_month", "plan_type", "object_type", "region_id", "department_id"],
    fields: {
      snapshot_date: ["Дата_знімка", date], plan_month: ["Місяць_плану", date], plan_type: ["Тип_плану", planType], object_type: ["Тип_об’єкта", objectType],
      region_id: [null], department_id: [null], fact_period_start: ["Початок_періоду_факту", date], fact_period_end: ["Кінець_періоду_факту", date],
      plan_period_ml: ["План_періоду_мл", number], plan_ml: ["План_періоду_мл", number], actual_to_date_ml: ["Факт_на_дату_мл", number], reported_actual_ml: ["Факт_на_дату_мл", number], plan_completion_percent: ["Виконання_плану_періоду_%", number],
      remaining_ml: ["Не_вистачає_мл", number], required_per_day_ml: ["Потрібно_на_день_мл", number], source_pace_percent: ["Темп_за_джерелом_%", number],
      status_at_date: ["Статус_на_дату", text], downtime_days: ["Дні_простою", number], previous_period_sales_ml: ["Продажі_минулого_періоду_мл", number],
      change_vs_previous_percent: ["Зміна_до_минулого_%", number], source_plan_period: ["Період_плану_у_джерелі", text],
      source_fact_period: ["Період_факту_у_джерелі", text], source_previous_period: ["Попередній_період_у_джерелі", text],
      source_file: ["Файл_джерело", text], source_row: ["Рядок_джерела", number],
    },
  },
};

async function inspectSchema(client) {
  const result = await client.query(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position
  `);
  const tables = new Map();
  for (const row of result.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name).add(row.column_name);
  }
  const resolved = {};
  for (const [name, spec] of Object.entries(tableSpecs)) {
    let table = spec.tableCandidates.find((candidate) => tables.has(candidate));
    if (!table) table = [...tables].find(([, columns]) => spec.key.filter((x) => x !== "region_id").every((x) => columns.has(x)))?.[0];
    if (!table) throw new Error(`Не знайдено таблицю для набору «${name}». Запустіть npm run import:schema.`);
    const columns = tables.get(table);
    const requiredKey = spec.key.filter((column) => !(name === "plans" && column === "department_id"));
    const missing = requiredKey.filter((column) => !columns.has(column));
    if (missing.length) throw new Error(`Таблиця ${table}: бракує колонок ${missing.join(", ")}.`);
    resolved[name] = { ...spec, table, columns };
  }
  return { resolved, tables };
}

async function loadReferences(client) {
  // Один pg Client виконує запити послідовно. Це прибирає попередження pg@8
  // про client.query(), викликаний під час уже активного запиту.
  const regions = await client.query("SELECT id, name, normalized_name FROM public.regions");
  const departments = await client.query("SELECT d.id, d.name, d.normalized_name, d.region_id, r.name region_name, r.normalized_name region_normalized FROM public.departments d JOIN public.regions r ON r.id=d.region_id");
  const employees = await client.query("SELECT id, full_name, normalized_name FROM public.employees");
  const employeeAliases = await client.query("SELECT employee_id, normalized_alias FROM public.employee_aliases");
  const departmentAliases = await client.query("SELECT department_id, normalized_alias FROM public.department_aliases");
  const employeeById = new Map(employees.rows.map((x) => [String(x.id), x]));
  const employeeMap = new Map(employees.rows.map((x) => [norm(x.normalized_name || x.full_name), x]));
  for (const alias of employeeAliases.rows) if (employeeById.has(String(alias.employee_id))) employeeMap.set(norm(alias.normalized_alias), employeeById.get(String(alias.employee_id)));
  const departmentById = new Map(departments.rows.map((x) => [String(x.id), x]));
  const departmentMap = new Map(departments.rows.map((x) => [`${norm(x.region_normalized || x.region_name)}|${norm(x.normalized_name || x.name)}`, x]));
  for (const alias of departmentAliases.rows) {
    const d = departmentById.get(String(alias.department_id));
    if (d) departmentMap.set(`${norm(d.region_normalized || d.region_name)}|${norm(alias.normalized_alias)}`, d);
  }
  const regionMap = new Map(regions.rows.map((x) => [norm(x.normalized_name || x.name), x]));
  return { employeeMap, departmentMap, regionMap };
}

async function ensureReferences(client, raw) {
  const employeeNames = new Map();
  for (const row of [...raw.shifts, ...raw.payroll]) {
    const name = text(row.Працівник);
    if (name) employeeNames.set(norm(name), { name, role: text(row.Роль) || "Продавець", include: bool(row.Враховувати_продавця) });
  }
  const existingEmployees = await client.query("SELECT normalized_name, full_name FROM public.employees");
  const employeeSet = new Set(existingEmployees.rows.flatMap((x) => [norm(x.normalized_name), norm(x.full_name)]));
  let employeesCreated = 0;
  for (const [normalized, employee] of employeeNames) {
    if (employeeSet.has(normalized)) continue;
    await client.query(
      `INSERT INTO public.employees (full_name, normalized_name, role, include_in_seller_analysis, employment_status)
       VALUES ($1, $2, $3, $4, 'inactive')`,
      [employee.name, normalized, employee.role, employee.include]
    );
    employeeSet.add(normalized); employeesCreated += 1;
  }

  const departmentNames = new Map();
  for (const row of [...raw.sales, ...raw.shifts, ...raw.payroll, ...raw.plans]) {
    if (row.Відділ) departmentNames.set(`${norm(row.Регіон)}|${norm(row.Відділ)}`, { region: text(row.Регіон), department: text(row.Відділ) });
    if (objectType(row["Тип_об’єкта"]) === "department") departmentNames.set(`${norm(row.Регіон)}|${norm(row.Відділ_або_регіон)}`, { region: text(row.Регіон), department: text(row.Відділ_або_регіон) });
  }
  const regions = await client.query("SELECT id, name, normalized_name FROM public.regions");
  const regionMap = new Map(regions.rows.map((x) => [norm(x.normalized_name || x.name), x]));
  const departments = await client.query("SELECT region_id, name, normalized_name FROM public.departments");
  const departmentSet = new Set(departments.rows.map((x) => `${x.region_id}|${norm(x.normalized_name || x.name)}`));
  let departmentsCreated = 0;
  for (const item of departmentNames.values()) {
    const region = regionMap.get(norm(item.region));
    if (!region) throw new Error(`Не можна створити історичний відділ «${item.department}»: у БД немає регіону «${item.region}».`);
    const key = `${region.id}|${norm(item.department)}`;
    if (departmentSet.has(key)) continue;
    await client.query(
      `INSERT INTO public.departments (region_id, name, normalized_name, is_active)
       VALUES ($1, $2, $3, false)`,
      [region.id, item.department, norm(item.department)]
    );
    departmentSet.add(key); departmentsCreated += 1;
  }
  if (employeesCreated || departmentsCreated) console.log(`Створено історичних довідників: працівники ${employeesCreated}, відділи ${departmentsCreated}.`);
}

function buildRecord(kind, row, resolved, refs) {
  const record = {};
  for (const [column, [header, convert]] of Object.entries(resolved.fields)) {
    if (resolved.columns.has(column) && header) record[column] = convert(row[header]);
  }
  if (["sales", "shifts", "payroll"].includes(kind)) {
    const department = refs.departmentMap.get(`${norm(row.Регіон)}|${norm(row.Відділ)}`);
    if (!department) throw new Error(`${SHEETS[kind]} рядок ${row.__row}: невідомий відділ ${text(row.Регіон)} → ${text(row.Відділ)}`);
    record.department_id = department.id;
  }
  if (["shifts", "payroll"].includes(kind)) {
    const employee = refs.employeeMap.get(norm(row.Працівник));
    if (!employee) throw new Error(`${SHEETS[kind]} рядок ${row.__row}: невідомий працівник ${text(row.Працівник)}`);
    record.employee_id = employee.id;
  }
  // У зведеному Excel частина необов'язкових показників зарплати відсутня.
  // Для NOT NULL колонок PostgreSQL потрібно передавати 0/1 явно: DEFAULT не
  // застосовується, якщо INSERT містить NULL.
  if (kind === "payroll") {
    const zeroColumns = [
      "revenue_uah",
      "salary_total_uah",
      "base_salary_uah",
      "commission_rate",
      "commission_uah",
      "ml_bonus_uah",
      "extra_bonus_uah",
    ];
    for (const column of zeroColumns) {
      if (resolved.columns.has(column) && record[column] == null) record[column] = 0;
    }
    if (resolved.columns.has("days_count") && record.days_count == null) record.days_count = 1;
  }
  if (["sales", "shifts"].includes(kind) && resolved.columns.has("gifts_ml") && record.gifts_ml == null) {
    record.gifts_ml = 0;
  }
  if (kind === "plans") {
    if (record.object_type === "department") {
      const department = refs.departmentMap.get(`${norm(row.Регіон)}|${norm(row.Відділ_або_регіон)}`);
      if (!department) throw new Error(`${SHEETS.plans} рядок ${row.__row}: невідомий відділ ${text(row.Відділ_або_регіон)}`);
      record.department_id = department.id;
      if (resolved.columns.has("region_id")) record.region_id = null;
    } else if (record.object_type === "region") {
      const regionName = text(row.Регіон) || text(row.Відділ_або_регіон);
      const region = refs.regionMap.get(norm(regionName));
      if (!region) throw new Error(`${SHEETS.plans} рядок ${row.__row}: невідомий регіон ${regionName}`);
      record.region_id = region.id;
      if (resolved.columns.has("department_id")) record.department_id = null;
    } else {
      throw new Error(`${SHEETS.plans} рядок ${row.__row}: невідомий тип об’єкта ${text(row["Тип_об’єкта"])}`);
    }
  }
  return record;
}

async function upsertBatch(client, resolved, records, kind) {
  if (!records.length) return;
  const columns = Object.keys(records[0]).filter((column) => resolved.columns.has(column));
  const values = records.flatMap((record) => columns.map((column) => record[column]));
  const tuples = records.map((_, rowIndex) =>
    `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`
  );
  let conflict;
  let predicate = "";
  if (kind === "plans") {
    const target = records[0].object_type;
    const targetColumn = target === "department" ? "department_id" : "region_id";
    conflict = ["snapshot_date", "plan_month", "plan_type", targetColumn];
    predicate = ` WHERE object_type = '${target}'`;
  } else {
    conflict = resolved.key.filter((column) => columns.includes(column));
  }
  const updates = columns.filter((column) => !conflict.includes(column));
  const updateSql = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${q(column)} = EXCLUDED.${q(column)}`).join(", ")}${resolved.columns.has("updated_at") ? ", updated_at = now()" : ""}`
    : "DO NOTHING";
  await client.query(
    `INSERT INTO public.${q(resolved.table)} (${columns.map(q).join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT (${conflict.map(q).join(", ")})${predicate} ${updateSql}`,
    values
  );
}

async function importDataset(client, kind, resolved, records) {
  const groups = kind === "plans"
    ? [records.filter((x) => x.object_type === "department"), records.filter((x) => x.object_type === "region")]
    : [records];
  let completed = 0;
  console.log(`\n${kind}: 0/${records.length}`);
  for (const group of groups) {
    for (let start = 0; start < group.length; start += batchSize) {
      const batch = group.slice(start, start + batchSize);
      await upsertBatch(client, resolved, batch, kind);
      completed += batch.length;
      console.log(`${kind}: ${completed}/${records.length}`);
    }
  }
}

async function monthlyCleanup(client, resolved, records) {
  const dateColumn = resolved.key[0];
  const months = [...new Set(records.map((record) => record[dateColumn]?.slice(0, 7)).filter(Boolean))];
  for (const month of months) {
    const start = `${month}-01`;
    const end = new Date(`${start}T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1);
    await client.query(`DELETE FROM public.${q(resolved.table)} WHERE ${q(dateColumn)} >= $1 AND ${q(dateColumn)} < $2`, [start, end.toISOString().slice(0, 10)]);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    const { resolved } = await inspectSchema(client);
    console.table(Object.entries(resolved).map(([dataset, x]) => ({ dataset, table: x.table, key: x.key.filter((c) => x.columns.has(c)).join(" + ") })));
    if (checkSchemaOnly) return;

    const filePath = path.resolve(fileArg);
    const bytes = await fs.readFile(filePath);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
    const raw = Object.fromEntries(Object.entries(SHEETS).map(([kind, sheet]) => [kind, readSheet(workbook, sheet)]));
    // «Загалом / ИТОГО» — контрольні суми Excel. Вони не є ані відділом,
    // ані регіоном і не повинні дублювати детальні плани в PostgreSQL.
    const planRowsBeforeFilter = raw.plans.length;
    raw.plans = raw.plans.filter((row) => norm(row["Тип_об’єкта"]) !== norm("Загалом"));
    const skippedPlanTotals = planRowsBeforeFilter - raw.plans.length;
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
    if (createMissingReferences) await ensureReferences(client, raw);
    const refs = await loadReferences(client);
    const data = Object.fromEntries(Object.entries(raw).map(([kind, rows]) => [kind, rows.map((row) => buildRecord(kind, row, resolved[kind], refs))]));
    if (mode === "monthly") for (const kind of Object.keys(data)) await monthlyCleanup(client, resolved[kind], data[kind]);
    for (const kind of Object.keys(data)) await importDataset(client, kind, resolved[kind], data[kind]);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    await client.query("COMMIT");
    console.table(Object.entries(data).map(([dataset, rows]) => ({ dataset, rows: rows.length })));
    if (skippedPlanTotals) console.log(`Пропущено підсумкових рядків «Загалом / ИТОГО»: ${skippedPlanTotals}.`);
    console.log({ file: path.basename(filePath), mode, sha256: hash });
    console.log("✅ Імпорт завершено. Транзакцію підтверджено.");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error("❌ Імпорт не виконано:", error.message); process.exitCode = 1; });
