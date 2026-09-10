import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(root, "data");
const outputFile = path.join(dataDir, "import-all.generated.xlsx");
const historyFiles = ["апрель.xlsx", "май.xlsx", "июнь.xlsx"];
const S = { sales: "ПРОДАЖІ_ВІДДІЛІВ", shifts: "ЗМІНИ_ПРОДАВЦІВ", payroll: "ЗАРПЛАТА_ПО_ДНЯХ", plans: "ПЛАНИ_ВІДДІЛІВ", allPlans: "ПЛАНИ_2026_ЗВЕДЕНІ", employees: "ПРАЦІВНИКИ", departments: "ВІДДІЛИ" };
const text = (v) => v == null ? "" : String(v).normalize("NFKC").replace(/\s+/g, " ").trim();
const norm = (v) => text(v).toLocaleLowerCase("uk-UA").replace(/[’`]/g, "'");
const isDate = (v) => /^\d{2}\.\d{2}\.\d{4}$/.test(text(v));
const parseDate = (v) => { const [d, m, y] = text(v).split(".").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

function sheet(wb, name) { const ws = wb.getWorksheet(name); if (!ws) throw new Error(`У main-2026.xlsx немає аркуша «${name}».`); return ws; }
function headers(ws) { const map = new Map(); ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { if (text(c.value)) map.set(text(c.value), i); }); return map; }
function append(ws, hm, record) { const values = []; for (const [name, column] of hm) values[column - 1] = record[name] ?? null; ws.addRow(values); }

function references(wb) {
  const employees = new Map(); const ews = sheet(wb, S.employees); const eh = headers(ews);
  ews.eachRow((r, i) => { if (i === 1) return; const name = text(r.getCell(eh.get("Працівник")).value); if (name) employees.set(norm(name), { name, role: text(r.getCell(eh.get("Роль")).value) || "Продавець", include: text(r.getCell(eh.get("Враховувати_продавця")).value) || "Так" }); });
  const departments = new Map(); const dws = sheet(wb, S.departments); const dh = headers(dws);
  dws.eachRow((r, i) => { if (i === 1) return; const department = text(r.getCell(dh.get("Відділ")).value); const region = text(r.getCell(dh.get("Регіон")).value); if (department) departments.set(norm(department), { department, region }); });
  // Закриті або неактивні в липні точки можуть бути відсутні на аркуші
  // ВІДДІЛИ, але залишаються в історичних планах квітня–червня.
  const pws = sheet(wb, S.allPlans); const ph = headers(pws);
  pws.eachRow((r, i) => {
    if (i === 1 || norm(r.getCell(ph.get("Тип_об’єкта")).value) !== "відділ") return;
    const department = text(r.getCell(ph.get("Відділ_або_регіон")).value);
    const region = text(r.getCell(ph.get("Регіон")).value);
    if (department && !departments.has(norm(department))) departments.set(norm(department), { department, region });
  });
  return { employees, departments };
}

async function parseHistory(fileName, refs) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(dataDir, fileName)); const ws = wb.worksheets[0];
  const items = []; for (let row = 4; row <= ws.rowCount; row++) { const value = text(ws.getRow(row).getCell(1).value); if (value) items.push({ row, value }); }
  const payroll = [], shifts = [], groups = new Map(), unknownEmployees = new Set(); let employee = null, department = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; if (norm(item.value) === "итог") break;
    if (!isDate(item.value)) {
      if (isDate(items[i + 1]?.value || "")) { department = refs.departments.get(norm(item.value)); if (!department) throw new Error(`${fileName}: невідомий відділ «${item.value}».`); }
      else { employee = refs.employees.get(norm(item.value)) || { name: item.value, role: "Продавець", include: "Так" }; if (!refs.employees.has(norm(item.value))) unknownEmployees.add(item.value); department = null; }
      continue;
    }
    if (!employee || !department) throw new Error(`${fileName}, рядок ${item.row}: дата без працівника або відділу.`);
    const r = ws.getRow(item.row), date = parseDate(item.value), plan = num(r.getCell(7).value), ml = num(r.getCell(9).value), rate0 = num(r.getCell(5).value);
    const common = { "Дата": date, "Працівник": employee.name, "Роль": employee.role, "Враховувати_продавця": employee.include, "Регіон": department.region, "Відділ": department.department, "План_зміни_мл": plan, "Продаж_точки_мл": ml, "Період_джерела": path.basename(fileName, ".xlsx"), "Файл_джерело": fileName, "Рядок_джерела": item.row };
    payroll.push({ ...common, "Виручка_грн": num(r.getCell(2).value), "Зарплата_всього_грн": num(r.getCell(3).value), "Оклад_грн": num(r.getCell(4).value), "Ставка_відсотка": rate0 == null ? null : (Math.abs(rate0) > 1 ? rate0 / 100 : rate0), "Сума_відсотка_грн": num(r.getCell(6).value), "Бонус_за_мл_грн": num(r.getCell(8).value), "Додаткова_премія_грн": num(r.getCell(10).value), "Кількість_днів": num(r.getCell(11).value) ?? 1 });
    shifts.push({ ...common, "Подарунки_мл": 0, "Виконання_плану_зміни_%": plan ? ml / plan : null, "Статус_зміни": ml == null ? "Дані відсутні" : (ml >= plan ? "План зміни виконано" : "План зміни не виконано"), "Тип_показника": "Продаж точки за зміну; може повторюватися у працівників однієї точки" });
    const key = `${date.toISOString().slice(0, 10)}|${norm(department.region)}|${norm(department.department)}`;
    const g = groups.get(key) || { date, ...department, ml, employees: [], rows: [] };
    if (g.ml != null && ml != null && g.ml !== ml) throw new Error(`${fileName}: різні продажі для ${item.value}, ${department.department}.`);
    if (g.ml == null) g.ml = ml; g.employees.push(employee.name); g.rows.push(item.row); groups.set(key, g);
  }
  const sales = [...groups.values()].map((g) => ({ "Дата": g.date, "Регіон": g.region, "Відділ": g.department, "Факт_продажу_мл": g.ml, "Подарунки_мл": 0, "Кількість_працівників": new Set(g.employees.map(norm)).size, "Усі_працівники_зміни": [...new Set(g.employees)].join(", "), "Продавці_для_аналізу": [...new Set(g.employees)].join(", "), "Статус_даних": g.ml == null ? "Дані відсутні" : "Дані є", "Період_джерела": path.basename(fileName, ".xlsx"), "Файл_джерело": fileName, "Рядки_джерела": g.rows.join(",") }));
  return { fileName, payroll, shifts, sales, unknownEmployees: [...unknownEmployees] };
}

function replacePlans(wb) {
  const source = sheet(wb, S.allPlans), oldTarget = sheet(wb, S.plans), sh = headers(source);
  const headerValues = oldTarget.getRow(1).values.slice(1);
  wb.removeWorksheet(oldTarget.id);
  const target = wb.addWorksheet(S.plans);
  target.addRow(headerValues);
  const th = headers(target);
  for (let i = 2; i <= source.rowCount; i++) { const record = {}; for (const [name, col] of sh) record[name] = source.getRow(i).getCell(col).value; append(target, th, record); }
  return source.rowCount - 1;
}

async function main() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(dataDir, "main-2026.xlsx")); const refs = references(wb), results = [];
  for (const name of historyFiles) results.push(await parseHistory(name, refs));
  const sales = sheet(wb, S.sales), shifts = sheet(wb, S.shifts), payroll = sheet(wb, S.payroll), hs = headers(sales), hh = headers(shifts), hp = headers(payroll);
  for (const x of results) { x.sales.forEach((r) => append(sales, hs, r)); x.shifts.forEach((r) => append(shifts, hh, r)); x.payroll.forEach((r) => append(payroll, hp, r)); }
  const plans = replacePlans(wb); await wb.xlsx.writeFile(outputFile);
  console.table(results.map((x) => ({ file: x.fileName, sales: x.sales.length, shifts: x.shifts.length, payroll: x.payroll.length, names_not_in_main_directory: x.unknownEmployees.length })));
  console.table([{ output: path.relative(root, outputFile), total_sales: sales.rowCount - 1, total_shifts: shifts.rowCount - 1, total_payroll: payroll.rowCount - 1, plans }]);
  const unknown = [...new Set(results.flatMap((x) => x.unknownEmployees))]; if (unknown.length) console.log(`\nІмена поза аркушем ПРАЦІВНИКИ (будуть перевірені за БД/аліасами):\n- ${unknown.join("\n- ")}`);
  console.log("\n✅ Усі Excel-файли перевірено, зведений файл для SQL створено.");
}
main().catch((e) => { console.error("❌ Підготовка не виконана:", e.message); process.exitCode = 1; });
