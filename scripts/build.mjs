import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
const root = new URL("../", import.meta.url);
const ASSETS = {};
for (const file of ["index.html", "app.js", "style.css", "login.js"])
  ASSETS["/" + file] = await readFile(new URL("web/" + file, root), "utf8");
const login = await readFile(new URL("web/login.html", root), "utf8");
await writeFile(
  new URL("src/generated-assets.mjs", root),
  "export const ASSETS=" +
    JSON.stringify(ASSETS) +
    ";\nexport const LOGIN=" +
    JSON.stringify(login) +
    ";\n",
);
await mkdir(new URL("build/", root), { recursive: true });
await build({
  stdin: {
    contents: "export { default } from './src/worker.mjs'",
    resolveDir: new URL(root).pathname,
    sourcefile: "entry.mjs",
  },
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: new URL("build/worker.mjs", root).pathname,
  minify: true,
  legalComments: "none",
});
console.log("Built Worker and authenticated dashboard. No secrets embedded.");
