import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDepartmentSales,
  ensureDepartments,
  ensureEmployees,
  ensureRegions,
  replaceMlPeriod,
  upsertRows,
  validateMlSchema,
} from "../src/importers/import-telegram-ml.js";

test("creates new region, department and employee references from ML", async () => {
  const inserted = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("SELECT normalized_name, name FROM regions")) return { rows: [] };
      if (text.includes("SELECT id, name, normalized_name FROM regions")) {
        return { rows: [{ id: 3, name: "Одеса", normalized_name: "одеса" }] };
      }
      if (text.includes("SELECT region_id, name, normalized_name FROM departments")) return { rows: [] };
      if (text.includes("FROM department_aliases a")) return { rows: [] };
      if (text.includes("SELECT normalized_name, full_name FROM employees")) return { rows: [] };
      if (text.includes("SELECT normalized_alias FROM employee_aliases")) return { rows: [] };
      if (/INSERT INTO (regions|departments|employees)/.test(text)) {
        inserted.push({ text, params });
        return { rowCount: 1, rows: [{ id: inserted.length }] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const rows = [{ region: "Одеса", department: "Новий відділ", employee: "Кулеша Настя" }];

  assert.deepEqual(await ensureRegions(client, rows), ["Одеса"]);
  assert.deepEqual(await ensureDepartments(client, rows), ["Одеса → Новий відділ"]);
  assert.deepEqual(await ensureEmployees(client, rows), ["Кулеша Настя"]);
  assert.equal(inserted.length, 3);
});

const salesColumns = new Set([
  "id", "sale_date", "department_id", "sales_ml", "gifts_ml", "data_status",
  "import_batch_id", "source_row", "created_at", "updated_at",
]);

const shiftColumns = new Set([
  "id", "shift_date", "employee_id", "department_id", "shift_plan_ml",
  "point_sales_ml", "gifts_ml", "data_status", "import_batch_id", "source_row",
  "created_at", "updated_at",
]);

test("accepts the actual Supabase ML table schema", () => {
  assert.doesNotThrow(() => validateMlSchema({ salesColumns, shiftColumns }));
});

test("can replace a verified full-month ML period", async () => {
  const queries = [];
  const client = { async query(sql, params) { queries.push({ sql: String(sql), params }); return { rows: [] }; } };
  await replaceMlPeriod(client, "2026-07-27", "2026-08-02");
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /DELETE FROM employee_shifts.*BETWEEN \$1 AND \$2/s);
  assert.match(queries[1].sql, /DELETE FROM department_daily_sales.*BETWEEN \$1 AND \$2/s);
  assert.deepEqual(queries[0].params, ["2026-07-27", "2026-08-02"]);
  assert.deepEqual(queries[1].params, ["2026-07-27", "2026-08-02"]);
});

test("rejects an invalid ML replacement period", async () => {
  await assert.rejects(() => replaceMlPeriod({ query() {} }, "2026-08-02", "2026-07-27"), /Некоректний період ML/);
});

test("reports every missing required schema column before importing", () => {
  assert.throws(
    () => validateMlSchema({ salesColumns, shiftColumns: new Set(["shift_date"]) }),
    /employee_id, department_id, shift_plan_ml, point_sales_ml, gifts_ml, data_status, source_row/,
  );
});

test("aggregates department totals when several employees work on the same day", () => {
  const result = aggregateDepartmentSales([
    { date: "2026-08-01", departmentId: 7, salesMl: 100, giftsMl: 5, sourceRow: 10 },
    { date: "2026-08-01", departmentId: 7, salesMl: 250, giftsMl: 0, sourceRow: 11 },
  ]);
  assert.deepEqual(result, [{
    date: "2026-08-01", departmentId: 7, salesMl: 350, giftsMl: 5, sourceRows: [10, 11],
  }]);
});

test("ML upsert only references columns that exist in the actual schema", async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      if (String(sql).startsWith("SELECT column_name")) {
        const columns = params[0] === "department_daily_sales" ? salesColumns : shiftColumns;
        return { rows: [...columns].map((column_name) => ({ column_name })) };
      }
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    },
  };

  await upsertRows(client, [{
    date: "2026-08-01", departmentId: 7, employeeId: 9,
    planMl: 250, salesMl: 300, giftsMl: 5, sourceRow: 42,
  }]);

  assert.equal(queries.length, 2);
  const sql = queries.map((query) => query.sql).join("\n");
  for (const forbidden of [
    "plan_completion_percent", "shift_plan_completion_percent", "include_employee",
    "include_seller", "metric_type", "source_file", "source_rows", " role",
  ]) {
    assert.equal(sql.includes(forbidden), false, `SQL must not contain ${forbidden}`);
  }
  assert.match(sql, /department_daily_sales/);
  assert.match(sql, /employee_shifts/);
  assert.match(sql, /COALESCE\(EXCLUDED\.shift_plan_ml, employee_shifts\.shift_plan_ml\)/);
});
