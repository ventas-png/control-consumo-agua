# Harness de RBAC/RLS server-side (plat:P15)

`rlsHarness.test.ts` verifica las **políticas RLS reales** contra un Supabase en
vivo (preview branch del PR o sandbox). Complementa —no reemplaza— la cobertura
de la **lógica de permisos pura** (`src/lib/__tests__/permissions.test.ts`,
`condominiosRoles.test.ts`, `systemRoleIds.test.ts`, `aguaPermissions.test.ts`).

No usamos pgTAP en este repo; este harness es la verificación equivalente desde
el cliente, con JWTs de distinto rol/empresa.

## Qué afirma

1. **Secretos = deny-all.** `fiscal_pac_secrets`, `company_payment_secrets` y
   `payfac_secrets` no devuelven filas ni para `authenticated` ni para `anon`. El
   secreto sólo es accesible por `service_role` (que hace BYPASSRLS) desde edge
   functions. El cliente nunca lo ve.
2. **Store de sesiones = deny-all.** `user_sessions` (store de express-session,
   columnas `sid/sess/expire`, política "No direct access") devuelve 0 filas para
   `authenticated` y `anon`. No tiene `user_id`, así que el invariante "A no ve
   filas de otro usuario" se cumple de forma trivial y más fuerte: A no ve nada.
3. **anon sin acceso de negocio.** `registros`, `cuotas_condominio`,
   `documentos_fiscales`, `notifications_outbox`, `user_invitations`,
   `legal_acceptances`, `pagos`, `notification_preferences` y `user_preferences`
   devuelven 0 filas para `anon` (no hay policy para ese rol; las user-scoped
   exigen `auth.uid()`, que para `anon` es `NULL`).
4. **Aislamiento multi-tenant (lectura).** Dos usuarios de **empresas distintas**
   ven conjuntos de `company_id` **disjuntos** en las tablas calientes que exponen
   `company_id`: `cuotas_condominio`, `documentos_fiscales`, `notifications_outbox`
   y `user_invitations`.
5. **Aislamiento user-scoped (lectura).** En `notification_preferences` y
   `user_preferences` (RLS `user_id = auth.uid()`) cada fila visible para A tiene
   `user_id = A`, y los `user_id` que ven A y B son disjuntos.
6. **Negative write (cross-tenant).** A intenta escribir con `company_id` ajeno y
   el `WITH CHECK` de RLS lo **rechaza** (no persiste nada, sin sembrar ni
   limpiar): `INSERT` en `cuotas_condominio`/`documentos_fiscales` con company_id
   ajeno, y `UPDATE` que re-etiqueta una fila propia hacia un tenant ajeno.
