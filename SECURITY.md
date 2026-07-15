# Security Policy

## Supported versions

Security fixes are applied to the latest `0.2.x` release line. Older versions may not receive fixes.

## Reporting a vulnerability

Please do not disclose a vulnerability, secret, or exploit path in a public issue or pull request.

Use the repository's private vulnerability-reporting channel when it is available. If no private channel has been configured yet, open a minimal public issue requesting a private contact path without including technical details, credentials, affected data, or proof-of-concept code.

Include, through the private channel only:

- a concise description of the impact;
- affected version and configuration;
- safe reproduction steps;
- any suggested mitigation.

Maintainers will acknowledge a valid report, assess the impact, coordinate a remediation, and publish disclosure details after users have had a reasonable opportunity to update.

## Secret handling

- Never commit `.env` files, access tokens, real architecture exports, or customer data.
- If a credential is exposed, revoke or rotate it immediately, then remove it from current files and repository history before publishing.
- Treat agent artifacts, evidence excerpts, repository paths, and architecture exports as potentially sensitive. Submit only material inside the user-authorized project scope.
- Point `VIEWER_WORKSPACE_ROOT` only at the repository the user authorized for inspection. Evidence paths are confined to that root and are never accepted as absolute or traversing paths.
- Review local MCP configuration before trusting it. The bundled server starts local Node processes and can submit validated artifacts to the viewer, but it exposes no approval or publication tool.

## Local-only deployment boundary

Version `0.2.x` is designed for local use and binds its HTTP server to `127.0.0.1`; the MCP integration uses local STDIO. Mutation APIs do not yet include authentication, CSRF protection, or multi-user authorization. Do not expose the HTTP service through a reverse proxy, LAN address, or public endpoint until those controls and a deployment threat model have been added.
