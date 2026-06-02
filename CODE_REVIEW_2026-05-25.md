# Code Review & Simplification Report

**Date:** 2026-05-25
**Branch:** `claude/brave-maxwell-qOTug`
**Scope:** Whole repository — security review (`/security-review`) + code-simplification pass
**Mode:** Report only (no source, migration, or config changes were made)

---

## 1. Executive summary

The codebase is **mature and clean for its size** (~344 source files, ~101k lines,
16 edge functions, 188 migrations). Security hygiene is strong: strict CSP, HSTS,
Stripe webhook signature verification, PII-stripped client cache, session in
`sessionStorage` (not `localStorage`), and company-scoped payment intents.

This review found **one verified Medium security issue** (CORS wildcard fallback in
three edge functions), two Low/defense-in-depth items, and a set of **behavior-
preserving** simplification opportunities — chiefly a handful of genuinely nested
ternaries and a few local re-implementations of helpers that already exist in
`src/lib`. No whole-repo rewrite is recommended; the high-value changes are
targeted and low-risk.

One previously-suspected High issue (permissive RLS on `solicitud_renta_unidad` /
`solicitud_mudanza_unidad`) was investigated and found **already fixed** — see §4.

---

## 2. Method & notes on the brief

- **Findings are grounded.** Every item below cites code that was read directly at
  the listed `file:line`. An initial automated pass flagged a now-stale RLS issue;
  it was discarded after verification (see §4), so nothing here is relayed
  unverified.
- **No `CLAUDE.md` exists** in the repo, although the request referenced one. The
  standards it lists are, in practice, **already followed**:
  - `export function` is the norm: **361** declarations, **0** top-level arrow
    exports — no arrow→function churn is needed.
  - Type discipline is good: only **4** `: any` usages; **0**
    `dangerouslySetInnerHTML`.
- **`/security-review` normally diffs a branch**, but the working tree is clean, so
  this was run as a whole-codebase review.
- Per request, this pass is **report-only** — no code was changed.

---

## 3. Security findings

### 3.1 [Medium] CORS falls back to wildcard `*` in three edge functions

Three functions define their **own** `getCorsHeaders` that returns
`Access-Control-Allow-Origin: '*'` whenever the request origin is not in the
allowlist, instead of using the shared, safer helper.

| File | Line |
|------|------|
| `supabase/functions/google-oauth-initiate/index.ts` | 17 |
| `supabase/functions/google-oauth-callback/index.ts` | 18 |
| `supabase/functions/send-email/index.ts` | 17 |

```ts
'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : '*',
```

The shared helper `supabase/functions/_shared/cors.ts:57-66` already does the
**right** thing — it falls back to `allowedOrigins[0]` and always includes the
production domains (`administratodo.com`, etc.):

```ts
const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
```

**Why it matters:** the wildcard relaxes the origin restriction these functions
otherwise try to enforce, and the three local copies also omit the hardcoded
production-domain allowlist the shared helper provides.

**Honest severity caveat:** real-world exploitability is limited — none of these
responses set `Access-Control-Allow-Credentials: true`, and the functions require
an `Authorization` bearer token that browsers do **not** send cross-origin without
credentials. This is primarily a hardening + consistency fix, not an open door.

**Recommended fix:** delete the three local `getAllowedOrigins`/`getCorsHeaders`
copies and import `getCorsHeaders`, `isOriginAllowed`, and `validateOrigin` from
`_shared/cors.ts` (this is also the simplification win in §5.3). Requires
redeploying the affected functions to take effect.

### 3.2 [Low] Service-role key compared with `===` (not constant-time)

Internal callers are authenticated by direct string comparison to the service-role
key:

- `supabase/functions/notify-package/index.ts:257` — `if (token && token === SERVICE_ROLE_KEY)`
- `supabase/functions/route-reminders/index.ts:343` — same pattern