7. **Guard anon/authenticated sobre RPCs sensibles (#378/#380).** Como `anon` y
   como `authenticated`, invocar `enqueue_notification`,
   `claim_notifications_batch`, `mark_notification_result` y
   `run_notifications_dispatcher` es **rechazado** (error de permiso / función no
   visible / PGRST — nunca un resultado exitoso). Regresa-guarda el agujero de
   #378 (RPCs SECURITY DEFINER ejecutables por `anon` vía DEFAULT PRIVILEGES).

## Por qué está credencial-gated (y por qué eso ya no deja verde a CI)

Necesita una base real + usuarios sembrados, cosa que el runner unitario de CI no
tiene, así que el bloque vive bajo `describe.skipIf(!ENABLED)`: sin las variables
no se abre una sola conexión.

Lo que **no** hay es un verde por omisión. En CI el job `rls-harness` es
**fail-closed**: `scripts/rls-preflight.mjs` exige las **siete** variables y que
el destino esté declarado, y falla el job antes de instalar nada. Después,
`scripts/assert-rls-ejecutado.mjs` lee el reporte JSON y exige pruebas > 0, cero
fallos y **cero skips**.

Tampoco queda ya el `it.skip('omitido — …')` que hubo como marcador: vitest
incluye las pruebas *skipped* en el reporte JSON, así que aparecía **siempre**
—también con credenciales— y el verificador lo leía como «harness omitido». El
job no podía ponerse verde ni con el sandbox montado. La constancia de la
omisión la da ahora el preflight, que es quien tiene la información.

## Cómo correrlo

Contra el **preview branch del PR** o un **sandbox** (NUNCA producción):

```bash
export RLS_SUPABASE_URL="https://<preview-ref>.supabase.co"
export RLS_SUPABASE_ANON_KEY="<anon-key-del-preview>"
# Declaración del destino: sin ella el harness aborta sin conectarse, y si no
# coincide con el ref de la URL también. Es lo que impide que exportar la URL
# equivocada mande los negative-write al proyecto que no es.
export RLS_EXPECTED_PROJECT_REF="<preview-ref>"

# Dos usuarios YA sembrados, de empresas DISTINTAS:
export RLS_USER_A_EMAIL="qa-a@example.com"
export RLS_USER_A_PASSWORD="********"
export RLS_USER_B_EMAIL="qa-b@example.com"
export RLS_USER_B_PASSWORD="********"

# OBLIGATORIO — gate por CLASE de paquetes_recibidos (motor único, 20260829000600).
# CUATRO usuarios de la MISMA empresa, porque hay dos gates distintos:
#   · SELECT/INSERT/UPDATE van por PERMISO de la clase. Solo se ve con usuarios
#     SIN rol admin: `user_has_permission` le dice true a TODO a
#     super_admin/company_owner/admin, así que un admin no sirve para probarlo.
#   · DELETE va por ROL: la correspondencia solo la borra company_owner. Ahí sí
#     hace falta un admin, para comprobar que NO puede.
# A/B tampoco sirven: son de empresas distintas y lo que se vería es el
# aislamiento de tenant.
#
# Sin estas ocho, el harness ENTERO no corre: forman parte del mismo conjunto
# que exige `exigirDestinoDeclarado`, y en CI el preflight deja el job en rojo
# antes de instalar nada. Antes eran opcionales y el bloque se auto-saltaba con
# un `describe.skipIf`: el job terminaba verde con 13 pruebas omitidas y el
# reporte las contaba como cobertura. Las crea `scripts/seed-rls-sandbox.mjs`.
export RLS_USER_PAQ_EMAIL="qa-paqueteria@example.com"      # rol granular (operator) + condominios.tab.paqueteria
export RLS_USER_PAQ_PASSWORD="********"
export RLS_USER_CORR_EMAIL="qa-correspondencia@example.com" # rol granular + condominios.tab.correspondencia
export RLS_USER_CORR_PASSWORD="********"
export RLS_USER_ADMIN_EMAIL="qa-admin@example.com"          # rol admin, MISMA empresa
export RLS_USER_ADMIN_PASSWORD="********"
export RLS_USER_OWNER_EMAIL="qa-owner@example.com"          # rol company_owner, MISMA empresa
export RLS_USER_OWNER_PASSWORD="********"

npx vitest run src/test/rls/rlsHarness.test.ts
```

Las **quince** son obligatorias: quien corre `vitest` a mano no pasa por el
preflight, así que el propio harness repite la validación del destino.

El bloque de clase es **no destructivo**: siembra sus propias filas desechables
con quien sí tiene el permiso y las limpia al terminar. Empieza afirmando las
precondiciones (misma empresa, roles esperados, permisos efectivos disjuntos)
para que ningún caso pueda pasar por aislamiento de tenant o por falta del rol.

## Sin credenciales: los sandboxes de Postgres

Dos runners prueban **las reglas reales** contra un Postgres desechable, sin
Supabase ni secretos. Montan el andamiaje mínimo (`auth.uid`, `app_users`, los
helpers de RBAC), aplican el SQL **tal como se va a desplegar** y ejecutan los
escenarios como cada usuario. No sustituyen al harness —no cubren GoTrue ni el
resto del esquema— pero sí se ejecutan siempre.

| Runner | Qué prueba |
|---|---|
| `scripts/rls-recepcion-sandbox.sh` | Las policies de `paquetes_recibidos` por clase (**extrae** la sección 5 de `20260829000600`): quién ve, crea, reclasifica y borra correspondencia frente a paquetería. |
| `scripts/rls-evidencias-sandbox.sh` | Monta `paquetes_recibidos` **tal como era antes del motor** y le aplica la cadena real de migraciones (`20260829` → `20260830` → `20260831` → `20260901`). Así hereda el FK y los CHECK de verdad: la primera versión partía de una tabla simplificada y eso ocultó que `ON DELETE SET NULL` era incompatible con los CHECK de unidad. Cubre el borrado de una unidad con historial, el bucket de evidencias, la RPC del acuse con la firma verificada, la inmutabilidad tras el cierre y el claim del aviso. |

El segundo cubre justo lo que el bucket viejo dejaba abierto: en
`condominios-media` las cuatro policies autorizan por proyecto, así que
cualquier residente del condominio podía leer, sustituir y borrar la firma de
acuse de su vecino.

En CI se cablea como job aparte (ver `.github/workflows/coverage.yml`, job
`rls-harness`). Estado hoy: **corre de verdad** — 146 pruebas pasadas, 0
omitidas, contra el sandbox. Detalle y evidencia en
`docs/ACTIVAR_HARNESS_RLS.md`.

## Sembrado de datos

El harness es **read-only** salvo los *negative-write*, que son escrituras
**diseñadas para ser rechazadas** por RLS (no persisten; igualmente intentan una
limpieza best-effort por si un bug las dejara colar). No crea datos de prueba.
Asume que A y B ya existen en empresas distintas y que B tiene al menos una
`cuota_condominio` (y, idealmente, alguna fila en las demás tablas calientes)
para que los asserts de disjunción sean significativos: si B no tiene filas, el
test pasa pero no prueba aislamiento — sembrar 1 fila por empresa lo hace
concluyente. Los asserts user-scoped son significativos cuando A y B tienen al
menos una preferencia cada uno.

## Limitaciones / siguiente paso

- `registros` no expone `company_id` directo (scoping sólo por RLS), por eso el
  aislamiento por tenant se afirma sobre `cuotas_condominio`. Un assert análogo
  para `registros` requiere ids sembrados conocidos por empresa.
- Un harness que **cree** usuarios/datos por rol (con `service_role`) daría
  cobertura más profunda (INSERT/UPDATE/DELETE denegados cross-tenant) pero es más
  caro de operar; queda como mejora futura. Hoy priorizamos lectura + deny-all de
  secretos + aislamiento, que son los invariantes críticos.

## Cobertura: real vs. estructural

`coverage.json` es la fuente única que comparten este harness y
`scripts/seed-rls-sandbox.mjs`:

- **`noTriviales`** (`proveedores`, `conta_cuentas`, `cuotas_condominio`,
  `documentos_fiscales`) — el seed garantiza filas de las DOS empresas y lo
  verifica entrando como cada usuario. El harness **exige conjuntos no vacíos**
  antes de comprobar la disjunción, porque dos conjuntos vacíos hacen que el
  bucle no itere y el test pase sin comparar nada.
- **`estructurales`** — la tabla puede estar vacía. Se comprueba que la policy
  responde y que no hay fuga observable, pero **su disjunción no demuestra
  aislamiento**.

Mover una tabla a `noTriviales` sin sembrarla rompe el seed y rompe el harness:
es la única forma de que «cobertura declarada» y «cobertura real» coincidan.

Detalle completo y limitaciones: `docs/ACTIVAR_HARNESS_RLS.md`.
