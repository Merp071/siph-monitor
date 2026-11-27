import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { cloudflare } from "./cloudflare-api.mjs";
export function verifyReview(pr, head, repository, branch) {
  if (
    !pr.merged ||
    pr.base?.repo?.full_name !== repository ||
    pr.base?.ref !== branch ||
    pr.merge_commit_sha !== head
  )
    throw Error(
      "Deploy requires a merged PR in this repository and checkout at its exact merge commit.",
    );
}
export async function deploy() {
  const root = new URL("../", import.meta.url);
  const config = JSON.parse(
    await readFile(new URL("config/cloudflare.json", root), "utf8"),
  );
  const args = process.argv.slice(2),
    index = args.indexOf("--pr"),
    number = args[index + 1];
  if (index < 0 || !/^\d+$/.test(number || ""))
    throw Error("Usage after review/merge: npm run deploy -- --pr <number>");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
  )
    throw Error("Commit or remove working-tree changes before deployment.");
  const r = await fetch(
    `https://api.github.com/repos/${config.repository}/pulls/${number}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SiPH-deployment-review-check",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok)
    throw Error("Cannot verify the pull request. No deployment performed.");
  verifyReview(await r.json(), head, config.repository, config.base_branch);
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: new URL(root),
    stdio: "inherit",
  });
  const path = `/accounts/${config.account_id}/workers/scripts/${config.worker_name}`;
  const settings = await cloudflare(path + "/settings");
  const bindings = settings.bindings || [];
  const database = bindings.find((b) => b.name === "DB" && b.type === "d1");
  if ((database?.database_id || database?.id) !== config.database_id)
    throw Error(
      "Existing D1 binding does not match the reviewed configuration.",
    );
  if (bindings.some((b) => b.name !== "DB" && b.type !== "secret_text"))
    throw Error("Unexpected binding: review it explicitly before deployment.");
  const metadata = {
    main_module: "worker.mjs",
    compatibility_date: config.compatibility_date,
    bindings: [
      { type: "d1", name: "DB", database_id: config.database_id },
      ...bindings
        .filter((b) => b.type === "secret_text")
        .map((b) => ({ type: "inherit", name: b.name })),
    ],
    placement: { mode: "smart" },
    observability: {
      enabled: true,
      redact_query_string: true,
      logs: { enabled: true, invocation_logs: true, persist: true },
      traces: { enabled: true, persist: true, head_sampling_rate: 0.1 },
    },
  };
  const code = await readFile(new URL("build/worker.mjs", root), "utf8");
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "worker.mjs",
    new Blob([code], { type: "application/javascript+module" }),
    "worker.mjs",
  );
  await cloudflare(path + "?bindings_inherit=strict", {
    method: "PUT",
    body: form,
  });
  console.log("Reviewed Worker uploaded; configuring scheduler.");
  await cloudflare(path + "/schedules", {
    method: "PUT",
    body: JSON.stringify([{ cron: config.cron }]),
  });
  const schedules = await cloudflare(path + "/schedules");
  if (!schedules.schedules.some((s) => s.cron === config.cron))
    throw Error(
      "Worker uploaded but schedule verification failed. Inspect Cloudflare dashboard.",
    );
  console.log(
    "Deployment and schedule confirmed. Existing database and secrets preserved.",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  deploy().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
