import crypto from "node:crypto";
import fs from "node:fs/promises";
import { parse1cMlWorkbook, summarizeMlRecords } from "./parse-1c-ml.js";
import { ensureMonthStatusTable, finalMonths, markMonthStatus } from "./month-status.js";

const norm = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

export async function ensureHistoryTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS telegram_imports (
    id bigserial PRIMARY KEY,
    sha256 text NOT NULL UNIQUE,
    file_unique_id text,
    file_name text NOT NULL,
    file_type text NOT NULL,
    import_mode text NOT NULL,
    date_from date,
    date_to date,
    row_count integer NOT NULL DEFAULT 0,
    telegram_channel_id bigint,
    telegram_message_id bigint,
    status text NOT NULL,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  )`);
  // public is exposed by Supabase by default. The import journal is server-only.
  await client.query("ALTER TABLE public.telegram_imports ENABLE ROW LEVEL SECURITY");
}

export async function recordImportFailure(client, { digest, file, fileType, importMode, dateFrom, dateTo, rowCount, error }) {
  await ensureHistoryTable(client);
  await client.query(`INSERT INTO telegram_imports
    (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,
     telegram_channel_id,telegram_message_id,status,error_message,completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11,now())
    ON CONFLICT (sha256) DO UPDATE SET status='needs_review',error_message=EXCLUDED.error_message,
      telegram_message_id=EXCLUDED.telegram_message_id,completed_at=now()`,
  [digest,file.fileUniqueId,file.fileName,fileType,importMode,dateFrom,dateTo,rowCount ?? 0,
    file.channelId,file.messageId,String(error.message).slice(0,2000)]);
}

export async function loadRefs(client) {
  // A pg Client executes one query at a time. Keep these sequential: running
  // Promise.all() on a checked-out client is deprecated and will fail in pg 9.
  const regions = await client.query("SELECT id, name, normalized_name FROM regions");
  const departments = await client.query("SELECT id, region_id, name, normalized_name FROM departments");
  const employees = await client.query("SELECT id, full_name, normalized_name FROM employees");
  const departmentAliases = await client.query("SELECT department_id, normalized_alias FROM department_aliases");
  const employeeAliases = await client.query("SELECT employee_id, normalized_alias FROM employee_aliases");
  const regionMap = new Map(regions.rows.map((x) => [norm(x.normalized_name || x.name), x]));
  const departmentById = new Map(departments.rows.map((x) => [String(x.id), x]));
  const departmentMap = new Map(departments.rows.map((x) => [`${x.region_id}|${norm(x.normalized_name || x.name)}`, x]));
  for (const x of departmentAliases.rows) {
    const item = departmentById.get(String(x.department_id));
    if (item) departmentMap.set(`${item.region_id}|${norm(x.normalized_alias)}`, item);
  }
  const employeeById = new Map(employees.rows.map((x) => [String(x.id), x]));
  const employeeMap = new Map(employees.rows.map((x) => [norm(x.normalized_name || x.full_name), x]));
  for (const x of employeeAliases.rows) {
    const item = employeeById.get(String(x.employee_id));
    if (item) employeeMap.set(norm(x.normalized_alias), item);
  }
  return { regionMap, departmentMap, employeeMap };
}

export async function ensureRegions(client, records) {
  const existing = await client.query("SELECT normalized_name, name FROM regions");
  const known = new Set(existing.rows.flatMap((row) => [norm(row.normalized_name), norm(row.name)]));
  const created = [];

  for (const row of records) {
    const name = row.region?.trim();
    const normalized = norm(name);
    if (!normalized || known.has(normalized)) continue;
    const result = await client.query(
      `INSERT INTO regions (name, normalized_name)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM regions
         WHERE normalized_name = $2 OR lower(trim(name)) = $2
       )
       RETURNING id`,
      [name, normalized],
    );
    known.add(normalized);
    if (result.rowCount) created.push(name);
  }
  return created;
}

export async function ensureDepartments(client, records) {
  const regions = await client.query("SELECT id, name, normalized_name FROM regions");
  const regionMap = new Map(regions.rows.map((row) => [norm(row.normalized_name || row.name), row]));
  const existing = await client.query("SELECT region_id, name, normalized_name FROM departments");
  const known = new Set(existing.rows.map((row) => `${row.region_id}|${norm(row.normalized_name || row.name)}`));
  const aliases = await client.query(`SELECT d.region_id, a.normalized_alias
    FROM department_aliases a JOIN departments d ON d.id = a.department_id`);
  for (const row of aliases.rows) known.add(`${row.region_id}|${norm(row.normalized_alias)}`);
  const created = [];

  for (const row of records) {
    if (!row.department) continue;
    const region = regionMap.get(norm(row.region));
    if (!region) throw new Error(`Не вдалося створити відділ «${row.department}»: немає регіону «${row.region}»`);
    const name = row.department?.trim();
    const normalized = norm(name);
    const key = `${region.id}|${normalized}`;
    if (!normalized || known.has(key)) continue;
    const result = await client.query(
      `INSERT INTO departments (region_id, name, normalized_name, is_active)
       SELECT $1, $2, $3, true
       WHERE NOT EXISTS (
         SELECT 1 FROM departments
         WHERE region_id = $1 AND (normalized_name = $3 OR lower(trim(name)) = $3)
       )
       RETURNING id`,
      [region.id, name, normalized],
    );
    known.add(key);
    if (result.rowCount) created.push(`${region.name} → ${name}`);
  }
  return created;
}

export async function ensureEmployees(client, records) {
  const existing = await client.query("SELECT normalized_name, full_name FROM employees");
  const known = new Set(existing.rows.flatMap((row) => [norm(row.normalized_name), norm(row.full_name)]));
  const aliases = await client.query("SELECT normalized_alias FROM employee_aliases");
  for (const row of aliases.rows) known.add(norm(row.normalized_alias));
  const created = [];

  for (const row of records) {
    const normalized = norm(row.employee);
    if (!normalized || known.has(normalized)) continue;

    const result = await client.query(
      `INSERT INTO employees
        (full_name, normalized_name, role, include_in_seller_analysis, employment_status)
       SELECT $1, $2, 'Продавець', true, 'active'
       WHERE NOT EXISTS (
         SELECT 1 FROM employees
         WHERE normalized_name = $2 OR lower(trim(full_name)) = $2
       )`,
      [row.employee.trim(), normalized],
    );
    known.add(normalized);
    if (result.rowCount) created.push(row.employee.trim());
  }

  return created;
}

function resolveRows(records, refs) {
  return records.map((row) => {
    const region = refs.regionMap.get(norm(row.region));
    if (!region) throw new Error(`Невідомий регіон «${row.region}» (рядок ${row.sourceRow})`);
    const department = refs.departmentMap.get(`${region.id}|${norm(row.department)}`);
    if (!department) throw new Error(`Невідомий відділ «${row.region} → ${row.department}» (рядок ${row.sourceRow})`);
    const employee = refs.employeeMap.get(norm(row.employee));
    if (!employee) throw new Error(`Невідомий працівник «${row.employee}» (рядок ${row.sourceRow})`);
    return { ...row, departmentId: department.id, employeeId: employee.id };
  });
}

function modeForMonth(records, month) {
  const dates = [...new Set(records.filter((x) => x.date.startsWith(month)).map((x) => x.date))].sort();
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return dates[0]?.endsWith("-01") && dates.at(-1)?.endsWith(`-${String(lastDay).padStart(2, "0")}`) ? "monthly" : "weekly";
}

async function tableColumns(client, table) {
  const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
  return new Set(result.rows.map((x) => x.column_name));
}

function requireColumns(table, actual, required) {
  const missing = required.filter((column) => !actual.has(column));
  if (missing.length) {
    throw new Error(`Схема БД: у таблиці ${table} немає колонок: ${missing.join(", ")}`);
  }
}

export function validateMlSchema({ salesColumns, shiftColumns }) {
  requireColumns("department_daily_sales", salesColumns, [
    "sale_date", "department_id", "sales_ml", "gifts_ml", "data_status", "source_row",
  ]);
  requireColumns("employee_shifts", shiftColumns, [
    "shift_date", "employee_id", "department_id", "shift_plan_ml",
    "point_sales_ml", "gifts_ml", "data_status", "source_row",
  ]);
}

export function aggregateDepartmentSales(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.departmentId}`;
    const current = result.get(key) ?? {
      date: row.date,
      departmentId: row.departmentId,
      salesMl: 0,
      giftsMl: 0,
      sourceRows: [],
    };
    current.salesMl += row.salesMl ?? 0;
    current.giftsMl += row.giftsMl ?? 0;
    current.sourceRows.push(row.sourceRow);
    result.set(key, current);
  }
  return [...result.values()];
}

