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
if (!tauri.app?.security?.csp) fail("Tauri production CSP must be enabled");
if (!/^name\s*=\s*"orbitodb"$/m.test(cargo)) fail("Cargo package/binary name must be orbitodb");

const requiredWorkflowFragments = [
  'actions/checkout@v7',
  'actions/setup-node@v7',
  'node-version: "24"',
  'npm ci',
  'npm run test:ci',
  'npm run check:bridge',
  'npm run check:release',
  'npm run audit:security',
  'cargo test --manifest-path src-tauri/Cargo.toml --lib',
  'x86_64-pc-windows-msvc',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  '--bundles nsis',
  '--bundles dmg',
  '--bundles deb,appimage',
  'OrbitoDB-windows-x64-portable.exe',
  'OrbitoDB-windows-x64-setup.exe',
  'OrbitoDB-macos-arm64.dmg',
  'OrbitoDB-macos-x64.dmg',
  'OrbitoDB-linux-x64.deb',
  'OrbitoDB-linux-x64.AppImage',
  '.sha256',
  'fail_on_unmatched_files: true',
];

for (const fragment of requiredWorkflowFragments) {
  if (!workflow.includes(fragment)) fail(`release workflow is missing: ${fragment}`);
}

if (!workflow.includes('needs: [windows, macos, linux]')) {
  fail("release finalization must wait for every platform");
}
if (!workflow.includes('APPLE_SIGNING_IDENTITY: "-"')) {
  fail("unsigned macOS builds must use explicit ad-hoc signing");
}
if (workflow.includes("branches: [main]")) {
  fail("release workflow must not publish on ordinary main pushes");
}

console.log("release configuration is internally consistent across Windows, macOS and Linux");