**Risk: low.** The key is long and high-entropy, so a remote timing attack is
impractical. If hardening is desired, use a constant-time comparison. Note that the
Web Crypto API has **no** `timingSafeEqual` (that is Node-only); in Deno, compare
SHA-256 digests of both sides, or implement a length-independent XOR loop.

### 3.3 [Low / informational] OAuth `redirect_uri` not validated against an allowlist

`supabase/functions/google-oauth-callback/index.ts:110` builds the token-exchange
redirect from an environment variable:

```ts
redirect_uri: `${APP_URL}/`,
```

`APP_URL` is server-configured (not user input), so the risk is low and depends on
an environment compromise. As defense-in-depth, validate `APP_URL`'s host against a
hardcoded allowlist before use.

---

## 4. Investigated and found already fixed (no action)

- **RLS on `solicitud_renta_unidad` / `solicitud_mudanza_unidad`.** The original
  `FOR ALL ... USING (true) WITH CHECK (true)` policies (migrations
  `20260513000001` / `20260513000002`) were **replaced with company-scoped
  policies** by `supabase/migrations/20260516000002_security_rls_close_solicitud_renta_mudanza.sql`
  (per-operation SELECT/INSERT/UPDATE/DELETE gated on `get_my_company_id()`,
  `get_my_cliente_id()`, `is_super_admin()`). **No cross-tenant exposure remains.**

---

## 5. Security — verified clean

Each confirmed by reading the cited code:

- **CSP & security headers** — `vercel.json:9-15`: `script-src 'self'` (no
  `unsafe-inline` for scripts), `frame-src 'none'`, `object-src 'none'`, HSTS w/
  preload, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  Referrer-Policy, Permissions-Policy.
- **Stripe webhook signature verification** —
  `stripe-webhook-handler/index.ts:64-112`: rejects missing signature, verifies via
  `Stripe.webhooks.constructEvent`, rejects invalid.
- **Payment-intent company scoping** — `create-payment-intent/index.ts:98-106`:
  caller's `company_id` is checked against the requested one (403 otherwise).
- **PII not persisted to cache** — `useData.ts:26-67`: `sanitizeForCache` strips
  `email`, `telefono`, `telefono_alterno`, `direccion`, etc. before writing.
- **Session in `sessionStorage`** — `supabase.ts:34`, `useAuth.ts:30-37`: session
  is in `sessionStorage`; an explicit note documents removal of the
  XSS-vulnerable `localStorage` path. Login failure throttling present
  (`useAuth.ts:48-60`).

---

## 6. Simplification opportunities (behavior-preserving)

### 6.1 Genuinely nested / chained ternaries

A loose scan suggests ~330 lines with chained `?:`, but most are harmless: simple
two-branch ternaries and pluralization (`x !== 1 ? 's' : ''`) are idiomatic and
should be **left as-is**. The ones worth changing are **3-level chains in
attribute/style positions**, where the logic is hard to scan:

| File:line | Current | Suggestion |
|-----------|---------|------------|
| `src/components/shared/DataTable.tsx:278` | `aria-sort={!col.sortable ? 'none' : isSorted ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}` | Extract a small `getAriaSort(col, sortConfig)` helper with early returns. |
| `src/components/shared/DataTable.tsx:273` | `const arrow = !isSorted ? '' : sortConfig.direction === 'asc' ? ' ↑' : ' ↓'` | `if/else` or a 3-key lookup. |
| `src/components/condominios/tabs/ReportesTab.tsx:123` | `pctEjec >= 100 ? 'danger' : pctEjec >= 80 ? 'warning' : 'success'` (threshold→color) | Small `thresholdColor(value, [100, 80])` helper. |
| `src/components/condominios/tabs/GeneradorCuotasTab.tsx:282,286` | `completado ? 'success' : activo ? 'primary' : 'line'` (3-state step) | Tiny `stepColor(completado, activo)` helper or `if/else`. |