export async function upsertRows(client, rows) {
  const salesColumns = await tableColumns(client, "department_daily_sales");
  const shiftColumns = await tableColumns(client, "employee_shifts");
  validateMlSchema({ salesColumns, shiftColumns });

  // The real Supabase schema stores completion as a derived value, not as a
  // physical column. Keep the raw plan and sales values and calculate the
  // percentage in SELECT/API queries when needed.
  for (const row of aggregateDepartmentSales(rows)) {
    await client.query(`INSERT INTO department_daily_sales
      (sale_date, department_id, sales_ml, gifts_ml, data_status, source_row)
      VALUES ($1,$2,$3,$4,'available',$5)
      ON CONFLICT (sale_date, department_id) DO UPDATE SET
        sales_ml=EXCLUDED.sales_ml, gifts_ml=EXCLUDED.gifts_ml,
        data_status=EXCLUDED.data_status, source_row=EXCLUDED.source_row,
        updated_at=now()`,
      [row.date, row.departmentId, row.salesMl, row.giftsMl, row.sourceRows.join(",")]);
  }

  for (const row of rows) {
    await client.query(`INSERT INTO employee_shifts
      (shift_date, employee_id, department_id, shift_plan_ml,
       point_sales_ml, gifts_ml, data_status, source_row)
      VALUES ($1,$2,$3,$4,$5,$6,'available',$7)
      ON CONFLICT (shift_date, employee_id, department_id) DO UPDATE SET
        shift_plan_ml=COALESCE(EXCLUDED.shift_plan_ml, employee_shifts.shift_plan_ml),
        point_sales_ml=EXCLUDED.point_sales_ml,
        gifts_ml=EXCLUDED.gifts_ml, data_status=EXCLUDED.data_status,
        source_row=EXCLUDED.source_row, updated_at=now()`,
      [row.date, row.employeeId, row.departmentId, row.planMl, row.salesMl, row.giftsMl, String(row.sourceRow)]);
  }
}

