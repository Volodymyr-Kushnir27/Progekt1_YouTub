import crypto from "node:crypto";
import fs from "node:fs/promises";
import { ensureHistoryTable, recordImportFailure } from "./import-telegram-ml.js";
import { parseEmployeeStatusesWorkbook } from "./parse-employee-statuses.js";

const norm = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("uk-UA").replace(/[іїєґыэъё]/g, (x) => ({ і:"и", ї:"и", є:"е", ґ:"г", ы:"и", э:"е", ъ:"ь", ё:"е" }[x]))
  .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

function uniqueEmployee(rows, wanted) {
  const wantedKey = norm(wanted);
  const exact = rows.filter((row) => [row.full_name, row.normalized_name, row.aliases]
    .some((value) => String(value ?? "").split(" | ").some((part) => norm(part) === wantedKey)));
  if (exact.length === 1) return exact[0];
  const tokens = wantedKey.split(" ").filter((token) => token.length > 2);
  const fuzzy = rows.filter((row) => tokens.length >= 2 && [row.full_name, row.normalized_name, row.aliases]
    .some((value) => tokens.every((token) => norm(value).includes(token))));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function ensureStatusTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS employee_status_snapshots (
    id bigserial PRIMARY KEY,
    status_month date NOT NULL,
    employee_id bigint NOT NULL REFERENCES employees(id),
    status text NOT NULL CHECK (status IN ('expert','master','seller','needs_review')),
    source_file text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (status_month,employee_id)
  )`);
  await client.query("ALTER TABLE public.employee_status_snapshots ENABLE ROW LEVEL SECURITY");
}

export async function importEmployeeStatuses({ pool, localPath, file, sha256 }) {
  const digest = sha256 ?? crypto.createHash("sha256").update(await fs.readFile(localPath)).digest("hex");
  const parsed = await parseEmployeeStatusesWorkbook(localPath, file.fileName, file.messageDate);
  const client = await pool.connect();
  let importId;
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    await ensureStatusTable(client);
    const previous = await client.query("SELECT id,status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (previous.rows[0]?.status === "completed") {
      await client.query("ROLLBACK");
      return { duplicate:true, importId:previous.rows[0].id, month:parsed.monthStart, records:parsed.records.length };
    }

    const history = await client.query(`INSERT INTO telegram_imports
      (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
      VALUES($1,$2,$3,'EmployeeStatuses','monthly',$4,$4,$5,$6,$7,'processing')
      ON CONFLICT(sha256) DO UPDATE SET status='processing',error_message=NULL,completed_at=NULL,
        telegram_message_id=EXCLUDED.telegram_message_id RETURNING id`,
    [digest,file.fileUniqueId,file.fileName,parsed.monthStart,parsed.records.length,file.channelId,file.messageId]);
    importId = history.rows[0].id;

    const employees = (await client.query(`SELECT e.id,e.full_name,e.normalized_name,
      string_agg(a.normalized_alias,' | ') aliases FROM employees e
      LEFT JOIN employee_aliases a ON a.employee_id=e.id GROUP BY e.id`)).rows;
    const resolved = parsed.records.map((record) => ({
      ...record,
      sourceEmployee: record.employee,
      employee: uniqueEmployee(employees, record.employee),
    }));
    const unknown = resolved.filter((row) => !row.employee).map((row) => row.sourceEmployee);
    if (unknown.length) {
      throw new Error(`Таблиця статусів: не знайдено однозначно в БД: ${unknown.join(", ")}`);
    }

    await client.query("DELETE FROM employee_status_snapshots WHERE status_month=$1::date", [parsed.monthStart]);
    for (const row of resolved) {
      await client.query(`INSERT INTO employee_status_snapshots(status_month,employee_id,status,source_file)
        VALUES($1,$2,$3,$4)`, [parsed.monthStart,row.employee.id,row.status,file.fileName]);
    }
    await client.query("UPDATE telegram_imports SET status='completed',completed_at=now() WHERE id=$1", [importId]);
    await client.query("COMMIT");
    return {
      duplicate:false, importId, month:parsed.monthStart, records:resolved.length,
      masters:resolved.filter((x)=>x.status==="master").length,
      experts:resolved.filter((x)=>x.status==="expert").length,
      warnings:parsed.warnings,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordImportFailure(client,{digest,file,fileType:"EmployeeStatuses",importMode:"monthly",dateFrom:parsed.monthStart,dateTo:parsed.monthStart,rowCount:parsed.records.length,error}).catch(()=>{});
    throw error;
  } finally { client.release(); }
}
