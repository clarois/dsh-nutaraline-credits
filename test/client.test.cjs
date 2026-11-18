/**
 * Browser-half behaviour checks for the Nutaraline credits bundle.
 *
 * Runs the real bundle under a small React stand-in and a scripted Host route.
 * The point is to prove the module contract, the single `settings.section`
 * registration, and that the section renders the balance, the limits and the
 * per-model bonuses from what the Host actually returns.
 *
 * Run: node test/client.test.cjs
 */
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

/* ---------------------------------------------------------------- React stub */

function makeReact() {
  // Hook state is keyed by component identity, not by one global cursor. The
  // test renderer invokes function components by calling them, so a flat cursor
  // would let one component's useState shift another component's slot index.
  const stores = new Map()
  let owner = null
  let cursor = 0
  const rootStore = []
  // Effects queued by the current render, flushed by the caller after commit.
  const pendingEffects = []
  function getStore(component) {
    let store = stores.get(component)
    if (!store) {
      store = []
      stores.set(component, store)
    }
    return store
  }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    /** Components call this around their body so hooks land in the right store. */
    __render(component, props) {
      const previousOwner = owner
      const previousCursor = cursor
      owner = component
      cursor = 0
      try {
        return component(props)
      } finally {
        owner = previousOwner
        cursor = previousCursor
      }
    },
    useState(initial) {
      const store = owner ? getStore(owner) : rootStore
      const index = cursor++
      if (store[index] === undefined) store[index] = typeof initial === 'function' ? initial() : initial
      return [
        store[index],
        (next) => {
          store[index] = typeof next === 'function' ? next(store[index]) : next
        },
      ]
    },
    useEffect(effect) {
      // React runs effects after the render commit, not during it. Deferring
      // them here reproduces that ordering: `render()` returns the committed
      // tree, and the caller then flushes effects.
      pendingEffects.push(effect)
      return () => {}
    },
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useRef(value) {
      return { current: value }
    },
    __reset() {
      cursor = 0
      pendingEffects.length = 0
    },
    /** Run the effects queued by the render that just committed. */
    __flushEffects() {
      const queued = pendingEffects.splice(0)
      for (const effect of queued) effect()
    },
  }
  return React
}

/* -------------------------------------------------- renderer / tree helpers */

// The stub in makeReact() owns hook storage; renderComponent routes every
// function-component invocation through it so hooks land in the right store.
let activeReact = null

function renderComponent(component, props) {
  if (activeReact && typeof activeReact.__render === 'function') {
    return activeReact.__render(component, props)
  }
  return component(props)
}

/** Flatten a rendered tree into element nodes so tests can find and act on them. */
function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') return out
  out.push(node)
  if (typeof node.type === 'function') {
    // Render through the stub so each component's hooks get their own store.
    flatten(renderComponent(node.type, node.props ?? {}), out)
    return out
  }
  flatten(node.props?.children, out)
  return out
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  // Descend into function components, or the root element reads as empty.
  if (typeof node.type === 'function') return textOf(renderComponent(node.type, node.props ?? {}))
  return textOf(node.props?.children)
}

function findAll(tree, predicate) {
  return flatten(tree).filter(predicate)
}

