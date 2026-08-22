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

- **Preflight** (`scripts/e2e-preflight.mjs`): sin cualquiera de las SEIS
  variables obligatorias, el job **falla ANTES de instalar nada ni ejecutar
  Playwright** — no existe ningún camino en el que la falta de variables
  produzca un verde. PR de fork y Dependabot —que no reciben Actions secrets
  por diseño— también quedan en **rojo**, con la explicación estructural y cómo
  desbloquear (rama interna).
- **El destino se valida POSITIVAMENTE, no por denylist**: el despliegue
  publica `/e2e-meta.json` (lo genera `scripts/generar-e2e-meta.mjs`, colgado
  del build) y tiene que demostrar TRES cosas: `environment=e2e-sandbox` (el
  marcador que sólo lleva un build con `VITE_E2E_ENVIRONMENT=e2e-sandbox`),
  `supabase_project_ref` igual a `E2E_EXPECTED_SUPABASE_REF`, y `commit_sha`
  igual al commit que el job está probando (en PRs, el HEAD de la rama). Un
  despliegue viejo, producción o un alias desconocido fallan aunque no estén
  en ninguna lista. La denylist de hosts de producción (de `vercel.json`)
  queda como segunda defensa: a esos ni se les consulta la metadata.
- **La URL se RESUELVE por SHA**: el preflight busca en la API de Deployments
  de GitHub los despliegues registrados para el commit (Vercel los publica con
  su `environment_url`) y los valida; `E2E_BASE_URL` es opcional y entra como
  un candidato más, sometido a las mismas comprobaciones. La URL elegida es la
  que corre la suite.
- **Sin ejecuciones simultáneas contra el sandbox compartido**: el job usa
  `concurrency: e2e-shared-sandbox` con `cancel-in-progress: false` — las
  corridas se encolan, ninguna muere a medias.
- **Vercel Deployment Protection, fail-closed**: un Preview protegido devuelve
  401 a cualquier visitante sin sesión de Vercel. El job usa el mecanismo
  oficial —**Protection Bypass for Automation**—: `E2E_VERCEL_BYPASS_TOKEN` es
  **obligatorio** y viaja como header `x-vercel-protection-bypass` (con
  `x-vercel-set-bypass-cookie: true` para que Vercel siembre la cookie) tanto
  en el fetch de `/e2e-meta.json` del preflight como en el navegador de
  Playwright (`extraHTTPHeaders` en `playwright.config.ts`). Un 401/403 se
  diagnostica nombrando la variable — el **valor** del token no se imprime
  nunca.
- **Sin `service_role`**: el job no la recibe ni la necesita; el despliegue de
  pruebas usa la anon key de su sandbox, como cualquier cliente.
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
| `E2E_EXPECTED_SUPABASE_REF` | ✅ | La DECLARACIÓN del proyecto Supabase sandbox contra el que corre la suite (el ref, no una credencial). El despliegue tiene que apuntar exactamente ahí. |
| `E2E_BASE_URL` | opcional | Candidato ESTÁTICO de URL, sometido a la misma validación positiva (marcador + ref + sha). Normalmente innecesario: el preflight resuelve el despliegue del commit por la API de Deployments. |
| `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD` | ✅ | Cuenta admin/operadora del tenant sembrado en ese sandbox. |
| `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD` | ✅ | Usuario del MISMO tenant con rol restringido (viewer/operator, no admin ni owner). |
| `E2E_VERCEL_BYPASS_TOKEN` | ✅ | **Protection Bypass for Automation** del proyecto de Vercel (Settings → Deployment Protection). Sin él, un Preview protegido respondería 401 al preflight y al navegador. Nunca se imprime. |
| `E2E_INVITE_TOKEN` | condicional | Token de invitación **fresco y de un solo uso** (insert en `user_invitations` + edge `invite-user`). No puede vivir como secreto estático: se genera justo antes de la corrida que deba ejercitar ese flujo. Ausente → `invitation-accept` queda como **omitido declarado**. |
| `E2E_FISCAL_SANDBOX_READY` | condicional | `1` cuando el despliegue de pruebas tiene PAC **sandbox** y configuración fiscal cargada. Ausente → `fiscal-timbrar` queda como **omitido declarado**. |

