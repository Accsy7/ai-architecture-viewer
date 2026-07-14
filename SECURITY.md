# Security Policy

## Supported versions

Security fixes are applied to the latest `0.1.x` release line. Older versions may not receive fixes.

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

- Keep provider keys such as `DEEPSEEK_API_KEY` in a terminal environment or deployment secret store.
- Never commit `.env` files, access tokens, real architecture exports, or customer data.
- If a credential is exposed, revoke or rotate it immediately, then remove it from current files and repository history before publishing.
- Treat model inputs and outputs as potentially sensitive; select only material approved for the configured model provider.

## Local-only deployment boundary

Version `0.1.x` is designed for local use and binds its server to `127.0.0.1`. Its mutation APIs do not yet include authentication, CSRF protection, or multi-user authorization. Do not expose it through a reverse proxy, LAN address, or public endpoint until those controls and a deployment threat model have been added.
