import crypto from "node:crypto";
import { ensureMonthStatusTable, finalMonths, markMonthStatus } from "./month-status.js";
import fs from "node:fs/promises";
import { ensureHistoryTable, recordImportFailure } from "./import-telegram-ml.js";
import { parse1cPayrollWorkbook } from "./parse-1c-payroll.js";

const norm = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
const q = (value) => `"${String(value).replaceAll('"', '""')}"`;

async function tableColumns(client, table) {
  const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

export function validatePayrollSchema(columns) {
  const required = [
    "payroll_date", "employee_id", "department_id", "revenue_uah", "salary_total_uah",
    "base_salary_uah", "commission_rate", "commission_uah", "shift_plan_ml",
    "point_sales_ml", "ml_bonus_uah", "extra_bonus_uah", "days_count", "source_row",
  ];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) throw new Error(`Схема БД: у таблиці payroll_daily немає колонок: ${missing.join(", ")}`);
}

async function ensureEmployees(client, records) {
  const existing = await client.query("SELECT normalized_name, full_name FROM employees");
  const aliases = await client.query("SELECT normalized_alias FROM employee_aliases");
  const known = new Set(existing.rows.flatMap((row) => [norm(row.normalized_name), norm(row.full_name)]));
  for (const row of aliases.rows) known.add(norm(row.normalized_alias));
  const created = [];
  for (const row of records) {
    const normalized = norm(row.employee);
    if (!normalized || known.has(normalized)) continue;
    const result = await client.query(`INSERT INTO employees
      (full_name, normalized_name, role, include_in_seller_analysis, employment_status)
      SELECT $1,$2,'Продавець',true,'active'
      WHERE NOT EXISTS (SELECT 1 FROM employees WHERE normalized_name=$2 OR lower(trim(full_name))=$2)`,
    [row.employee.trim(), normalized]);
    known.add(normalized);
    if (result.rowCount) created.push(row.employee.trim());
  }
  return created;
}

async function loadPayrollRefs(client) {
  const employees = await client.query("SELECT id, full_name, normalized_name FROM employees");
  const employeeAliases = await client.query("SELECT employee_id, normalized_alias FROM employee_aliases");
  const departments = await client.query("SELECT id, region_id, name, normalized_name FROM departments");
  const departmentAliases = await client.query("SELECT department_id, normalized_alias FROM department_aliases");
  const employeeById = new Map(employees.rows.map((row) => [String(row.id), row]));
  const employeeMap = new Map(employees.rows.map((row) => [norm(row.normalized_name || row.full_name), row]));
  for (const alias of employeeAliases.rows) {
    const employee = employeeById.get(String(alias.employee_id));
    if (employee) employeeMap.set(norm(alias.normalized_alias), employee);
  }
  const departmentById = new Map(departments.rows.map((row) => [String(row.id), row]));
  const departmentMap = new Map();
  const addDepartment = (name, department) => {
    const key = norm(name);
    if (!key) return;
    const items = departmentMap.get(key) ?? new Map();
    items.set(String(department.id), department);
    departmentMap.set(key, items);
  };
  for (const department of departments.rows) addDepartment(department.normalized_name || department.name, department);
  for (const alias of departmentAliases.rows) {
    const department = departmentById.get(String(alias.department_id));
    if (department) addDepartment(alias.normalized_alias, department);
  }
  return { employeeMap, departmentMap };
}

async function resolveRows(client, records, refs) {
  const result = [];
  for (const row of records) {
    const employee = refs.employeeMap.get(norm(row.employee));
    if (!employee) throw new Error(`ЗП рядок ${row.sourceRow}: невідомий працівник «${row.employee}»`);
    let candidates = [...(refs.departmentMap.get(norm(row.department))?.values() ?? [])];
    if (candidates.length > 1) {
      const matches = await client.query(`SELECT DISTINCT department_id FROM employee_shifts
        WHERE employee_id=$1 AND shift_date BETWEEN $2 AND $3 AND department_id=ANY($4::bigint[])`,
      [employee.id, row.payrollDate, row.payrollDate, candidates.map((item) => item.id)]);
      const ids = new Set(matches.rows.map((item) => String(item.department_id)));
      candidates = candidates.filter((item) => ids.has(String(item.id)));
    }
    if (candidates.length !== 1) {
      const reason = candidates.length ? "назва є в кількох регіонах, а зміна ML за цей день не визначила одну точку" : "відділ відсутній у довіднику та псевдонімах";
      throw new Error(`ЗП рядок ${row.sourceRow}: не вдалося визначити відділ «${row.department}» — ${reason}. Спочатку імпортуй ML або додай department_aliases.`);
    }
    result.push({ ...row, employeeId: employee.id, departmentId: candidates[0].id });
  }
  return result;
}

