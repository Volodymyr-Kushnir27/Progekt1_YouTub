import AdmZip from "adm-zip";

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value = "") {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? _;
  });
}

function sharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map((match) =>
    decodeXml([...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((x) => x[1]).join("")),
  );
}

function cells(rowXml, strings) {
  const result = new Map();
  for (const match of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
    const attrs = match[1];
    const body = match[2] ?? "";
    const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1]?.toUpperCase();
    if (!ref) continue;
    const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
    const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1];
    const inline = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((x) => x[1]).join("");
    if (type === "s" && raw != null) result.set(ref, strings[Number(raw)] ?? "");
    else if (type === "inlineStr") result.set(ref, decodeXml(inline));
    else if (raw != null) result.set(ref, Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw));
  }
  return result;
}

function number(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value) {
  const match = String(value ?? "").match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s|$)/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  if (date.getUTCDate() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1) return null;
  return date.toISOString().slice(0, 10);
}

export function parse1cMlWorkbook(localPath, sourceFile = "ML.xlsx") {
  const zip = new AdmZip(localPath);
  const stringEntry = zip.getEntry("xl/SharedStrings.xml") ?? zip.getEntry("xl/sharedStrings.xml");
  const sheetEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("ML: не знайдено xl/worksheets/sheet1.xml");
  const strings = stringEntry ? sharedStrings(stringEntry.getData().toString("utf8")) : [];
  const xml = sheetEntry.getData().toString("utf8");
  const context = { 1: null, 2: null, 3: null };
  const records = [];

  for (const match of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const attrs = match[1];
    const level = Number(attrs.match(/\boutlineLevel="(\d+)"/i)?.[1] ?? 0);
    const sourceRow = Number(attrs.match(/\br="(\d+)"/i)?.[1] ?? 0);
    const row = cells(match[2], strings);
    const label = String(row.get("A") ?? "").trim();
    if (level >= 1 && level <= 3 && label) {
      context[level] = label;
      for (let deeper = level + 1; deeper <= 3; deeper += 1) context[deeper] = null;
    }
    if (level !== 4) continue;
    const date = parseDate(label);
    if (!date) continue;
    if (!context[1] || !context[2] || !context[3]) {
      throw new Error(`ML рядок ${sourceRow}: неповна ієрархія регіон/відділ/працівник`);
    }
    records.push({
      date,
      region: context[1],
      department: context[2],
      employee: context[3],
      // 1C produces two physical layouts for the same visual report. In the
      // compact export the visible plan/sales/gifts/delta/percent columns are
      // C/E/F/H/I (B, D and G are empty service columns). Older exports use
      // D/E/G/I/J. Detect the layout from the numeric plan cell.
      planMl: number(row.get("C")) ?? number(row.get("D")),
      salesMl: number(row.get("E"), 0),
      giftsMl: number(row.get("C")) != null ? number(row.get("F"), 0) : number(row.get("G"), 0),
      deltaMl: number(row.get("C")) != null ? number(row.get("H")) : number(row.get("I")),
      completionPercent: number(row.get("C")) != null ? number(row.get("I")) : number(row.get("J")),
      sourceFile,
      sourceRow,
    });
  }
  if (!records.length) throw new Error("ML: у звіті 1С не знайдено рядків рівня 4 з датами");
  return records;
}

export function summarizeMlRecords(records) {
  const dates = [...new Set(records.map((row) => row.date))].sort();
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  return { records: records.length, dates: dates.length, dateFrom: dates[0], dateTo: dates.at(-1), months };
}
