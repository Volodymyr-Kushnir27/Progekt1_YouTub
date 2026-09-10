import "dotenv/config";
import { pool } from "../db.js";
async function main() {
  const { rows } = await pool.query(`SELECT 'department_daily_sales' dataset, COUNT(*)::int rows, MIN(sale_date)::text first_date, MAX(sale_date)::text last_date FROM department_daily_sales UNION ALL SELECT 'employee_shifts', COUNT(*)::int, MIN(shift_date)::text, MAX(shift_date)::text FROM employee_shifts UNION ALL SELECT 'payroll_daily', COUNT(*)::int, MIN(payroll_date)::text, MAX(payroll_date)::text FROM payroll_daily UNION ALL SELECT 'department_plan_snapshots', COUNT(*)::int, MIN(snapshot_date)::text, MAX(snapshot_date)::text FROM department_plan_snapshots`);
  console.table(rows); const sales = rows.find((r) => r.dataset === "department_daily_sales");
  if (!sales?.first_date || sales.first_date > "2026-04-01") throw new Error("Перша дата продажів має бути не пізніше 2026-04-01.");
  console.log("✅ Історичні дані є в PostgreSQL.");
}
main().catch((e) => { console.error("❌ Перевірка не пройдена:", e.message); process.exitCode = 1; }).finally(() => pool.end());
