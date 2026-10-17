# RemplirPDF MCP server

Let your AI agent prepare **French rental documents**: furnished and unfurnished leases, inventories (état des lieux),
rent receipts (quittances), rent notices, guarantor deeds, notices to quit and certificates. The agent picks the right
template, asks you for the missing details, and generates the filled PDF in your [RemplirPDF](https://remplirpdf.fr)
account, with the legal clauses already written.

> *Serveur MCP de RemplirPDF : votre assistant IA prépare bail, état des lieux, quittance de loyer et attestations
> en PDF rempli, avec les clauses légales déjà rédigées. Documentation en français : https://remplirpdf.fr/mcp*

- Remote server (recommended): `https://remplirpdf.fr/api/mcp` (Streamable HTTP, OAuth 2.1 or API key)
- Registry name: `fr.remplirpdf/mcp-server`
- Docs: https://remplirpdf.fr/mcp · Privacy: https://remplirpdf.fr/confidentialite · Terms: https://remplirpdf.fr/cgv · Support: contact@remplirpdf.fr

## What an agent can do

| Tool | What it does | Behaviour |
|---|---|---|
| `list_templates` | Lists the 20 rental templates (slug, category, signers). Call it first. | read-only |
| `get_template` | Fields of a template: required or not, expected format, options, computed fields, signers. Call it before generating. | read-only |
| `generate_document` | Fills a template with the values the user gave, saves the PDF in their account, returns a 24-hour download link. With `document_id` it replaces an earlier document made from the same template. | writes (may overwrite) |
| `list_documents` | The latest rental documents of the account. | read-only |
| `get_download_link` | A fresh 24-hour download link for a document of the account. | read-only |

Every tool has a title, a description of when to use it, described parameters, explicit `readOnlyHint` /
`destructiveHint` / `openWorldHint` annotations and an `outputSchema` (results come as `structuredContent`).

Generating documents and download links need an active RemplirPDF subscription. Without one the tools refuse with
a clear message: **no tool ever starts a payment or charges a card**. Documents must reflect a real tenancy; the
server is not meant to produce documents meant to mislead a third party.

Example: *« Prépare la quittance de loyer de septembre pour Paul Martin, 750 € plus 80,50 € de charges, 12 rue des
Lilas à Lyon. »* → `list_templates` → `get_template("quittance-de-loyer")` → the agent asks for the landlord's name →
`generate_document(...)` → a PDF link.

## Connect

### OAuth (Claude, ChatGPT, Claude Code, Cursor, VS Code)

Add the server URL; your client opens RemplirPDF, you sign in (or create an account) and click **Autoriser**. You can
disconnect at any time. Access tokens last one hour and are refreshed while the connection is active.

- **Claude** (claude.ai, Claude Desktop): Settings → Connectors → Add custom connector → `https://remplirpdf.fr/api/mcp` → Connect.
- **ChatGPT**: Settings → Apps → developer mode → Create app → `https://remplirpdf.fr/api/mcp`, authentication OAuth.
- **Claude Code**: `claude mcp add --transport http remplirpdf https://remplirpdf.fr/api/mcp`, then `/mcp` to sign in.
- **Cursor** (`~/.cursor/mcp.json`) and **VS Code** (`.vscode/mcp.json`, with `"type": "http"`): use the URL; the editor offers to sign in.

This repository's [`.mcp.json`](.mcp.json) / [`mcp.json`](mcp.json) contain the same remote configuration (no secrets).

### API key (any client that can send a header)

Create a key in your account (https://remplirpdf.fr/app/compte, « Clés API »). It is shown once; only its hash is
stored, and you can revoke it at any time. Send it as `Authorization: Bearer rpdf_…` (the `Bearer ` prefix is
optional).

```toml
# Codex CLI, ~/.codex/config.toml (then export REMPLIRPDF_API_KEY)
[mcp_servers.remplirpdf]
url = "https://remplirpdf.fr/api/mcp"
bearer_token_env_var = "REMPLIRPDF_API_KEY"
```

## Local stdio server (this repository)

For clients that only speak stdio. It exposes exactly the remote tools (their definitions are generated from the live
server into [`src/tools.json`](src/tools.json)) and runs them through RemplirPDF's HTTPS API with your API key.

```bash
# Docker
docker build -t remplirpdf-mcp .
docker run -i --rm -e REMPLIRPDF_API_KEY=rpdf_your_key remplirpdf-mcp

# From source (Node.js 20+)
npm ci && npm run build
REMPLIRPDF_API_KEY=rpdf_your_key node dist/index.js
```

```json
{
  "mcpServers": {
    "remplirpdf": {
      "command": "node",
      "args": ["/path/to/remplirpdf-mcp/dist/index.js"],
      "env": { "REMPLIRPDF_API_KEY": "rpdf_your_key" }
    }
  }
}
```

| Variable | Default | |
|---|---|---|
| `REMPLIRPDF_API_KEY` | none | API key of your account. Without it the server starts and lists its tools; calls explain how to set the key. |
| `REMPLIRPDF_MCP_URL` | `https://remplirpdf.fr/api/mcp` | Endpoint the tools are sent to. |

Maintenance: `npm run sync-tools` regenerates `src/tools.json` from the live server (`REMPLIRPDF_API_KEY` set:
`tools/list`; otherwise the public card `/.well-known/mcp/server-card.json`); `npm test` runs a stdio smoke test.

## Security and privacy

- OAuth 2.1 with PKCE (S256), exact redirect URIs, audience-bound one-hour tokens (RFC 8707), rotating refresh
  tokens, revocation (RFC 7009), Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents.
- Generated documents stay in your RemplirPDF account; download links expire after 24 hours.
- Personal data is processed as described in the privacy policy: https://remplirpdf.fr/confidentialite

## License

MIT, see [LICENSE](LICENSE). RemplirPDF is a private service, not affiliated with the French administration.
