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
- **El preflight ESPERA al build de Vercel**: el workflow arranca con el push y
  Vercel tarda alrededor de un minuto en construir, así que consultar la API una
  sola vez perdía la carrera siempre. El preflight sondea cada 15 s hasta 15 min
  (`INTERVALO_SONDEO_MS` / `ESPERA_DESPLIEGUE_MS`). Esto **no afloja el
  fail-closed**: agotada la ventana no hay candidato y el job queda rojo. Con
  `E2E_BASE_URL` definida no espera nada: ya hay destino que validar. Si el job
  se queda esperando los 15 min completos, mirá en Vercel si el build de ese
  commit falló o quedó en cola.
- **Sin ejecuciones simultáneas contra el sandbox compartido**: el job usa
  `concurrency: e2e-shared-sandbox` con `cancel-in-progress: false` — las
  corridas se encolan, ninguna muere a medias.
- **Vercel Deployment Protection, fail-closed y limitada al origen**: un
  Preview protegido devuelve 401 a cualquier visitante sin sesión de Vercel.
  El job usa el mecanismo oficial —**Protection Bypass for Automation**—:
  `E2E_VERCEL_BYPASS_TOKEN` es **obligatorio** y viaja como header
  `x-vercel-protection-bypass` (con `x-vercel-set-bypass-cookie: true`)
  **únicamente hacia el origen del Preview**: en el fetch de `/e2e-meta.json`
  del preflight y en la única petición de siembra del proyecto `setup` de
  Playwright (`e2e/bypass.setup.ts`), que guarda la **cookie** de bypass en un
  `storageState` que el proyecto `chromium` carga. El navegador navega con la
  cookie — que sólo se envía a su propio origen — y el token **jamás** entra
  como header global (`use.extraHTTPHeaders` acompañaría TODAS las solicitudes
  del contexto, también hacia otros orígenes, filtrando el secreto; una prueba
  con dos orígenes locales lo impide: `scripts/__tests__/e2e-bypass.test.mjs`).
  Un 401/403 se diagnostica nombrando la variable — el **valor** del token no
  aparece en URLs, logs, reportes, traces ni artifacts.
- **Sin `service_role`**: el job no la recibe ni la necesita; el despliegue de
  pruebas usa la anon key de su sandbox, como cualquier cliente.
- **Verificador post-ejecución** (`scripts/e2e-verificar.mjs`): lee el reporte
  JSON y **falla** si se descubrieron cero pruebas, si todas quedaron skipped,
  si un spec obligatorio no ejecutó ninguna, si un condicional se omitió con
  su variable presente, o si quedó **cualquier skip inesperado** (un test
  suelto de un spec obligatorio, o de un archivo fuera de las listas), aunque
  el resto del archivo haya corrido.

  **El criterio del verde**, explícito: **0 fallos**, **0 skips inesperados**
  (el único skip admitido es el de un spec condicional sin su variable, y
  queda **declarado** en el resumen) y **todos los specs obligatorios con al
  menos una prueba ejecutada**. No es "0 skips literal": `invitation-accept`
  y `fiscal-timbrar` pueden quedar en omisión declarada sin sus variables —
  si algún día se quiere el 100 %, basta configurar `E2E_INVITE_TOKEN` fresco
  y `E2E_FISCAL_SANDBOX_READY=1` y el verificador los exigirá.
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

#### Comprobá las credenciales ANTES de guardarlas

Una credencial mal copiada no se nota al guardarla: se nota ~15 minutos después,
como trece pruebas de Playwright cayendo en un timeout de 20 s. Pasó en el run
32753812314 — el Supabase era el correcto y el bypass funcionaba, pero Supabase
contestaba `400 invalid_credentials` a cada intento. Preguntáselo directamente:

```bash
VITE_SUPABASE_URL="https://<ref-del-sandbox>.supabase.co" \
VITE_SUPABASE_ANON_KEY="<anon key del MISMO proyecto>" \
E2E_LOGIN_EMAIL="…"      E2E_LOGIN_PASSWORD="…" \
E2E_RESTRICTED_EMAIL="…" E2E_RESTRICTED_PASSWORD="…" \
node scripts/verificar-credenciales-e2e.mjs
```

Usa la **anon key**, la misma que el navegador, así que comprueba exactamente lo
que hará Playwright. Distingue "contraseña incorrecta" de "email sin confirmar",
de "anon key de otro proyecto" y de un fallo de red; y nunca imprime una
contraseña. Lo que **no** puede comprobar: que ambos usuarios pertenezcan a la
misma empresa y que el restringido no sea admin ni owner.

> **Las cuentas de `scripts/seed-rls-sandbox.mjs` rotan en CADA corrida del
> seed.** Sirve la contraseña de la última. Si volvés a sembrar después de
> guardar los secretos E2E, quedan obsoletos — y también los `RLS_USER_*`, que
> el harness RLS usa. Actualizá todos de una sola salida del seed.

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
3. `npx playwright test` contra la URL validada: primero el proyecto `setup`
   siembra la cookie de bypass con una petición al origen exacto del Preview,
   después `chromium` navega con esa cookie (`storageState`).
4. **Verificador post-ejecución** (`scripts/e2e-verificar.mjs`) sobre el
   reporte JSON: cero ejecutadas, todas skipped, un spec obligatorio omitido
   o cualquier **skip inesperado** → rojo. El reporte se sube como artifact
   incluso en fallo (el `storageState` con la cookie de bypass no está entre
   los paths subidos).

Las corridas se **encolan** (`concurrency: e2e-shared-sandbox`,
`cancel-in-progress: false`): el sandbox es compartido y una corrida cancelada
a medias dejaría datos a medio sembrar.

## Type-check

`e2e/` queda fuera del `tsconfig.json` raíz (`include: ["src"]`), así que el
`npm run type-check` del repo no se ve afectado. Para chequear los specs:

```bash
npx tsc -p e2e/tsconfig.json
```