export async function replaceMlPeriod(client, dateFrom, dateTo) {
  if (!dateFrom || !dateTo || dateFrom > dateTo) {
    throw new Error(`Некоректний період ML: ${dateFrom ?? "?"}–${dateTo ?? "?"}`);
  }
  await client.query(
    "DELETE FROM employee_shifts WHERE shift_date BETWEEN $1 AND $2",
    [dateFrom, dateTo],
  );
  await client.query(
    "DELETE FROM department_daily_sales WHERE sale_date BETWEEN $1 AND $2",
    [dateFrom, dateTo],
  );
}

export async function importTelegramMl({ pool, localPath, file, sha256 }) {
  const bytes = await fs.readFile(localPath);
  const digest = sha256 ?? crypto.createHash("sha256").update(bytes).digest("hex");
  const records = parse1cMlWorkbook(localPath, file.fileName);
  const summary = summarizeMlRecords(records);
  const modes = Object.fromEntries(summary.months.map((month) => [month, modeForMonth(records, month)]));
  const overallMode = Object.values(modes).every((x) => x === "monthly") ? "monthly" : "weekly";
  const client = await pool.connect();
  let importId;
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    await ensureMonthStatusTable(client);
    const previous = await client.query("SELECT id,status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (previous.rowCount && previous.rows[0].status === "completed") {
      await client.query("ROLLBACK");
      return { duplicate: true, reprocessed: false, importId: previous.rows[0].id, ...summary, modes,
        regionsCreated: [], departmentsCreated: [], employeesCreated: [] };
    }
    const reprocessed = previous.rowCount > 0;
    if (reprocessed) {
      importId = previous.rows[0].id;
      await client.query(`UPDATE telegram_imports SET file_unique_id=$2,file_name=$3,
        import_mode=$4,date_from=$5,date_to=$6,row_count=$7,telegram_channel_id=$8,
        telegram_message_id=$9,status='processing',error_message=NULL,completed_at=NULL WHERE id=$1`,
      [importId,file.fileUniqueId,file.fileName,overallMode,summary.dateFrom,summary.dateTo,
        summary.records,file.channelId,file.messageId]);
    } else {
      const history = await client.query(`INSERT INTO telegram_imports
        (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
        VALUES ($1,$2,$3,'ML',$4,$5,$6,$7,$8,$9,'processing') RETURNING id`,
      [digest, file.fileUniqueId, file.fileName, overallMode, summary.dateFrom, summary.dateTo, summary.records, file.channelId, file.messageId]);
      importId = history.rows[0].id;
    }
    // A 1C export is also the authoritative source for new operational
    // references. Create them inside the same transaction so a failed import
    // cannot leave half-created dictionaries behind.
    const regionsCreated = await ensureRegions(client, records);
    const departmentsCreated = await ensureDepartments(client, records);
    const employeesCreated = await ensureEmployees(client, records);
    const resolved = resolveRows(records, await loadRefs(client));
    // Weekly files are incremental corrections. Never delete their whole date
    // range: a partial export could erase valid rows from another file, and an
    // empty plan cell must not replace a previously known plan with NULL.
    // A verified full-month export remains authoritative for that month.
    const monthlyMonths = Object.entries(modes).filter(([, mode]) => mode === "monthly").map(([month]) => month);
    if (monthlyMonths.length) {
      for (const month of monthlyMonths) {
        const monthStart = `${month}-01`;
        const nextMonth = new Date(`${monthStart}T00:00:00Z`);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        await replaceMlPeriod(client, monthStart, new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10));
      }
    }
    const weeklyMonths = Object.entries(modes).filter(([, mode]) => mode === "weekly").map(([month]) => month);
    const protectedSales = await finalMonths(client, "department_sales", weeklyMonths);
    const protectedShifts = await finalMonths(client, "employee_shifts", weeklyMonths);
    const writable = resolved.filter((row) => !protectedSales.has(row.date.slice(0, 7)) && !protectedShifts.has(row.date.slice(0, 7)));
    await upsertRows(client, writable);
    for (const [month, mode] of Object.entries(modes)) {
      await markMonthStatus(client, { month, datasets: ["department_sales", "employee_shifts"], status: mode === "monthly" ? "final" : "weekly", sourceFile: file.fileName });
    }
    await client.query("UPDATE telegram_imports SET status='completed', completed_at=now() WHERE id=$1", [importId]);
    await client.query("COMMIT");
    return { duplicate: false, reprocessed, importId, ...summary, modes, protectedRows: resolved.length - writable.length, regionsCreated, departmentsCreated, employeesCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordImportFailure(client, { digest, file, fileType: "ML", importMode: overallMode,
      dateFrom: summary.dateFrom, dateTo: summary.dateTo, rowCount: summary.records, error }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