export async function upsertPayrollRows(client, rows) {
  const columns = await tableColumns(client, "payroll_daily");
  validatePayrollSchema(columns);
  const fields = [
    ["payroll_date", "payrollDate"], ["employee_id", "employeeId"], ["department_id", "departmentId"],
    ["revenue_uah", "revenueUah"], ["salary_total_uah", "salaryTotalUah"],
    ["base_salary_uah", "baseSalaryUah"], ["commission_rate", "commissionRate"],
    ["commission_uah", "commissionUah"], ["shift_plan_ml", "shiftPlanMl"],
    ["point_sales_ml", "pointSalesMl"], ["ml_bonus_uah", "mlBonusUah"],
    ["extra_bonus_uah", "extraBonusUah"], ["days_count", "daysCount"], ["source_row", "sourceRow"],
  ];
  const names = fields.map(([column]) => column);
  const updates = names.filter((column) => !["payroll_date", "employee_id", "department_id"].includes(column));
  for (const row of rows) {
    await client.query(`INSERT INTO payroll_daily (${names.map(q).join(",")})
      VALUES (${names.map((_, index) => `$${index + 1}`).join(",")})
      ON CONFLICT (payroll_date,employee_id,department_id) DO UPDATE SET
      ${updates.map((column) => `${q(column)}=EXCLUDED.${q(column)}`).join(",")}${columns.has("updated_at") ? ",updated_at=now()" : ""}`,
    fields.map(([, property]) => row[property]));
  }
}

async function replaceMonthlyPerformance(client, monthStart, summaries, refs, sourceFile) {
  await client.query("DELETE FROM employee_monthly_performance WHERE performance_month=$1::date", [monthStart]);
  for (const row of summaries) {
    const employee = refs.employeeMap.get(norm(row.employee));
    if (!employee) throw new Error(`Місячний звіт: невідомий працівник «${row.employee}»`);
    await client.query(`INSERT INTO employee_monthly_performance
      (performance_month,employee_id,department_id,reported_shifts,plan_ml,sales_ml,
       completion_percent,is_final,source_file,source_row)
      VALUES ($1,$2,NULL,$3,$4,$5,$6,true,$7,$8)
      ON CONFLICT (performance_month,employee_id,department_id)
      DO UPDATE SET reported_shifts=EXCLUDED.reported_shifts,plan_ml=EXCLUDED.plan_ml,
        sales_ml=EXCLUDED.sales_ml,completion_percent=EXCLUDED.completion_percent,
        is_final=true,source_file=EXCLUDED.source_file,source_row=EXCLUDED.source_row,updated_at=now()`,
    [monthStart,employee.id,row.reportedShifts,row.planMl,row.salesMl,row.completionPercent,sourceFile,row.sourceRow]);
  }
}

export async function importTelegramPayroll({ pool, localPath, file, sha256 }) {
  const bytes = await fs.readFile(localPath);
  const digest = sha256 ?? crypto.createHash("sha256").update(bytes).digest("hex");
  const parsed = parse1cPayrollWorkbook(localPath, file.fileName);
  const month = parsed.dateFrom.slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
  const importMode = parsed.dateFrom === monthStart && parsed.dateTo === monthEnd ? "monthly" : "weekly";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    await ensureMonthStatusTable(client);
    const duplicate = await client.query("SELECT id,status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return { duplicate: true, importId: duplicate.rows[0].id, ...parsed, records: parsed.records.length };
    }
    const history = await client.query(`INSERT INTO telegram_imports
      (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
      VALUES ($1,$2,$3,'Payroll',$4,$5,$6,$7,$8,$9,'processing') RETURNING id`,
    [digest, file.fileUniqueId, file.fileName, importMode, parsed.dateFrom, parsed.dateTo, parsed.records.length, file.channelId, file.messageId]);
    const employeesCreated = await ensureEmployees(client, [
      ...parsed.records,
      ...parsed.summaries,
    ]);
    const refs = await loadPayrollRefs(client);
    const resolved = await resolveRows(client, parsed.records, refs);
    // Only a complete calendar-month file may replace a whole period. Weekly
    // files are incremental UPSERTs; deleting their range can remove valid
    // rows that are absent from a partial/corrected export.
    if (importMode === "monthly") {
      await client.query("DELETE FROM payroll_daily WHERE payroll_date BETWEEN $1 AND $2", [monthStart, monthEnd]);
    }
    const protectedSet = importMode === "weekly" ? await finalMonths(client, "payroll", [month]) : new Set();
    const writable = protectedSet.has(month) ? [] : resolved;
    await upsertPayrollRows(client, writable);
    if (importMode === "monthly") {
      await replaceMonthlyPerformance(client, monthStart, parsed.summaries, refs, file.fileName);
    }
    await markMonthStatus(client, { month, datasets: importMode === "monthly" ? ["payroll", "employee_performance"] : ["payroll"], status: importMode === "monthly" ? "final" : "weekly", sourceFile: file.fileName });
    await client.query("UPDATE telegram_imports SET status='completed',completed_at=now() WHERE id=$1", [history.rows[0].id]);
    await client.query("COMMIT");
    return { duplicate: false, importId: history.rows[0].id, records: writable.length, protectedRows: resolved.length - writable.length, dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo, distinctDates: parsed.distinctDates, employees: parsed.employees,
      departments: parsed.departments, importMode, employeesCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordImportFailure(client, { digest, file, fileType: "Payroll", importMode,
      dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, rowCount: parsed.records.length, error }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
