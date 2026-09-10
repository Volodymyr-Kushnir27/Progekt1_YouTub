import AdmZip from "adm-zip";

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value = "") => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
  if (entity[0] === "#") {
    const hex = entity[1].toLowerCase() === "x";
    return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  }
  return entities[entity.toLowerCase()] ?? _;
});

const columnNumber = (letters) => [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);

export function readFirstSheetRows(localPath) {
  const zip = new AdmZip(localPath);
  const stringsEntry = zip.getEntry("xl/SharedStrings.xml") ?? zip.getEntry("xl/sharedStrings.xml");
  const sheet = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("XLSX: не знайдено перший аркуш");
  const strings = stringsEntry ? [...stringsEntry.getData().toString("utf8").matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((m) =>
    decode([...m[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((x) => x[1]).join(""))) : [];
  const rows = [];
  for (const match of sheet.getData().toString("utf8").matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const values = [];
    for (const cell of match[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi)) {
      const ref = cell[1].match(/\br="([A-Z]+)\d+"/i)?.[1]?.toUpperCase();
      if (!ref) continue;
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const raw = cell[2]?.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1];
      const inline = [...(cell[2] ?? "").matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((x) => x[1]).join("");
      let value = null;
      if (type === "s" && raw != null) value = strings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = decode(inline);
      else if (raw != null) value = Number.isFinite(Number(raw)) ? Number(raw) : decode(raw);
      values[columnNumber(ref) - 1] = value;
    }
    rows.push({ rowNumber: Number(match[1].match(/\br="(\d+)"/i)?.[1] ?? rows.length + 1), values });
  }
  return rows;
}
