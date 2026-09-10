import fs from 'node:fs';
import path from 'node:path';
import { parseEmployeePerformanceWorkbook } from '../src/importers/parse-employee-performance.js';
import { parse1cPlanWorkbook } from '../src/importers/parse-1c-plan.js';
import { parse1cMlWorkbook } from '../src/importers/parse-1c-ml.js';

const upload = path.resolve('../../upload');
const out = path.resolve('tmp/backfill-sql');
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(out)) fs.unlinkSync(path.join(out, name));
const q = (v) => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
const n = (v) => v == null || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v));

const performanceFiles = [
  'Процент_выполнения_плана_по_сотрудникам_апрель_2026(3).xlsx',
  'Процент_выполнения_плана_по_сотрудникам_май_2026(3).xlsx',
  'Выполнение_плана_сотрудниками_июнь(3).xlsx',
];
const performance = performanceFiles.flatMap((file) => {
  const p = parseEmployeePerformanceWorkbook(path.join(upload, file), file);
  return p.records.map((r) => ({...r, monthStart:p.monthStart, dateFrom:p.dateFrom, dateTo:p.dateTo}));
});

const planFiles = [
  ['План_БНАЦ_апрель_2026(3).xlsx','PlanBNAC'], ['План_минимум_апрель_2026(3).xlsx','PlanMin'],
  ['План_БНАЦ_май_2026(3).xlsx','PlanBNAC'], ['План_минимум_май_2026(3).xlsx','PlanMin'],
  ['План_БНАЦ (июнь)(3).xlsx','PlanBNAC'], ['План_минимум_продаж(июнь) (3).xlsx','PlanMin'],
  ['PlanBNAC(4).xlsx','PlanBNAC'], ['PlanMin(4).xlsx','PlanMin'],
  ['PlanBNAC (2).xlsx','PlanBNAC'], ['PlanMin (2)(1).xlsx','PlanMin'],
];
const plans = planFiles.flatMap(([file,fileType]) => parse1cPlanWorkbook(path.join(upload,file), {fileType,sourceFile:file,referenceDate:'2026-08-13T00:00:00Z'}).records);

const oldMl = parse1cMlWorkbook(path.join(upload,'ML (1)(3).xlsx'),'ML (1)(3).xlsx');
const newMl = parse1cMlWorkbook(path.join(upload,'ML(5).xlsx'),'ML(5).xlsx');
const mlMap = new Map();
for (const r of [...oldMl,...newMl]) {
  const key=[r.date,r.region,r.department,r.employee].join('|');
  const prior=mlMap.get(key);
  mlMap.set(key,{...prior,...r,planMl:r.planMl ?? prior?.planMl ?? null});
}
const ml=[...mlMap.values()];

function writeChunks(prefix, table, columns, rows, rowSql, size=100) {
  for(let i=0;i<rows.length;i+=size){
    const values=rows.slice(i,i+size).map(rowSql).join(',\n');
    fs.writeFileSync(path.join(out,`${prefix}-${String(i/size+1).padStart(2,'0')}.sql`),`insert into ${table} (${columns}) values\n${values};\n`);
  }
}
writeChunks('performance','backfill_20260813.performance','month_start,date_from,date_to,employee,reported_shifts,sales_ml,completion_percent,plan_ml,source_file,source_row',performance,r=>`(${q(r.monthStart)},${q(r.dateFrom)},${q(r.dateTo)},${q(r.employee)},${n(r.reportedShifts)},${n(r.salesMl)},${n(r.completionPercent)},${n(r.planMl)},${q(r.sourceFile)},${n(r.sourceRow)})`);
writeChunks('plans','backfill_20260813.plans','snapshot_date,plan_month,plan_type,object_type,region,department,fact_period_start,fact_period_end,plan_ml,reported_actual_ml,downtime_days,previous_period_sales_ml,source_file,source_row',plans,r=>`(${q(r.snapshotDate)},${q(r.planMonth)},${q(r.planType)},${q(r.objectType)},${q(r.region)},${q(r.department)},${q(r.factPeriodStart)},${q(r.factPeriodEnd)},${n(r.planMl)},${n(r.reportedActualMl)},${n(r.downtimeDays)},${n(r.previousPeriodSalesMl)},${q(r.sourceFile)},${q(r.sourceRow)})`);
writeChunks('ml','backfill_20260813.ml','shift_date,region,department,employee,plan_ml,sales_ml,gifts_ml,source_file,source_row',ml,r=>`(${q(r.date)},${q(r.region)},${q(r.department)},${q(r.employee)},${n(r.planMl)},${n(r.salesMl)},${n(r.giftsMl)},${q(r.sourceFile)},${n(r.sourceRow)})`);
console.log(JSON.stringify({performance:performance.length,plans:plans.length,ml:ml.length,files:fs.readdirSync(out).length}));
