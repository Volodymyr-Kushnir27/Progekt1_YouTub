import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

function safeFileName(value) {
  const baseName = path.basename(value || "telegram-file.xlsx");
  const cleaned = baseName
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
    .trim();

  return cleaned || "telegram-file.xlsx";
}

async function readTelegramJson(response, operation) {
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    const description = body?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram ${operation}: ${description}`);
  }

  return body.result;
}

export async function downloadTelegramFile({
  botToken,
  fileId,
  fileName,
  fileSize,
  destinationDirectory = path.join(os.tmpdir(), "perfums-telegram-imports"),
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  fetchImpl = globalThis.fetch,
}) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не налаштовано");
  if (!fileId) throw new Error("Telegram file_id відсутній");
  if (typeof fetchImpl !== "function") throw new Error("Fetch API недоступний");
  if (fileSize != null && fileSize > maxFileSize) {
    throw new Error(`Excel-файл перевищує ліміт ${maxFileSize} байт`);
  }

  const getFileResponse = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const telegramFile = await readTelegramJson(getFileResponse, "getFile");

  if (!telegramFile?.file_path) {
    throw new Error("Telegram getFile не повернув file_path");
  }

  const downloadResponse = await fetchImpl(
    `https://api.telegram.org/file/bot${botToken}/${telegramFile.file_path}`,
  );
  if (!downloadResponse.ok) {
    throw new Error(`Telegram download: HTTP ${downloadResponse.status}`);
  }

  const contentLength = Number(downloadResponse.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxFileSize) {
    throw new Error(`Excel-файл перевищує ліміт ${maxFileSize} байт`);
  }

  const bytes = Buffer.from(await downloadResponse.arrayBuffer());
  if (bytes.length > maxFileSize) {
    throw new Error(`Excel-файл перевищує ліміт ${maxFileSize} байт`);
  }

  await fs.mkdir(destinationDirectory, { recursive: true });
  const extension = path.extname(safeFileName(fileName)) || ".xlsx";
  const stem = path.basename(safeFileName(fileName), extension);
  const uniquePart = `${Date.now()}-${crypto.randomUUID()}`;
  const localPath = path.join(
    destinationDirectory,
    `${stem}-${uniquePart}${extension.toLowerCase()}`,
  );

  await fs.writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });

  return {
    localPath,
    originalFileName: fileName || null,
    telegramFilePath: telegramFile.file_path,
    size: bytes.length,
  };
}

