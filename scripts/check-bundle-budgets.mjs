import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join(process.cwd(), "dist", "assets");
const assets = readdirSync(assetsDir);

function entryAsset(extension) {
  const matches = assets.filter((name) => name.startsWith("index-") && name.endsWith(extension));
  if (matches.length !== 1) throw new Error(`Expected one index-*${extension} asset, found ${matches.length}.`);
  const name = matches[0];
  return { name, bytes: statSync(join(assetsDir, name)).size };
}

const js = entryAsset(".js");
const css = entryAsset(".css");
const budgets = {
  js: 500 * 1024,
  css: 130 * 1024,
};

const violations = [
  js.bytes > budgets.js && `${js.name} is ${(js.bytes / 1024).toFixed(1)} KB (budget: 500 KB)`,
  css.bytes > budgets.css && `${css.name} is ${(css.bytes / 1024).toFixed(1)} KB (budget: 130 KB)`,
].filter(Boolean);

if (violations.length) {
  throw new Error(`Bundle budget exceeded:\n${violations.map((line) => `- ${line}`).join("\n")}`);
}

console.log(
  `Bundle budgets passed (startup JS ${(js.bytes / 1024).toFixed(1)} KB, CSS ${(css.bytes / 1024).toFixed(1)} KB).`,
);
