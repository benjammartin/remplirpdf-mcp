// Regenerates src/tools.json from the live server, so the stdio server exposes exactly the remote tools.
// With REMPLIRPDF_API_KEY: tools/list + initialize on the MCP endpoint (authoritative). Without: the public static
// card /.well-known/mcp/server-card.json (same tool definitions, no credentials needed).
// Usage: npm run sync-tools            (REMPLIRPDF_URL=https://remplirpdf.fr by default)
import fs from "node:fs";

const SITE = (process.env.REMPLIRPDF_URL || "https://remplirpdf.fr").replace(/\/$/, "");
const KEY = process.env.REMPLIRPDF_API_KEY?.trim();
const OUT = new URL("../src/tools.json", import.meta.url);

async function rpc(method, params) {
  const r = await fetch(`${SITE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

let tools, instructions, version, source;
if (KEY) {
  const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "remplirpdf-mcp sync-tools", version: "1" } });
  tools = (await rpc("tools/list", {})).tools;
  instructions = init.instructions;
  version = init.serverInfo?.version;
  source = `${SITE}/api/mcp (tools/list)`;
} else {
  const r = await fetch(`${SITE}/.well-known/mcp/server-card.json`);
  if (!r.ok) throw new Error(`server card: HTTP ${r.status}`);
  const card = await r.json();
  tools = card.tools;
  instructions = card.instructions;
  version = card.serverInfo?.version;
  source = `${SITE}/.well-known/mcp/server-card.json`;
}
if (!Array.isArray(tools) || !tools.length) throw new Error("no tools received");
// The live instructions mention the site's own URL: keep the production one in the package.
const fix = (s) => (typeof s === "string" ? s.split(SITE).join("https://remplirpdf.fr") : s);
fs.writeFileSync(OUT, JSON.stringify({ source: fix(source), serverVersion: version, instructions: fix(instructions), tools }, null, 2) + "\n");
console.log(`src/tools.json: ${tools.length} tools from ${source} (server ${version})`);