The repo already models the preferred pattern — a lookup/helper rather than an
inline chain — in `src/components/shared/statusTone.ts` + `StatusBadge.tsx`. New
helpers should follow that style.

### 6.2 Local re-implementation of an existing helper

`src/components/condominios/tabs/ReporteConsolidadoTab.tsx:28` defines:

```ts
function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
```

This duplicates `formatCurrency` (`src/lib/format.ts:79-86`, already used in ~17
places). **Caveat before swapping:** `formatCurrency` uses `defaultLocale`
(`'es-GT'`, `format.ts:12`) and adds null/NaN handling, whereas the local copy
hardcodes `'es'`. Confirm `'es'` vs `'es-GT'` produce identical separators for the
real data before replacing, to honor "preserve functionality".

### 6.3 Duplicated CORS code (overlaps §3.1)

The three functions in §3.1 each carry their own `getAllowedOrigins` +
`getCorsHeaders`, re-implementing `_shared/cors.ts`. Consolidating onto the shared
module removes the duplication **and** fixes the wildcard fallback in one change.

### 6.4 Repeated condition across sibling style props

In KPI/stat rendering, the same condition is repeated for `color`, `bg`, and
`border` (e.g. in `ReporteConsolidadoTab.tsx` / `ReportesTab.tsx` KPI boxes:
`pendiente > 0 ? danger : success` written three times). Compute the tone once
(one variable, or a `{color,bg,border}` returned by a helper) and spread it.

### 6.5 Repeated 2-level save-button label

`saving ? 'Guardando…' : editId ? 'Actualizar' : '…'` recurs across modal save
buttons (e.g. `InspeccionesTab.tsx:185`, `ProformasTab.tsx:194`, and others).
Optional: a tiny `saveButtonLabel(saving, editId, createLabel)` helper. Low
priority — the pattern is readable as-is; only worth it for consistency.

---

## 7. Explicitly excluded (and why)

- **Swal → toast migration (~1000 call sites).** Replacing blocking `Swal.fire`
  dialogs with non-blocking `toast` **changes user-facing behavior**, which
  violates the "never change what the code does" constraint. This is a product/UX
  decision, not a simplification — track it separately.
- **Mass `arrow → function`, blanket return-type / Props annotations.** The
  codebase already complies; broad edits would be churn with regression risk.
- **Whole-repo mechanical rewrite.** Unsafe here — there is no linter/formatter and
  test coverage is minimal (only `business.test.ts`, `rutasAccess.test.ts`).
  Prefer the targeted changes above.

---

## 8. Prioritized recommendations

**Do first (low risk, clear win):**
1. Consolidate the three edge functions onto `_shared/cors.ts` — fixes §3.1 and
   §6.3 together. (Redeploy functions afterward.)
2. Replace the 3-level ternaries in `DataTable.tsx:273,278` with helpers/early
   returns (§6.1).
3. Reuse `formatCurrency` in `ReporteConsolidadoTab.tsx:28` after confirming
   locale equivalence (§6.2).

**Do next (small, optional):**
4. Threshold/step color helpers for `ReportesTab.tsx:123` and
   `GeneradorCuotasTab.tsx:282,286` (§6.1); deduplicate the repeated KPI condition
   (§6.4).

**Defense-in-depth (low urgency):**
5. Constant-time service-role compare (§3.2); allowlist `APP_URL` (§3.3).

**Leave alone:** large stateful components (`AmenidadesTab.tsx` 1925 lines,
`CustomerPortal.tsx` 1567, `useData.ts` 644) unless doing a dedicated, well-tested
refactor — high blast radius.

---

## 9. How to action / verify

- **Security fixes** must be followed by redeploying the affected Supabase edge
  functions; verify by sending a cross-origin `OPTIONS`/request with a
  non-allowlisted `Origin` and confirming the response no longer echoes `*`.
- **Simplification changes** should each be verified by `npm run type-check` and
  `npm test`, plus a manual smoke test of the touched screen, since behavior must
  be identical.
