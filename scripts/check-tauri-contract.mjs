import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const frontend = readFileSync(new URL("../src/ipc/tauri.ts", import.meta.url), "utf8");
const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

const invoked = new Set([...frontend.matchAll(/\binvoke(?:<[^>]+>)?\(\s*"([a-z0-9_]+)"/g)].map((match) => match[1]));
const handlerBlock = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
const registered = new Set(
  [...handlerBlock.matchAll(/(?:commands::)?([a-z][a-z0-9_]*)\s*,/g)].map((match) => match[1]),
);

assert.ok(invoked.size > 0, "No Tauri invoke calls were discovered");
assert.ok(registered.size > 0, "No Tauri command registrations were discovered");

const missing = [...invoked].filter((command) => !registered.has(command));
assert.deepEqual(missing, [], `Frontend invokes unregistered Tauri commands: ${missing.join(", ")}`);

console.log(`Tauri contract check passed (${invoked.size} frontend commands registered)`);
