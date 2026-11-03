# Política de seguridad — AdministraTodo

## Reporte de vulnerabilidades

Si encontrás una vulnerabilidad, **no abras un issue público**. Escribí a
**ventas@mayanresidenciales.com** con el asunto `[SECURITY]` incluyendo:

- Descripción y impacto potencial (¿qué datos/tenants alcanza?).
- Pasos de reproducción o PoC.
- Versión/URL donde la observaste.

Compromiso: acuse de recibo en 72 horas; corrección priorizada según impacto
(las vulnerabilidades de aislamiento entre tenants y del camino de dinero se
tratan como P0). Pedimos divulgación coordinada: no publiques detalles hasta
que el fix esté desplegado.

## Alcance

- Aplicación web (Vercel) y Edge Functions / base de datos (Supabase).
- Aislamiento multi-tenant (RLS), autenticación/MFA, camino de pagos
  (Stripe/payfac), portal del residente.

Fuera de alcance: DoS volumétrico, ingeniería social, hallazgos que requieran
acceso físico al dispositivo de la víctima.

## Postura de seguridad (resumen para revisores)

- **Aislamiento**: RLS en todas las tablas de tenant + harness de invariantes
  en CI (`RLS harness`); RPCs `SECURITY DEFINER` con scoping explícito por
  `company_id` y guards trivaluados fail-closed.
- **Secretos de tenant**: bóveda cifrada (AES-GCM vía `TENANT_SECRETS_ENC_KEY`)
  con RPCs `*_estatus` que jamás devuelven el secreto.
- **Camino de dinero**: rate limiting por usuario, comparación de secretos en
  tiempo constante (`timingSafeEqualSecret`), validación estricta de bodies
  (`validate.ts` por edge), idempotencia por llaves naturales UNIQUE.
- **Códigos/tokens**: siempre CSPRNG (`crypto.getRandomValues` /
  `gen_random_bytes`) — nunca `Math.random()`/`random()`.
- **MFA**: enforcement server-side (`aal2`) vía políticas RESTRICTIVE cuando el
  tenant lo exige.
- **Dependencias**: Dependabot (npm + GitHub Actions) semanal.

## Overrides de npm vigentes

`package.json → overrides` fuerza versiones que los padres aún no declaran.
Cada entrada existe por un advisory concreto y tiene criterio de retiro; no
agregar overrides sin documentarlos aquí.

