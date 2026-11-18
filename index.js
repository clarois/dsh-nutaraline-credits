/**
 * Host half of the Nutaraline credits bundle.
 *
 * Two facts shape this module:
 *
 *   1. `nutaraline.co.uk` sends no CORS headers, so the page cannot call the
 *      gateway itself. Every request goes through the same-origin route below.
 *   2. The API key must never reach the browser. It is read per call from the
 *      credential seam, which keeps the value in the profile store and lets a
 *      rotated key take effect on the next refresh without a restart.
 *
 * Only `GET /v1/balance` is used. It is a documented read-only endpoint; the
 * section never spends credit and never issues a generation request.
 */

const DEFAULT_API_BASE = 'https://nutaraline.co.uk'
const DEFAULT_ENV_NAME = 'NUTARALINE_API_KEY'
const ROUTE_PATH = '/nutaraline-credits/api'

/** The gateway is a plain HTTPS service; a slow read should not hang the panel. */
const REQUEST_TIMEOUT_MS = 20000

/**
 * `loadSchemastery` mirrors the sibling image bundles: Cordis validates a row's
 * `config` through `Config['~standard'].validate`, and a plain object literal
 * would crash activation with "Cannot read properties of undefined (reading
 * 'validate')". Resolving the real schema keeps the row validatable.
 */
async function loadSchemastery() {
  try {
    const mod = await import('schemastery')
    return mod.default ?? mod
  } catch {
    return undefined
  }
}

const z = await loadSchemastery()

const configSchema =
  typeof z?.object === 'function'
    ? z.object({
        apiKeyEnv: z.string().default(DEFAULT_ENV_NAME),
        apiBase: z.string().default(DEFAULT_API_BASE),
      })
    : undefined

export const Config = configSchema?.['~standard'] ? configSchema : undefined

export const inject = ['webServer']

/* ------------------------------------------------------------------- helpers */

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** The gateway returns seconds; the panel shows local time from milliseconds. */
function toMilliseconds(value) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined
}

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/* ---------------------------------------------------------------- credentials */

/**
 * Resolve the API key for one request.
 *
 * Resolution is deliberately per call and never cached: the seam documents that
 * a stored value outranks the launching environment and that a rotation applies
 * to the next operation, which only holds while nothing is held across calls.
 */
async function resolveCredentials(ctx, config) {
  const apiKeyEnv = clean(config?.apiKeyEnv) || DEFAULT_ENV_NAME
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new Error('The credential service is unavailable in this profile.')
  }
  const resolved = await credentials.resolve(apiKeyEnv)
  const apiKey = clean(resolved?.value)
  if (apiKey === '') {
    throw new Error(
      `No Nutaraline API key is stored under ${apiKeyEnv}. Add it to the credential store, then refresh.`,
    )
  }
  return {
    apiKey,
    apiKeyEnv,
    apiBase: (clean(config?.apiBase) || DEFAULT_API_BASE).replace(/\/+$/, ''),
  }
}

/* --------------------------------------------------------------- the balance */

/**
 * Shape one `/v1/balance` payload for the panel.
 *
 * The gateway returns a great deal more than the panel shows. Everything below
 * is optional-by-construction: a field the gateway omits or renames becomes
 * absent rather than `NaN`, so a gateway change degrades one row instead of
 * breaking the whole section. `undefined` values are dropped so the client can
 * use a plain truthiness check.
 */
export function readonlySummary(payload, meta = {}) {
  const source = payload ?? {}
  const unlimited = source.stable_unlimited ?? {}
  const daily = source.daily_free_tokens ?? {}

  const compact = (object) => {
    const out = {}
    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined && value !== null) out[key] = value
    }
    return out
  }

  return compact({
    // Identity and plan
    username: clean(source.username),
    billingStatus: clean(source.billing_status) || clean(source.status),
    plan: clean(source.product) || clean(source.quota_tier),

    // Money, in rupiah
    balanceIdr: Number.isFinite(Number(source.balance_idr)) ? Number(source.balance_idr) : undefined,
    availableIdr: Number.isFinite(Number(source.available_idr)) ? Number(source.available_idr) : undefined,
    reservedIdr: Number.isFinite(Number(source.reserved_idr)) ? Number(source.reserved_idr) : undefined,

    // Lifetime traffic
    totalTokens: toCount(source.total_tokens),
    promptTokens: toCount(source.prompt_tokens),
    completionTokens: toCount(source.completion_tokens),
    requests: toCount(source.requests),

    // Stable Pool limits
    rpmLimit: Number.isFinite(Number(unlimited.rpm?.limit)) ? Number(unlimited.rpm.limit) : undefined,
    rpmAvailable: Number.isFinite(Number(unlimited.rpm?.available)) ? Number(unlimited.rpm.available) : undefined,
    rpmResetAt: toMilliseconds(unlimited.rpm?.reset_at),
    hourlyUsed: unlimited.hour === undefined ? undefined : toCount(unlimited.hour.used),
    hourlyLimit: unlimited.hour === undefined ? undefined : toCount(unlimited.hour.limit),
    hourlyResetAt: toMilliseconds(unlimited.hour?.reset_at),
    dailyUsed: unlimited.day === undefined ? undefined : toCount(unlimited.day.used),
    dailyLimit: unlimited.day === undefined ? undefined : toCount(unlimited.day.limit),
    dailyResetAt: toMilliseconds(unlimited.day?.reset_at),
    tokenUsed: unlimited.tokens === undefined ? undefined : toCount(unlimited.tokens.used),
    tokenLimit: unlimited.tokens === undefined ? undefined : toCount(unlimited.tokens.limit),
    tokenResetAt: toMilliseconds(unlimited.tokens?.reset_at),
    timezone: clean(unlimited.timezone),
    maxOutput: Number.isFinite(Number(unlimited.max_output)) ? Number(unlimited.max_output) : undefined,

    // Unrestricted daily budget that applies to every account
    freeDailyLimit: daily.limit === undefined ? undefined : toCount(daily.limit),
    freeDailyUsed: daily.used === undefined ? undefined : toCount(daily.used),
    freeDailyRemaining: daily.remaining === undefined ? undefined : toCount(daily.remaining),
    freeDailyResetAt: toMilliseconds(daily.resets_at),

    // Per-model bonuses
    quotas: Array.isArray(source.additional_free_quotas)
      ? source.additional_free_quotas.map((quota) => compact({
          id: clean(quota?.id),
          // The gateway names the bonus after its models; the label is the
          // human-readable one when present.
          label: clean(quota?.models?.[0]?.name) || clean(quota?.id),
          limit: toCount(quota?.effective_limit ?? quota?.limit),
          used: toCount(quota?.used),
          remaining: toCount(quota?.remaining),
          resetsAt: toMilliseconds(quota?.resets_at),
          timezone: clean(quota?.timezone),
        }))
      : undefined,

    // Surfaced so the section can show a stale-by construction error rather than
    // implying the numbers are live.
    fetchedAt: Date.now(),
    ...meta,
  })
}

