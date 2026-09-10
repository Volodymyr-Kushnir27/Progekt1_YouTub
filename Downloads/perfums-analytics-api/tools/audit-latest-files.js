import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { parse1cMlWorkbook, summarizeMlRecords } from '../src/importers/parse-1c-ml.js';
import { parse1cPlanWorkbook } from '../src/importers/parse-1c-plan.js';

const upload = path.resolve('../../upload');
const defs = [
  ['ML(7).xlsx', 'ML'],
  ['PlanBNAC(5).xlsx', 'PlanBNAC'],
  ['PlanMin(5).xlsx', 'PlanMin'],
];
const output = {};
for (const [name, type] of defs) {
  const file = path.join(upload, name);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (type === 'ML') {
    const records = parse1cMlWorkbook(file, name);
    output[type] = { name, sha256, summary: summarizeMlRecords(records), records };
  } else {
    const parsed = parse1cPlanWorkbook(file, { fileType: type, sourceFile: name, referenceDate: '2026-08-13T00:00:00Z' });
    output[type] = { name, sha256, summary: { records: parsed.records.length, skipped: parsed.skipped.length, planPeriod: parsed.planPeriod, factPeriod: parsed.factPeriod }, records: parsed.records };
  }
}
console.log(JSON.stringify(output));

if (process.argv.includes('--sql')) {
  const sqlOut = path.resolve('tmp/latest-sql');
  fs.mkdirSync(sqlOut, { recursive: true });
  for (const name of fs.readdirSync(sqlOut)) fs.unlinkSync(path.join(sqlOut, name));
  const q = (v) => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
  const n = (v) => v == null || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v));
  const chunks = (prefix, table, columns, rows, mapper, size=100) => rows.forEach((_, i) => {
    if (i % size) return;
    const values = rows.slice(i, i + size).map(mapper).join(',\n');
    fs.writeFileSync(path.join(sqlOut, `${prefix}-${String(i/size+1).padStart(2,'0')}.sql`), `insert into ${table} (${columns}) values\n${values};\n`);
  });
  chunks('ml','backfill_20260813.ml','shift_date,region,department,employee,plan_ml,sales_ml,gifts_ml,source_file,source_row',output.ML.records,r=>`(${q(r.date)},${q(r.region)},${q(r.department)},${q(r.employee)},${n(r.planMl)},${n(r.salesMl)},${n(r.giftsMl)},${q(r.sourceFile)},${n(r.sourceRow)})`);
  const plans=[...output.PlanBNAC.records,...output.PlanMin.records];
  chunks('plans','backfill_20260813.plans','snapshot_date,plan_month,plan_type,object_type,region,department,fact_period_start,fact_period_end,plan_ml,reported_actual_ml,downtime_days,previous_period_sales_ml,source_file,source_row',plans,r=>`(${q(r.snapshotDate)},${q(r.planMonth)},${q(r.planType)},${q(r.objectType)},${q(r.region)},${q(r.department)},${q(r.factPeriodStart)},${q(r.factPeriodEnd)},${n(r.planMl)},${n(r.reportedActualMl)},${n(r.downtimeDays)},${n(r.previousPeriodSalesMl)},${q(r.sourceFile)},${q(r.sourceRow)})`);
}
