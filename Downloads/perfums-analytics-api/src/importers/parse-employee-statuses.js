import ExcelJS from "exceljs";

const MONTHS = new Map([
  ["січень", 1], ["январь", 1],
  ["лютий", 2], ["февраль", 2],
  ["березень", 3], ["март", 3],
  ["квітень", 4], ["апрель", 4],
  ["травень", 5], ["май", 5],
  ["червень", 6], ["июнь", 6],
  ["липень", 7], ["июль", 7],
  ["серпень", 8], ["август", 8],
  ["вересень", 9], ["сентябрь", 9],
  ["жовтень", 10], ["октябрь", 10],
  ["листопад", 11], ["ноябрь", 11],
  ["грудень", 12], ["декабрь", 12],
]);

const text = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const key = (value) => text(value).toLocaleLowerCase("uk-UA");

function monthStart(month, referenceDate) {
  const reference = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(reference.getTime())) throw new Error("Таблиця статусів: не вдалося визначити рік із дати Telegram");
  return `${reference.getUTCFullYear()}-${String(month).padStart(2, "0")}-01`;
}

function splitPeople(value) {
  return text(value).split(/\s+\/\s+/).map(text).filter(Boolean);
}

export async function parseEmployeeStatusesWorkbook(localPath, fileName, referenceDate) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(localPath, { ignoreNodes: ["drawing", "picture"] });
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Таблиця статусів: у файлі немає аркушів");

  let month;
  let masterColumn;
  let expertColumn;
  let headerRow;
  let declaredMasters;
  let declaredExperts;
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 15); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const value = key(cell.value);
      if (!month && MONTHS.has(value)) month = MONTHS.get(value);
      const declared = value.match(/всього\s*:\s*(\d+)\s*(майстр|експерт)/iu);
      if (declared?.[2].toLocaleLowerCase("uk-UA").startsWith("майстр")) declaredMasters = Number(declared[1]);
      if (declared?.[2].toLocaleLowerCase("uk-UA").startsWith("експерт")) declaredExperts = Number(declared[1]);
      if (/^майстер$/iu.test(value)) { masterColumn = columnNumber; headerRow = rowNumber; }
      if (/^експерт$/iu.test(value)) { expertColumn = columnNumber; headerRow = headerRow ?? rowNumber; }
    });
  }
  if (!month) throw new Error("Таблиця статусів: у верхній частині файла не знайдено назву місяця");
  if (!masterColumn || !expertColumn || masterColumn === expertColumn) {
    throw new Error("Таблиця статусів: не знайдено окремі колонки «МАЙСТЕР» і «ЕКСПЕРТ»");
  }

  const records = [];
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    for (const [column, status] of [[masterColumn, "master"], [expertColumn, "expert"]]) {
      for (const employee of splitPeople(worksheet.getCell(rowNumber, column).value)) {
        records.push({ employee, status, sourceRow: rowNumber });
      }
    }
  }
  if (!records.length) throw new Error("Таблиця статусів: списки працівників порожні");

  const duplicates = records.filter((row, index) =>
    records.findIndex((candidate) => key(candidate.employee) === key(row.employee)) !== index);
  if (duplicates.length) throw new Error(`Таблиця статусів: працівники повторюються: ${[...new Set(duplicates.map((x) => x.employee))].join(", ")}`);

  const masters = records.filter((row) => row.status === "master").length;
  const experts = records.filter((row) => row.status === "expert").length;
  const warnings = [];
  if (declaredMasters != null && declaredMasters !== masters) warnings.push(`у шапці майстрів ${declaredMasters}, у списку ${masters}`);
  if (declaredExperts != null && declaredExperts !== experts) warnings.push(`у шапці експертів ${declaredExperts}, у списку ${experts}`);

  return {
    monthStart: monthStart(month, referenceDate),
    sourceFile: fileName,
    sourceSheet: worksheet.name,
    records,
    warnings,
  };
}
