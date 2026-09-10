import express from "express";
import "dotenv/config";
import { pool } from "./db.js";
import { createTelegramWebhookRouter } from "./telegram/webhook.js";
import { downloadTelegramFile } from "./telegram/download-file.js";
import { classifyWorkbook } from "./telegram/classify-workbook.js";
import { importTelegramMl } from "./importers/import-telegram-ml.js";
import { importTelegramPlan } from "./importers/import-telegram-plan.js";
import { importTelegramPayroll } from "./importers/import-telegram-payroll.js";
import { importEmployeePerformance } from "./importers/import-employee-performance.js";
import { importTelegramAdminActions } from "./importers/import-telegram-admin-actions.js";
import { importEmployeeStatuses } from "./importers/import-employee-statuses.js";
import { detectFileType } from "./telegram/classify-workbook.js";
import { sendTelegramMessage } from "./telegram/send-message.js";
import fs from "node:fs/promises";

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiKey = process.env.ACTION_API_KEY;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.use(
  "/telegram/webhook",
  createTelegramWebhookRouter({
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    onDocument: async (file) => {
      const downloaded = await downloadTelegramFile({
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        fileId: file.fileId,
        fileName: file.fileName,
        fileSize: file.fileSize,
      });

      console.log("Telegram: Excel-файл завантажено", {
        fileName: file.fileName,
        size: downloaded.size,
        localPath: downloaded.localPath,
      });

      try {
        const fileType = detectFileType(file.fileName);
        if (fileType === "AdminActions") {
          const result = await importTelegramAdminActions({ pool, localPath: downloaded.localPath, file });
          await sendTelegramMessage({ botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: file.channelId,
            text: result.duplicate ? `ℹ️ ${file.fileName} вже імпортовано раніше.`
              : `✅ ${file.fileName} імпортовано як адмін-таблицю\nМісяць: ${result.reportMonth}\nРегіон: ${result.region}\nОб'єктів контролю: ${result.records}\nЗаповнених тижневих звітів: ${result.completedUpdates}` });
        } else if (fileType === "EmployeeStatuses") {
          const result = await importEmployeeStatuses({ pool, localPath: downloaded.localPath, file });
          await sendTelegramMessage({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: file.channelId,
            text: result.duplicate
              ? `ℹ️ ${file.fileName} вже імпортовано раніше.`
              : `✅ ${file.fileName} імпортовано як статуси працівників\nМісяць: ${result.month}\nМайстрів: ${result.masters}\nЕкспертів: ${result.experts}${result.warnings?.length ? `\n⚠️ ${result.warnings.join("; ")}` : ""}`,
          });
        } else if (fileType === "ML") {
          const result = await importTelegramMl({ pool, localPath: downloaded.localPath, file });
          console.log("Telegram: ML імпортовано", { fileName: file.fileName, ...result });
          const months = Object.entries(result.modes).map(([month, mode]) => `${month}: ${mode}`).join(", ");
          const createdEmployees = result.employeesCreated?.length
            ? `\nНові працівники: ${result.employeesCreated.join(", ")}`
            : "";
          const createdDepartments = result.departmentsCreated?.length
            ? `\nНові відділи: ${result.departmentsCreated.join(", ")}`
            : "";
          const createdRegions = result.regionsCreated?.length
            ? `\nНові регіони: ${result.regionsCreated.join(", ")}`
            : "";
          await sendTelegramMessage({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: file.channelId,
            text: result.duplicate
              ? `ℹ️ ${file.fileName} вже імпортовано раніше (SHA-256 збігається).`
              : `✅ ${file.fileName} ${result.reprocessed ? "повторно оброблено та повністю замінено" : "імпортовано"}\nПеріод заміни: ${result.dateFrom}–${result.dateTo}\nРядків: ${result.records}\n${months}${createdRegions}${createdDepartments}${createdEmployees}`,
          });
        } else if (fileType === "PlanBNAC" || fileType === "PlanMin") {
          const result = await importTelegramPlan({ pool, localPath: downloaded.localPath, file, fileType });
          console.log("Telegram: план імпортовано", { fileName: file.fileName, fileType, ...result });
          const createdDepartments = result.departmentsCreated?.length
            ? `\nНові відділи: ${result.departmentsCreated.join(", ")}` : "";
          const createdRegions = result.regionsCreated?.length
            ? `\nНові регіони: ${result.regionsCreated.join(", ")}` : "";
          const skipped = result.skipped?.length
            ? `\nБез установленого плану пропущено: ${result.skipped.length}` : "";
          await sendTelegramMessage({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: file.channelId,
            text: result.duplicate
              ? `ℹ️ ${file.fileName} вже імпортовано раніше (SHA-256 збігається).`
              : `✅ ${file.fileName} імпортовано\nТип: ${result.planType}\nМісяць плану: ${result.planMonth}\nФакт: ${result.dateFrom}–${result.dateTo}\nРядків плану: ${result.records}${skipped}${createdRegions}${createdDepartments}`,
          });
        } else if (fileType === "EmployeePerformance") {
          const result = await importEmployeePerformance({ pool, localPath: downloaded.localPath, file });
          await sendTelegramMessage({ botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: file.channelId,
            text: result.duplicate ? `ℹ️ ${file.fileName} вже імпортовано раніше.`
              : `✅ ${file.fileName} імпортовано як офіційний місячний звіт\nМісяць: ${result.month}\nПрацівників: ${result.records}` });
        } else if (fileType === "Payroll") {
          const result = await importTelegramPayroll({ pool, localPath: downloaded.localPath, file });
          console.log("Telegram: ЗП імпортовано", { fileName: file.fileName, ...result });
          const createdEmployees = result.employeesCreated?.length
            ? `\nНові працівники: ${result.employeesCreated.join(", ")}` : "";
          await sendTelegramMessage({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: file.channelId,
            text: result.duplicate
              ? `ℹ️ ${file.fileName} вже імпортовано раніше (SHA-256 збігається).`
              : `✅ ${file.fileName} імпортовано\nПеріод: ${result.dateFrom}–${result.dateTo}\nДенних записів ЗП: ${result.records}\nПрацівників: ${result.employees}\nВідділів: ${result.departments}${createdEmployees}`,
          });
        } else {
          const classification = await classifyWorkbook({ localPath: downloaded.localPath, fileName: file.fileName });
          console.log("Telegram: Excel-файл класифіковано", { fileName: file.fileName, ...classification });
          await sendTelegramMessage({ botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: file.channelId,
            text: `ℹ️ ${file.fileName} розпізнано як ${classification.fileType}. Автоімпорт цього типу буде додано наступним етапом.` });
        }
      } catch (error) {
        await sendTelegramMessage({
          botToken: process.env.TELEGRAM_BOT_TOKEN,
          chatId: file.channelId,
          text: `❌ ${file.fileName} не імпортовано\n${error.message}`,
        }).catch((sendError) => console.error("Telegram: не вдалося надіслати помилку", sendError.message));
        throw error;
      } finally {
        await fs.rm(downloaded.localPath, { force: true });
      }
    },
  }),
);

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function requireApiKey(req, res, next) {
  if (!apiKey) {
    return res
      .status(503)
      .json({ status: "error", message: "ACTION_API_KEY не налаштовано" });
  }

  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== apiKey) {
    return res
      .status(401)
      .json({ status: "error", message: "Невірний або відсутній API key" });
  }

  next();
}

