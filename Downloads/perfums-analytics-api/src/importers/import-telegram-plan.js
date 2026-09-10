import crypto from "node:crypto";
import { ensureMonthStatusTable, finalMonths, markMonthStatus } from "./month-status.js";
import fs from "node:fs/promises";
import { parse1cPlanWorkbook } from "./parse-1c-plan.js";
import {
  ensureDepartments,
  ensureHistoryTable,
  ensureRegions,
  loadRefs,
  recordImportFailure,
} from "./import-telegram-ml.js";

const norm = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

async function tableColumns(client, table) {
  const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

export function validatePlanSchema(columns) {
  const required = ["snapshot_date", "plan_month", "plan_type", "object_type", "department_id", "region_id", "fact_period_start", "fact_period_end", "plan_ml", "reported_actual_ml", "downtime_days", "previous_period_sales_ml", "source_row"];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length) throw new Error(`Схема БД: у таблиці department_plan_snapshots немає колонок: ${missing.join(", ")}`);
}

function resolvePlanRows(records, refs) {
  return records.map((row) => {
    const region = refs.regionMap.get(norm(row.region));
    if (!region) throw new Error(`Невідомий регіон «${row.region}» (рядок ${row.sourceRow})`);
    if (row.objectType === "region") return { ...row, regionId: region.id, departmentId: null };
    const department = refs.departmentMap.get(`${region.id}|${norm(row.department)}`);
    if (!department) throw new Error(`Невідомий відділ «${row.region} → ${row.department}» (рядок ${row.sourceRow})`);
    return { ...row, regionId: null, departmentId: department.id };
  });
}

export async function upsertPlanRows(client, rows) {
  validatePlanSchema(await tableColumns(client, "department_plan_snapshots"));
  for (const row of rows) {
    const targetColumn = row.objectType === "department" ? "department_id" : "region_id";
    await client.query(`INSERT INTO department_plan_snapshots
      (snapshot_date, plan_month, plan_type, object_type, department_id, region_id,
       fact_period_start, fact_period_end, plan_ml, reported_actual_ml,
       downtime_days, previous_period_sales_ml, source_row)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (snapshot_date, plan_month, plan_type, ${targetColumn})
      WHERE object_type = '${row.objectType}'
      DO UPDATE SET fact_period_start=EXCLUDED.fact_period_start,
        fact_period_end=EXCLUDED.fact_period_end, plan_ml=EXCLUDED.plan_ml,
        reported_actual_ml=EXCLUDED.reported_actual_ml,
        downtime_days=EXCLUDED.downtime_days,
        previous_period_sales_ml=EXCLUDED.previous_period_sales_ml,
        source_row=EXCLUDED.source_row`,
      [row.snapshotDate, row.planMonth, row.planType, row.objectType, row.departmentId, row.regionId,
        row.factPeriodStart, row.factPeriodEnd, row.planMl, row.reportedActualMl,
        row.downtimeDays, row.previousPeriodSalesMl, row.sourceRow]);
  }
}

export async function importTelegramPlan({ pool, localPath, file, fileType, sha256 }) {
  const bytes = await fs.readFile(localPath);
  const digest = sha256 ?? crypto.createHash("sha256").update(bytes).digest("hex");
  const parsed = parse1cPlanWorkbook(localPath, { fileType, sourceFile: file.fileName, referenceDate: file.messageDate });
  const importMode = parsed.factPeriod.end === parsed.planPeriod.end ? "monthly" : "weekly";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    await ensureMonthStatusTable(client);
    const duplicate = await client.query("SELECT id, status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return { duplicate: true, importId: duplicate.rows[0].id, records: parsed.records.length, skipped: parsed.skipped, importMode, ...parsed.factPeriod, planMonth: parsed.records[0].planMonth };
    }
    const history = await client.query(`INSERT INTO telegram_imports
      (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing') RETURNING id`,
      [digest, file.fileUniqueId, file.fileName, fileType, importMode, parsed.factPeriod.start, parsed.factPeriod.end,
        parsed.records.length, file.channelId, file.messageId]);
    const protectedSet = importMode === "weekly" ? await finalMonths(client, "plans", [parsed.records[0].planMonth.slice(0,7)]) : new Set();
    if (protectedSet.size) throw new Error(`Плани за ${parsed.records[0].planMonth.slice(0,7)} вже фіналізовані; тижневий файл не застосовано`);
    const regionsCreated = await ensureRegions(client, parsed.records);
    const departmentsCreated = await ensureDepartments(client, parsed.records);
    const resolved = resolvePlanRows(parsed.records, await loadRefs(client));
    // A snapshot is authoritative: remove stale objects absent from a corrected file.
    if (importMode === "monthly") {
      await client.query(
        "DELETE FROM department_plan_snapshots WHERE plan_month=$1::date AND plan_type=$2",
        [resolved[0].planMonth, resolved[0].planType],
      );
    } else {
      await client.query(
        "DELETE FROM department_plan_snapshots WHERE snapshot_date=$1::date AND plan_month=$2::date AND plan_type=$3",
        [resolved[0].snapshotDate, resolved[0].planMonth, resolved[0].planType],
      );
    }
    await upsertPlanRows(client, resolved);
    await markMonthStatus(client, { month: resolved[0].planMonth, datasets: ["plans"], status: importMode === "monthly" ? "final" : "weekly", sourceFile: file.fileName });
    await client.query("UPDATE telegram_imports SET status='completed', completed_at=now() WHERE id=$1", [history.rows[0].id]);
    await client.query("COMMIT");
    return { duplicate: false, importId: history.rows[0].id, records: resolved.length, skipped: parsed.skipped,
      importMode, dateFrom: parsed.factPeriod.start, dateTo: parsed.factPeriod.end,
      planMonth: resolved[0].planMonth, planType: resolved[0].planType, regionsCreated, departmentsCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordImportFailure(client, { digest, file, fileType, importMode,
      dateFrom: parsed.factPeriod.start, dateTo: parsed.factPeriod.end,
      rowCount: parsed.records.length, error }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
