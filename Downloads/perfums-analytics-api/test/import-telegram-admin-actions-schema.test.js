import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("admin importer creates the referenced import batch before writing admin rows", async () => {
  const source=await fs.readFile(new URL("../src/importers/import-telegram-admin-actions.js",import.meta.url),"utf8");
  const batchInsert=source.indexOf("INSERT INTO import_batches");
  const contextInsert=source.indexOf("INSERT INTO admin_monthly_context");
  assert.ok(batchInsert >= 0);
  assert.ok(contextInsert > batchInsert);
  assert.match(source,/const batchId = batch\.rows\[0\]\.id/);
  assert.doesNotMatch(source,/const batchId = crypto\.randomUUID/);
});
