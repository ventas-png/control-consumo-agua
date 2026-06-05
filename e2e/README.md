# E2E (Playwright) — caminos de dinero/auth (Track T8)

Tests end-to-end de los flujos **críticos de dinero y autenticación**, contra el
**preview branch del PR** o un **sandbox** — NUNCA producción.

| Spec | Camino |
|---|---|
| `auth-login.e2e.ts` | Login email/password (Supabase) + rechazo de credenciales inválidas |
| `invitation-accept.e2e.ts` | Alta por invitación (`/aceptar-invitacion?token=…`) |
| `agua-lectura-cobro.e2e.ts` | Captura de lectura → emitir factura (agua) |
| `condominios-cuota.e2e.ts` | Emitir cuota → registrar pago (condominios) |
| `fiscal-timbrar.e2e.ts` | Timbrar comprobante FEL/CFDI contra **Sandbox** |

> Los specs usan extensión `*.e2e.ts` (no `*.spec.ts`) a propósito: así el glob por
> defecto de Vitest (`**/*.{test,spec}.ts`) no los recoge. Sólo Playwright los corre.

## Diseño: credencial-gated + guardas de runtime

- **Sin `E2E_BASE_URL`** → todos los specs se **skipean** (CI verde sin secretos).
- Cada flujo tiene su propio gate de credenciales (login / invite token / fiscal).
- Los pasos que dependen de **datos sembrados** (una unidad, un cargo pendiente,
  una cuota…) se **skipean en runtime** si el dato no está, en vez de fallar. Así
  la suite nunca da un falso rojo; cuando el preview está sembrado, corre de verdad.

No hay `data-testid` en la app (confirmado), así que los selectores son
**semánticos** (placeholder, label, rol+texto). Si la UI cambia esos textos, hay
que ajustar el selector — está aislado en `e2e/fixtures/`.

## Correr local

Contra un dev server o un preview ya levantado:

```bash
npm i -D @playwright/test @types/node
npx playwright install chromium

export E2E_BASE_URL="https://<preview-ref>.vercel.app"   # o http://localhost:5173
export E2E_LOGIN_EMAIL="qa@example.com"
export E2E_LOGIN_PASSWORD="********"
# opcionales por flujo:
export E2E_INVITE_TOKEN="<token-fresco>"        # para invitation-accept
export E2E_FISCAL_SANDBOX_READY=1               # para fiscal-timbrar

npx playwright test --config e2e/playwright.config.ts
```

> El login/agua/condominios usan `E2E_LOGIN_*`. La invitación consume un token
> **efímero** (one-shot): generá uno fresco por corrida. El timbrado necesita PAC
> sandbox configurado en el preview.

## Variables de entorno

| Var | Para | Obligatoria |
|---|---|---|
| `E2E_BASE_URL` | base URL del preview/sandbox | sí (sin ella, todo skip) |
| `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD` | login + flujos autenticados | login/agua/condominios/fiscal |
| `E2E_INVITE_TOKEN` | token fresco de invitación | sólo invitation-accept |
| `E2E_FISCAL_SANDBOX_READY` | `=1` si el preview tiene PAC sandbox listo | sólo fiscal-timbrar |

## CI

Job `e2e` en `.github/workflows/coverage.yml`: sólo instala Playwright y corre los
specs cuando el secreto `E2E_BASE_URL` del repo está presente; si no, es no-op
verde. No se agrega `@playwright/test` a `package.json` (evita que el `npm ci` de
`ci.yml` dispare la descarga de browsers): el job lo instala on-demand.

## Type-check

`e2e/` queda fuera del `tsconfig.json` raíz (`include: ["src"]`), así que el
`npm run type-check` del repo no se ve afectado. Para chequear los specs:

```bash
npx tsc -p e2e/tsconfig.json
```