El entorno de referencia: **Vercel Preview** de esta rama (no el alias de
producción), construido con `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` del
proyecto **Supabase sandbox** y `VITE_E2E_ENVIRONMENT=e2e-sandbox` — las tres
como variables de entorno *Preview* en Vercel (idealmente restringidas a las
ramas de prueba). Sin el marcador, ningún despliegue pasa la validación
positiva; con él pero apuntando a otro Supabase, tampoco.

No hay `data-testid` en la app (confirmado), así que los selectores son
**semánticos** (placeholder, label, rol+texto). Si la UI cambia esos textos, hay
que ajustar el selector — está aislado en `e2e/fixtures/`.

## Correr local

Contra un dev server o un preview ya levantado:

```bash
# @playwright/test y @types/node ya están FIJADOS en package.json (versión
# exacta): npm ci los instala; sólo falta el binario del navegador.
npm ci
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

| Var | Para | En CI |
|---|---|---|
| `E2E_BASE_URL` | base URL del preview/sandbox. En CI es **opcional**: el preflight resuelve la URL del despliegue del SHA por la API de Deployments; si se define, entra como un candidato más bajo la misma validación positiva. En local es la forma normal de apuntar la suite. | opcional |
| `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD` | login + flujos autenticados | obligatoria |
| `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD` | usuario viewer/operator del mismo tenant | obligatoria |
| `E2E_EXPECTED_SUPABASE_REF` | declaración del proyecto Supabase sandbox esperado | obligatoria |
| `E2E_VERCEL_BYPASS_TOKEN` | bypass oficial de la Deployment Protection de Vercel | obligatoria |
| `E2E_INVITE_TOKEN` | token fresco de invitación | condicional (sólo invitation-accept) |
| `E2E_FISCAL_SANDBOX_READY` | `=1` si el preview tiene PAC sandbox listo | condicional (sólo fiscal-timbrar) |

## CI

Workflow **dedicado** `.github/workflows/e2e.yml` (job `E2E (caminos de
dinero/auth)`), disparado en `pull_request` y `workflow_dispatch` — **no** en
push a `main`: el build de `main` es el de producción y nunca lleva el marcador
`e2e-sandbox`, así que un run automático ahí sólo podría quedar rojo por
ausencia de destino. Cuando exista un despliegue de pruebas del SHA exacto de
`main`, se lanza a mano con `workflow_dispatch`.

La secuencia del job:

1. **Preflight fail-closed** (`scripts/e2e-preflight.mjs`): exige las SEIS
   variables obligatorias y **descubre el despliegue por la API de Deployments
   de GitHub** para el SHA exacto que el job prueba (en PRs, el HEAD de la
   rama). Cada candidato tiene que demostrar `environment=e2e-sandbox`, el
   `supabase_project_ref` igual a `E2E_EXPECTED_SUPABASE_REF` y el
   `commit_sha` exacto, leyendo `/e2e-meta.json` con el header de bypass de
   Vercel. Sin destino válido, el job falla **antes de instalar nada**.
2. `npm ci` (dependencias fijadas en el lockfile — no hay instalación bajo
   demanda de Playwright) + el binario de Chromium + type-check de `e2e/`.
3. `npx playwright test` contra la URL validada, con el bypass en
   `extraHTTPHeaders`.
4. **Verificador post-ejecución** (`scripts/e2e-verificar.mjs`) sobre el
   reporte JSON: cero ejecutadas, todas skipped o un spec obligatorio omitido
   → rojo. El reporte se sube como artifact incluso en fallo.

Las corridas se **encolan** (`concurrency: e2e-shared-sandbox`,
`cancel-in-progress: false`): el sandbox es compartido y una corrida cancelada
a medias dejaría datos a medio sembrar.

## Type-check

`e2e/` queda fuera del `tsconfig.json` raíz (`include: ["src"]`), así que el
`npm run type-check` del repo no se ve afectado. Para chequear los specs:

```bash
npx tsc -p e2e/tsconfig.json
```
