// Interop check with the official MCP TypeScript SDK (client side): OAuth discovery, DCR, PKCE authorization,
// token exchange and refresh with the SDK's own helpers, then a Streamable HTTP client session with the OAuth token
// (the SDK validates tool schemas and every structuredContent against its outputSchema).
// Usage: node scripts/sdk-interop.mjs <base>   (creates a throwaway RemplirPDF account on that server)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { discoverOAuthServerInfo, exchangeAuthorization, refreshAuthorization, registerClient, selectResourceURL, startAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const MCP = new URL(`${BASE}/api/mcp`);
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + String(detail).slice(0, 300) : ""}`);
};

// 1. discovery, exactly as SDK clients do it (401 → PRM → AS metadata)
const info = await discoverOAuthServerInfo(MCP);
check("SDK discovers the authorization server from the MCP URL", info.authorizationServerUrl === BASE || info.authorizationServerUrl === `${BASE}/`, info.authorizationServerUrl);
const resource = await selectResourceURL(MCP, {}, info.resourceMetadata);
check("SDK accepts the protected resource metadata (resource = MCP URL)", String(resource) === MCP.href, String(resource));
const metadata = info.authorizationServerMetadata;
const redirectUrl = "http://127.0.0.1:53682/callback";
const client = await registerClient(info.authorizationServerUrl, {
  metadata,
  clientMetadata: { client_name: "SDK interop", redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
});
check("SDK registerClient (DCR)", !!client.client_id);
const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, { metadata, clientInformation: client, redirectUrl, scope: "documents:read documents:write", state: "sdk-state", resource });

// 2. the user signs in and clicks Autoriser (simulated with a fresh account)
const stamp = Date.now();
const su = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `delivered+mcp-sdk-${stamp}@resend.dev`, password: "sdk-password-" + stamp, name: "SDK" }) });
const cookie = (su.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("inkform_session="))?.split(";")[0];
const html = await (await fetch(authorizationUrl, { headers: { cookie } })).text();
const action = /action="(\/api\/oauth\/consent\?decision=allow[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
const back = await fetch(BASE + action, { method: "POST", headers: { cookie }, redirect: "manual" });
const loc = new URL(back.headers.get("location"));
check("SDK authorization URL → consent → code with state and iss", loc.searchParams.get("state") === "sdk-state" && loc.searchParams.get("iss") === BASE && !!loc.searchParams.get("code"), loc.href);

// 3. token exchange and refresh with the SDK
const tokens = await exchangeAuthorization(info.authorizationServerUrl, { metadata, clientInformation: client, authorizationCode: loc.searchParams.get("code"), codeVerifier, redirectUri: redirectUrl, resource });
check("SDK exchangeAuthorization → access + refresh token", !!tokens.access_token && !!tokens.refresh_token);
const refreshed = await refreshAuthorization(info.authorizationServerUrl, { metadata, clientInformation: client, refreshToken: tokens.refresh_token, resource });
check("SDK refreshAuthorization → rotated refresh token", !!refreshed.access_token && refreshed.refresh_token !== tokens.refresh_token);

// 4. a real SDK client session over Streamable HTTP
const mcp = new Client({ name: "sdk-interop", version: "1.0.0" });
await mcp.connect(new StreamableHTTPClientTransport(MCP, { requestInit: { headers: { authorization: `Bearer ${refreshed.access_token}` } } }));
check("SDK client connects (initialize)", mcp.getServerVersion()?.name === "remplirpdf", JSON.stringify(mcp.getServerVersion()));
const { tools } = await mcp.listTools();
check("SDK listTools parses the 5 tools", tools.length === 5);
const calls = [
  ["list_templates", {}],
  ["get_template", { template: "bail-meuble" }],
  ["get_template", { template: "etat-des-lieux-sortie" }],
  ["list_documents", { limit: 5 }],
];
for (const [name, args] of calls) {
  try {
    const r = await mcp.callTool({ name, arguments: args });
    check(`SDK callTool ${name} → structuredContent valid against outputSchema`, !r.isError && r.structuredContent);
  } catch (e) {
    check(`SDK callTool ${name}`, false, e.message);
  }
}
const gen = await mcp.callTool({ name: "generate_document", arguments: { template: "quittance-de-loyer", values: { periode_mois: "2026-09" } } });
check("SDK callTool generate_document with missing fields → tool error (isError), no exception", gen.isError === true);
// Optional, throwaway local databases only: E2E_ENTITLE_PSQL_URL=postgresql://… starts a trial for the account so the
// write tools run and the SDK validates their structuredContent too.
if (process.env.E2E_ENTITLE_PSQL_URL) {
  const { execFileSync } = await import("node:child_process");
  execFileSync("psql", [process.env.E2E_ENTITLE_PSQL_URL, "-qc", `UPDATE users SET sub_status='trialing' WHERE email='delivered+mcp-sdk-${stamp}@resend.dev'`]);
  const values = { periode_mois: "2026-09", bailleur_nom: "Marie Dupont", bailleur_adresse: "5 avenue Foch, 75016 Paris", locataire_nom: "Paul Martin", adresse_logement: "12 rue des Lilas, 69003 Lyon", loyer: "750", charges: "80,50" };
  try {
    const ok = await mcp.callTool({ name: "generate_document", arguments: { template: "quittance-de-loyer", values } });
    check("SDK callTool generate_document → structuredContent valid against outputSchema", !ok.isError && ok.structuredContent?.document_id);
    const link = await mcp.callTool({ name: "get_download_link", arguments: { document_id: ok.structuredContent.document_id } });
    check("SDK callTool get_download_link → structuredContent valid against outputSchema", !link.isError && link.structuredContent?.download_url);
    const docs = await mcp.callTool({ name: "list_documents", arguments: {} });
    check("SDK callTool list_documents with a document → valid structuredContent", docs.structuredContent?.documents?.length === 1);
  } catch (e) {
    check("SDK write tools", false, e.message);
  }
}
await mcp.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
