/**
 * Host-half checks for the Nutaraline credits bundle.
 *
 * The suite drives the route handler with a stubbed request/response pair and a
 * stubbed credential service, so it covers what actually breaks: a missing key,
 * the gateway's own error codes, and the shape the client receives.
 *
 * The balance fixture is trimmed from a real `GET /v1/balance` response.
 */

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PACKAGE_DIR = path.resolve(__dirname, '..')
const ROUTE_PATH = '/nutaraline-credits/api'

let failures = 0
const notes = []

function check(label, fn) {
  try {
    fn()
    notes.push(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    notes.push(`  FAIL ${label}\n       ${error.message.split('\n').join('\n       ')}`)
  }
}

/* -------------------------------------------------------------------- fixtures */

const BALANCE = {
  stable_unlimited: {
    enabled: true,
    rpm: { limit: 30, burst: 8, available: 8, reset_at: 1794805224.2120943 },
    hour: { mode: 'first_hit', used: 0, limit: 1000, window_seconds: 3600, started: false },
    day: { used: 0, limit: 5000, reset_at: 1794848400.0 },
    tokens: { used: 0, limit: 2500000000, reset_at: 1794848400.0 },
    max_output: 8192,
    timezone: 'Asia/Jakarta',
  },
  username: 'TEST ACCOUNT',
  billing_status: 'active',
  balance_idr: 12345.678901,
  available_idr: 12345.678901,
  reserved_idr: 0.0,
  total_tokens: 4000000123,
  prompt_tokens: 3990000000,
  completion_tokens: 10000123,
  requests: 4321,
  quota_tier: 'prepaid',
  additional_free_quotas: [
    {
      id: 'deepseek_v41',
      eligible: true,
      limit: 3000000,
      used: 3000000,
      remaining: 0,
      effective_limit: 3000000,
      models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash LoRA' }],
      resets_at: 1794848400.0,
      timezone: 'Asia/Jakarta',
    },
    {
      id: 'deepseek1017',
      limit: 3000000,
      used: 0,
      remaining: 3000000,
      effective_limit: 3000000,
      models: [{ id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017 LoRA' }],
      resets_at: 1794848400.0,
    },
  ],
  daily_free_tokens: {
    limit: 15000000,
    used: 0,
    reserved: 0,
    remaining: 15000000,
    available: 15000000,
    resets_at: 1794848400.0,
    timezone: 'Asia/Jakarta',
  },
  free_models: [],
  active: true,
  status: 'active',
  product: 'prepaid',
}

/** A credential service that behaves like the real seam for one ref name. */
function credentialStub(refName, value, source = 'store') {
  const seen = []
  return {
    seen,
    resolve: async (ref) => {
      seen.push(ref)
      if (ref !== refName || value === '') return undefined
      return { value, source }
    },
    describe: async (ref) => ({
      configured: ref === refName && value !== '',
      source: ref === refName && value !== '' ? source : undefined,
      writable: true,
      masked: value === '' ? undefined : `${value.slice(0, 6)}…`,
    }),
  }
}

/** Capture what the handler writes, in the shape the client will parse. */
function invoke(handler, { method = 'POST', body = {}, path: sub = 'balance' } = {}) {
  const chunks = []
  const headers = {}
  const req = {
    method,
    url: `${ROUTE_PATH}/${sub}`,
    async *[Symbol.asyncIterator]() {
      const raw = typeof body === 'string' ? body : JSON.stringify(body)
      if (raw !== '') yield Buffer.from(raw, 'utf8')
    },
  }
  const res = {
    statusCode: 200,
    writeHead(status, extra) {
      this.statusCode = status
      Object.assign(headers, extra ?? {})
    },
    end(payload) {
      chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'))
    },
  }
  return handler(req, res).then(() => {
    const text = Buffer.concat(chunks).toString('utf8')
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: res.statusCode, headers, text, json }
  })
}

/** Build a plugin context whose `fetch` is scripted, never the network. */
function makeContext({ credentials, fetchImpl, config }) {
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'credentials') return credentials
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    webServer: {
      register(route) {
        calls.push(route)
        return () => {}
      },
    },
  }
  return { ctx, calls, config: config ?? {} }
}

/* --------------------------------------------------------------------- the run */

