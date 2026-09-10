const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");

const app = express();
app.use(cors());
app.use(bodyParser.json());

let db;

// --- Ініціалізація БД ---
(async () => {
  db = await open({ filename: "./data.db", driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE,
      department TEXT,
      seller TEXT,
      prevDayBalance REAL,
      cashless REAL,
      remaining REAL,
      safeCashless REAL,
      safeTerminal REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS report_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      position_no INTEGER,
      volume TEXT,
      bottle TEXT,
      color TEXT,
      quantity REAL,
      price REAL,
      remark TEXT,
      carry_from_prev INTEGER DEFAULT 0,
      FOREIGN KEY(report_id) REFERENCES daily_reports(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      text TEXT,
      done INTEGER DEFAULT 0,
      FOREIGN KEY(report_id) REFERENCES daily_reports(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tester_writeoff_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      text TEXT,
      quantity REAL,
      FOREIGN KEY(report_id) REFERENCES daily_reports(id)
    );
  `);
})();

// --- Створити/оновити звіт ---
app.post("/api/reports", async (req, res) => {
  const {
    date,
    department,
    seller,
    prevDayBalance,
    cashless,
    remaining,
    safeCashless,
    safeTerminal,
    items = [],
    tasks = [],
    testerWriteOffItems = [],
  } = req.body;

  const existing = await db.get(`SELECT id FROM daily_reports WHERE date = ?`, [date]);
  if (existing) {
    await db.run(`DELETE FROM report_items WHERE report_id = ?`, [existing.id]);
    await db.run(`DELETE FROM tasks WHERE report_id = ?`, [existing.id]);
    await db.run(`DELETE FROM tester_writeoff_items WHERE report_id = ?`, [existing.id]);
    await db.run(`DELETE FROM daily_reports WHERE id = ?`, [existing.id]);
  }

  const r = await db.run(
    `INSERT INTO daily_reports (date, department, seller, prevDayBalance, cashless, remaining, safeCashless, safeTerminal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [date, department, seller, prevDayBalance, cashless, remaining, safeCashless, safeTerminal]
  );

  const reportId = r.lastID;

  const insertItem = await db.prepare(
    `INSERT INTO report_items (report_id, position_no, volume, bottle, color, quantity, price, remark, carry_from_prev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    await insertItem.run(
      reportId,
      it.position_no,
      it.volume,
      it.bottle,
      it.color,
      it.quantity,
      it.price,
      it.remark || "",
      it.carry_from_prev ? 1 : 0
    );
  }
  await insertItem.finalize();

  const insertTask = await db.prepare(`INSERT INTO tasks (report_id, text, done) VALUES (?, ?, ?)`);
  for (const t of tasks) {
    await insertTask.run(reportId, t.text || "", t.done ? 1 : 0);
  }
  await insertTask.finalize();

  const insertTester = await db.prepare(
    `INSERT INTO tester_writeoff_items (report_id, text, quantity) VALUES (?, ?, ?)`
  );
  for (const t of testerWriteOffItems) {
    await insertTester.run(reportId, t.text || "", t.quantity || 0);
  }
  await insertTester.finalize();

  const created = await db.get(`SELECT * FROM daily_reports WHERE id = ?`, [reportId]);
  res.json({ success: true, report: created });
});

// --- Отримати звіт за датою ---
app.get("/api/reports", async (req, res) => {
  const { date } = req.query;
  const report = await db.get(`SELECT * FROM daily_reports WHERE date = ?`, [date]);
  if (!report) return res.status(404).json({ error: "Not found" });

  const items = await db.all(`SELECT * FROM report_items WHERE report_id = ? ORDER BY position_no`, [report.id]);
  const tasks = await db.all(`SELECT * FROM tasks WHERE report_id = ?`, [report.id]);
  const testerWriteOffItems = await db.all(`SELECT * FROM tester_writeoff_items WHERE report_id = ?`, [report.id]);

  res.json({ report, items, tasks, testerWriteOffItems });
});

// --- Експорт у CSV без стовпчика "Сума" ---
app.get("/api/reports/:id/export/csv", async (req, res) => {
  const { id } = req.params;
  const report = await db.get(`SELECT * FROM daily_reports WHERE id = ?`, [id]);
  if (!report) return res.status(404).send("Не знайдено");

  const items = await db.all(`SELECT * FROM report_items WHERE report_id = ? ORDER BY position_no`, [id]);
  const tasks = await db.all(`SELECT * FROM tasks WHERE report_id = ?`, [id]);
  const testers = await db.all(`SELECT * FROM tester_writeoff_items WHERE report_id = ?`, [id]);

  let csv = `Дата,${report.date}\nВідділ,${report.department}\nПродавець,${report.seller}\n\n`;

  // --- таблиця товарів без стовпчика "Сума" ---
  csv += "№,Обʼєм,Бутилка,Колір,Кількість,Ціна,Примітка\n";
  let totalSum = 0;
  for (const it of items) {
    totalSum += it.quantity * it.price;
    csv += `${it.position_no},"${it.volume}","${it.bottle}","${it.color}",${it.quantity},${it.price},"${it.remark || ""}"\n`;
  }

  // --- Загальна сума під стовпчиком Ціна ---
  csv += `Загальна сума,,,,,${totalSum.toFixed(2)}\n`;

  csv += "\nЗадачі\n";
  for (const t of tasks) {
    csv += `"${t.text}",${t.done ? "Виконано" : "Не виконано"}\n`;
  }

  csv += "\nТестери\n";
  for (const t of testers) {
    csv += `"${t.text}",${t.quantity}\n`;
  }

  csv += `\nЗалишок попереднього дня,${report.prevDayBalance}\nБезготівка,${report.cashless}\nЗалишок,${report.remaining}\nКаса,${report.safeCashless}\nТермінал,${report.safeTerminal}`;

  res.setHeader("Content-disposition", `attachment; filename=report_${report.date}.csv`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(csv);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server running on port", PORT));