function dateParam(value, name) {
  if (value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${name} має бути у форматі YYYY-MM-DD`);
    error.status = 400;
    throw error;
  }
  return value;
}

function requiredDateParam(value, name) {
  const parsed = dateParam(value, name);
  if (!parsed) {
    const error = new Error(`${name} є обов'язковим параметром`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function boundedInt(value, fallback, min, max, name = "limit") {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error(
      `${name} має бути цілим числом від ${min} до ${max}`,
    );
    error.status = 400;
    throw error;
  }
  return parsed;
}

function addFilter(filters, values, sql, value) {
  if (value === undefined || value === null || value === "") return;
  values.push(value);
  filters.push(sql.replace("?", `$${values.length}`));
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Perfums Analytics API працює",
    version: "2.0.0",
  });
});

app.get(
  "/api/health",
  asyncRoute(async (req, res) => {
    const result = await pool.query("SELECT NOW() AS db_time");
    res.json({
      status: "ok",
      database: "connected",
      db_time: result.rows[0].db_time,
    });
  }),
);

app.use("/api", requireApiKey);

app.get(
  "/api/meta",
  asyncRoute(async (req, res) => {
    const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM regions) AS regions,
      (SELECT COUNT(*)::int FROM departments) AS departments,
      (SELECT COUNT(*)::int FROM employees) AS employees,
      (SELECT COUNT(*)::int FROM department_daily_sales) AS sales_rows,
      (SELECT COUNT(*)::int FROM employee_shifts) AS shift_rows,
      (SELECT COUNT(*)::int FROM payroll_daily) AS payroll_rows,
      (SELECT COUNT(*)::int FROM department_plan_snapshots) AS plan_rows,
      (SELECT COUNT(*)::int FROM employee_monthly_performance) AS monthly_performance_rows,
      (SELECT MIN(sale_date) FROM department_daily_sales) AS first_sale_date,
      (SELECT MAX(sale_date) FROM department_daily_sales) AS last_sale_date,
      (SELECT MAX(snapshot_date) FROM department_plan_snapshots) AS last_plan_snapshot_date,
      (SELECT MAX(performance_month) FROM employee_monthly_performance) AS last_performance_month,
      (SELECT jsonb_object_agg(month_key, mode) FROM (
        SELECT to_char(month_start, 'YYYY-MM') AS month_key,
               CASE WHEN bool_or(import_mode='monthly') THEN 'final' ELSE 'weekly' END AS mode
        FROM telegram_imports t
        CROSS JOIN LATERAL generate_series(date_trunc('month', t.date_from), date_trunc('month', t.date_to), interval '1 month') month_start
        WHERE status='completed' AND date_from IS NOT NULL AND date_to IS NOT NULL
        GROUP BY month_start
      ) months) AS months
  `);
    res.json({ status: "ok", data: result.rows[0] });
  }),
);

app.get(
  "/api/departments",
  asyncRoute(async (req, res) => {
    const values = [];
    const filters = ["d.is_active = true"];
    addFilter(
      filters,
      values,
      "r.name ILIKE '%' || ? || '%'",
      req.query.region,
    );
    addFilter(filters, values, "d.name ILIKE '%' || ? || '%'", req.query.q);

    const result = await pool.query(
      `
    SELECT d.id, d.name AS department, r.name AS region
    FROM departments d
    JOIN regions r ON r.id = d.region_id
    WHERE ${filters.join(" AND ")}
    ORDER BY r.name, d.name
  `,
      values,
    );
    res.json({ status: "ok", count: result.rowCount, data: result.rows });
  }),
);

app.get(
  "/api/employees",
  asyncRoute(async (req, res) => {
    const limit = boundedInt(req.query.limit, 100, 1, 200);
    const values = [];
    const filters = ["e.include_in_seller_analysis = true"];
    addFilter(
      filters,
      values,
      `translate(lower(e.full_name), 'іїєґыэъё', 'ииегиеье')
    ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`,
      req.query.q,
    );
    addFilter(filters, values, "e.employment_status = ?", req.query.status);
    values.push(limit);

    const result = await pool.query(
      `
    SELECT e.id, e.full_name, e.role, e.employment_status
    FROM employees e
    WHERE ${filters.join(" AND ")}
    ORDER BY e.full_name
    LIMIT $${values.length}
  `,
      values,
    );
    res.json({ status: "ok", count: result.rowCount, data: result.rows });
  }),
);

app.get(
  "/api/sales/daily",
  asyncRoute(async (req, res) => {
    const from = dateParam(req.query.from, "from");
    const to = dateParam(req.query.to, "to");
    const limit = boundedInt(req.query.limit, 400, 1, 1000);
    const values = [];
    const filters = ["1=1"];
    addFilter(filters, values, "sale_date >= ?::date", from);
    addFilter(filters, values, "sale_date <= ?::date", to);
    addFilter(
      filters,
      values,
      "department ILIKE '%' || ? || '%'",
      req.query.department,
    );
    addFilter(
      filters,
      values,
      "region ILIKE '%' || ? || '%'",
      req.query.region,
    );
    values.push(limit);

    const result = await pool.query(
      `
    SELECT sale_date, region, department, sales_ml, gifts_ml, data_status
    FROM v_department_daily_sales
    WHERE ${filters.join(" AND ")}
    ORDER BY sale_date DESC, region, department
    LIMIT $${values.length}
  `,
      values,
    );
    res.json({ status: "ok", count: result.rowCount, data: result.rows });
  }),
);

app.get(
  "/api/plans",
  asyncRoute(async (req, res) => {
    const month = dateParam(req.query.month, "month");
    const departmentId = boundedInt(
      req.query.department_id,
      null,
      1,
      2147483647,
      "department_id",
    );
    const values = [];
    const filters = ["1=1"];
    addFilter(
      filters,
      values,
      `EXISTS (
    SELECT 1
    FROM departments d
    JOIN regions r ON r.id = d.region_id
    WHERE d.id = ?
      AND d.name = v_department_plan_progress.department
      AND r.name = v_department_plan_progress.region
  )`,
      departmentId,
    );
    addFilter(
      filters,
      values,
      "plan_month = date_trunc('month', ?::date)::date",
      month,
    );
    addFilter(filters, values, "plan_type = ?", req.query.plan_type);
    addFilter(filters, values, "object_type = ?", req.query.object_type);
    addFilter(
      filters,
      values,
      "department ILIKE '%' || ? || '%'",
      req.query.department,
    );
    addFilter(
      filters,
      values,
      "region ILIKE '%' || ? || '%'",
      req.query.region,
    );

    if (req.query.latest !== "false") {
      filters.push(`snapshot_date = (
      SELECT MAX(p2.snapshot_date)
      FROM v_department_plan_progress p2
      WHERE p2.plan_month = v_department_plan_progress.plan_month
        AND p2.plan_type = v_department_plan_progress.plan_type
    )`);
    }

    const result = await pool.query(
      `
    SELECT snapshot_date, plan_month, plan_type, object_type, region, department,
           fact_period_start, fact_period_end, plan_ml, reported_actual_ml,
           completion_rate, remaining_ml, downtime_days,
           previous_period_sales_ml, change_vs_previous_rate
    FROM v_department_plan_progress
    WHERE ${filters.join(" AND ")}
    ORDER BY plan_month DESC, plan_type, completion_rate NULLS FIRST, region, department
    LIMIT 500
  `,
      values,
    );
    res.json({ status: "ok", count: result.rowCount, data: result.rows });
  }),
);

app.get(
  "/api/employees/monthly-performance",
  asyncRoute(async (req, res) => {
    const month = requiredDateParam(req.query.month, "month").slice(0, 7) + "-01";
    const limit = boundedInt(req.query.limit, 200, 1, 500);
    const values = [month];
    const filters = ["include_in_seller_analysis = true"];
    addFilter(
      filters,
      values,
      `translate(lower(full_name), 'іїєґыэъё', 'ииегиеье')
    ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`,
      req.query.employee,
    );
    addFilter(
      filters,
      values,
      "COALESCE(department, '') ILIKE '%' || ? || '%'",
      req.query.department,
    );
    addFilter(
      filters,
      values,
      "COALESCE(region, '') ILIKE '%' || ? || '%'",
      req.query.region,
    );
    values.push(limit);

    const result = await pool.query(
      `
    WITH official AS (
      SELECT e.id employee_id,e.full_name,e.include_in_seller_analysis,
        r.name region,d.name department,p.reported_shifts,p.plan_ml,p.sales_ml,
        p.completion_percent,p.is_final,p.source_file,
        0::int plan_missing_shifts,'employee_monthly_performance'::text source
      FROM employee_monthly_performance p
      JOIN employees e ON e.id=p.employee_id
      LEFT JOIN departments d ON d.id=p.department_id
      LEFT JOIN regions r ON r.id=d.region_id
      WHERE p.performance_month=$1::date
    ), interim AS (
      SELECT e.id employee_id,e.full_name,e.include_in_seller_analysis,
        r.name region,d.name department,COUNT(*)::numeric reported_shifts,
        SUM(s.shift_plan_ml) plan_ml,SUM(s.point_sales_ml) sales_ml,
        CASE WHEN COUNT(*) FILTER (WHERE s.shift_plan_ml IS NULL)>0 OR COALESCE(SUM(s.shift_plan_ml),0)=0
          THEN NULL ELSE ROUND((SUM(s.point_sales_ml)*100.0/SUM(s.shift_plan_ml))::numeric,2) END completion_percent,
        false is_final,NULL::text source_file,
        COUNT(*) FILTER (WHERE s.shift_plan_ml IS NULL)::int plan_missing_shifts,
        'employee_shifts_interim'::text source
      FROM employee_shifts s
      JOIN employees e ON e.id=s.employee_id
      JOIN departments d ON d.id=s.department_id JOIN regions r ON r.id=d.region_id
      WHERE s.shift_date >= $1::date AND s.shift_date < ($1::date + interval '1 month')
        AND NOT EXISTS (SELECT 1 FROM employee_monthly_performance f
          WHERE f.performance_month=$1::date AND f.is_final=true)
      GROUP BY e.id,e.full_name,e.include_in_seller_analysis,r.name,d.id,d.name
    ), combined AS (SELECT * FROM official UNION ALL SELECT * FROM interim)
    SELECT employee_id,full_name,region,department,reported_shifts,plan_ml,sales_ml,
      completion_percent,is_final,source_file,plan_missing_shifts,source
    FROM combined
    WHERE ${filters.join(" AND ")}
    ORDER BY completion_percent ASC NULLS FIRST, sales_ml ASC
    LIMIT $${values.length}
  `,
      values,
    );
    const isFinal = result.rowCount > 0 && result.rows.every((x) => x.is_final);
    res.json({ status: "ok", count: result.rowCount, period: { month, is_final: isFinal },
      source: isFinal ? "employee_monthly_performance" : "employee_shifts_interim", data: result.rows });
  }),
);

// Backward-compatible alias. It intentionally uses the official monthly table.
app.get("/api/employees/performance", (req, res) => {
  const month = req.query.month || req.query.from;
  const query = new URLSearchParams({ ...req.query, ...(month ? { month } : {}) });
  query.delete("from"); query.delete("to");
  res.redirect(307, `/api/employees/monthly-performance?${query}`);
});

app.get(
  "/api/employees/payroll",
  asyncRoute(async (req, res) => {
    const from = requiredDateParam(req.query.from, "from");
    const to = requiredDateParam(req.query.to, "to");
    if (from > to) {
      const error = new Error("from не може бути пізніше за to");
      error.status = 400;
      throw error;
    }
    const limit = boundedInt(req.query.limit, 200, 1, 500);

    const values = [];
    const filters = ["e.include_in_seller_analysis = true"];

    addFilter(filters, values, "p.payroll_date >= ?::date", from);
    addFilter(filters, values, "p.payroll_date <= ?::date", to);
    addFilter(
      filters,
      values,
      `translate(lower(e.full_name), 'іїєґыэъё', 'ииегиеье')
    ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`,
      req.query.employee,
    );
    addFilter(
      filters,
      values,
      "d.name ILIKE '%' || ? || '%'",
      req.query.department,
    );
    addFilter(
      filters,
      values,
      "r.name ILIKE '%' || ? || '%'",
      req.query.region,
    );

    values.push(limit);

    const result = await pool.query(
      `
    SELECT
      e.id AS employee_id,
      e.full_name,
      r.name AS region,
      d.name AS department,

      COUNT(DISTINCT p.payroll_date)::int AS worked_days,

      COALESCE(SUM(p.shift_plan_ml), 0) AS plan_ml,
      COALESCE(SUM(p.point_sales_ml), 0) AS sales_ml,
      CASE WHEN COALESCE(SUM(p.shift_plan_ml), 0) = 0 THEN NULL
           ELSE ROUND((SUM(p.point_sales_ml) * 100.0 / SUM(p.shift_plan_ml))::numeric, 2)
      END AS completion_percent,

      ROUND(COALESCE(SUM(p.revenue_uah), 0)::numeric, 2) AS revenue_uah,
      ROUND(COALESCE(SUM(p.base_salary_uah), 0)::numeric, 2) AS base_salary_uah,
      ROUND(COALESCE(SUM(p.commission_uah), 0)::numeric, 2) AS commission_uah,
      ROUND(COALESCE(SUM(p.ml_bonus_uah), 0)::numeric, 2) AS ml_bonus_uah,
      ROUND(COALESCE(SUM(p.extra_bonus_uah), 0)::numeric, 2) AS extra_bonus_uah,
      ROUND(COALESCE(SUM(p.salary_total_uah), 0)::numeric, 2) AS salary_total_uah,

      MIN(p.payroll_date) AS period_start,
      MAX(p.payroll_date) AS period_end,
      'payroll_daily'::text AS source

    FROM payroll_daily p
    JOIN employees e ON e.id = p.employee_id
    JOIN departments d ON d.id = p.department_id
    JOIN regions r ON r.id = d.region_id

    WHERE ${filters.join(" AND ")}

    GROUP BY
      e.id,
      e.full_name,
      r.name,
      d.id,
      d.name

    ORDER BY
      salary_total_uah DESC,
      e.full_name,
      d.name

    LIMIT $${values.length}
  `,
      values,
    );

    res.json({
      status: "ok",
      count: result.rowCount,
      period: {
        from,
        to,
      },
      data: result.rows,
    });
  }),
);

app.get(
  "/api/employees/payroll/daily",
  asyncRoute(async (req, res) => {
    const from = requiredDateParam(req.query.from, "from");
    const to = requiredDateParam(req.query.to, "to");
    if (from > to) { const error = new Error("from не може бути пізніше за to"); error.status = 400; throw error; }
    const limit = boundedInt(req.query.limit, 400, 1, 1000);
    const values = [];
    const filters = ["e.include_in_seller_analysis = true"];
    addFilter(filters, values, "x.work_date >= ?::date", from);
    addFilter(filters, values, "x.work_date <= ?::date", to);
    addFilter(filters, values, `translate(lower(e.full_name), 'іїєґыэъё', 'ииегиеье') ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`, req.query.employee);
    addFilter(filters, values, "d.name ILIKE '%' || ? || '%'", req.query.department);
    addFilter(filters, values, "r.name ILIKE '%' || ? || '%'", req.query.region);
    values.push(limit);
    const result = await pool.query(`WITH daily AS (
      SELECT p.payroll_date work_date,p.employee_id,p.department_id,p.revenue_uah,p.salary_total_uah,
        p.base_salary_uah,p.commission_rate,p.commission_uah,p.shift_plan_ml,p.point_sales_ml,
        p.ml_bonus_uah,p.extra_bonus_uah,p.days_count,'payroll_daily'::text source
      FROM payroll_daily p
      UNION ALL
      SELECT s.shift_date,s.employee_id,s.department_id,NULL::numeric,NULL::numeric,
        NULL::numeric,NULL::numeric,NULL::numeric,s.shift_plan_ml,s.point_sales_ml,
        NULL::numeric,NULL::numeric,1::numeric,'employee_shifts_interim'::text
      FROM employee_shifts s
      WHERE NOT EXISTS (SELECT 1 FROM payroll_daily p
        WHERE p.payroll_date=s.shift_date AND p.employee_id=s.employee_id AND p.department_id=s.department_id)
    )
    SELECT x.work_date payroll_date,e.id employee_id,e.full_name,r.name region,d.name department,
      x.revenue_uah,x.salary_total_uah,x.base_salary_uah,x.commission_rate,x.commission_uah,
      x.shift_plan_ml,x.point_sales_ml,
      CASE WHEN x.shift_plan_ml IS NULL OR x.shift_plan_ml=0 THEN NULL
           ELSE ROUND((x.point_sales_ml*100.0/x.shift_plan_ml)::numeric,2) END completion_percent,
      x.ml_bonus_uah,x.extra_bonus_uah,x.days_count,x.source
    FROM daily x JOIN employees e ON e.id=x.employee_id
    JOIN departments d ON d.id=x.department_id JOIN regions r ON r.id=d.region_id
    WHERE ${filters.join(" AND ")} ORDER BY x.work_date,e.full_name,d.name LIMIT $${values.length}`, values);
    const sources = [...new Set(result.rows.map((row) => row.source))];
    res.json({ status: "ok", count: result.rowCount, period: { from, to },
      source: sources.length === 1 ? sources[0] : "payroll_daily+employee_shifts_interim", data: result.rows });
  }),
);

app.get(
  "/api/employees/statuses",
  asyncRoute(async (req, res) => {
    const month = requiredDateParam(req.query.month, "month").slice(0, 7) + "-01";
    const values = [month];
    const filters = ["s.status_month=$1::date"];
    addFilter(filters, values, "s.status=?", req.query.status);
    addFilter(filters, values, `translate(lower(e.full_name), 'іїєґыэъё', 'ииегиеье') ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`, req.query.employee);
    const result = await pool.query(`SELECT s.status_month,e.id employee_id,e.full_name,s.status,s.source_file
      FROM employee_status_snapshots s JOIN employees e ON e.id=s.employee_id
      WHERE ${filters.join(" AND ")} ORDER BY s.status,e.full_name`, values);
    res.json({ status: "ok", count: result.rowCount, period: { month }, source: "employee_status_snapshots", data: result.rows });
  }),
);

app.get(
  "/api/admin/actions",
  asyncRoute(async (req, res) => {
    const month = requiredDateParam(req.query.month, "month").slice(0, 7) + "-01";
    const asOf = req.query.as_of ? requiredDateParam(req.query.as_of, "as_of") : new Date().toISOString().slice(0,10);
    const values = [month];
    const filters = ["a.report_month=$1::date"];
    addFilter(filters, values, `translate(lower(r.name), 'іїєґыэъё', 'ииегиеье') ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`, req.query.region);
    const result = await pool.query(`SELECT a.id,a.report_month,a.subject_type,a.action_category,
      COALESCE(e.full_name,a.source_subject_text) subject,r.name region,
      COALESCE(d.name,a.source_department_text) department,a.status_text,a.target_text,a.initial_action_plan,a.source_file,
      COALESCE((SELECT json_agg(json_build_object('week_start',w.week_start,'week_end',w.week_end,
        'completed_text',w.completed_text) ORDER BY w.week_start) FROM admin_action_weekly_updates w WHERE w.action_item_id=a.id),'[]') weekly_updates
      ,a.employee_id FROM admin_action_items a LEFT JOIN employees e ON e.id=a.employee_id
      LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN regions r ON r.id=a.region_id
      WHERE ${filters.join(" AND ")} ORDER BY a.action_category,subject`, values);
    const contextValues = [month];
    const contextFilters = ["m.report_month=$1::date"];
    addFilter(contextFilters, contextValues, `translate(lower(r.name), 'іїєґыэъё', 'ииегиеье') ILIKE '%' || translate(lower(?), 'іїєґыэъё', 'ииегиеье') || '%'`, req.query.region);
    const context = await pool.query(`SELECT m.report_month,r.name region,m.previous_year_result_text,m.region_goal_text,m.source_file
      FROM admin_monthly_context m JOIN regions r ON r.id=m.region_id
      WHERE ${contextFilters.join(" AND ")} ORDER BY r.name LIMIT 1`,contextValues);
    const data = await Promise.all(result.rows.map(async (row) => {
      const metric = row.subject_type === "employee"
        ? await pool.query(`WITH b AS (SELECT LEAST($3::date,COALESCE(max(shift_date),$1::date)) as last_date FROM employee_shifts WHERE employee_id=$2 AND shift_date >= $1::date),
          x AS (SELECT b.last_date,count(s.*) shifts_count,sum(s.point_sales_ml) sales_ml,sum(s.shift_plan_ml) plan_ml,
            sum(s.point_sales_ml) FILTER(WHERE s.shift_date>=b.last_date-6) recent_sales_ml,
            sum(s.shift_plan_ml) FILTER(WHERE s.shift_date>=b.last_date-6) recent_plan_ml,
            count(s.*) FILTER(WHERE s.shift_plan_ml IS NULL) missing_plan_shifts
            FROM b LEFT JOIN employee_shifts s ON s.employee_id=$2 AND s.shift_date BETWEEN $1::date AND b.last_date GROUP BY b.last_date)
          SELECT *,CASE WHEN plan_ml>0 AND missing_plan_shifts=0 THEN round(sales_ml*100/plan_ml,2) END actual_result_percent,
            CASE WHEN plan_ml>0 AND missing_plan_shifts=0 THEN round((sales_ml*100/plan_ml)*.4 + COALESCE(recent_sales_ml*100/nullif(recent_plan_ml,0),sales_ml*100/plan_ml)*.6,2) END expected_result_percent
          FROM x`,[month,row.employee_id,asOf])
        : await pool.query(`WITH ids AS (SELECT department_id FROM admin_action_item_departments WHERE action_item_id=$2 UNION SELECT department_id FROM admin_action_items WHERE id=$2 AND department_id IS NOT NULL),
          b AS (SELECT LEAST($3::date,COALESCE(max(sale_date),$1::date)) last_date FROM department_daily_sales WHERE department_id IN(SELECT department_id FROM ids) AND sale_date >= $1::date)
          SELECT b.last_date,COALESCE(sum(s.sales_ml),0) sales_ml,
            round(COALESCE(sum(s.sales_ml),0)/GREATEST(1,extract(day from b.last_date))*
              extract(day from (date_trunc('month',$1::date)+interval '1 month'-interval '1 day')),2) expected_sales_ml
          FROM b LEFT JOIN department_daily_sales s ON s.department_id IN(SELECT department_id FROM ids) AND s.sale_date BETWEEN $1::date AND b.last_date GROUP BY b.last_date`,[month,row.id,asOf]);
      const facts = metric.rows[0] ?? {};
      const liters = Number(String(row.target_text ?? "").replace(",",".").match(/(\d+(?:\.\d+)?)\s*(?:л(?:і|и)тр|л\b)/iu)?.[1]);
      if (row.subject_type === "department" && liters > 0) {
        facts.actual_result_percent = Math.round(Number(facts.sales_ml)*10000/(liters*1000))/100;
        facts.expected_result_percent = Math.round(Number(facts.expected_sales_ml)*10000/(liters*1000))/100;
      } else if (row.subject_type === "department" && /мінімум|минимум/iu.test(row.target_text ?? "")) {
        const plan = await pool.query(`SELECT snapshot_date,fact_period_end,plan_ml,reported_actual_ml,completion_rate
          FROM v_department_plan_progress WHERE plan_month=$1::date AND plan_type='minimum'
          AND department ILIKE '%'||$2||'%' AND fact_period_end<=$3::date ORDER BY snapshot_date DESC LIMIT 1`,
          [month,row.department,asOf]);
        if (plan.rows[0]) {
          Object.assign(facts,{ minimum_plan:plan.rows[0] });
          facts.last_date=plan.rows[0].fact_period_end;
          facts.actual_result_percent=Math.round(Number(plan.rows[0].completion_rate)*10000)/100;
          const elapsed=Number(String(plan.rows[0].fact_period_end).slice(8,10));
          const monthDays=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
          facts.expected_result_percent=Math.round(Number(plan.rows[0].completion_rate)*100*monthDays/elapsed*100)/100;
        }
      }
      const { employee_id, ...publicRow } = row;
      return { ...publicRow, analysis_as_of:facts.last_date, actual_result: facts.actual_result_percent ?? null,
        expected_result: facts.expected_result_percent ?? null, facts,
        forecast_method: row.subject_type === "employee" ? "40% результат місяця + 60% останні 7 днів" : "календарна проєкція поточного темпу" };
    }));
    res.json({ status: "ok", count: data.length, period: { month, as_of:asOf },
      source: "admin_actions+sales_database", context:context.rows[0] ?? null, data });
  }),
);

app.get(
  "/api/admin/actions/weekly",
  asyncRoute(async (req, res) => {
    const from = requiredDateParam(req.query.from, "from");
    const to = requiredDateParam(req.query.to, "to");
    const result = await pool.query(`SELECT w.week_start,w.week_end,w.action_item_id,a.report_month,a.action_category,a.subject_type,
      COALESCE(e.full_name,a.source_subject_text) subject,a.target_text,a.initial_action_plan,w.completed_text
      FROM admin_action_weekly_updates w JOIN admin_action_items a ON a.id=w.action_item_id
      LEFT JOIN employees e ON e.id=a.employee_id
      WHERE w.week_start BETWEEN $1::date AND $2::date ORDER BY w.week_start,w.action_item_id`, [from,to]);
    res.json({ status: "ok", count: result.rowCount, period: { from,to }, source: "admin_action_weekly_updates_manual", data: result.rows });
  }),
);

app.use((error, req, res, next) => {
  console.error("API error:", error.message);
  res.status(error.status || 500).json({
    status: "error",
    message: error.status ? error.message : "Внутрішня помилка API",
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API запущено: http://localhost:${port}`);
});

server.on("error", (error) => console.error("Помилка запуску API:", error));