| Override | Por qué | Evidencia de compatibilidad | Retirar cuando |
| --- | --- | --- | --- |
| `exceljs → uuid ^11.1.1` | uuid <11.1.1: falta el bounds-check del `buf` en v3/v5/v6 (advisory de npm audit). exceljs@4.4.0 declara `uuid ^8.3.2` y no hay release del padre con uuid parcheado; el «fix» que propone `npm audit` DEGRADA exceljs a 3.4.0, que no es aceptable. | exceljs consume únicamente `v4()` por `require` CJS (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`); uuid 11 conserva el build CJS y el named export (13+ es ESM-only: NO subir el override a 13 sin verificar). La costura se ejecuta de verdad en `src/lib/__tests__/xlsx.test.ts` (round-trip con formato condicional dataBar → uuidv4 real). | exceljs publique una versión con `uuid >=11.1.1`. |
| `minimatch ^11.0.4` | minimatch <11.0.1: GHSA-g3hv-75wg-m249 (moderate; DoS por amplificación de globparts). No hay backport: el fix solo existe en 11.x. Ningún padre lo declara: eslint, `@eslint/config-array` y typescript-estree piden `^10`; filelist (workbox → ejs → jake) y readdir-glob (exceljs → archiver) `^5`; glob 7 `^3`. | minimatch 11 cambia de motor (`@isaacs/nonrecursive-glob-match`, sin backtracking recursivo) y elimina `makeRe`, `AST` y `MMRegExp`: `Minimatch#set` ya no contiene `RegExp`. Solo glob 7/11/13 usaban esos internos, por eso va junto con el override de glob. Los demás consumidores usan la API pública, que 11 conserva: `new Minimatch(p, opts).match(f[, partial])` (eslint, config-array, readdir-glob), `minimatch()` (typescript-estree) y `match()` (filelist). Diferencial minimatch 3/5/10 vs 11 sobre las 4 101 rutas reales del repo (archivos y directorios), con los patrones de `eslint.config.js`, workbox y Sentry y `{dot:true}` (lo que usan eslint y config-array), en modo normal y parcial y con `flipNegate`: 0 diferencias en 1,5 M comparaciones. Solo difiere con rutas sintéticas (`.`, `..`, `''`, `a/../b`) o en modo parcial sin `dot`, que ningún consumidor del repo usa. `eslint .` recorre los mismos 969 archivos con los mismos resultados y resuelve la misma configuración. filelist, readdir-glob y archiver-utils funcionan en una prueba de humo. Ojo: 11.0.4 (2026-11-02) y `@isaacs/nonrecursive-glob-match` 1.0.3 (2026-10-28) son de la última semana. Los publica el mismo mantenedor de glob y rimraf, y rimraf 6.1.4 ya los trae dentro de rango. | eslint, `@eslint/config-array`, typescript-eslint, filelist y readdir-glob declaren minimatch ≥ 11.0.1. Entonces basta `npm audit fix` en rango. |
| `glob ^14.0.3` | glob 9.0.0–14.0.1: GHSA-3g3m-2fjr-6pw4 (moderate; un recorrido sigue después de cancelarse con `AbortSignal`). Además, minimatch 11 exige glob 14 (ver arriba). Solo rimraf 6.1.4 (@capacitor/cli) lo declara. @sentry/bundler-plugins y el docgen de Storybook piden `^13`, workbox-build `^11`, archiver-utils (exceljs → archiver) `^7` y rimraf 2.7.1 (exceljs → unzipper → fstream) `^7`. | Los consumidores usan solo la API pública: workbox `globSync(pattern, {cwd, follow, ignore})`, Sentry `glob(patterns, {absolute, nodir, root})`, el docgen `globSync(...)` y archiver-utils `glob.sync`. De 13 a 14 solo desaparece la opción `debug`. Diferencial glob 7/11/13 vs 14 con la llamada exacta de cada consumidor sobre el repo y `dist/`: resultados idénticos. `vite build` genera un `sw.js` idéntico byte a byte (el precache lo arma workbox con glob). **Excepción conocida**: rimraf 2.7.1 en modo async, con comodín y sobre una ruta inexistente, llama `glob(p, opts, cb)`, que no existe desde glob 9, y lanza `TypeError`. `fstream` solo borra rutas que acaba de verificar con `stat`, y solo lo usa `unzipper.Extract`; exceljs usa únicamente `unzipper.Parse` (`lib/stream/xlsx/workbook-reader.js`), así que ese camino no se ejecuta. | @sentry/bundler-plugins, el docgen, workbox-build y archiver-utils declaren glob ≥ 14.0.2, y exceljs deje unzipper 0.10 (fstream y rimraf 2). Mientras tanto, `npm ls glob` debe mostrar solo 14.x. |

### Estado de `npm audit` al 2026-11-02

Medición sobre `main` (Node 22, `npm ci` limpio). El estado anterior, del
2026-08-28, daba **0 vulnerabilidades**. Desde entonces se publicaron
advisories nuevos contra versiones que ya estaban en el lockfile, y la
medición dio **38 (3 low, 30 moderate, 5 high)** con `npm audit` y **11 (9
moderate, 2 high)** con `--omit=dev`.

`npm audit fix` **sin** `--force` refrescó solo el lockfile, dentro de los
rangos declarados (`package.json` no cambia):

| Paquete | Antes → después | Advisories que cierra |
| --- | --- | --- |
| `@xmldom/xmldom` (plist de @capacitor/cli) | 0.9.10 → 0.9.12 | 13 GHSA (inyección con `requireWellFormed`, ReDoS, tiempo/memoria cuadráticos), p. ej. GHSA-6mj3-qw4j-hgrw y GHSA-93r5-fhx6-vmg9 |
| `brace-expansion` (eslint, glob, workbox, archiver) | 1.1.18 → 1.1.21; 2.1.4 → 2.1.7; 5.0.9 → 5.0.12 | GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p (DoS) |
| `browserslist` | 4.28.6 → 4.29.5 | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g |
| `fast-uri` (ajv de workbox-build) | 3.1.6 → 3.1.9 | 7 GHSA, p. ej. GHSA-qw65-cvwx-89v3 y GHSA-58mr-gqgx-xq4g |
| `baseline-browser-mapping` | 2.10.43 → 2.11.35 | GHSA-w5vr-8v7q-w6rv |
| `serialize-javascript` (terser de workbox-build) | 7.0.7 → 7.1.4 | GHSA-m5mm-p8h7-m29v |
| `fflate` (anidado en posthog-js) | 0.4.8 → 0.4.9 | GHSA-px8p-9vwx-vf98 |

Además subieron, por arrastre: eslint 10.13.0 → 10.14.0,
`@eslint-community/eslint-utils` 4.9.1 → 4.10.1, minimatch de workbox-build
10.2.5 → 10.2.6, caniuse-lite, electron-to-chromium, node-releases y
update-browserslist-db. Verificación: `npm ci`, `npm run type-check`,
`npm run lint`, `npx vitest run` y `npm run build`, todos en verde.

**Resultado: `npm audit` da 31 (2 low, 28 moderate, 1 high) y
`npm audit --omit=dev` da 9 (8 moderate, 1 high).** Los 31 avisos salen de
cuatro advisories raíz. Los demás nombres del reporte (eslint,
typescript-eslint, exceljs, archiver, vite-plugin-pwa, @sentry/vite-plugin,
@storybook/react-vite, @capacitor/cli, etc.) aparecen solo porque dependen de
esos cuatro. Ninguno tiene arreglo en rango y ninguno amerita un override.

El único high, zod, se cerró después con la migración a zod 4 (PR propio,
ver su fila). **Desde entonces `npm audit` da 30 (2 low, 28 moderate, 0 high)
y `npm audit --omit=dev` da 8 (8 moderate, 0 high).**

El 2026-11-03, sobre `main`, `npm audit` daba 29 (2 low, 27 moderate). Ese
día se cerraron minimatch y glob con `npm audit fix` en rango (rimraf
6.1.3 → 6.1.4 de @capacitor/cli, ya con glob 14) y los overrides
`minimatch ^11.0.4` y `glob ^14.0.3` (ver «Overrides de npm vigentes»).
**Desde entonces `npm audit` da 4 (4 low, 0 moderate) y `npm audit
--omit=dev` da 0.** Los cuatro salen de deepmerge, el único advisory raíz
abierto:

| Advisory raíz | Versión instalada / parcheada | ¿Llega al bundle? | Por qué queda | Revisar cuando |
| --- | --- | --- | --- | --- |
| **zod** — GHSA-mrhx-c7xc-m3w5 (high; agotamiento de memoria al validar un arreglo enorme, porque los límites `.max()`/`.length()` se aplicaban después de recorrer cada elemento). **Cerrado.** | Era 3.25.76 (última 3.x) / parcheada 4.6.6, sin backport a 3.x. **Hoy 4.6.7.** | Sí: zod es dependencia de producción (`src/domain/*/schemas.ts`, `src/lib/validatedInsert.ts`), ya con la versión parcheada. | **Ya no queda.** Los schemas se migraron a la API v4 y `npm audit` dejó de listar zod. Ningún archivo usaba `error.errors`, `required_error`/`invalid_type_error` ni `.format()`. `.flatten()` pasó a `z.flattenError()`, `z.ZodIssueCode.custom` a `'custom'` y `ZodTypeAny` a `ZodType`. `z.string().uuid()` ahora exige RFC 9562: solo cambiaron fixtures de prueba (las filas reales son v4; los IDs fijos de roles del sistema no son RFC, pero ningún schema valida un `role_id`). Dos diferencias de v4 quedaron neutralizadas: (1) `.passthrough()` ahora conserva llaves no declaradas con valor `undefined`, y en un lote postgrest-js las listaría en `?columns=` con NULL en vez de su DEFAULT; `validatedInsertMany` las omite, como zod 3. (2) La unión fecha/timestamp de `valido_hasta` ya no hereda el mensaje de la primera opción; el schema lo fija. Regresión en `src/lib/__tests__/validatedInsert.test.ts`: piso de versión, un arreglo que excede `.max()` se rechaza sin validar sus elementos, y UUID estricto. Se levantó el `ignore` de majors de zod en `.github/dependabot.yml`. | — |
| **minimatch** — GHSA-g3hv-75wg-m249 (moderate; DoS por amplificación de globparts). **Cerrado.** | Eran 3.1.5, 5.1.9, 10.2.5 y 10.2.6 / parcheada solo 11.0.1, sin backport. **Hoy una sola copia: 11.0.4.** | No. Vite resuelve exceljs a su build de navegador (`dist/exceljs.min.js`), que no incluye archiver. El build con el override genera el mismo `dist/`. | **Ya no queda.** Ningún padre declaraba `^11`, así que se cerró con el override `minimatch ^11.0.4`. Su evidencia de compatibilidad y su criterio de retiro están en la tabla de overrides. Explotarlo exigía controlar el **patrón** glob, y aquí los patrones son configuración del repo. | — |
| **glob** — GHSA-3g3m-2fjr-6pw4 (moderate; un recorrido sigue después de cancelarse con `AbortSignal`). **Cerrado.** | Eran 13.0.6 (@capacitor/cli, @sentry/bundler-plugins, docgen de Storybook), 11.1.0 (workbox-build) y 7.2.3 (rama exceljs, que no estaba en el rango del advisory pero arrastraba minimatch 3) / 14.0.2. **Hoy una sola copia: 14.0.3.** | No (solo build, tooling y CLI) | **Ya no queda.** rimraf 6.1.4 adoptó glob 14 dentro de rango. Para el resto se usa el override `glob ^14.0.3`, documentado en la tabla de overrides junto con la excepción conocida de rimraf 2. Ningún consumidor pasaba `signal`. | — |
| **deepmerge** — GHSA-gcqx-w48m-w2h4 (low; prototype poisoning en `mergeObject`) | 4.3.1 / **ninguna**: 4.3.1 es la última y no hay versión parcheada | **No**: lo usa `@rollup/plugin-node-resolve`, que workbox-build ejecuta al generar el service worker | Su único uso es `deepMerge({}, defaults)` sobre las constantes del propio plugin (`dist/cjs/index.js`), sin entrada externa. El «fix» de `--force` **degrada** vite-plugin-pwa a 1.1.0, el mismo patrón que exceljs → 3.4.0. No es aceptable. | deepmerge publique un parche, o plugin-node-resolve o workbox dejen de usarlo. |

`npm audit fix --force` sigue sin ser opción: para deepmerge, el único
advisory abierto, propone degradar vite-plugin-pwa a 1.1.0.

La regresión de dompurify (GHSA-55q2-fjhq-7xh7, actualizado a 3.4.14 el
2026-08-28) sigue cubierta en `src/lib/__tests__/validation.test.ts`, con el
piso de versión, los vectores mXSS y la forma IN_PLACE del advisory.

## Configuración del repositorio (checklist del owner)

Estas protecciones se activan en GitHub → Settings (no viven en archivos):

- [ ] **Secret scanning** + **Push protection** (Settings → Code security).
- [ ] **Dependabot alerts** y **security updates** habilitados.
- [ ] Environment `production-db` con *required reviewers* (gate de migraciones).
