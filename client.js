/**
 * Browser half of the Nutaraline credits bundle.
 *
 * Registers one entry in `settings.section`, so the section appears as its own
 * page in the Settings panel rather than as a left-bar panel.
 *
 * The page never holds the API key and never talks to `nutaraline.co.uk`: it
 * calls the Host half's same-origin route, which resolves the key from the
 * credential store and reads `GET /v1/balance`.
 *
 * `settings.section` is a list slot whose registrant options carry the nav
 * identity: `id` is the section key, `order` its nav position, and `label` the
 * displayed name. The label is a thunk so the shell re-reads it on a locale
 * change without re-registering.
 */

window.__ModuleLoader__.load({
  id: 'dsh-nutaraline-credits',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const SECTION_ID = 'nutaraline-credits'
    const ROUTE = '/nutaraline-credits/api'
    const LOCALE_NS = 'nutaraline-credits'

    const CSS = `
.kie-nc { display: flex; flex-direction: column; gap: 18px; max-width: 720px; }
.kie-nc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.kie-nc-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.kie-nc-sub { margin-top: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.kie-nc-btn {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 12px;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.kie-nc-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.kie-nc-btn:disabled { opacity: .55; cursor: default; }
.kie-nc-card {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); padding: 14px 16px;
}
.kie-nc-card h4 {
  margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--dsw-alias-label-secondary);
}
.kie-nc-hero { font-size: 30px; font-weight: 650; color: var(--dsw-alias-label-primary); line-height: 1.15; }
.kie-nc-hero small { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 6px; }
.kie-nc-rows { display: flex; flex-direction: column; gap: 7px; }
.kie-nc-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; font-size: 13px; }
.kie-nc-row dt { color: var(--dsw-alias-label-secondary); }
.kie-nc-row dd { margin: 0; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; text-align: right; }
.kie-nc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.kie-nc-stat { font-size: 13px; }
.kie-nc-stat b { display: block; font-size: 19px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.kie-nc-stat span { color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.kie-nc-bar { height: 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin-top: 6px; }
.kie-nc-bar i { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary); }
.kie-nc-bar.is-warn i { background: var(--dsw-alias-state-warn-primary); }
.kie-nc-bar.is-full i { background: var(--dsw-alias-state-error-primary); }
.kie-nc-quota { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.kie-nc-quota:last-child { margin-bottom: 0; }
.kie-nc-quota-head { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.kie-nc-quota-head span:last-child { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.kie-nc-note { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.kie-nc-error {
  border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px;
  padding: 12px 14px; font-size: 13px; color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-1); word-break: break-word;
}
.kie-nc-empty { font-size: 13px; color: var(--dsw-alias-label-secondary); padding: 6px 0; }
.kie-nc-busy { font-size: 13px; color: var(--dsw-alias-label-secondary); padding: 6px 0; }
`

    /* ------------------------------------------------------------- formatting */

    /** Rupiah, whole units: the gateway's fractional sen is noise, not signal. */
    function money(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'IDR',
          maximumFractionDigits: 0,
        }).format(value)
      } catch {
        return `Rp${Math.round(value).toLocaleString()}`
      }
    }

    const int = (value) =>
      typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : ''

    /** Compact token counts, because billions of digits are unreadable. */
    function tokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      const units = [
        [1e12, 'T'],
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'K'],
      ]
      for (const [size, suffix] of units) {
        if (Math.abs(value) >= size) {
          const scaled = value / size
          return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2).replace(/\.?0+$/, '')}${suffix}`
        }
      }
      return int(value)
    }

    /** Absolute local time: a countdown would go stale without a ticking clock. */
    function clock(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      try {
        return new Date(ms).toLocaleString(undefined, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return ''
      }
    }

    /** Substitute `{name}` placeholders without a formatting dependency. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      )
    }

    /* ------------------------------------------------------------------ store */

    /**
     * Module-scope store, like the sibling image bundles: the settings shell
     * unmounts a section when the user navigates away, and component state would
     * be discarded, forcing a second network read on every visit.
     */
    const store = {
      data: null,
      keyState: null,
      error: '',
      loading: false,
      loadedAt: 0,
    }
    const listeners = new Set()

    function emit() {
      for (const listener of listeners) listener()
    }

    function patch(next) {
      Object.assign(store, next)
      emit()
    }

    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((value) => value + 1)
        listeners.add(listener)
        return () => listeners.delete(listener)
      }, [])
      // A render happens before this effect runs, and `refresh()` can settle
      // between the two (its first `await` yields to the microtask queue). The
      // listener would be registered too late to see that change, so the store
      // is subscribed only for later updates; the snapshot is read live here.
      return store
    }

    /** One Host call; the Host's own message survives as the error text. */
    async function call(method, args) {
      const response = await fetch(`${ROUTE}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`The ${method} call returned a response that was not JSON.`)
      }
      if (!payload?.ok) throw new Error(payload?.error ?? `The ${method} call failed.`)
      return payload.value
    }

    async function refresh() {
      if (store.loading) return
      patch({ loading: true, error: '' })
      try {
        // Both reads are independent; a missing key is reported by `keyState`
        // while `balance` carries the gateway's own sentence.
        const [data, keyState] = await Promise.all([
          call('balance', {}),
          call('keyState', {}).catch(() => null),
        ])
        patch({ data, keyState, error: '', loadedAt: Date.now() })
      } catch (error) {
        patch({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        patch({ loading: false })
      }
    }

    /* --------------------------------------------------------------- rendering */

    function Stat({ label, value, hint }) {
      if (value === '' || value === undefined) return null
      return h('div', { className: 'kie-nc-stat' }, h('b', null, value), h('span', null, label), hint ? h('span', null, ` · ${hint}`) : null)
    }

    function Bar({ used, limit }) {
      if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return null
      const ratio = Math.max(0, Math.min(1, used / limit))
      const className = ratio >= 1 ? 'kie-nc-bar is-full' : ratio >= 0.8 ? 'kie-nc-bar is-warn' : 'kie-nc-bar'
      return h('div', { className }, h('i', { style: { width: `${(ratio * 100).toFixed(1)}%` } }))
    }

    function Row({ label, value }) {
      if (value === '' || value === undefined || value === null) return null
      return h('div', { className: 'kie-nc-row' }, h('dt', null, label), h('dd', null, value))
    }

    function BalanceCard({ t, data }) {
      const available = money(data.availableIdr ?? data.balanceIdr)
      const rows = [
        [t('balance.reserved', 'Reserved'), money(data.reservedIdr)],
        [t('balance.account', 'Account'), data.username || ''],
        [t('balance.plan', 'Plan'), data.plan || ''],
        [t('balance.status', 'Status'), data.billingStatus || ''],
      ].filter(([, value]) => value !== '')

      return h(
        'section',
        { className: 'kie-nc-card' },
        h('h4', null, t('balance.heading', 'Balance')),
        available === ''
          ? h('div', { className: 'kie-nc-empty' }, t('states.empty', 'No data yet.'))
          : h('div', { className: 'kie-nc-hero' }, available, h('small', null, t('balance.available', 'Available'))),
        rows.length === 0 ? null : h('dl', { className: 'kie-nc-rows', style: { marginTop: '12px' } },
          rows.map(([label, value]) => h(Row, { key: label, label, value }))),
      )
    }

    function UsageCard({ t, data }) {
      const stats = [
        [t('usage.requests', 'Requests'), int(data.requests)],
        [t('usage.totalTokens', 'Total tokens'), tokens(data.totalTokens)],
        [t('usage.inputTokens', 'Input tokens'), tokens(data.promptTokens)],
        [t('usage.outputTokens', 'Output tokens'), tokens(data.completionTokens)],
      ].filter(([, value]) => value !== '')
      if (stats.length === 0) return null
      return h(
        'section',
        { className: 'kie-nc-card' },
        h('h4', null, t('usage.heading', 'Usage')),
        h('div', { className: 'kie-nc-grid' },
          stats.map(([label, value]) => h(Stat, { key: label, label, value }))),
      )
    }

    function LimitsCard({ t, data }) {
      const hasFree = typeof data.freeDailyLimit === 'number'
      const hasHour = typeof data.hourlyLimit === 'number'
      const hasDay = typeof data.dailyLimit === 'number'
      const hasTokens = typeof data.tokenLimit === 'number'
      const hasRpm = typeof data.rpmLimit === 'number'
      if (!hasFree && !hasHour && !hasDay && !hasTokens && !hasRpm) return null

      const reset = clock(data.freeDailyResetAt)

      return h(
        'section',
        { className: 'kie-nc-card' },
        h('h4', null, t('limits.heading', "Today's limits")),

        hasFree
          ? h('div', { className: 'kie-nc-quota' },
              h('div', { className: 'kie-nc-quota-head' },
                h('span', null, t('limits.freeTokens', 'Free tokens')),
                h('span', null, `${tokens(data.freeDailyRemaining)} / ${tokens(data.freeDailyLimit)}`)),
              h(Bar, { used: data.freeDailyUsed, limit: data.freeDailyLimit }),
              reset === ''
                ? null
                : h('div', { className: 'kie-nc-note' }, fill(t('limits.freeReset', 'Resets {time}'), { time: reset })))
          : null,

        hasHour
          ? h('div', { className: 'kie-nc-quota' },
              h('div', { className: 'kie-nc-quota-head' },
                h('span', null, t('limits.requestsPerHour', 'Requests this hour')),
                h('span', null, `${int(data.hourlyUsed)} / ${int(data.hourlyLimit)}`)),
              h(Bar, { used: data.hourlyUsed, limit: data.hourlyLimit }))
          : null,

        hasDay
          ? h('div', { className: 'kie-nc-quota' },
              h('div', { className: 'kie-nc-quota-head' },
                h('span', null, t('limits.requestsPerDay', 'Requests today')),
                h('span', null, `${int(data.dailyUsed)} / ${int(data.dailyLimit)}`)),
              h(Bar, { used: data.dailyUsed, limit: data.dailyLimit }))
          : null,

        hasTokens
          ? h('div', { className: 'kie-nc-quota' },
              h('div', { className: 'kie-nc-quota-head' },
                h('span', null, t('limits.tokensToday', 'Tokens today')),
                h('span', null, `${tokens(data.tokenUsed)} / ${tokens(data.tokenLimit)}`)),
              h(Bar, { used: data.tokenUsed, limit: data.tokenLimit }))
          : null,

        hasRpm
          ? h('div', { className: 'kie-nc-quota' },
              h('div', { className: 'kie-nc-quota-head' },
                h('span', null, t('limits.rateLimit', 'Rate limit')),
                h('span', null, fill(t('limits.rateLimitValue', '{available} of {limit} available'), {
                  available: int(data.rpmAvailable),
                  limit: int(data.rpmLimit),
                }))))
          : null,
      )
    }

    function QuotasCard({ t, data }) {
      const quotas = Array.isArray(data.quotas) ? data.quotas : []
      const visible = quotas.filter((quota) => quota.limit > 0)
      if (visible.length === 0) {
        return h(
          'section',
          { className: 'kie-nc-card' },
          h('h4', null, t('quotas.heading', 'Model bonuses')),
          h('div', { className: 'kie-nc-note' }, t('quotas.none', 'No model bonuses on this account.')),
        )
      }
      return h(
        'section',
        { className: 'kie-nc-card' },
        h('h4', null, t('quotas.heading', 'Model bonuses')),
        visible.map((quota) =>
          h('div', { className: 'kie-nc-quota', key: quota.id || quota.label },
            h('div', { className: 'kie-nc-quota-head' },
              h('span', null, quota.label || quota.id || ''),
              h('span', null, fill(t('quotas.remainingOf', '{remaining} of {limit} left'), {
                remaining: tokens(quota.remaining),
                limit: tokens(quota.limit),
              }))),
            h(Bar, { used: quota.used, limit: quota.limit }),
            typeof quota.resetsAt === 'number'
              ? h('div', { className: 'kie-nc-note' }, fill(t('limits.freeReset', 'Resets {time}'), { time: clock(quota.resetsAt) }))
              : null),
        ),
      )
    }

    function KeyRow({ t, keyState, data }) {
      const env = keyState?.apiKeyEnv ?? 'NUTARALINE_API_KEY'
      const configured = keyState?.configured === true
      const endpoint = data?.apiBase ?? ''
      const source = keyState?.source ?? ''
      return h(
        'section',
        { className: 'kie-nc-card' },
        h('h4', null, t('fields.key', 'API key')),
        h('div', { className: 'kie-nc-row' },
          h('dt', null, configured ? fill(t('fields.keyConfigured', 'Stored as {name}'), { name: env })
                                   : fill(t('fields.keyMissing', 'No key stored under {name}'), { name: env })),
          h('dd', null, source === '' ? '' : fill(t('fields.keySource', 'source: {source}'), { source }))),
        endpoint === ''
          ? null
          : h('div', { className: 'kie-nc-row' }, h('dt', null, t('fields.endpoint', 'Endpoint')), h('dd', null, endpoint)),
      )
    }

    /* ------------------------------------------------------------------- panel */

    /**
     * The owner props for `settings.section` are `{ close }`; the shell passes
     * no plugin context, so the translator is built from the closure instead.
     */
    function Section(props) {
      const { ctx } = props
      const t = React.useMemo(() => {
        try {
          const bound = ctx?.locale?.bind?.(LOCALE_NS)
          if (typeof bound === 'function') {
            return (key, fallback) => {
              const value = bound(key)
              // An unregistered key resolves to the key itself.
              return typeof value === 'string' && value !== '' && value !== key
                ? value
                : fallback ?? key
            }
          }
        } catch {
          // A broken locale service must not blank the section.
        }
        return (key, fallback) => fallback ?? key
      }, [ctx])

      const state = useStore()

      // Read once on first mount. The store survives a remount, so returning to
      // the page does not re-fetch; Refresh is explicit.
      React.useEffect(() => {
        if (store.data === null && store.error === '' && !store.loading) void refresh()
      }, [])

      const loading = state.loading
      const data = state.data

      return h(
        'div',
        { className: 'kie-nc' },
        h('div', { className: 'kie-nc-head' },
          h('div', null,
            h('div', { className: 'kie-nc-title' }, t('panel.title', 'Nutaraline credits')),
            h('div', { className: 'kie-nc-sub' }, t('panel.subtitle', 'Live balance and usage for your gateway key.'))),
          h('button', {
            type: 'button',
            className: 'kie-nc-btn',
            disabled: loading,
            onClick: () => void refresh(),
          }, loading ? t('actions.refreshing', 'Refreshing…') : t('actions.refresh', 'Refresh'))),

        state.error !== ''
          ? h('div', { className: 'kie-nc-error' }, h('strong', null, `${t('states.error', 'Could not read the balance')}: `), state.error)
          : null,

        loading && data === null ? h('div', { className: 'kie-nc-busy' }, t('states.loading', 'Reading the gateway…')) : null,

        data === null ? null : h(BalanceCard, { t, data }),
        data === null ? null : h(LimitsCard, { t, data }),
        data === null ? null : h(QuotasCard, { t, data }),
        data === null ? null : h(UsageCard, { t, data }),
        h(KeyRow, { t, keyState: state.keyState, data }),

        state.loadedAt > 0
          ? h('div', { className: 'kie-nc-note' },
              fill(t('actions.lastUpdated', 'Updated {time}'), { time: clock(state.loadedAt) }))
          : null,
      )
    }

    /** The nav row's glyph, rendered at the sidebar's own size. */
    function SectionIcon() {
      return h('svg', {
        viewBox: '0 0 36 36', width: 18, height: 18, 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 3, y: 10, width: 30, height: 17, rx: 3.2, fill: 'none', stroke: 'currentColor', strokeWidth: 2.6 }),
        h('path', { d: 'M22 15.5h10v6h-10a3 3 0 0 1 0-6z', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6 }),
        h('circle', { cx: 25.8, cy: 18.5, r: 1.6, fill: 'currentColor' }),
      )
    }

    /**
     * The dictionary the runtime serves. `locale/en.json` is only read by the
     * plugin manager for the card; the live page needs this registration or
     * `bind(ns)(key)` returns the key itself.
     */
    const LOCALE = {
      en: {
        meta: {
          title: 'Nutaraline credits',
          description: 'Shows the Nutaraline gateway balance, usage and per-model bonuses in Settings.',
        },
        panel: { title: 'Nutaraline credits', subtitle: 'Live balance and usage for your gateway key.' },
        actions: { refresh: 'Refresh', refreshing: 'Refreshing…', lastUpdated: 'Updated {time}' },
        fields: {
          key: 'API key',
          keyConfigured: 'Stored as {name}',
          keyMissing: 'No key stored under {name}',
          keySource: 'source: {source}',
          endpoint: 'Endpoint',
        },
        balance: { heading: 'Balance', available: 'Available', reserved: 'Reserved', account: 'Account', plan: 'Plan', status: 'Status' },
        usage: { heading: 'Usage', requests: 'Requests', totalTokens: 'Total tokens', inputTokens: 'Input tokens', outputTokens: 'Output tokens' },
        limits: {
          heading: "Today's limits",
          freeTokens: 'Free tokens',
          freeReset: 'Resets {time}',
          requestsPerHour: 'Requests this hour',
          requestsPerDay: 'Requests today',
          tokensToday: 'Tokens today',
          rateLimit: 'Rate limit',
          rateLimitValue: '{available} of {limit} available',
        },
        quotas: { heading: 'Model bonuses', none: 'No model bonuses on this account.', remainingOf: '{remaining} of {limit} left' },
        states: { loading: 'Reading the gateway…', empty: 'No data yet. Refresh to read the balance.', error: 'Could not read the balance' },
      },
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (typeof ctx.locale?.register === 'function') {
          ctx.effect(() => ctx.locale.register(LOCALE_NS, LOCALE), 'nutaraline-credits:locale')
        }

        ctx.effect(() => {
          if (typeof document !== 'undefined') {
            const tag = document.createElement('style')
            tag.setAttribute('data-nutaraline-credits', '')
            tag.textContent = CSS
            document.head.appendChild(tag)
            return () => tag.remove()
          }
          return () => {}
        }, 'nutaraline-credits/styles')

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: 65,
              // A thunk: the shell re-reads it on every projection, so the nav
              // row follows the active locale without re-registering.
              label: () => {
                try {
                  const value = ctx.locale?.bind?.(LOCALE_NS)?.('panel.title')
                  return typeof value === 'string' && value !== '' && value !== 'panel.title'
                    ? value
                    : 'Nutaraline credits'
                } catch {
                  return 'Nutaraline credits'
                }
              },
            },
            () => h(Section, { ctx }),
          ),
        )
      },
    }
  },
})
