# llama-swap

[llama-swap](https://github.com/mostlygeek/llama-swap) runs one local model at a time and
swaps models on demand. When a provider instance points at a llama-swap server, T3 Code
shows which model is loaded, warns before a switch takes a model away from other threads,
and shows progress while llama-swap changes models.

This works with Claude, Codex, OpenCode and Pi. Other providers have no custom endpoint,
so nothing changes for them.

## Custom model endpoints

**Settings > Providers > Custom model endpoints** keeps a list of model servers, so you
enter each address and key once. Add as many as you need:

| Field                  | What it does                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Id                     | Short and stable. Lower case letters, numbers, `-` and `_`.                                           |
| Label                  | The name shown in lists.                                                                              |
| Base URL               | The server's address. A bare host gets `/v1` where a provider needs it.                               |
| Default context length | The model's whole window, used only when the server cannot report a size.                             |
| API key                | Stored as a secret, or read from a secret provider. Leave blank on edit to keep the saved key.        |
| Auth header            | `Authorization: Bearer` (default), `api-key` (Azure OpenAI), `x-api-key`, or Basic. Only one is sent. |
| API version            | Azure's `api-version` query parameter.                                                                |
| Default model          | What new threads on a linked instance start with. **Discover models** lists the server's models.      |

Then open a Claude or Codex instance in **Settings > Providers** and choose the endpoint
under **Endpoint**. T3 Code puts the address, key and header into that instance, and uses the
same endpoint for the Loaded badges, Unload and swap-out notices. Variables you set on the
instance itself still win.

Claude takes a bearer token or `x-api-key` directly. The `api-key` and Basic styles go through
`ANTHROPIC_CUSTOM_HEADERS`, which needs a literal key rather than a secret reference. Claude
Code will not start without a credential, so the `api-key` style also sends a placeholder
bearer token. Codex gets
a custom provider through launch arguments, with the key in its own environment variable.
OpenCode and Pi keep their addresses in their own configuration, so they do not use this list.

Not yet verified against a live Azure deployment or a Codex build that rejects the `responses`
wire format, so treat those two as untested.

## Set up an instance by hand

Point a provider instance at the server's address. The server must be reachable from the
machine that runs the environment, not from your browser or phone.

| Provider | Where the address goes                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `ANTHROPIC_BASE_URL` in the instance's **Environment variables**. T3 Code lists the server's models itself, because Claude Code's own discovery keeps only names containing "claude". |
| Codex    | A custom `model_provider` with a `base_url` in Codex's `config.toml`. T3 Code adds the server's models to the picker.                                                                 |
| OpenCode | A provider with `options.baseURL` in `opencode.json`.                                                                                                                                 |
| Pi       | A provider with `baseUrl` in Pi's `models.json`.                                                                                                                                      |

The picker reads `/running` and `/v1/models` from the same address. A server that does not
answer like llama-swap shows no badges, and the instance works as it did before.

### API keys

If llama-swap has `apiKeys` set, add `LLAMA_SWAP_API_KEY` to the instance's **Environment
variables** and mark it Sensitive. Without it, T3 Code tries the credential the provider
already sends (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` for Claude). A rejected key is
shown as no badges, so check the key if a server you know is running looks plain.

Codex's own `env_key` is not read yet. A Codex instance on a server that needs a key must
also set `LLAMA_SWAP_API_KEY`.

## What you see

- **Loaded.** In the model picker, the loaded model has a **Loaded** badge and leads its
  list. **Loading** and **Unloading** show while llama-swap changes models. Every other
  model stays selectable.
- **Context size.** Rows show the window one request can use, such as `16K ctx`. For a
  loaded model this is its context divided by its slots. For one that is not loaded it is
  the figure llama-swap lists.
- **Picking another model.** Picking a model sends nothing. llama-swap loads it when you
  send the next message, which unloads the loaded model first. If other projects or
  threads use the loaded model, a dialog lists them and how many are running. Cancel keeps
  your current pick.
- **Progress.** While a turn waits for the model, the composer shows **Unloading** and then
  **Loading**, the seconds elapsed, and the latest line from llama.cpp. llama-swap reports
  no percentage, so there is no progress bar. Stopping the turn cancels the wait.
- **Unload.** The loaded row has an **Unload** button for people who can manage providers.
  The same dialog lists affected threads first. Pick the model and send to load it again.
- **Swapped out.** If another client makes llama-swap replace a model one of your threads
  was using, a notice says which model took its place, once per swap. On web and desktop it
  is a notification with **Open thread**. On mobile it appears on the open thread. Send a
  message and llama-swap loads the thread's model again.

### Context warnings

Claude Code's first request is about 16,000 tokens, so T3 Code asks for a window of at least
20,000 tokens per slot. If a model's window per slot is below that, or llama-swap does not
report it, the switch dialog warns you and offers **Use anyway**. llama-swap reports a
model's window only once it has loaded the model, or if the model's entry sets it. Raise the
model's context size in llama-swap's config to fix a small window. Claude Code does not know
a local model's window and cannot be set to compact below 100,000 tokens, so long sessions
need a window of 100,000 tokens or more. Other providers have no warning yet because their requirements have
not been measured.

## Limits

- OpenCode and Pi only accept models defined in their own configuration, so the picker shows
  those models with their loaded state. It cannot add models the server has but the
  configuration does not.
- OpenCode and Pi read the API key only from `LLAMA_SWAP_API_KEY` on the instance.
- When one OpenCode or Pi instance uses several llama-swap servers, the picker shows state for
  the server of the model in use.
- llama-swap's model states other than `ready`, `starting` and `stopping` show no badge.
