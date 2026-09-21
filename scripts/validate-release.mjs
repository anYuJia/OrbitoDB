import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`release validation failed: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const workflow = readFileSync(".github/workflows/release.yml", "utf8");

if (pkg.name !== "orbitodb") fail(`package.json name is ${pkg.name}`);
if (tauri.productName !== "OrbitoDB") fail(`unexpected productName: ${tauri.productName}`);
if (tauri.identifier !== "com.anyujia.orbitodb") fail(`unexpected identifier: ${tauri.identifier}`);
if (tauri.build?.frontendDist !== "../dist") fail("frontendDist must remain ../dist");
if (!tauri.bundle?.active) fail("Tauri bundle must stay active for installer builds");
if (!/^name\s*=\s*"orbitodb"$/m.test(cargo)) fail("Cargo package/binary name must be orbitodb");
if (!workflow.includes("src-tauri/target/release/orbitodb.exe")) {
  fail("release workflow artifact path does not match the Cargo binary name");
}
if (!workflow.includes("npm ci")) fail("release workflow must use npm ci");
if (!workflow.includes("npm run test:ci")) fail("release workflow must run the shared frontend test gate");

console.log("release configuration is internally consistent");
