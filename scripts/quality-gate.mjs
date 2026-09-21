import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const roots = ["src", "server", "src-tauri/src"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".rs"]);
const forbidden = [
  { re: /\bTODO\b/i, label: "TODO marker" },
  { re: /\bFIXME\b/i, label: "FIXME marker" },
  { re: /coming soon/i, label: "coming-soon placeholder" },
  { re: /not implemented/i, label: "not-implemented placeholder" },
  { re: /MamaSQL/i, label: "legacy MamaSQL runtime reference" },
  { re: /ImportCsvModal/i, label: "obsolete CSV import path" },
];

const ignored = new Set([
  "src/vite-env.d.ts",
]);

const files = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (extensions.has(path.extname(file))) files.push(file.replaceAll("\\", "/"));
  }
}
for (const root of roots) walk(root);

const failures = [];
for (const file of files) {
  if (ignored.has(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const rule of forbidden) {
    const match = rule.re.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    failures.push(`${file}:${line}: ${rule.label}`);
  }
}

for (const legacy of [
  "src/App.css",
  "src/assets/react.svg",
  "public/vite.svg",
  "public/tauri.svg",
  "src/components/bud/ImportCsvModal.tsx",
  "src/components/builder/Builder.tsx",
  "src/components/mantine/Workspace.tsx",
]) {
  if (existsSync(legacy)) failures.push(`${legacy}: obsolete/template asset still exists`);
}

if (failures.length) {
  console.error("source quality gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`source quality gate passed (${files.length} source files scanned)`);
