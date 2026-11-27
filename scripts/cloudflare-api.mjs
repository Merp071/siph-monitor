/** Administrative API client: used locally, never bundled into the Worker. */
export async function cloudflare(path, options = {}) {
  if (!process.env.CLOUDFLARE_API_TOKEN)
    throw Error(
      "Set CLOUDFLARE_API_TOKEN in the local environment. Never commit it.",
    );
  const headers = {
    Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN,
    ...options.headers,
  };
  if (options.body && !(options.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...options,
    headers,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw Error("Cloudflare API returned HTTP " + r.status);
  const result = await r.json();
  if (!result.success) throw Error("Cloudflare API did not confirm success.");
  return result.result;
}