async function main() {
  const moduleUrl = pathToFileURL(path.join(PACKAGE_DIR, 'index.js')).href
  // A fresh query string defeats the ESM module cache between sections.
  const mod = await import(`${moduleUrl}?t=${Date.now()}`)

  check('module exports the Host form', () => {
    assert.equal(typeof mod.apply, 'function', 'apply must be exported')
    assert.ok(mod.inject.includes('webServer'), "inject must include 'webServer'")
  })

  // ---- route registration ------------------------------------------------

  {
    const { ctx, calls } = makeContext({ credentials: credentialStub('NUTARALINE_API_KEY', 'k') })
    const dispose = mod.apply(ctx, {})
    const [route] = calls
    check('apply registers one prefix route', () => {
      assert.equal(calls.length, 1, 'exactly one route')
      assert.equal(route.kind, 'prefix', 'must be a prefix route so POST works')
      assert.equal(route.path, ROUTE_PATH)
      assert.equal(typeof route.handler, 'function')
    })
    check('dispose is a function', () => assert.equal(typeof dispose, 'function'))
  }

  // ---- a healthy read ----------------------------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test')
    let request = null
    const { ctx } = makeContext({
      credentials,
      fetchImpl: async (url, init) => {
        request = { url, init }
        return { ok: true, status: 200, async json() { return BALANCE } }
      },
    })
    globalThis.fetch = (url, init) => {
      request = { url, init }
      return Promise.resolve({ ok: true, status: 200, json: async () => BALANCE })
    }

    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler)

    check('a healthy read answers ok with a value', () => {
      assert.equal(result.status, 200)
      assert.equal(result.json.ok, true, result.text.slice(0, 200))
      assert.ok(result.json.value, 'value must be present')
    })

    check('the key is resolved per call, by name', () => {
      assert.deepEqual(credentials.seen, ['NUTARALINE_API_KEY'])
    })

    check('the request carries the bearer key and never the page', () => {
      assert.equal(request.url, 'https://nutaraline.co.uk/v1/balance')
      assert.equal(request.init.headers.authorization, 'Bearer sk-gw-test')
    })

    const value = result.json.value
    check('money fields survive as numbers', () => {
      assert.equal(value.balanceIdr, 12345.678901)
      assert.equal(value.availableIdr, 12345.678901)
      assert.equal(value.reservedIdr, 0)
    })

    check('lifetime counters survive', () => {
      assert.equal(value.requests, 4321)
      assert.equal(value.totalTokens, 4000000123)
      assert.equal(value.promptTokens, 3990000000)
      assert.equal(value.completionTokens, 10000123)
    })

    check('stable-pool limits are flattened and converted to milliseconds', () => {
      assert.equal(value.rpmLimit, 30)
      assert.equal(value.rpmAvailable, 8)
      assert.equal(value.hourlyLimit, 1000)
      assert.equal(value.hourlyUsed, 0)
      assert.equal(value.dailyLimit, 5000)
      assert.equal(value.tokenLimit, 2500000000)
      assert.equal(value.timezone, 'Asia/Jakarta')
      assert.equal(value.maxOutput, 8192)
      assert.equal(value.rpmResetAt, Math.round(1794805224.2120943 * 1000))
      assert.equal(value.dailyResetAt, 1794848400000)
    })

    check('the unrestricted daily budget is reported', () => {
      assert.equal(value.freeDailyLimit, 15000000)
      assert.equal(value.freeDailyUsed, 0)
      assert.equal(value.freeDailyRemaining, 15000000)
      assert.equal(value.freeDailyResetAt, 1794848400000)
    })

    check('per-model bonuses keep a human label and their own reset', () => {
      assert.equal(value.quotas.length, 2)
      assert.equal(value.quotas[0].id, 'deepseek_v41')
      assert.equal(value.quotas[0].label, 'DeepSeek V4.1 Flash LoRA')
      assert.equal(value.quotas[0].limit, 3000000)
      assert.equal(value.quotas[0].used, 3000000)
      assert.equal(value.quotas[0].remaining, 0)
      assert.equal(value.quotas[1].label, 'DeepSeek V4.1 Flash 1017 LoRA')
      assert.equal(value.quotas[1].remaining, 3000000)
    })

    check('the summary records where it came from and when', () => {
      assert.equal(value.apiBase, 'https://nutaraline.co.uk')
      assert.ok(typeof value.fetchedAt === 'number' && value.fetchedAt > 0)
    })

    check('no API key leaks into the payload', () => {
      assert.ok(!result.text.includes('sk-gw-test'), 'the key must never reach the response')
    })
  }

  // ---- a missing key -----------------------------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', '')
    const { ctx } = makeContext({ credentials })
    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler)

    check('a missing key fails with a sentence naming the variable', () => {
      assert.equal(result.json.ok, false)
      assert.match(result.json.error, /NUTARALINE_API_KEY/)
      assert.match(result.json.error, /credential store/i)
    })
  }

  // ---- gateway error codes ----------------------------------------------

  const cases = [
    [401, /rejected the API key/, 'authentication'],
    [403, /rejected the API key/, 'authorization'],
    [402, /exhausted/, 'exhausted balance'],
    [429, /rate limit/i, 'rate limit'],
    [500, /HTTP 500/, 'server fault'],
  ]

  for (const [status, pattern, label] of cases) {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test')
    const { ctx } = makeContext({
      credentials,
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'gateway says no' }) }),
    })
    globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ message: 'gateway says no' }) })

    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler)

    check(`HTTP ${status} (${label}) is reported as a sentence`, () => {
      assert.equal(result.json.ok, false)
      assert.match(result.json.error, pattern)
      assert.match(result.json.error, /gateway says no/, "the gateway's own message survives")
    })
  }

  // ---- transport failure -------------------------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test')
    const { ctx } = makeContext({ credentials })
    globalThis.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }
    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler)

    check('a transport failure names the host and the reason', () => {
      assert.equal(result.json.ok, false)
      assert.match(result.json.error, /Could not reach https:\/\/nutaraline\.co\.uk/)
      assert.match(result.json.error, /ENOTFOUND/)
    })
  }

  // ---- key state ---------------------------------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test', 'profile store')
    const { ctx } = makeContext({ credentials })
    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler, { path: 'keyState' })

    check('keyState reports configuration without the value', () => {
      assert.equal(result.json.ok, true)
      assert.equal(result.json.value.apiKeyEnv, 'NUTARALINE_API_KEY')
      assert.equal(result.json.value.configured, true)
      assert.equal(result.json.value.source, 'profile store')
      assert.ok(!result.text.includes('sk-gw-test'))
    })
  }

  // ---- a custom variable name -------------------------------------------

  {
    const credentials = credentialStub('MY_NUT_KEY', 'sk-gw-other')
    const { ctx } = makeContext({ credentials, config: { apiKeyEnv: 'MY_NUT_KEY' } })
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => BALANCE })
    const handler = mod.createHandler(ctx, { apiKeyEnv: 'MY_NUT_KEY' })
    const result = await invoke(handler)

    check('a configured variable name replaces the default', () => {
      assert.equal(result.json.ok, true)
      assert.deepEqual(credentials.seen, ['MY_NUT_KEY'])
    })
  }

  // ---- routing guards ----------------------------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test')
    const { ctx } = makeContext({ credentials })
    const handler = mod.createHandler(ctx, {})

    const get = await invoke(handler, { method: 'GET' })
    check('GET is refused, so a browser cannot read it by navigation', () => {
      assert.equal(get.status, 405)
      assert.equal(get.headers.allow, 'POST')
    })

    const unknown = await invoke(handler, { path: 'nope' })
    check('an unknown method is a 404', () => {
      assert.equal(unknown.status, 404)
      assert.match(unknown.json.error, /Unknown method: nope/)
    })

    const badJson = await invoke(handler, { body: '{not json' })
    check('a non-JSON body is a 400', () => {
      assert.equal(badJson.status, 400)
      assert.match(badJson.json.error, /not JSON/)
    })

    const arrayBody = await invoke(handler, { body: '[1,2]' })
    check('a non-object body is a 400', () => {
      assert.equal(arrayBody.status, 400)
      assert.match(arrayBody.json.error, /must be an object/)
    })
  }

  // ---- a sparse payload must not crash -----------------------------------

  {
    const credentials = credentialStub('NUTARALINE_API_KEY', 'sk-gw-test')
    const { ctx } = makeContext({ credentials })
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })
    const handler = mod.createHandler(ctx, {})
    const result = await invoke(handler)

    check('an empty payload degrades to absent fields, not NaN', () => {
      assert.equal(result.json.ok, true)
      const value = result.json.value
      assert.equal(value.balanceIdr, undefined)
      assert.equal(value.requests, 0)
      assert.equal(value.quotas, undefined)
      assert.equal(value.rpmLimit, undefined)
      assert.equal(value.username, '')
    })
  }

  /* ------------------------------------------------------------------ report */

  console.log(notes.join('\n'))
  if (failures > 0) {
    console.log(`\n${failures} host check(s) failed`)
    process.exitCode = 1
  } else {
    console.log(`\nhost checks passed · ${notes.length} assertions · route ${ROUTE_PATH}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