function findButton(tree, label) {
  return findAll(tree, (node) => node.type === 'button' && textOf(node).includes(label))[0]
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const React = makeReact()
  activeReact = React
  const registered = []
  const injected = []
  const styles = []
  const hostCalls = []

  /* ----------------------------------------------------- scripted Host route */

  // Trimmed from a real `GET /v1/balance` response.
  const balance = {
    username: 'TEST ACCOUNT',
    billingStatus: 'active',
    plan: 'prepaid',
    balanceIdr: 12345.678901,
    availableIdr: 12345.678901,
    reservedIdr: 0,
    totalTokens: 4000000123,
    promptTokens: 3990000000,
    completionTokens: 10000123,
    requests: 4321,
    rpmLimit: 30,
    rpmAvailable: 8,
    hourlyUsed: 0,
    hourlyLimit: 1000,
    dailyUsed: 0,
    dailyLimit: 5000,
    tokenUsed: 0,
    tokenLimit: 2500000000,
    timezone: 'Asia/Jakarta',
    maxOutput: 8192,
    freeDailyLimit: 15000000,
    freeDailyUsed: 0,
    freeDailyRemaining: 15000000,
    freeDailyResetAt: 1794848400000,
    quotas: [
      {
        id: 'deepseek_v41',
        label: 'DeepSeek V4.1 Flash LoRA',
        limit: 3000000,
        used: 3000000,
        remaining: 0,
        resetsAt: 1794848400000,
      },
      {
        id: 'deepseek1017',
        label: 'DeepSeek V4.1 Flash 1017 LoRA',
        limit: 3000000,
        used: 0,
        remaining: 3000000,
        resetsAt: 1794848400000,
      },
    ],
    fetchedAt: Date.now(),
    apiBase: 'https://nutaraline.co.uk',
  }

  const hostState = { failWith: null, balance }

  const fetcher = async (url, init) => {
    const method = String(url).split('/').pop().split('?')[0]
    hostCalls.push(method)
    assert.strictEqual(init?.method, 'POST', `${method} must be a POST`)
    if (hostState.failWith !== null) {
      return { json: async () => ({ ok: false, error: hostState.failWith }) }
    }
    if (method === 'balance') {
      return { json: async () => ({ ok: true, value: hostState.balance }) }
    }
    if (method === 'keyState') {
      return {
        json: async () => ({
          ok: true,
          value: {
            apiKeyEnv: 'NUTARALINE_API_KEY',
            configured: true,
            source: 'store',
            writable: true,
            masked: 'sk-gw-...',
          },
        }),
      }
    }
    return { json: async () => ({ ok: true, value: {} }) }
  }

  /* --------------------------------------------------------------- locale */

  // Mirrors ClientLocale: an unregistered key resolves to the key itself.
  const bind = () => (key) => key

  const localeRegistrations = []

  /* ------------------------------------------------------------ module host */

  const ctx = {
    locale: {
      bind,
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(name, callback) {
        injected.push(name)
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }

  const documentStub = {
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '', style: {} }),
    head: { appendChild: (tag) => styles.push(tag) },
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!documentStub.listeners.has(type)) documentStub.listeners.set(type, new Set())
      documentStub.listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      documentStub.listeners.get(type)?.delete(handler)
    },
    body: { appendChild() {}, removeChild() {} },
  }

  let loaded
  const windowStub = {
    __ModuleLoader__: { load: (spec) => (loaded = spec) },
    setTimeout,
    clearTimeout,
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
  const previousWindow = global.window
  const previousDocument = global.document
  global.window = windowStub
  global.document = documentStub

  let plugin
  try {
    new Function('window', 'fetch', source)(windowStub, fetcher)
    assert.ok(loaded, 'the bundle must call __ModuleLoader__.load')
    assert.strictEqual(loaded.id, 'dsh-nutaraline-credits')
    assert.strictEqual(typeof loaded.factory, 'function')

    plugin = loaded.factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require(${name})`)
    })
    assert.ok(plugin && typeof plugin.apply === 'function')
    assert.deepStrictEqual(plugin.inject, ['slots', 'locale'])
    plugin.apply(ctx)
  } catch (error) {
    global.window = previousWindow
    global.document = previousDocument
    throw error
  }
  const restoreGlobals = () => {
    global.window = previousWindow
    global.document = previousDocument
  }

  const checks = []
  const check = (label, fn) => {
    try {
      fn()
      checks.push(`  ok   ${label}`)
    } catch (error) {
      checks.push(`  FAIL ${label}\n       ${error.message.split('\n').join('\n       ')}`)
      process.exitCode = 1
    }
  }

  try {
    /* ------------------------------------------------------------- contract */

    check('the section is injected into settings.section only', () => {
      assert.deepStrictEqual(injected, ['settings.section'])
    })

    check('exactly one slot is registered', () => {
      assert.strictEqual(registered.length, 1)
      assert.strictEqual(registered[0].options.name, 'settings.section')
    })

    check('the section id is stable, because the shell addresses it by id', () => {
      assert.strictEqual(registered[0].options.id, 'nutaraline-credits')
    })

    check('the nav label is a thunk, so a locale change re-reads it', () => {
      assert.strictEqual(typeof registered[0].options.label, 'function')
      // The scripted bind returns the key itself, so the guard must fall back.
      assert.strictEqual(registered[0].options.label(), 'Nutaraline credits')
    })

    check('the stylesheet is installed and removable', () => {
      assert.strictEqual(styles.length, 1)
      assert.ok(styles[0].textContent.includes('.kie-nc'))
    })

    check('the client publishes its own dictionary', () => {
      assert.strictEqual(localeRegistrations.length, 1)
      assert.strictEqual(localeRegistrations[0].namespace, 'nutaraline-credits')
      assert.ok(localeRegistrations[0].dictionaries.en.panel.title)
    })

    /* ------------------------------------------------------- the rendered page */

    // `slots.register` is handed a render function; calling it yields the
    // section's root element, which then has to be rendered like any other
    // component so its hooks run.
    const render = () => {
      React.__reset()
      const element = registered[0].component()
      const committed = renderComponent(element.type, element.props ?? {})
      React.__flushEffects()
      return committed
    }

    let tree = render()
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = render()

    check('the section reads the balance and the key state', () => {
      assert.deepStrictEqual(hostCalls, ['balance', 'keyState'])
    })

    const text = textOf(tree)

    check('the page names itself', () => {
      assert.ok(text.includes('Nutaraline credits'), text.slice(0, 300))
    })

    check('the available balance is rendered as rupiah', () => {
      assert.ok(text.includes('IDR') && text.includes('12,346'), `balance missing from: ${text}`)
    })

    check('the account and plan are shown', () => {
      assert.ok(text.includes('TEST ACCOUNT'))
      assert.ok(text.includes('prepaid'))
    })

    check('lifetime usage is rendered with compact token counts', () => {
      assert.ok(text.includes('4,321'), 'request count missing')
      assert.ok(text.includes('4B'), `total tokens missing from: ${text}`)
      assert.ok(text.includes('3.99B'), `prompt tokens missing from: ${text}`)
      assert.ok(text.includes('10M'), `completion tokens missing from: ${text}`)
    })

    check('the free daily budget shows remaining over limit', () => {
      assert.ok(text.includes('15M'), 'free token budget missing')
    })

    check('the stable-pool limits are shown', () => {
      assert.ok(text.includes('1,000'), 'hourly request limit missing')
      assert.ok(text.includes('5,000'), 'daily request limit missing')
    })

    check('per-model bonuses are listed by their human label', () => {
      assert.ok(text.includes('DeepSeek V4.1 Flash LoRA'), text.slice(0, 400))
      assert.ok(text.includes('DeepSeek V4.1 Flash 1017 LoRA'))
    })

    check('the API key name is shown but never its value', () => {
      assert.ok(text.includes('NUTARALINE_API_KEY'))
      assert.ok(!text.includes('sk-gw-'), 'the key must never render')
    })

    check('the endpoint is shown', () => {
      assert.ok(text.includes('https://nutaraline.co.uk'))
    })

    /* ------------------------------------------------------------- refresh */

    const button = findButton(tree, 'Refresh')
    check('a Refresh control is present', () => {
      assert.ok(button, 'no Refresh button found')
    })

    hostCalls.length = 0
    await button.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    check('Refresh re-reads both values', () => {
      assert.deepStrictEqual(hostCalls, ['balance', 'keyState'])
    })

    /* --------------------------------------------------------------- errors */

    hostState.failWith = 'Nutaraline rejected the API key stored under NUTARALINE_API_KEY (HTTP 401).'
    hostCalls.length = 0
    tree = render()
    const refresh = findButton(tree, 'Refresh')
    await refresh.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = render()
    const errorText = textOf(tree)

    check("a failed read shows the Host's own sentence", () => {
      assert.ok(errorText.includes('HTTP 401'), `error missing from: ${errorText}`)
      assert.ok(errorText.includes('Could not read the balance'))
    })

    check('a failed read keeps the last good numbers on screen', () => {
      assert.ok(errorText.includes('TEST ACCOUNT'), 'the previous data must survive a failure')
    })

    hostState.failWith = null

    /* ------------------------------------------------------------- a remount */

    // The settings shell unmounts a section when the user navigates away. The
    // module-scope store must spare a second network read on the way back.
    hostCalls.length = 0
    const remounted = render()
    await new Promise((resolve) => setTimeout(resolve, 0))

    check('a remount renders from the store without re-fetching', () => {
      assert.deepStrictEqual(hostCalls, [], 'a remount must not re-read the gateway')
      assert.ok(textOf(remounted).includes('TEST ACCOUNT'))
    })

    /* ------------------------------------------------------------- sparse data */

    hostState.balance = { requests: 0 }
    hostCalls.length = 0
    tree = render()
    const refresh2 = findButton(tree, 'Refresh')
    await refresh2.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = render()
    const sparseText = textOf(tree)

    check('a sparse payload renders without NaN', () => {
      assert.ok(!sparseText.includes('NaN'), `NaN leaked into: ${sparseText}`)
      assert.ok(!sparseText.includes('undefined'), `undefined leaked into: ${sparseText}`)
    })

    console.log(checks.join('\n'))
    const failed = checks.filter((line) => line.includes('FAIL')).length
    if (failed > 0) {
      console.log(`\n${failed} client check(s) failed`)
      process.exitCode = 1
    } else {
      console.log(`\nclient checks passed Â· slots: ${injected.join(', ')} Â· host calls: ${['balance', 'keyState'].join(',')}`)
    }
  } finally {
    restoreGlobals()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
