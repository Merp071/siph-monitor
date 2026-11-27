import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const bad = [];
for (const file of files) {
  if (!statSync(file).isFile()) continue;
  if (
    /(?:^|\/)(?:\.env|\.dev\.vars)(?:$|\.)/.test(file) &&
    !file.endsWith(".example")
  ) {
    bad.push(file + ": runtime secret file must never be tracked");
    continue;
  }
  const data = readFileSync(file, "utf8");
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(data) ||
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(data) ||
    /\bre_[A-Za-z0-9]{24,}\b/.test(data) ||
    /\bAIza[A-Za-z0-9_-]{35}\b/.test(data)
  )
    bad.push(file + ": possible private key or API token");
  if (
    /(?:YOUTUBE_API_KEY|RESEND_API_KEY|LINE_CHANNEL_ACCESS_TOKEN|SOCIAL_FEED_TOKEN|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'](?!test-|fixture-|<|["'])[^"'\n]{16,}["']/.test(
      data,
    )
  )
    bad.push(file + ": possible hardcoded provider credential");
}
if (bad.length) {
  console.error(bad.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Secret scan passed for tracked and untracked publishable files.",
  );
