import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

export default function App() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [department, setDepartment] = useState("");
  const [seller, setSeller] = useState("");
  const [items, setItems] = useState([]);
  const [reportId, setReportId] = useState(null);
  const [loading, setLoading] = useState(false);

  const [prevDayBalance, setPrevDayBalance] = useState("");
  const [tasks, setTasks] = useState([]);
  const [cashless, setCashless] = useState("");
  const [remaining, setRemaining] = useState("");
  const [safeTerminal, setSafeTerminal] = useState("");
  const [testerItems, setTesterItems] = useState([]);
  const [safeCashless, setSafeCashless] = useState("");

  const navigate = useNavigate();

  // ⬇️ Підтягуємо ім'я продавця з localStorage при завантаженні
  useEffect(() => {
    const savedSeller = localStorage.getItem("sellerName");
    if (savedSeller) setSeller(savedSeller);
  }, []);

  // ⬇️ Зберігаємо ім'я продавця в localStorage при зміні
  useEffect(() => {
    if (seller) localStorage.setItem("sellerName", seller);
  }, [seller]);

  useEffect(() => {
    const loadReport = async () => {
      try {
        const res = await fetch(`/api/reports?date=${date}`);
        if (!res.ok) {
          setReportId(null);
          setItems([]);
          setPrevDayBalance("");
          setCashless("");
          setRemaining("");
          setSafeTerminal("");
          setSafeCashless("");
          setTasks([]);
          setTesterItems([]);
          setDepartment("");
          return;
        }
        const data = await res.json();
        setReportId(data.report.id);
        setDepartment(data.report.department || "");
        setItems(data.items || []);
        setPrevDayBalance(data.report.prevDayBalance?.toString() || "");
        setCashless(data.report.cashless?.toString() || "");
        setRemaining(data.report.remaining?.toString() || "");
        setSafeTerminal(data.report.safeTerminal?.toString() || "");
        setSafeCashless(data.report.safeCashless?.toString() || "");
        setTasks(data.tasks || []);
        setTesterItems(data.testerWriteOffItems || []);

        // ⬇️ Підставляємо збережене ім’я, якщо його немає в базі
        if (!data.report.seller && seller) {
          setSeller(seller);
        } else if (data.report.seller) {
          setSeller(data.report.seller);
        }
      } catch (err) {
        console.error(err);
        setReportId(null);
        setItems([]);
        setPrevDayBalance("");
        setCashless("");
        setRemaining("");
        setSafeTerminal("");
        setSafeCashless("");
        setTasks([]);
        setTesterItems([]);
        setDepartment("");
      }
    };

    loadReport();
  }, [date]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("sellerName");
    navigate("/login");
  };

  const normalizeNumber = (val) => {
    if (val === "") return "";
    return String(Number(val));
  };

  const updateRow = (idx, changes) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], ...changes };
    setItems(copy);
  };

  const addRow = () => {
    const pos = items.length + 1;
    setItems([
      ...items,
      {
        position_no: pos,
        volume: "",
        bottle: "",
        color: "",
        quantity: "",
        price: "",
        remark: "",
        carry_from_prev: false,
      },
    ]);
  };

  const removeRow = (idx) => {
    setItems(
      items
        .filter((_, i) => i !== idx)
        .map((item, index) => ({ ...item, position_no: index + 1 }))
    );
  };

  const saveReport = async () => {
    const token = localStorage.getItem("token");
    setLoading(true);
    try {
      const payload = {
        date,
        department,
        seller,
        items,
        prevDayBalance: Number(prevDayBalance || 0),
        tasks,
        cashless: Number(cashless || 0),
        remaining: Number(remaining || 0),
        safeCashless: Number(safeCashless || 0),
        safeTerminal: Number(safeTerminal || 0),
        testerWriteOffItems: testerItems,
      };
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setReportId(data.report.id);
      alert("Збережено");
    } catch (e) {
      alert("Помилка збереження: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!reportId) return alert("Спочатку збережіть звіт");
    const token = localStorage.getItem("token");
    window.open(`/api/reports/${reportId}/export/csv?token=${token}`, "_blank");
  };

  const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const addTask = () => setTasks([...tasks, { text: "", done: false }]);
  const updateTask = (idx, changes) => {
    const copy = [...tasks];
    copy[idx] = { ...copy[idx], ...changes };
    setTasks(copy);
  };
  const removeTask = (idx) => setTasks(tasks.filter((_, i) => i !== idx));

  const addTesterItem = () => setTesterItems([...testerItems, { text: "", quantity: "" }]);
  const updateTesterItem = (idx, changes) => {
    const copy = [...testerItems];
    copy[idx] = { ...copy[idx], ...changes };
    setTesterItems(copy);
  };
  const removeTesterItem = (idx) => setTesterItems(testerItems.filter((_, i) => i !== idx));

  const testerTotal = testerItems.reduce(
    (s, t) => s + (Number(t.quantity) || 0),
    0
  );

  return (
    <div className="container">
      <div className="header">
        <h2>ParfumNotebook — щоденний звіт</h2>
        <div className="header-buttons">
          <button className="btn primary" onClick={saveReport} disabled={loading}>
            {loading ? "Збереження..." : "Зберегти"}
          </button>
          <button className="btn" onClick={exportCsv}>
            Експорт CSV
          </button>
        </div>
      </div>

      <div className="controls">
        <label>Дата: <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Відділ: <input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Назва відділу" /></label>
        <label>Продавець: <input value={seller} onChange={e => setSeller(e.target.value)} placeholder="Ім'я продавця" /></label>
      </div>

      <div className="prev-day-balance">
        <label>
          <span className="yellow-label">Залишок попереднього дня:</span>
          <input type="number" value={prevDayBalance} onChange={e => setPrevDayBalance(e.target.value)} />
          <span className="currency">грн.</span>
        </label>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th></th><th>#</th><th>Об'єм</th><th>Флакон</th><th>Колір</th><th>К-сть</th><th>Ціна</th><th>Примітка</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td><button className="btn small red" onClick={() => removeRow(idx)}>✖</button></td>
                <td>{it.position_no}</td>
                <td><input value={it.volume} onChange={e => updateRow(idx, { volume: e.target.value })} /></td>
                <td><input value={it.bottle} onChange={e => updateRow(idx, { bottle: e.target.value })} /></td>
                <td><input value={it.color} onChange={e => updateRow(idx, { color: e.target.value })} /></td>
                <td><input type="number" value={it.quantity} onChange={e => updateRow(idx, { quantity: normalizeNumber(e.target.value) })} /></td>
                <td><input type="number" value={it.price} onChange={e => updateRow(idx, { price: normalizeNumber(e.target.value) })} /></td>
                <td><input value={it.remark} onChange={e => updateRow(idx, { remark: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="summary">
        <button className="btn" onClick={addRow}>Додати рядок</button>
        <div>Загальна сума: {total.toFixed(2)} грн.</div>
      </div>

      <div className="tasks">
        <h3>Задачі на день</h3>
        <button className="btn small" onClick={addTask}>Додати задачу</button>
        <ul>
          {tasks.map((t, idx) => (
            <li key={idx}>
              <button className="btn small red" onClick={() => removeTask(idx)}>✖</button>
              <input type="checkbox" checked={t.done} onChange={e => updateTask(idx, { done: e.target.checked })} />
              <input type="text" value={t.text} placeholder="Опис задачі" onChange={e => updateTask(idx, { text: e.target.value })} />
            </li>
          ))}
        </ul>
      </div>

      <div className="tester-writeoff">
        <h3>Списання тестерів</h3>
        <button className="btn small" onClick={addTesterItem}>Додати рядок</button>
        <ul>
          {testerItems.map((t, idx) => (
            <li key={idx}>
              <button className="btn small red " onClick={() => removeTesterItem(idx)}>✖</button>
              <input type="text" value={t.text} placeholder="Назва тестера" onChange={e => updateTesterItem(idx, { text: e.target.value })} />
              <input type="number" value={t.quantity} placeholder="К-сть" onChange={e => updateTesterItem(idx, { quantity: e.target.value })} />
            </li>
          ))}
        </ul>
        {testerItems.length > 0 && (
          <div>Загальна к-сть тестерів: {testerTotal}</div>
        )}
      </div>

      <div className="financials">
        <label>Безготівка: <input type="number" value={cashless} onChange={e => setCashless(normalizeNumber(e.target.value))} /> <span>грн.</span></label>
        <label>Залишок: <input type="number" value={remaining} onChange={e => setRemaining(normalizeNumber(e.target.value))} /> <span>грн.</span></label>
        <label>Термінал:<input type="number" value={safeTerminal} onChange={e => setSafeTerminal(normalizeNumber(e.target.value))} /> <span>грн.</span></label>
        <label>Каса:<input type="number" value={safeCashless} onChange={e => setSafeCashless(normalizeNumber(e.target.value))} /> <span>грн.</span></label>
      </div>
    </div>
  );
}
