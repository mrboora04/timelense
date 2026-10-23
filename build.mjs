/* Builds a minified copy of the extension into dist/ (load that folder in Chrome or zip it
   for the Web Store). Source files stay readable; only dist/ is minified.
   node build.mjs          -> build
   node build.mjs --test   -> build, then run the test suite against dist/ */
import { transform } from "esbuild";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const OUT = "dist";
const kb = n => (n / 1024).toFixed(1) + " KB";
const filesIn = dir => readdirSync(dir, { recursive: true }).map(f => join(dir, f)).filter(f => statSync(f).isFile());
const total = (list, size = f => statSync(f).size) => list.reduce((a, f) => a + size(f), 0);
const gz = f => gzipSync(readFileSync(f), { level: 9 }).length;

const code = readdirSync(".").filter(f => /\.(js|css|html)$/.test(f) && f !== "build.mjs");
const sources = [...code, "manifest.json", ...filesIn("icons"), "model/lens.bin"];
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

for (const f of code) {
  const src = readFileSync(f, "utf8");
  const out = f.endsWith(".html")
    ? src.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim()
    /* No bundling and no output format: the scripts share globals across files
       (lib.js -> ui.js -> panel.js), so esbuild keeps top-level names and shortens the rest.
       (Bundling each page instead duplicates lib.js three times and ends up bigger.) */
    : (await transform(src, { loader: f.endsWith(".css") ? "css" : "js", minify: true, legalComments: "none" })).code;
  writeFileSync(join(OUT, f), out);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(JSON.parse(readFileSync("manifest.json", "utf8"))));
cpSync("icons", join(OUT, "icons"), { recursive: true });
mkdirSync(join(OUT, "model"));
cpSync("model/lens.bin", join(OUT, "model/lens.bin"));   // Lens's own words (talk.js)

const built = filesIn(OUT);
console.log(`dist/ built: ${kb(total(sources))} -> ${kb(total(built))}` +
  ` (gzipped: ${kb(total(sources, gz))} -> ${kb(total(built, gz))})`);

if (process.argv.includes("--test")) {
  const r = spawnSync(process.execPath, ["--test", "test/"], { stdio: "inherit", env: { ...process.env, TL_ROOT: OUT } });
  process.exit(r.status);
}
