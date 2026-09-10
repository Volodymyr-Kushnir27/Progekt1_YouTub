import crypto from "node:crypto";
import fs from "node:fs/promises";
import { ensureHistoryTable, ensureEmployees, loadRefs, recordImportFailure } from "./import-telegram-ml.js";
import { parseEmployeePerformanceWorkbook } from "./parse-employee-performance.js";
import { ensureMonthStatusTable, markMonthStatus } from "./month-status.js";

const norm = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

export async function importEmployeePerformance({ pool, localPath, file, sha256 }) {
  const bytes = await fs.readFile(localPath);
  const digest = sha256 ?? crypto.createHash("sha256").update(bytes).digest("hex");
  const parsed = parseEmployeePerformanceWorkbook(localPath, file.fileName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    await ensureMonthStatusTable(client);
    const duplicate = await client.query("SELECT id,status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (duplicate.rowCount && duplicate.rows[0].status === "completed") {
      await client.query("ROLLBACK");
      return { duplicate: true, importId: duplicate.rows[0].id, ...parsed, records: parsed.records.length };
    }
    const employeesCreated = await ensureEmployees(client, parsed.records);
    const refs = await loadRefs(client);
    const history = await client.query(`INSERT INTO telegram_imports
      (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
      VALUES ($1,$2,$3,'EmployeePerformance','monthly',$4,$5,$6,$7,$8,'processing')
      ON CONFLICT (sha256) DO UPDATE SET status='processing',error_message=NULL,completed_at=NULL
      RETURNING id`, [digest,file.fileUniqueId,file.fileName,parsed.dateFrom,parsed.dateTo,parsed.records.length,file.channelId,file.messageId]);
    await client.query("DELETE FROM employee_monthly_performance WHERE performance_month=$1::date", [parsed.monthStart]);
    for (const source of parsed.records) {
      const employee = refs.employeeMap.get(norm(source.employee));
      if (!employee) throw new Error(`Місячний звіт: невідомий працівник «${source.employee}»`);
      let salesMl = source.salesMl;
      if (salesMl == null) {
        const daily = await client.query(`SELECT SUM(point_sales_ml) sales_ml FROM payroll_daily
          WHERE employee_id=$1 AND payroll_date >= $2::date AND payroll_date <= $3::date`,
        [employee.id,parsed.dateFrom,parsed.dateTo]);
        salesMl = daily.rows[0]?.sales_ml == null ? null : Number(daily.rows[0].sales_ml);
      }
      const planMl = salesMl != null && source.completionPercent > 0 ? salesMl * 100 / source.completionPercent : source.planMl;
      await client.query(`INSERT INTO employee_monthly_performance
        (performance_month,employee_id,department_id,reported_shifts,plan_ml,sales_ml,completion_percent,is_final,source_file,source_row)
        VALUES ($1,$2,NULL,$3,$4,$5,$6,true,$7,$8)`,
      [parsed.monthStart,employee.id,source.reportedShifts,planMl,salesMl,source.completionPercent,file.fileName,String(source.sourceRow)]);
    }
    await markMonthStatus(client, { month: parsed.monthStart, datasets: ["employee_performance"], status: "final", sourceFile: file.fileName });
    await client.query("UPDATE telegram_imports SET status='completed',completed_at=now() WHERE id=$1", [history.rows[0].id]);
    await client.query("COMMIT");
    return { duplicate:false,importId:history.rows[0].id,month:parsed.monthStart,records:parsed.records.length,employeesCreated };
  } catch (error) {
    await client.query("ROLLBACK");
    await recordImportFailure(client,{digest,file,fileType:"EmployeePerformance",importMode:"monthly",dateFrom:parsed.dateFrom,dateTo:parsed.dateTo,rowCount:parsed.records.length,error}).catch(()=>{});
    throw error;
  } finally { client.release(); }
}
