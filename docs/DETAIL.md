# Design notes

## Why the section lives in Settings

`settings.section` is a list slot: one settings page per entry. Its registrant
options carry the navigation identity — `id` is the section key, `order` its
position in the nav, and `label` the displayed name. The label is registered as
a **thunk** rather than a string, because the shell re-reads a thunk on every
projection; that way a locale change updates the nav row without re-registering
the slot.

Alternatives that were considered and rejected:

- `settings.general.item` — renders a single preference row, not a whole page.
  The balance needs a page with several cards.
- `plugins.detail.section` — attaches to a plugin card inside the plugin list.
  Discoverable only if you already know which plugin to open.
- `sidebar.panellist` — what the sibling image bundles use. Keeping an
  always-visible left-bar icon for a read-only readout is disproportionate.

## Why the browser never calls Nutaraline

`nutaraline.co.uk` sends no CORS headers, so a page-origin request fails
preflight. More importantly the API key must not reach the browser at all: a
value in page memory is visible to anything that can run script in that page.

So the bundle splits in two:

```
page  --POST /nutaraline-credits/api/balance-->  Host
                                                  |
                                     credentials.resolve('NUTARALINE_API_KEY')
                                                  |
                                     GET https://nutaraline.co.uk/v1/balance
```

The Client calls the Host's own route, which is same-origin and therefore needs
no CORS cooperation. The route is registered with `kind: 'prefix'` and a
`handler`; a `resource` route answers only GET and HEAD, so it could not carry
the POST bodies this route uses (and refusing GET by default is a useful
property — see below).

## Route contract

`POST /nutaraline-credits/api/<method>` with a JSON object body.

| Method | Result |
| --- | --- |
| `balance` | The flattened `/v1/balance` summary |
| `keyState` | `{ apiKeyEnv, configured, source?, writable, masked? }` — never the value |

Failures answer `{ ok: false, error: "<sentence>" }`. The Client throws that
sentence verbatim, so the gateway's own explanation reaches the screen instead
of a generic "request failed".

Method handling:

- **GET → 405** with an `allow` header. A browser cannot read the route by
  navigation, so a leaked URL cannot be used to trigger a spend.
- Unknown method → **404**.
- Non-JSON or non-object body → **400**.

`JSON.parse` also accepts a bare array, a string and `null`, so the guard
rejects anything that is not a plain object rather than treating it as absent
arguments.

## What the summary keeps

`readonlySummary()` flattens the gateway payload into camelCase and drops
`undefined`/`null` with a `compact()` helper, so absent fields disappear instead
of rendering as `"undefined"`. Reset timestamps arrive as **seconds** and are
converted to milliseconds by `toMilliseconds()`, because the page's `clock()`
formatter takes epoch milliseconds like `Date.now()`.

Only fields the panel actually renders are carried through. A pass-through of
the raw payload would grow silently as the gateway adds fields, and every added
field would be one more thing that might be rendered without a check.

## Errors the Host maps

| Upstream | Sentence shown |
| --- | --- |
| 401 / 403 | `Nutaraline rejected the API key stored under <name> (HTTP n).` |
| 402 | `The Nutaraline balance is exhausted (HTTP 402).` |
| 429 | `Nutaraline is rate limiting this key (HTTP 429). Try again shortly.` |
| other | `The balance request failed (HTTP n).` |
| transport | `Could not reach <base> (<reason>).` |

The upstream body is not forwarded. It is untrusted text that would be rendered
into the page, and the status code already identifies the situation.

The docs warn against automatically retrying after an ambiguous POST. The route
performs no retries at all: `/v1/balance` is read-only, and a user-initiated
Refresh is the right retry mechanism.

## State handling

The store lives at module scope rather than in component state. The settings
shell unmounts a section when the user navigates away, so component state would
be discarded and every visit would force another network read. With a
module-scope store, returning to the page renders the cached numbers instantly
and only **Refresh** re-reads.

The mount effect is guarded by `store.data === null && store.error === '' &&
!store.loading`, so a remount while data is present performs no request.

A failed read keeps the previous data and shows the error above it — a transient
blip should not blank the page. The last good data is never cleared by an error.

## Testing notes

Both suites run under plain `node` with no dependencies. The Client suite loads
the real bundle through a `window.__ModuleLoader__` stub and renders it with a
small React stand-in.

Two details of that stand-in are worth recording, because getting them wrong
produces a misleading "nothing rendered" result:

1. **Hook state is keyed by component identity**, not by one global cursor. The
   stub invokes function components by calling them, so a flat cursor lets one
   component's `useState` shift another component's slot index between renders.
2. **Effects are queued during render and flushed after commit**, which is what
   React does. Running them inline during render would fire the mount read
   before the tree that depends on it was ever committed.

The registration callback is a render function returning `h(Section, { ctx })`,
so the suite renders that element rather than treating it as the final tree.

The Host suite stubs the credential service and drives the real handler with
stub request/response objects, using a trimmed real `/v1/balance` response as
the fixture. It asserts that the API key never appears anywhere in the payload.