export function normalizeSummary(payload, meta) {
  return readonlySummary(payload, meta)
}

/* ------------------------------------------------------------------ fetching */

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Read the balance, translating every failure into a sentence the panel can
 * show. Each status code gets its own message because the gateway's own codes
 * are meaningful: 401 means the key is wrong, 402 means the money ran out, and
 * 429 is a rate limit rather than a fault.
 */
async function readBalance(ctx, config) {
  const { apiKey, apiBase, apiKeyEnv } = await resolveCredentials(ctx, config)

  let response
  try {
    response = await fetch(`${apiBase}/v1/balance`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not reach ${apiBase} (${reason}).`)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = clean(body?.message) || clean(body?.error?.message) || clean(body?.error)
    } catch {
      // A non-JSON error body is not worth reporting over the status code.
    }
    const suffix = detail === '' ? '' : ` ${detail}`
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Nutaraline rejected the API key stored under ${apiKeyEnv} (HTTP ${response.status}).${suffix}`)
    }
    if (response.status === 402) {
      throw new Error(`The Nutaraline balance is exhausted (HTTP 402).${suffix}`)
    }
    if (response.status === 429) {
      throw new Error(`Nutaraline is rate limiting this key (HTTP 429). Try again shortly.${suffix}`)
    }
    throw new Error(`The balance request failed (HTTP ${response.status}).${suffix}`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('The balance response was not JSON.')
  }

  return normalizeSummary(payload, { apiBase })
}

/** Report which key name is in play without ever returning its value. */
async function readKeyState(ctx, config) {
  const apiKeyEnv = clean(config?.apiKeyEnv) || DEFAULT_ENV_NAME
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    return { apiKeyEnv, configured: false, source: '', writable: false, masked: '' }
  }
  const described = await credentials.describe(apiKeyEnv)
  return {
    apiKeyEnv,
    configured: described?.configured === true,
    source: clean(described?.source),
    writable: described?.writable === true,
    masked: clean(described?.masked),
  }
}

/* -------------------------------------------------------------------- routing */

const METHODS = {
  balance: (ctx, config) => readBalance(ctx, config),
  keyState: (ctx, config) => readKeyState(ctx, config),
}

export function createHandler(ctx, config) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = url.pathname.slice(ROUTE_PATH.length).replace(/^\/+/, '')

    const send = (body, status = 200, headers = {}) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(payload)),
        'cache-control': 'no-store',
        ...headers,
      })
      res.end(payload)
    }

    try {
      if (req.method !== 'POST') {
        send({ ok: false, error: 'Use POST for this endpoint.' }, 405, { allow: 'POST' })
        return
      }

      const fn = METHODS[method]
      if (fn === undefined) {
        send({ ok: false, error: `Unknown method: ${method}` }, 404)
        return
      }

      const raw = await readBody(req)
      let args = {}
      if (raw.trim() !== '') {
        try {
          args = JSON.parse(raw)
        } catch {
          send({ ok: false, error: 'The request body was not JSON.' }, 400)
          return
        }
      }
      // `JSON.parse` also accepts a bare array, a string and `null`; every
      // method here takes a plain object, so anything else is rejected rather
      // than silently treated as no arguments.
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        send({ ok: false, error: 'The request body must be an object.' }, 400)
        return
      }

      send({ ok: true, value: await fn(ctx, config, args) })
    } catch (error) {
      send({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
    }
  }
}

export function apply(ctx, config) {
  const resolved = config ?? {}
  // `ctx.effect` keeps the route alive for as long as the plugin is mounted and
  // removes it on dispose; the returned disposer is the plugin's own teardown.
  return ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PATH,
        handler: createHandler(ctx, resolved),
      }),
    'nutaraline-credits/api-route',
  )
}
