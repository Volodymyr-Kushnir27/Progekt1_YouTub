import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadTelegramFile } from "../src/telegram/download-file.js";

test("downloads a Telegram file into a safe temporary path", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes("/getFile?")) {
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: "documents/report.xlsx" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(Buffer.from("excel-content"), {
      status: 200,
      headers: { "content-length": "13" },
    });
  };

  const result = await downloadTelegramFile({
    botToken: "secret-token",
    fileId: "file-id",
    fileName: "../ML (1).xlsx",
    fileSize: 13,
    destinationDirectory: directory,
    fetchImpl,
  });

  assert.equal(result.size, 13);
  assert.match(path.basename(result.localPath), /^ML \(1\)-.+\.xlsx$/);
  assert.equal(await fs.readFile(result.localPath, "utf8"), "excel-content");
  assert.equal(requests.length, 2);
});

test("rejects a file that is larger than the configured limit", async () => {
  await assert.rejects(
    downloadTelegramFile({
      botToken: "secret-token",
      fileId: "file-id",
      fileName: "ML.xlsx",
      fileSize: 101,
      maxFileSize: 100,
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /перевищує ліміт/,
  );
});
