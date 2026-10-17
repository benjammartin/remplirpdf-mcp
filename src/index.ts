#!/usr/bin/env node
// RemplirPDF MCP server (stdio). Exposes the same tools as the remote server https://remplirpdf.fr/api/mcp and
// runs them through RemplirPDF's HTTPS API with your API key (REMPLIRPDF_API_KEY). Tool definitions come from
// src/tools.json, generated from the live server by `npm run sync-tools`, so they never drift from it.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import catalog from "./tools.json" with { type: "json" };

const VERSION = "1.1.0";
const ENDPOINT = (process.env.REMPLIRPDF_MCP_URL || "https://remplirpdf.fr/api/mcp").replace(/\/$/, "");
const API_KEY = process.env.REMPLIRPDF_API_KEY?.trim();
const TOOLS = catalog.tools as unknown as Tool[];
const NAMES = new Set(TOOLS.map((t) => t.name));

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

let rid = 0;
async function callRemote(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!API_KEY)
    return failure(
      "REMPLIRPDF_API_KEY is not set. Create an API key in your RemplirPDF account (https://remplirpdf.fr/app/compte, section « Clés API ») and add it to this server's environment. " +
        "Clients that support OAuth can use the remote server https://remplirpdf.fr/api/mcp directly instead.",
    );
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${API_KEY}`,
        "mcp-protocol-version": "2025-11-25",
        "user-agent": `remplirpdf-mcp/${VERSION}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return failure(`RemplirPDF is unreachable (${e instanceof Error ? e.message : String(e)}). Try again in a moment.`);
  }
  if (res.status === 401) return failure("RemplirPDF rejected the API key (unknown or revoked). Create a new key at https://remplirpdf.fr/app/compte.");
  if (res.status === 403) return failure("This API key is not allowed to run this tool.");
  if (!res.ok) return failure(`RemplirPDF answered HTTP ${res.status}. Try again later or write to contact@remplirpdf.fr.`);
  const body = (await res.json().catch(() => null)) as { result?: CallToolResult; error?: { message?: string } } | null;
  if (body?.error) return failure(body.error.message ?? "RemplirPDF returned an error.");
  if (!body?.result) return failure("Unexpected answer from RemplirPDF.");
  return body.result;
}

const server = new Server(
  { name: "remplirpdf", title: "RemplirPDF : documents de location", version: VERSION, websiteUrl: "https://remplirpdf.fr/mcp" },
  { capabilities: { tools: { listChanged: false } }, instructions: catalog.instructions },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (!NAMES.has(name)) return failure(`Unknown tool: ${name}. Available: ${[...NAMES].join(", ")}.`);
  return callRemote(name, (args ?? {}) as Record<string, unknown>);
});

await server.connect(new StdioServerTransport());
console.error(`remplirpdf-mcp ${VERSION} on stdio → ${ENDPOINT}${API_KEY ? "" : " (no REMPLIRPDF_API_KEY: tools will explain how to set one)"}`);
