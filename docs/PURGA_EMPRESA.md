# Purga de empresa (`delete-company` + `purgar_empresa`)

Qué hace la purga definitiva de una empresa, qué llaves foráneas existen en
producción y por qué importan, qué pasa con las cuentas cliente y la política de
retención: qué se borra con la empresa, qué impide purgarla y qué sobrevive a
propósito.

- Edge: `supabase/functions/delete-company/index.ts` (lógica pura en `logic.ts`).
- RPC: `public.purgar_empresa` — `supabase/migrations/20261029000100_purgar_empresa_atomica.sql`;
  política de retención, llaves que faltaban y orden de borrado en
  `supabase/migrations/20261030000000_purga_empresa_retencion_y_huerfanas.sql`.
- Pruebas: `supabase/functions/delete-company/__tests__/` (vitest, handler y lógica) y
  `supabase/tests/purgar_empresa/run.sh` (Postgres real, en CI: `coverage.yml › rls-sandbox`).
- Inventario completo de llaves de producción: [`PURGA_EMPRESA_FK_PRODUCCION.tsv`](PURGA_EMPRESA_FK_PRODUCCION.tsv).

### Versión de la migración (renumerada antes de fusionar)

La migración nació como `20261027000000`, la **misma versión** que
`20261027000000_compras_aislamiento_referencias` de #926. `schema_migrations` se indexa
por versión y `apply-migrations-prod.yml` registra con `ON CONFLICT (version) DO NOTHING`:
la segunda en llegar se aplicaría sin quedar registrada. Antes de renumerar se comprobó
dónde estaba aplicada cada una (2026-10-12):

