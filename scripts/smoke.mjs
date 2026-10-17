// Smoke test of the built stdio server: initialize, tools/list, and (with REMPLIRPDF_API_KEY) a read-only call.
// Usage: npm run build && npm test
import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const rl = readline.createInterface({ input: child.stdout });
const waiting = new Map();
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  waiting.get(msg.id)?.(msg);
});
let id = 0;
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    waiting.set(i, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n");
    setTimeout(() => reject(new Error(`${method}: timeout`)), 60_000);
  });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + detail : ""}`);
};

const init = await send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
check("initialize", init.result?.serverInfo?.name === "remplirpdf" && /list_templates/.test(init.result.instructions ?? ""), JSON.stringify(init).slice(0, 200));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tl = await send("tools/list", {});
const tools = tl.result?.tools ?? [];
check("tools/list → 5 tools with annotations and output schemas", tools.length === 5 && tools.every((t) => t.annotations && t.outputSchema), tools.map((t) => t.name).join(","));
const r = await send("tools/call", { name: "list_templates", arguments: {} });
if (process.env.REMPLIRPDF_API_KEY) check("list_templates through the API → 20 templates", r.result?.structuredContent?.templates?.length === 20, JSON.stringify(r).slice(0, 200));
else check("without REMPLIRPDF_API_KEY → explains how to set it", r.result?.isError && /REMPLIRPDF_API_KEY/.test(r.result.content?.[0]?.text ?? ""));
child.kill();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
