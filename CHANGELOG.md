# Changelog

All notable changes to AI Architecture Viewer are documented in this file.

## [0.1.0] - 2026-07-14

### Added

- A local-first visual workspace for comparing current and target architecture.
- Human-controlled drafts, publication, immutable revision history, restore, and
  structured architecture differences.
- Evidence-backed AI proposals generated only from materials explicitly
  selected by the user.
- A project document registry with safe preview, diagnostics, references, and
  lifecycle controls.
- Independent architecture diagrams, layout persistence, smart edge routing,
  and focused detail inspection.
- A fictional public demo package that requires no customer or internal data.
- Three vendor-neutral AI coding collaboration skills and a validated exchange
  artifact protocol.
- Chinese and English project documentation, contribution guidance, security
  reporting, and community standards.

### Security and governance

- The local server binds to `127.0.0.1` by default.
- Model credentials are read only from the process environment.
- AI cannot publish or modify a formal architecture without explicit human
  confirmation.
- Real project packages, generated output, local migrations, dependencies, and
  secret files are excluded from the public repository by default.

### Known limitations

- The v0.1.x server has no authentication, CSRF protection, or multi-user
  authorization and must not be exposed directly to a LAN or the public
  internet.
- Repository understanding is based on explicitly selected materials; automatic
  whole-repository scanning is not included.
- The built-in model provider integration currently uses DeepSeek-compatible
  environment configuration.
- GitHub may display the PolyForm license as “Other”; the authoritative terms
  remain in [LICENSE](LICENSE) and [NOTICE](NOTICE).