| Entorno | `20261027000000` de #926 (compras) | `20261027000000` de #931 (purga) |
|---|---|---|
| Producción | No (última corrida de `apply-migrations-prod.yml`: #924, `20261026000500`) | No |
| Sandbox `control-agua-rls-sandbox` | **Sí** (`apply-migrations-sandbox.yml`, corrida 37808159930, 2026-10-08, sobre `7c5d4d8d`) | No (ninguna corrida desde esta rama) |
| Supabase Preview de cada PR | Sí, en la rama de #926 | Sí, en la rama de #931 (`cuydavbqhtctimljsbyy`) |

La de #926 ya está desplegada en el sandbox y no se toca. Esta pasa a
**`20261029000100`**: posterior a todo lo aplicado en cualquier entorno (máxima del
sandbox: `20261028000100`, de #927), posterior a `20261029000000` de #930 y anterior a
`20261030000000` de #933, que la sigue. Orden de fusión: 929 → 928 → 926 → 927 → 930 →
**931** → 932 → 933.

**Preview de #931.** Su rama de Supabase tiene registrada `20261027000000` y el repo ya
no la tiene: el check «Supabase Preview» fallará con `Remote migration versions not found
in local migrations directory` hasta que se **recree esa rama de preview** (borrarla en el
panel o cerrar y reabrir el PR). Recrearla destruye su historial efímero: **pendiente de
autorización**; no se hizo. No afecta a producción ni al sandbox.

## Qué estaba mal

1. **El edge respondía 500 a todo** desde `6db61ad1` («refactor(cors): unificar las 14
   copias inline», #672, 2026-07-29). El refactor borró las funciones inline
   `getAllowedOrigins`/`getCorsHeaders` pero dejó la llamada `getAllowedOrigins()`,
   que `_shared/cors.ts` no exporta: un `ReferenceError` **fuera del `try`**, antes de
   cualquier compuerta. Ningún CI lo vio: los `index.ts` no pasan por `tsc` ni por
   `deno check` (`edge-tests.yml` sólo chequea helpers puros) y `eslint.config.js`
   ignora `supabase/**`. Se arregla con `isOriginAllowed` de `_shared/cors.ts`, que
   acepta **la misma lista** que la copia inline anterior (los cuatro dominios de
   producción, `ALLOWED_ORIGINS` o los `localhost` de desarrollo si no está, y el
   origen de `APP_URL`), más los previews de Vercel de este proyecto **sólo** si el
   proyecto define `ALLOW_VERCEL_PREVIEW_ORIGINS=true` —únicamente el sandbox—. En
   producción no es más amplia.
2. **La purga no era atómica.** El edge escribía pieza por pieza: desligaba
   superadministradores, borraba una a una a todas las personas (también el
   `company_owner`, también en `auth`), insertaba la auditoría y *después* borraba
   `companies`. Si ese último `DELETE` fallaba, la empresa quedaba viva, sin ninguna
   persona y con una auditoría que decía que se había borrado. Los errores del
   `INSERT` de auditoría y del `UPDATE` del superadministrador se ignoraban.
3. **Y ese último `DELETE` fallaba seguro en producción**, por dos razones medidas:
   - La única empresa elegible para purga tiene **49 cuentas contables de sistema**;
     `conta_cuenta_proteger_borrado` las defiende contra el borrado (también en
     cascada) salvo con `conta.allow_system_write` encendido.
   - Las llaves `NO ACTION` hacia `companies`/`projects` (abajo).
4. Cuerpos mal formados (`null`, JSON roto, `company_id` numérico) daban 500 en vez
   de 400, y `DELETE_COMPANY_GRACE_DAYS` negativo abría la compuerta de gracia.

## Cómo funciona ahora

1. **Edge** (`index.ts`): origen permitido → JWT → `app_users.role` de super_admin
   (un error al leerlo es 500, no «no es superadmin») → cuerpo válido (400) → el
   actor no pertenece a la empresa (400) → la empresa existe (404) → compuertas de
   nombre/suspensión/gracia (`checkPurgeGates`, 400/409). Hasta aquí **no se escribe
   nada**.
2. **Stripe**: si hay suscripción viva, primero un **ensayo** de la purga
   (`purgar_empresa(..., p_ensayo => true)`: hace todo y lo revierte). Sólo si el
   ensayo pasa se cancela en Stripe. Si la purga no va a poder completarse, Stripe no
   se toca.
3. **`purgar_empresa`**: todas las escrituras de base de datos en **una transacción**.
   Repite las compuertas con la empresa bloqueada (`FOR UPDATE`); **compuerta de
   retención** (abajo: si la empresa tiene historia que se conserva, `PURGA_RETENCION`
   y no se escribe nada); desliga a los superadministradores (`company_id = NULL,
   project_id = NULL`); borra de `app_users` a las personas de la empresa y a las
   cuentas cliente exclusivas; escribe la fila `DELETE` en `audit_log`; borra los
   cobros, lecturas y documentos fiscales que no retienen; borra lo que bloquearía
   el `DELETE` de `projects` por orden de llaves (`purgar_empresa_previos`); vacía
   las tablas con FK `NO ACTION`/`RESTRICT` (las lee del catálogo); borra `projects`
   y `companies`; borra los clientes exclusivos. **Cualquier fallo revierte todo**,
   auditoría incluida.
4. **Después del COMMIT**, el edge borra en `auth` exactamente las identidades que
   devolvió la RPC (`usuarios_auth`). Una que ya no existe (404) cuenta como borrada;
   las que fallen se devuelven en `auth_pendientes` con un `aviso`, y la lista
   completa queda en `audit_log.before.usuarios_auth`. Para terminarlas: Supabase ›
   Authentication › Users.

Códigos de la RPC → HTTP (`mapPurgeRpcError`): `PURGA_PARAMETROS`,
`PURGA_NOMBRE_NO_COINCIDE`, `PURGA_ACTOR_DE_LA_EMPRESA` → 400; `PURGA_SOLO_SUPERADMIN`
→ 403; `PURGA_EMPRESA_NO_ENCONTRADA` → 404; `PURGA_EMPRESA_ACTIVA`, `PURGA_EN_GRACIA`,
`PURGA_RETENCION` (con lo que retiene a la empresa) y cualquier FK/guard que bloquee
(`23503`, `23514`, `23001`) → 409 con el mensaje de Postgres; el resto → 500 genérico.
En todos, **no se borró nada**.

## Llaves foráneas en producción (medido el 2026-10-12)

Medido en el proyecto `nnsqmeigtgewatameexo` **sólo con `SELECT`** sobre
`pg_catalog.pg_constraint` (conector Supabase). Para repetirlo:

```sql
SELECT confrelid::regclass AS referenciada, conrelid::regclass AS tabla, conname,
       confdeltype, pg_get_constraintdef(oid) AS def
FROM pg_catalog.pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('public.companies'::regclass, 'public.projects'::regclass,
                    'public.app_users'::regclass, 'auth.users'::regclass)
ORDER BY 1, 2, 3;
```

687 llaves; la lista completa está en el `.tsv`. Por destino y acción `ON DELETE`:

| Hacia | CASCADE | SET NULL | NO ACTION | RESTRICT |
| --- | ---: | ---: | ---: | ---: |
| `companies(id)` | 241 | 3 | **6** | 0 |
| `projects(id)` | 185 | 17 | **2** | 0 |
| `app_users(id)` | 2 | 18 | 0 | 0 |
| `auth.users(id)` | 16 | 195 | 0 | **2** |

### Las que bloquean el `DELETE`

| Tabla | Columna | Hacia | Acción |
| --- | --- | --- | --- |
| `areas_condominio` | `company_id` | companies | NO ACTION |
| `convenios_pago` | `company_id` | companies | NO ACTION |
| `fuentes_agua` | `company_id` | companies | NO ACTION |
| `payment_requests` | `company_id` | companies | NO ACTION |
| `registros_calidad` | `company_id` | companies | NO ACTION |
| `rutas` | `company_id` | companies | NO ACTION |
| `convenios_pago` | `project_id` | projects | NO ACTION |
| `rutas` | `project_id` | projects | NO ACTION |
| `contrato_ampliaciones` | `autorizado_por` | auth.users | RESTRICT |
| `orden_compra_excepciones` | `autorizado_por` | auth.users | RESTRICT |

`NO ACTION` se comprueba al **final de la sentencia**, pero antes de que una cascada
por otra ruta haya terminado: probado, una fila que caería en cascada vía `projects`
igual bloquea el `DELETE FROM companies`. Por eso la RPC vacía primero estas tablas
(`purgar_empresa_bloqueantes`). Las dos `RESTRICT` hacia `auth.users` no afectan:
la identidad se borra después del COMMIT, cuando las filas de la empresa que la
referenciaban ya no existen.

Dependientes de esas tablas que también importan (medido): `areas_condominio` ←
`tareas_condominio`, `checklist_areas`, `puntos_verificacion`, `programacion_limpieza`,
`rutinas_limpieza` (RESTRICT); `payment_requests` ← `pasarela_eventos`,
`pasarela_reembolsos`, `conta_incidencias_conciliacion` (RESTRICT); `convenios_pago` ←
`pagos.convenio_id` (NO ACTION); `clientes` ← `cuotas_condominio`,
`cargos_adicionales_unidad`, `conta_auxiliares`, `conta_asiento_lineas` (RESTRICT) y
`convenios_pago` (NO ACTION); `unidades` ← cinco tablas con NO ACTION y dos con RESTRICT.

### Diferencias con el repositorio

El esquema reconstruido desde `supabase/migrations` **no** coincide con producción
en esto (drift ya declarado en `scripts/schema-drift/drift-conocido.json`, #826):

| Llave | Producción | Repositorio |
| --- | --- | --- |
| `areas_condominio.project_id` | CASCADE | NO ACTION |
| `mensajes_portal.company_id` | CASCADE | NO ACTION |
| `mensajes_portal.project_id` | CASCADE | NO ACTION |
| `plantillas_tarea_cargo.project_id` | CASCADE | NO ACTION |
| `rutas_ronda.project_id` | CASCADE | NO ACTION |
| `plantillas_tarea_cargo.company_id` | — (no existe) | NO ACTION |
| `rutas_ronda.company_id` | — (no existe) | NO ACTION |
| `amenidades_bloqueos.company_id` | — (no existe) | CASCADE |

(El `grep` de las migraciones que lista «~11» cuenta líneas, no llaves: incluye
llaves cuyo `ON DELETE` va en la línea siguiente y otras redefinidas después. El
catálogo reconstruido da 9 hacia `companies` y 6 hacia `projects`.)

Consecuencia práctica, fijada en `supabase/tests/purgar_empresa/assert_areas.sql`: un
área con tareas **se purga** con la forma de producción (el área y sus tareas caen
juntas con el proyecto) y **no** con la del repositorio (el área no se puede vaciar
antes porque sus tareas la referencian con RESTRICT, ni cae con el proyecto). En la
forma del repositorio la purga falla **entera**. `run.sh` prueba las dos formas:
`forma_produccion.sql` deforma el esquema reconstruido hasta la forma medida.

### Columnas sin llave foránea (antes de 20261030000000)

Medidas el 2026-10-12, **sólo con `SELECT`** sobre `pg_constraint`. Fuera de
`app_users` y `audit_log` (que la purga trata a propósito), estas columnas de
producción **no tenían FK**, así que nada las borraba en cascada:

| Tabla | Columnas sin FK |
| --- | --- |
| `app_users` | `company_id`, `project_id`, `cliente_id` — la RPC las trata explícitamente |
| `audit_log` | `company_id`, `project_id` — a propósito: la auditoría sobrevive |
| `amenidades_bloqueos`, `bloques_turno`, `broadcasts`, `conversation_access_rules`, `cuota_recordatorios_log`, `pasarela_eventos`, `pasarela_reembolsos`, `plantillas_tarea_cargo`, `registro_recordatorios_log`, `report_runs`, `rutas_ronda` | `company_id` |
| `broadcast_recipients` | `company_id`, `cliente_id` |
| `conversations`, `solicitud_mudanza_unidad`, `solicitud_renta_unidad` | `company_id`, `project_id`, `cliente_id` |
| `conta_ajustes_eventos`, `conta_ajustes_respaldos`, `conta_borradores_tc_resoluciones`, `conta_cargo_anulaciones`, `conta_cuota_anulaciones`, `conta_diferenciales_cambiarios`, `conta_sf_cuota_estado_eventos`, `conta_tasas_manuales` | `company_id`, `project_id` |
| `conta_anticipos`, `conta_notas_credito`, `conta_saldo_favor_aplicaciones`, `conta_saldo_favor_origenes` | `cliente_id` |

(`bloques_turno.company_id` faltaba en la primera versión de esta lista.) No todas
dejaban filas: varias tablas caen por otra llave (`amenidades_bloqueos`,
`plantillas_tarea_cargo` y `rutas_ronda` con el proyecto en producción;
`solicitud_mudanza_unidad` con la unidad; `cuota_recordatorios_log` con la cuota;
`broadcast_recipients` con la difusión). Las que **sí** sobrevivían: `broadcasts`,
`conversations` (con sus mensajes), `conversation_access_rules`,
`solicitud_renta_unidad`, `conta_diferenciales_cambiarios`, las bitácoras
contables sin llave y, por `ON DELETE SET NULL` hacia `projects`, `pagos` y
`registros` (con `registro_recordatorios_log`). El mismo día **no había ninguna
fila huérfana** en producción y sólo 2 `conversations.cliente_id` apuntaban a un
cliente ya borrado. Qué pasa ahora con cada una: «Política de retención y purga».

## Cuentas cliente (decisión)

Un cliente (`clientes`) puede estar vinculado a **varias** empresas
(`company_clientes`, «visibilidad entre empresas»), y su cuenta de portal es una fila
de `app_users` con `role = 'cliente'`, `company_id` siempre `NULL`
(`trg_cliente_sin_company_id`) y `cliente_id` apuntando a él. Por eso el edge
anterior **nunca las veía** (buscaba por `company_id`), y además `clientes` sólo
cuelga de `projects` con `SET NULL`: tras la purga, el cliente quedaba huérfano con
nombre, correo y documento, para siempre.

Se considera **exclusivo** de la empresa purgada el cliente cuyo proyecto (si tiene)
es de la empresa y que no está vinculado a ninguna otra en `company_clientes`.

- **Exclusivo** → su fila de `clientes` se borra (arrastra en cascada sus pagos,
  solicitudes de pago, vínculos y residencias) y su cuenta de portal se borra de
  `app_users` en la transacción y de `auth` después del COMMIT. No le queda ninguna
  empresa que ver, y conservar la identidad sería conservar datos personales de un
  inquilino purgado.
- **Compartido** con otra empresa → se conserva con su cuenta. Pierde el vínculo con
  la purgada (`company_clientes` cae en cascada, `clientes.project_id` queda `NULL`
  por su FK y `app_users.project_id` lo pone a `NULL` la RPC).

## Política de retención y purga (propuesta, `20261030000000`)

> **Para el dueño de producto.** Es la propuesta implementada; cada fila es una
> decisión que puede cambiarse. Las preguntas que quedan abiertas están al final.

**Principio.** La purga es para una empresa que **no llegó a operar** (prueba
abandonada, alta por error: la única elegible hoy) y la borra entera, **sin dejar
huérfanos**. Una empresa con **historia financiera, fiscal o laboral** —lo que la
propia aplicación ya trata como «se anula, no se borra»— **no se purga**: queda
suspendida, que en la práctica es un archivo (nadie entra, nada se toca), y la RPC
responde `PURGA_RETENCION` (409) con la lista de lo que la retiene. Retener es
reversible; borrar historia no.

Por qué así y no «purgar todo»: además de los guards sin escape, **la purga de
`20261029000100` ya fallaba** para cualquier empresa con contabilidad publicada,
por orden de llaves (las líneas de póliza sobreviven al `DELETE` de `projects` con
`SET NULL` y bloquean con `RESTRICT` el borrado de las cuentas del proyecto;
reproducido). Hacer purgable la historia exigía romper a propósito varios guards
y borrar libros, facturas y marcajes: eso es una decisión legal, no técnica.

| Grupo | Tablas | Política | Cómo |
| --- | --- | --- | --- |
| **A. Operación y configuración** | `conversation_access_rules`, `report_runs`, `bloques_turno` (turnos futuros pendientes), `conta_diferenciales_cambiarios`, `cuota_recordatorios_log`, `registro_recordatorios_log`, `amenidades_bloqueos` | Se borran con la empresa | FK `ON DELETE CASCADE` hacia empresa (y proyecto) |
| **B. Comunicaciones y solicitudes** (datos personales) | `conversations` (+ mensajes, asignaciones), `broadcasts` (+ destinatarios), `solicitud_mudanza_unidad`, `solicitud_renta_unidad` | Se borran con la empresa. Si se borra un **cliente**: su fila de destinatario se va; la conversación y las solicitudes (que son de la empresa) quedan sin el vínculo | FK `CASCADE` hacia empresa/proyecto; hacia `clientes`, `CASCADE` en `broadcast_recipients` y `SET NULL` en el resto. Las 2 conversaciones con cliente inexistente pasan a `NULL` |
| **C. Movimientos que no retienen** | cobros pendientes o rechazados, lecturas sin facturar, documentos fiscales en borrador o rechazados | Se borran en la purga (antes sobrevivían con `project_id = NULL`) | Paso `movimientos` de la RPC, **antes** de `projects` |
| **D. Historia (retención)** | pólizas publicadas o anuladas; bitácoras de sólo inserción (`conta_tg_bitacora_inmutable`: `pasarela_eventos`, `pasarela_reembolsos`, `conta_notas_credito`, `conta_ajustes_*`, `conta_*_anulaciones`, `conta_tasas_manuales`, `conta_borradores_tc_resoluciones`, `conta_sf_cuota_estado_eventos`) y aplicaciones de saldo a favor (leídas del catálogo); anticipos; cobros verificados, aplicados o de cargos adicionales; lecturas facturadas, cobradas o en mora; documentos fiscales por timbrar, timbrados o cancelados; facturas de proveedor; recepciones registradas; turnos ya ocurridos y marcajes de presencia | **La empresa no se purga**: `PURGA_RETENCION` | Compuerta `purgar_empresa_retencion`, antes de escribir nada (también en el ensayo: Stripe no se toca). Además, FK `CASCADE` hacia empresa/proyecto en las bitácoras: su guard aborta la cascada, así que **ningún camino** (ni un `DELETE` directo) las deja huérfanas. `cliente_id` de anticipos, notas de crédito y saldos a favor: `RESTRICT` |
| **E. Sobrevive a propósito** | `audit_log`, `billing_sync_log` (`SET NULL`), `legal_acceptances` (`SET NULL`) | Se conservan: son registros de la plataforma (auditoría, facturación del SaaS a la empresa, aceptación de términos) | Sin cambio. `notification_preferences` cae con la identidad en `auth` |
| **F. Configuración que bloqueaba** | reglas de compra vigentes | Caen en la cascada de su empresa o proyecto, como ya hacían cuotas y cargos | `conta_reglas_compra_borrado_tg` permite el nivel > 1; fuera de la cascada no cambia |
| **G. Pendiente de #826** | `plantillas_tarea_cargo`, `rutas_ronda` (`company_id`) | En producción ya caen con el proyecto (`project_id NOT NULL CASCADE`) | Sin cambio: su forma la alinea #826 |

**Orden de borrado.** Además del paso de movimientos, `purgar_empresa_previos`
borra **antes** de `projects` las filas que caen con la empresa pero no con el
proyecto y referencian con `RESTRICT` algo que sí cae con el proyecto (cuentas
bancarias, partidas de presupuesto, líneas de órdenes de compra, líneas de pólizas
en borrador → cuentas contables del proyecto). Sólo reordena filas que la cascada
de `companies` borraba igual; sin él, una cuenta bancaria configurada hacía fallar
la purga (`BANCO_LEDGER`, reproducido).

**Lo que sigue abortando sin compuerta (fail-closed, 409 con el mensaje del
guard):** un turno futuro pendiente que ya tiene tareas o revisiones, una
contraseña de pago cerrada, movimientos bancarios importados y cualquier guard
nuevo. La purga se revierte entera y no se borra nada.

**Medido en producción el 2026-10-12 (sólo `SELECT`, sin nombres):** las 10
bitácoras inmutables, anticipos, notas de crédito, saldos a favor y `pagos` están
vacíos. De las 5 empresas, la elegible hoy se purga (sólo tiene catálogo); la
única con operación (6 939 lecturas, 12 conversaciones, 120 turnos) quedaría
retenida si se suspendiera (1 turno ya ocurrido, además de su facturación).

**Aprobación (2026-10-13).** El dueño aprobó la política de esta sección (grupos A–G:
la empresa con historia no se purga y queda suspendida con `PURGA_RETENCION`) y el ajuste
de datos de la migración (las 2 filas de `conversations.cliente_id` que apuntan a un
cliente ya borrado pasan a `NULL`). Siguen abiertas las preguntas de abajo.

**Preguntas abiertas para el dueño de producto**

1. **Plazo de retención.** ¿Cuánto se conserva la historia de una empresa
   retenida (p. ej. el plazo fiscal del país) y qué pasa al vencer? Purgarla
   exige un escape auditado en los guards y, probablemente, entregarle antes una
   exportación a la empresa. Nada de eso existe todavía.
2. **Datos personales de una empresa retenida.** Los residentes de una empresa
   retenida conservan nombre, contacto, conversaciones y solicitudes. ¿Se
   anonimizan al retener (conservando sólo lo que la historia necesita)?
3. **`audit_log`.** Sobrevive a la purga y guarda, por `audit_trigger_func`, la
   fila completa de cada cobro o cuota borrados. ¿Tiene su propio plazo?
4. **¿Qué cuenta como historia?** La lista de D es conservadora a propósito (un
   cobro rechazado o una lectura sin facturar no retienen; una factura de
   proveedor en cualquier estado sí). Cambiarla es tocar una categoría de
   `purgar_empresa_retencion` y su prueba.
5. **Tablas nuevas de los PR que se fusionan antes (medido sobre la cadena combinada
   929 → 928 → 926 → 927 → 930 → 931 → 932 → 933, 2026-10-12).** La invariante «toda
   columna `company_id`/`project_id`/`cliente_id` tiene llave o una razón escrita» falla
   en el orden real con tres columnas que aquí no existen:
   - `hk_limpieza_storage.company_id` y `.project_id` (#927): **sin llave a propósito**
     —la cola de borrado del bucket sobrevive a la empresa para retirar sus archivos—, lo
     dice su propia migración. Ya están en la lista de razones de `assert_politica.sql`.
   - `compras_config_separacion_bitacora.company_id` (#926, `NOT NULL`, sin llave):
     bitácora *append-only* con guard que impide `UPDATE`/`DELETE`. **Decidido por el
     dueño (2026-10-13): se trata como `audit_log`** —es auditoría, sobrevive a la purga
     y no retiene a la empresa—; está en la lista de razones de `assert_politica.sql`.

## La empresa elegible hoy (medido el 2026-10-12)

De las 5 empresas de producción, 1 está suspendida y es elegible (más de 90 días).
Contando, sólo con `SELECT`, sus filas en **todas** las tablas de `public` con
`company_id`, sólo tiene: 49 cuentas contables (todas de sistema) en
`conta_cuentas`, 31 mapeos en `conta_mapeo_cuentas` y 1 fila en `subscriptions`.
Ningún proyecto, ninguna persona, nada en las tablas bloqueantes ni en las
bitácoras inmutables.

La suite la reproduce tal cual (empresa «Q» de `supabase/tests/purgar_empresa/fixture.sql`)
y fija las dos cosas: el `DELETE` directo con el que terminaba la purga anterior
falla con `CUENTA_DE_SISTEMA`, y `purgar_empresa` la borra entera, con su auditoría.
No tiene nada de la categoría D: la política no cambia su caso.

## Pruebas de la política

`supabase/tests/purgar_empresa/run.sh` aplica `20261030000000` sobre la forma de
llaves del repositorio **y** sobre la medida en producción (`forma_produccion.sql`
antes de la migración, como pasará al desplegar), después de sembrar lo que su
limpieza previa arregla (`pre_migracion.sql`). `fixture_politica.sql` da a X una
fila en cada grupo A–C y la configuración que bloqueaba, y a Y lo mismo (que no se
toca). `assert_politica.sql` comprueba: que **toda** columna `company_id`/
`project_id`/`cliente_id` de `public` tiene llave o una razón escrita (una tabla
nueva sin llave rompe la suite); cada categoría de retención por separado, con su
motivo y sin cambiar nada; que una bitácora no se borra ni con `DELETE` directo; el
`RESTRICT`/`SET NULL`/`CASCADE` hacia el cliente; y que, tras purgar X, **ninguna
tabla** conserva una fila de X, de sus proyectos o de sus clientes exclusivos
(salvo `audit_log`). Los 30 bloques marcados de la migración se quitan uno por uno
y la suite falla sin cada uno.
