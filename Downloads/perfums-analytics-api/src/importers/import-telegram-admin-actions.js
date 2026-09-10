import crypto from "node:crypto";
import fs from "node:fs/promises";
import { ensureHistoryTable, recordImportFailure } from "./import-telegram-ml.js";
import { parseAdminActionsWorkbook } from "./parse-admin-actions.js";

const norm = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("uk-UA").replace(/[іїєґыэъё]/g, (x) => ({ і:"и", ї:"и", є:"е", ґ:"г", ы:"и", э:"е", ъ:"ь", ё:"е" }[x]))
  .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

function uniqueMatch(rows, wanted, fields) {
  const key = norm(wanted);
  const exact = rows.filter((row) => fields.some((field) => norm(row[field]) === key));
  if (exact.length === 1) return exact[0];
  const tokens = key.split(" ").filter((x) => x.length > 2);
  const fuzzy = rows.filter((row) => fields.some((field) => tokens.every((token) => norm(row[field]).includes(token))));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function references(client) {
  const regions = (await client.query("SELECT id,name,normalized_name FROM regions")).rows;
  const employees = (await client.query(`SELECT e.id,e.full_name,e.normalized_name,string_agg(a.normalized_alias,' | ') aliases
    FROM employees e LEFT JOIN employee_aliases a ON a.employee_id=e.id GROUP BY e.id`)).rows;
  const departments = (await client.query(`SELECT d.id,d.region_id,d.name,d.normalized_name,string_agg(a.normalized_alias,' | ') aliases
    FROM departments d LEFT JOIN department_aliases a ON a.department_id=d.id GROUP BY d.id`)).rows;
  return { regions, employees, departments };
}

function splitDepartments(value) { return String(value ?? "").split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean); }

