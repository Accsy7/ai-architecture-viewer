# Contributing

Thanks for helping improve AI 架构查看器.

## Before you begin

- Read [SECURITY.md](SECURITY.md). Do not include credentials, real architecture material, customer data, internal directory names, or provider outputs containing sensitive content in an issue or pull request.
- Keep the public demo fictional. Put real project packages outside this repository or in a private workspace.
- Discuss a material product or data-contract change in an issue before investing in a large implementation.

## Local setup

```powershell
npm install
npm test
npm run build
npm start
```

The local application is served at `http://127.0.0.1:8800` by default. See [README.md](README.md) for optional model-provider configuration.

## Pull requests

Keep each pull request focused and explain:

- the user-facing problem and the chosen behavior;
- changes to data contracts, API behavior, or visual interaction;
- tests you ran;
- any migration or compatibility consideration.

Before requesting review, run:

```powershell
npm test
npm run build
git status --ignored
```

AI-generated architecture suggestions must remain evidence-backed and human-reviewable. Never add a path that lets a model directly publish a change, override a human confirmation, or write a secret into project data.

## Contribution licensing

By submitting a pull request or other contribution, you confirm that you have
the right to submit it and agree that the project may distribute your
contribution as part of this repository under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Contributions must retain the
project's [NOTICE](NOTICE); use of the project name and Logo remains subject to
[TRADEMARKS.md](TRADEMARKS.md).

## Style and scope

Preserve the existing calm, paper-like visual language unless the change explicitly calls for a design decision. Prefer small, accessible components, explicit server-side validation, and backward-compatible data changes. Add or update tests whenever behavior changes.

## Code of conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
