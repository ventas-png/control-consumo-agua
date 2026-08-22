# E2E (Playwright) — caminos de dinero/auth (Track T8)

Tests end-to-end de los flujos **críticos de dinero y autenticación**, contra el
**preview branch del PR** o un **sandbox** — NUNCA producción.

| Spec | Camino |
|---|---|
| `auth-login.e2e.ts` | Login email/password (Supabase) + rechazo de credenciales inválidas |
| `unauthorized-access.e2e.ts` | Visitante anónimo: rutas protegidas caen al landing público, no al shell |
| `role-restricted-access.e2e.ts` | Usuario autenticado de rol restringido: secciones admin responden "Acceso Denegado" |
| `invitation-accept.e2e.ts` | Alta por invitación (`/aceptar-invitacion?token=…`) |
| `agua-lectura-cobro.e2e.ts` | Captura de lectura → emitir factura (agua) |
| `agua-lectura-validaciones.e2e.ts` | Edge cases de dinero: lectura sin unidad y consumo negativo rechazados |
| `condominios-cuota.e2e.ts` | Emitir cuota → registrar pago (condominios) |
| `fiscal-timbrar.e2e.ts` | Timbrar comprobante FEL/CFDI contra **Sandbox** |
| `contabilidad-ledger.e2e.ts` | Selector de contabilidad: la empresa y cada proyecto llevan libros propios |

> Los specs usan extensión `*.e2e.ts` (no `*.spec.ts`) a propósito: así el glob por
> defecto de Vitest (`**/*.{test,spec}.ts`) no los recoge. Sólo Playwright los corre.

## Diseño: FAIL-CLOSED en CI, gating como comodidad local

En CI el verde de este job significa «la suite corrió», no «no se opuso»:

- **Preflight** (`scripts/e2e-preflight.mjs`): sin cualquiera de las CINCO
  variables obligatorias, el job **falla** con instrucciones. PR de fork y
  Dependabot —que no reciben Actions secrets por diseño— también quedan en
  **rojo**, con la explicación estructural y cómo desbloquear (rama interna).
  Además rechaza un `E2E_BASE_URL` que apunte a producción o que no sea https.
- **Verificador post-ejecución** (`scripts/e2e-verificar.mjs`): lee el reporte
  JSON y **falla** si se descubrieron cero pruebas, si todas quedaron skipped,
  si un spec obligatorio no ejecutó ninguna, o si un condicional se omitió con
  su variable presente.
- El auto-skip de `fixtures/env.ts` sigue existiendo como **comodidad local**
  (correr sin variables no revienta tu terminal); en CI esos skips son
  precisamente lo que el verificador convierte en rojo.
- Los pasos que dependen de **datos sembrados** (una unidad, un cargo, una
  cuota…) se skipean en runtime con un mensaje accionable; si eso deja un spec
  obligatorio en cero ejecutadas, el job falla nombrando qué hay que sembrar.

### Secretos que configura el administrador

En *Settings → Secrets and variables → Actions*:

| Secreto | Obligatorio | Qué es y de dónde sale |
|---|---|---|
| `E2E_BASE_URL` | ✅ | URL **https** del despliegue ESTABLE de pruebas — un deploy de Vercel (Preview) de una rama estable dedicada, conectado al **Supabase sandbox**. **Nunca** producción: el preflight rechaza los hosts de `vercel.json`. |
| `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD` | ✅ | Cuenta admin/operadora del tenant sembrado en ese sandbox. |
| `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD` | ✅ | Usuario del MISMO tenant con rol restringido (viewer/operator, no admin ni owner). |
| `E2E_INVITE_TOKEN` | condicional | Token de invitación **fresco y de un solo uso** (insert en `user_invitations` + edge `invite-user`). No puede vivir como secreto estático: se genera justo antes de la corrida que deba ejercitar ese flujo. Ausente → `invitation-accept` queda como **omitido declarado**. |
| `E2E_FISCAL_SANDBOX_READY` | condicional | `1` cuando el despliegue de pruebas tiene PAC **sandbox** y configuración fiscal cargada. Ausente → `fiscal-timbrar` queda como **omitido declarado**. |

El entorno de referencia: **Vercel Preview** (rama estable de pruebas, no el
alias de producción) apuntando con `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
al proyecto **Supabase sandbox** — el mismo criterio que el harness RLS, que
jamás apunta a producción.

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
| `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD` | usuario viewer/operator del mismo tenant | sólo role-restricted-access |

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
