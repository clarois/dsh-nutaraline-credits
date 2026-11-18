# Nutaraline credits

A DeepSeek Harness bundle that shows the remaining **Nutaraline** gateway credit
and usage. It registers one page in the **Settings** panel — it is deliberately
*not* a left-bar panel, because it is something you glance at occasionally
rather than a workspace you keep open.

The page reads `GET /v1/balance` once on first mount and then only when you press
**Refresh**. It never holds the API key and never talks to `nutaraline.co.uk`:
the browser half calls a same-origin route served by the Host half, which
resolves the key from the credential store.

## What it shows

| Card | Contents |
| --- | --- |
| Balance | Available and reserved credit in IDR, account name, plan, billing status |
| Today's limits | Free daily tokens, requests per hour / per day, tokens today, rate-limit headroom |
| Model bonuses | Each per-model bonus quota with its remaining share and its own reset time |
| Usage | Lifetime requests, total tokens, input tokens, output tokens |
| API key | The variable name and whether a key is stored — never the value |
| Endpoint | The gateway base URL the Host is calling |

## Install

```
dsh plugin install dsh-nutaraline-credits
```

Or, from a checkout, point the profile at the folder and enable the bundle.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `NUTARALINE_API_KEY` | Credential name the Host resolves |
| `apiBase` | `https://nutaraline.co.uk` | Gateway base URL |

The key itself is **not** a config value. Store it once:

```
dsh credential set NUTARALINE_API_KEY
```

Configuration is read at activation, so a change needs a plugin reload. The
credential is resolved **per call with no caching**, so a rotated key applies to
the next Refresh without a restart.

## Troubleshooting

| Panel says | Meaning |
| --- | --- |
| *No key stored under `NUTARALINE_API_KEY`* | Nothing is stored under that name; run `dsh credential set`. |
| *Nutaraline rejected the API key … (HTTP 401)* | The stored key is wrong or revoked. |
| *The Nutaraline balance is exhausted (HTTP 402)* | The account is out of credit. |
| *Nutaraline is rate limiting this key (HTTP 429)* | Too many requests; wait and refresh. |
| *Could not reach `https://nutaraline.co.uk` (…)* | Network or DNS failure from the Host. |
| *The credential service is unavailable in this profile.* | The `credentials` service is not loaded. |

A failed read keeps the last good numbers on screen and shows the error above
them, so a transient network blip does not blank the page.

## Development

```
node test/host.test.cjs     # Host route, error mapping, no key leakage
node test/client.test.cjs   # slot contract and rendered output
```

Both suites run with plain `node` — no test framework and no dependencies.

See [docs/DETAIL.md](docs/DETAIL.md) for the design and the API contract.

## Licence

MIT
