# CLAUDE.md

better-link is a Cloudflare Worker that turns social media post URLs into clean share links with working previews in chat apps. `README.md` covers what it does, its endpoints and how to deploy it.

## Commands

Bun is used for package management and tests; the `cf` CLI runs, builds and deploys the Worker from `cloudflare.config.ts`, delegating the build to Wrangler. `cf` runs on Node 22.18 or later.

```sh
bun install
bun run dev          # cf dev, run the Worker locally
bun run typecheck    # cf workers types generates .cloudflare/types/index.d.ts, then checks src and test separately
bun test             # all unit tests
bun test ./test/clean.test.ts   # a single file
bun run check        # typecheck + test, run this before committing
bun run deploy       # cf deploy
bun run smoke        # starts cf dev on port 8799 and sends end-to-end requests to real Instagram / Facebook
```

- `.cloudflare/` holds generated types and build output and is gitignored. Until typecheck has run, types such as `Env` and `ExecutionContext` are missing. `wrangler.config.ts` sets `types.generate: false`, so `cf dev` and `cf build` do not regenerate them.
- The README's Deploy to Cloudflare button relies on `cloudflare.config.ts`, the `deploy` script and the `cloudflare` field in `package.json`. Do not add a Wrangler config file; `test/config.test.ts` fails if one appears. Keep it working without any bindings, variables or secrets, so a fresh copy deploys with no setup.
- `bun.lock` must stay at `lockfileVersion` 1. Workers Builds installs with Bun 1.2.15 by default, which rejects version 2 under `--frozen-lockfile`; Bun 1.4 reads version 1 without rewriting it but writes version 2 when it regenerates the lock. `test/config.test.ts` fails if that happens; regenerate the lock with Bun 1.3.
- Pull requests are reviewed by CodeRabbit (GitHub App), configured in `.coderabbit.yaml`. Its `knowledge_base` applies `docs/spec/*.md` to the files in their `scope`; when a spec's `scope` gains a path, add it there.
- GitHub Actions (`.github/workflows/ci.yml`) runs `bun install --frozen-lockfile` and `bun run check` with Bun 1.3.11 and Node 24 on pull requests and pushes to `main`. Keep its Bun version on 1.3 so the lock stays at version 1.
- `smoke` needs outbound network access and its result depends on what upstream returns at the time, so it is not suitable as a required CI check.

## Architecture

`ARCHITECTURE.md` maps the modules, how a request is routed, and how tests replace the cache and `fetch`.

## Specs (`docs/spec/`)

`docs/spec/*.md` are accepted hard constraints. Read the relevant specs before changing files covered by their `scope`. Each spec's frontmatter has a `verify` field with a runnable check (the part after `check:`).

What these specs have in common is that violations go unnoticed: a crawler that gets an error just silently shows no preview, and nobody reports it. So new behavior needs tests; do not rely on pasting links by hand and looking at the preview.

When adding a spec, keep the existing frontmatter (`id`, `status`, `scope`, `verify`, `related`, `source`, `adr`) and write the body in this order: the rule in one sentence, details and measurements (with date and sample size), what is out of scope, and why a violation would go unnoticed.

## Conventions

- TypeScript strict with `verbatimModuleSyntax`; write type imports as `import type` or with the `type` modifier.
- No runtime dependencies; there are only devDependencies.
- Parse upstream HTML with string search, and handle missing fields by returning `null` so the caller can 302 to the original URL.
- When adding a platform, save the upstream page as a fixture first, then write the parsing tests.
- Commit messages follow Conventional Commits with the module name as scope: `feat(facebook): ...`, `fix(clean): ...`, `test(worker): ...`, `docs(spec): ...`. Descriptions are English starting in lowercase, one change per commit, and tests are often committed separately from the implementation.
- Language: code, comments and `CLAUDE.md` are in English. Specs are in Traditional Chinese. The README exists in English (`README.md`) and Traditional Chinese (`README.zh-TW.md`); update both together.
