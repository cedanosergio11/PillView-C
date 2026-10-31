/**
 * GitHub Pages post-build: SPA shell as index/404, rewrite SSR CSS hashes
 * to client assets, and add .nojekyll + a static web manifest.
 */
import { copyFileSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CANDIDATE_DIRS = ["dist/client", "dist", ".output/public"];

function clientDir() {
  for (const dir of CANDIDATE_DIRS) {
    if (existsSync(join(dir, "index.html")) || existsSync(join(dir, "_shell.html"))) return dir;
  }
  return null;
}

function rewriteMissingAssets(html, assetsDir) {
  if (!existsSync(assetsDir)) return html;
  const files = readdirSync(assetsDir);
  return html.replace(/\/assets\/([A-Za-z0-9_.-]+)/g, (match, name) => {
    if (files.includes(name)) return match;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
    const prefix = name.replace(/-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/, "");
    const alt = files.find((f) => f.startsWith(prefix + "-") && f.endsWith("." + ext));
    return alt ? match.replace(name, alt) : match;
  });
}

const dir = clientDir();
if (!dir) {
  console.error("[pages-fallback] no index.html or _shell.html in dist or .output");
  process.exit(1);
}

const shell = existsSync(join(dir, "_shell.html")) ? join(dir, "_shell.html") : null;
const indexPath = join(dir, "index.html");
if (!existsSync(indexPath)) {
  if (!shell) {
    console.error("[pages-fallback] missing index.html in", dir);
    process.exit(1);
  }
  copyFileSync(shell, indexPath);
}

let html = readFileSync(indexPath, "utf8");
html = rewriteMissingAssets(html, join(dir, "assets"));
writeFileSync(indexPath, html);
writeFileSync(join(dir, "404.html"), html);
writeFileSync(join(dir, ".nojekyll"), "");

const grokDir = join(dir, "__grok");
const manifestPath = join(grokDir, "manifest.webmanifest");
if (existsSync(grokDir) && !existsSync(manifestPath)) {
  // Same rule as pagesBase() in vite.config.ts: BASE_PATH wins, trailing slash enforced.
  const rawBase = process.env.BASE_PATH?.trim() || "/mpd-360-pill-calculator/";
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  writeFileSync(
    manifestPath,
    JSON.stringify({
      name: "PillView",
      short_name: "PillView",
      start_url: base,
      display: "standalone",
      background_color: "#0e1116",
      theme_color: "#0e1116",
      icons: [
        { src: `${base}__grok/icon-180.png`, sizes: "180x180", type: "image/png" },
      ],
    }),
  );
}

console.log("[pages-fallback]", indexPath, "->", join(dir, "404.html"));
