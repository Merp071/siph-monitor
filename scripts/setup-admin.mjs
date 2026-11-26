// Generates a new one-use setup link only when no administrator password exists.
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { cloudflare } from "./cloudflare-api.mjs";
const c = JSON.parse(
  await readFile(new URL("../config/cloudflare.json", import.meta.url), "utf8"),
);
if (process.argv[2] !== "--create-one-use-link")
  throw Error(
    "No auth write performed. Pass --create-one-use-link to initialize an administrator who has no password yet.",
  );
const origin = process.env.SIPH_ORIGIN;
if (
  !origin ||
  new URL(origin).protocol !== "https:" ||
  new URL(origin).origin !== origin
)
  throw Error(
    "SIPH_ORIGIN must be the exact HTTPS app origin, without path or trailing slash.",
  );
const token = randomBytes(32).toString("hex"),
  digest = createHash("sha256").update(token).digest("hex");
const result = await cloudflare(
  `/accounts/${c.account_id}/d1/database/${c.database_id}/query`,
  {
    method: "POST",
    body: JSON.stringify({
      sql: "UPDATE auth SET setup_hash=?,setup_expires=? WHERE id=1 AND password_hash IS NULL",
      params: [digest, String(Date.now() + 86400000)],
    }),
  },
);
if (!result[0]?.meta?.changes)
  throw Error(
    "No setup link created: administrator already initialized or auth row missing.",
  );
console.log(
  "Private one-use link, expires in 24h. Do not commit or paste it into an issue:",
);
console.log(origin + "/#setup=" + token);
