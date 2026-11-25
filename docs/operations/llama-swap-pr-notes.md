# llama-swap support: PR notes

Draft pull request notes for `feature/llama-swap-models`. Delete this file before merging.
User-facing behaviour is in [docs/user/llama-swap.md](../user/llama-swap.md).

## What this adds

T3 Code works with a local [llama-swap](https://github.com/mostlygeek/llama-swap) server for
Claude, Codex, OpenCode and Pi instances that point at one.

- Discovers the server's models and shows which is loaded, with its context size.
- Picking another model sends nothing. llama-swap loads it on the next send.
- A confirm dialog lists the other projects and threads using the loaded model, and warns when
  a model's context per slot is below Claude Code's floor (40,000 tokens).
- A composer banner shows Unloading, then Loading, with elapsed time and the latest llama.cpp
  line, while a turn waits.
- A manual **Unload** button, gated by `providers:manage`.
- A toast when another client makes llama-swap replace a thread's model.
- llama-swap servers that use `apiKeys` (one `Authorization: Bearer` header only).

## Commits

| Commit       | Scope                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `65a98d4721` | Server service: status, unload, log tail, launch-command parsing             |
| `9d5881f889` | `provider.llamaSwap.subscribe` and `unload` RPCs, client atoms, pure helpers |
| `e08ce1f218` | Web picker badges, context size, Unload button, Codex model merge            |
| `3471a6f2f3` | Web confirm dialog and composer load banner                                  |
| `43e9139a82` | 20 second swap-out sweep, `swapEvents` stream, web toast                     |
| `54dbd98d32` | OpenCode and Pi upstream-provider endpoints                                  |
| `8b10f80fbf` | Mobile badge, Unload, confirm alerts, load and swap-out notices              |
| `600c8167f7` | `docs/user/llama-swap.md` and links from the four provider pages             |

## Design notes

- Clients name an instance id, never a URL. The server resolves the endpoint and API key from
  the instance's own config, so it cannot be pointed at an arbitrary address.
- Context comes from the launch command (`--fit-ctx`, then `-c` or `--ctx-size`, and `-np` or
  `--parallel`), never `/props`, which reports the wrong figure for `--fit-ctx`. The listed
  `/v1/models` figure is per slot and is recorded as one slot.
- Nothing streams while idle. The status stream runs only while the picker is open or a turn is
  busy. The swap-out sweep reads nothing when no instance has a custom endpoint.
- The switch plan, conflict check, load stage and model location live in
  `packages/client-runtime/src/state/llamaSwap.ts`, shared by web and mobile.

## Differences from the original plan

- OpenCode and Pi use a new `ServerProvider.subProviderEndpoints` field (keyed by upstream
  provider id) instead of `ServerProviderSubProvider.endpoint`, which would have regrouped
  their pickers.
- On OpenCode and Pi the API key comes only from `LLAMA_SWAP_API_KEY` on the instance. Keys
  from their own configs would have had to travel in the snapshot sent to clients.
- Codex's `env_key` is not read. A Codex instance on a server that needs a key also sets
  `LLAMA_SWAP_API_KEY`.
- The mobile swap-out notice shows only on the open thread, not app-wide.

## Not done

- Not tried against a real llama-swap server or in a running app. The `test-t3-app` and
  `test-t3-mobile` walk-throughs are owed, including the swap-out, `apiKeys` and small-context
  cases.
- The `/running` state names are unchecked. Only `ready`, `starting` and `stopping` map to a
  badge.
- Context floors for Codex, OpenCode and Pi are unmeasured, so only Claude warns.
- Not confirmed that OpenCode's server API returns `options.baseURL`.
- No browser or mobile UI tests, only unit tests for the logic.
- `vp run check:changed` could not run on the SMB share used for development (every file reads
  as changed, then `spawn E2BIG`). Targeted typechecks and tests passed instead, and each
  commit passed the format, lint and knip hook.

## Checks run

- Typecheck clean for contracts, client-runtime, provider-core, provider-pi, provider-opencode,
  server, web and mobile.
- Server (238 tests across 19 files), client-runtime (85) and the web row helper (3) pass.
- `vp run i18n:check` passes. New strings are translated in all nine locales for web and mobile.
