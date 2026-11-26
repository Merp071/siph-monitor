// Run only for local/staging initialization or an explicitly reviewed existing DB bootstrap.
import { readFile } from "node:fs/promises";
import { cloudflare } from "./cloudflare-api.mjs";
import { DEFAULT } from "../src/core.mjs";
const root = new URL("../", import.meta.url),
  c = JSON.parse(
    await readFile(new URL("config/cloudflare.json", root), "utf8"),
  );
if (process.argv[2] !== `--confirm=${c.database_name}`)
  throw Error(
    "No database write performed. Pass --confirm=" +
      c.database_name +
      " only after reviewing schema and backup.",
  );
const path = `/accounts/${c.account_id}/d1/database/${c.database_id}/query`;
await cloudflare(path, {
  method: "POST",
  body: JSON.stringify({
    sql: await readFile(
      new URL("db/migrations/0001_existing_schema.sql", root),
      "utf8",
    ),
  }),
});
await cloudflare(path, {
  method: "POST",
  body: JSON.stringify({
    batch: [
      {
        sql: "INSERT OR IGNORE INTO settings(id,data) VALUES(1,?)",
        params: [JSON.stringify(DEFAULT)],
      },
      { sql: "INSERT OR IGNORE INTO auth(id) VALUES(1)" },
    ],
  }),
});
console.log(
  "Idempotent schema initialization finished; existing rows were preserved. No password or session was reset.",
);
