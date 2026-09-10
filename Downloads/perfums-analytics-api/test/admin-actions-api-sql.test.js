import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("admin department forecast uses a valid PostgreSQL month-end interval", async () => {
  const source=await fs.readFile(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/interval '1 month'-interval '1 day'/);
  assert.doesNotMatch(source,/interval '1 month-1 day'/);
  assert.match(source,/FROM admin_monthly_context m JOIN regions r/);
  assert.match(source,/context:context\.rows\[0\] \?\? null/);
});
