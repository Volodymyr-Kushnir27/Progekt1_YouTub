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

function readSharedStrings(xml) {
  return [...xml.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((match) =>
    decodeXml([...match[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((x) => x[1]).join("")),
  );
}

function readCells(rowXml, strings) {
  const result = new Map();
  for (const match of rowXml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi)) {
    const attrs = match[1];
    const body = match[2] ?? "";
    const column = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1]?.toUpperCase();
    if (!column) continue;
    const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
    const style = Number(attrs.match(/\bs="(\d+)"/i)?.[1] ?? 0);
    const raw = body.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1];
    const inline = [...body.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((x) => x[1]).join("");
    let value = null;
    if (type === "s" && raw != null) value = strings[Number(raw)] ?? "";
    else if (type === "inlineStr") value = decodeXml(inline);
    else if (raw != null) value = Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw);
    result.set(column, { value, style });
  }
  return result;
}

const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const norm = (value) => text(value).toLocaleLowerCase("uk-UA");

function number(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function fullYear(value, fallback) {
  if (value == null) return fallback;
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function parsePeriodRange(value, referenceDate = new Date()) {
  const match = text(value).match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\s*[-–—]\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (!match) return null;
  const referenceYear = new Date(referenceDate).getUTCFullYear();
  const endYear = fullYear(match[6], fullYear(match[3], referenceYear));
  let startYear = fullYear(match[3], endYear);
  if (!match[3] && Number(match[2]) > Number(match[5])) startYear = endYear - 1;
  const start = validDate(startYear, Number(match[2]), Number(match[1]));
  const end = validDate(endYear, Number(match[5]), Number(match[4]));
  return start && end ? { start, end, source: text(value) } : null;
}

function workbookXml(localPath) {
  const zip = new AdmZip(localPath);
  const stringEntry = zip.getEntry("xl/SharedStrings.xml") ?? zip.getEntry("xl/sharedStrings.xml");
  const sheetEntry = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("План: не знайдено xl/worksheets/sheet1.xml");
  const strings = stringEntry ? readSharedStrings(stringEntry.getData().toString("utf8")) : [];
  return { strings, xml: sheetEntry.getData().toString("utf8") };
}

export function parse1cPlanWorkbook(localPath, { fileType, sourceFile, referenceDate } = {}) {
  if (!['PlanBNAC', 'PlanMin'].includes(fileType)) throw new Error(`Непідтримуваний тип плану: ${fileType}`);
  const { strings, xml } = workbookXml(localPath);
  const rows = [...xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)].map((match) => ({
    sourceRow: Number(match[1].match(/\br="(\d+)"/i)?.[1] ?? 0),
    cells: readCells(match[2], strings),
  }));
  const header1 = rows.find((row) => row.sourceRow === 1)?.cells;
  const header2 = rows.find((row) => row.sourceRow === 2)?.cells;
  const normalizedLayout = /план\s*(?:бнац|минимум)/i.test(text(header1?.get("B")?.value));
  const columns = normalizedLayout
    ? { label:"A",plan:"B",fact:"C",downtime:"G",previous:"H" }
    : { label:"B",plan:"C",fact:"D",downtime:"H",previous:"I" };
  const planPeriod = parsePeriodRange(header2?.get(columns.plan)?.value, referenceDate);
  const factPeriod = parsePeriodRange(header2?.get(columns.fact)?.value, referenceDate);
  const previousPeriod = fileType === "PlanMin" ? parsePeriodRange(header2?.get(columns.previous)?.value, referenceDate) : null;
  if (!planPeriod || !factPeriod) throw new Error("План: не вдалося прочитати період плану або факту з другого рядка");
  const expectedTitle = fileType === "PlanBNAC" ? /план\s*бнац/i : /план\s*минимум/i;
  if (!expectedTitle.test(text(header1?.get(columns.plan)?.value))) throw new Error(`Файл не відповідає структурі ${fileType}`);

  const firstData = rows.find((row) => row.sourceRow >= 3 && text(row.cells.get(columns.label)?.value));
  const regionStyle = firstData?.cells.get(columns.label)?.style;
  if (regionStyle == null) throw new Error("План: не знайдено рядків регіонів і відділів");
  const records = [];
  const skipped = [];
  let currentRegion = null;

  for (const row of rows.filter((item) => item.sourceRow >= 3)) {
    const label = text(row.cells.get(columns.label)?.value);
    if (!label || ["итого", "усього", "всього"].includes(norm(label))) continue;
    const objectType = row.cells.get(columns.label)?.style === regionStyle ? "region" : "department";
    if (objectType === "region") currentRegion = label;
    if (!currentRegion) throw new Error(`План рядок ${row.sourceRow}: відділ «${label}» не має регіону`);
    const planMl = number(row.cells.get(columns.plan)?.value);
    if (planMl == null) {
      skipped.push({ region: currentRegion, department: objectType === "department" ? label : null, sourceRow: row.sourceRow, reason: "plan_missing" });
      continue;
    }
    if (planMl < 0) throw new Error(`План рядок ${row.sourceRow}: план не може бути від’ємним`);
    records.push({
      snapshotDate: factPeriod.end,
      planMonth: `${planPeriod.end.slice(0, 7)}-01`,
      planType: fileType === "PlanBNAC" ? "bnac" : "minimum",
      objectType,
      region: currentRegion,
      department: objectType === "department" ? label : null,
      factPeriodStart: factPeriod.start,
      factPeriodEnd: factPeriod.end,
      planMl,
      reportedActualMl: number(row.cells.get(columns.fact)?.value),
      downtimeDays: number(row.cells.get(columns.downtime)?.value),
      previousPeriodSalesMl: fileType === "PlanMin" ? number(row.cells.get(columns.previous)?.value) : null,
      sourceRow: String(row.sourceRow),
      sourceFile: sourceFile ?? fileType,
    });
  }
  if (!records.length) throw new Error("План: не знайдено рядків із числовим планом");
  return { records, skipped, planPeriod, factPeriod, previousPeriod };
}