export async function importTelegramAdminActions({ pool, localPath, file, sha256 }) {
  const digest = sha256 ?? crypto.createHash("sha256").update(await fs.readFile(localPath)).digest("hex");
  const parsed = await parseAdminActionsWorkbook(localPath, file.fileName, file.messageDate);
  const client = await pool.connect();
  let importId;
  try {
    await client.query("BEGIN");
    await ensureHistoryTable(client);
    const duplicate = await client.query("SELECT id,status FROM telegram_imports WHERE sha256=$1", [digest]);
    if (duplicate.rows[0]?.status === "completed") { await client.query("ROLLBACK"); return { duplicate:true, importId:duplicate.rows[0].id, records:parsed.items.length, reportMonth:parsed.reportMonth }; }
    const history = await client.query(`INSERT INTO telegram_imports
      (sha256,file_unique_id,file_name,file_type,import_mode,date_from,date_to,row_count,telegram_channel_id,telegram_message_id,status)
      VALUES($1,$2,$3,'AdminActions','weekly',$4,$5,$6,$7,$8,'processing')
      ON CONFLICT(sha256) DO UPDATE SET status='processing',error_message=NULL,completed_at=NULL RETURNING id`,
      [digest,file.fileUniqueId,file.fileName,parsed.reportMonth,parsed.items[0].weeks.at(-1).weekEnd,parsed.items.length,file.channelId,file.messageId]);
    importId = history.rows[0].id;
    const batch = await client.query(`INSERT INTO import_batches
      (file_name,file_sha256,report_type,source_period_start,source_period_end,snapshot_date,status,rows_read,rows_imported,rows_rejected,notes)
      VALUES($1,$2,'admin_action_plan',$3,$4,$4,'pending',$5,0,0,'Telegram admin table import')
      ON CONFLICT(file_sha256) DO UPDATE SET file_name=EXCLUDED.file_name,status='pending',rows_read=EXCLUDED.rows_read,
        rows_imported=0,rows_rejected=0,notes=EXCLUDED.notes,imported_at=now() RETURNING id`,
      [file.fileName,digest,parsed.reportMonth,parsed.items[0].weeks.at(-1).weekEnd,parsed.items.length]);
    const batchId = batch.rows[0].id;
    const refs = await references(client);
    const region = uniqueMatch(refs.regions, parsed.region, ["name","normalized_name"]);
    if (!region) throw new Error(`Адмін-таблиця: регіон «${parsed.region}» не знайдено в БД`);
    await client.query(`INSERT INTO admin_monthly_context(report_month,region_id,previous_year_result_text,region_goal_text,source_file,source_sheet,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(report_month,region_id) DO UPDATE SET
      previous_year_result_text=EXCLUDED.previous_year_result_text,region_goal_text=EXCLUDED.region_goal_text,
      source_file=EXCLUDED.source_file,source_sheet=EXCLUDED.source_sheet,import_batch_id=EXCLUDED.import_batch_id,updated_at=now()`,
      [parsed.reportMonth,region.id,parsed.previousYearResultText,parsed.regionGoalText,parsed.sourceFile,parsed.sourceSheet,batchId]);
    let completedUpdates = 0;
    for (const item of parsed.items) {
      const existing = await client.query(`SELECT id,employee_id,department_id FROM admin_action_items
        WHERE report_month=$1 AND region_id=$2 AND action_category=$3
          AND regexp_replace(lower(trim(source_subject_text)),'\\s+',' ','g')=regexp_replace(lower(trim($4)),'\\s+',' ','g') LIMIT 1`,
        [parsed.reportMonth,region.id,item.category,item.sourceSubjectText]);
      const employee = item.subjectType === "employee" ? uniqueMatch(refs.employees,item.subject,["full_name","normalized_name","aliases"]) : null;
      const departmentNames = splitDepartments(item.departmentText);
      const matchedDepartments = departmentNames.map((name) => uniqueMatch(refs.departments.filter((x)=>String(x.region_id)===String(region.id)),name,["name","normalized_name","aliases"]));
      if (item.subjectType === "employee" && !employee && !existing.rows[0]?.employee_id) throw new Error(`Адмін-таблиця: працівника «${item.subject}» не знайдено однозначно в БД`);
      if (matchedDepartments.some((x)=>!x) && !existing.rows[0]) throw new Error(`Адмін-таблиця: не знайдено відділ із «${item.departmentText}» у регіоні ${parsed.region}`);
      const primaryDepartment = matchedDepartments.find(Boolean) ?? null;
      let actionId = existing.rows[0]?.id;
      if (actionId) {
        await client.query(`UPDATE admin_action_items SET employee_id=COALESCE($2,employee_id),department_id=COALESCE($3,department_id),
          source_department_text=$4,status_text=$5,target_text=$6,initial_action_plan=$7,source_file=$8,source_sheet=$9,source_row=$10,import_batch_id=$11,updated_at=now() WHERE id=$1`,
          [actionId,employee?.id, item.subjectType === "department" ? primaryDepartment?.id : null,item.departmentText,item.statusText,item.targetText,item.actionPlan,parsed.sourceFile,parsed.sourceSheet,item.sourceRow,batchId]);
      } else {
        const inserted = await client.query(`INSERT INTO admin_action_items(report_month,region_id,subject_type,action_category,employee_id,department_id,
          source_subject_text,source_department_text,status_text,target_text,initial_action_plan,source_file,source_sheet,source_row,import_batch_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [parsed.reportMonth,region.id,item.subjectType,item.category,employee?.id,item.subjectType === "department" ? primaryDepartment?.id : null,item.sourceSubjectText,item.departmentText,item.statusText,item.targetText,item.actionPlan,parsed.sourceFile,parsed.sourceSheet,item.sourceRow,batchId]);
        actionId=inserted.rows[0].id;
      }
      for (const department of matchedDepartments.filter(Boolean)) await client.query(`INSERT INTO admin_action_item_departments(action_item_id,department_id,is_primary)
        VALUES($1,$2,$3) ON CONFLICT(action_item_id,department_id) DO UPDATE SET is_primary=EXCLUDED.is_primary`,[actionId,department.id,department.id===primaryDepartment?.id]);
      for (const week of item.weeks) {
        await client.query(`INSERT INTO admin_action_weekly_updates(action_item_id,week_start,week_end,completed_text,actual_result_text,expected_result_text,source_file,source_sheet,source_row,import_batch_id)
          VALUES($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8) ON CONFLICT(action_item_id,week_start) DO UPDATE SET
          week_end=EXCLUDED.week_end,completed_text=COALESCE(EXCLUDED.completed_text,admin_action_weekly_updates.completed_text),
          actual_result_text=NULL,expected_result_text=NULL,source_file=EXCLUDED.source_file,source_sheet=EXCLUDED.source_sheet,source_row=EXCLUDED.source_row,import_batch_id=EXCLUDED.import_batch_id,updated_at=now()`,
          [actionId,week.weekStart,week.weekEnd,week.completedText,parsed.sourceFile,parsed.sourceSheet,item.sourceRow,batchId]);
        if (week.completedText) completedUpdates += 1;
      }
    }
    await client.query(`UPDATE import_batches SET status='imported',rows_imported=$2,notes=$3 WHERE id=$1`,
      [batchId,parsed.items.length,`Imported ${completedUpdates} completed weekly updates`]);
    await client.query("UPDATE telegram_imports SET status='completed',completed_at=now() WHERE id=$1",[importId]);
    await client.query("COMMIT");
    return { duplicate:false,importId,records:parsed.items.length,completedUpdates,reportMonth:parsed.reportMonth,region:parsed.region };
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    await recordImportFailure(client,{digest,file,fileType:"AdminActions",importMode:"weekly",dateFrom:parsed.reportMonth,dateTo:parsed.items[0]?.weeks.at(-1)?.weekEnd,rowCount:parsed.items.length,error}).catch(()=>{});
    throw error;
  } finally { client.release(); }
}
