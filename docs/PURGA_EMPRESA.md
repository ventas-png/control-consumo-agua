# Purga de empresa (`delete-company` + `purgar_empresa`)

Qué hace la purga definitiva de una empresa, qué llaves foráneas existen en
producción y por qué importan, qué pasa con las cuentas cliente y qué sigue
bloqueando la purga a propósito.

- Edge: `supabase/functions/delete-company/index.ts` (lógica pura en `logic.ts`).
- RPC: `public.purgar_empresa` — `supabase/migrations/20261027000000_purgar_empresa_atomica.sql`.
- Pruebas: `supabase/functions/delete-company/__tests__/` (vitest, handler y lógica) y
  `supabase/tests/purgar_empresa/run.sh` (Postgres real, en CI: `coverage.yml › rls-sandbox`).
- Inventario completo de llaves de producción: [`PURGA_EMPRESA_FK_PRODUCCION.tsv`](PURGA_EMPRESA_FK_PRODUCCION.tsv).

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
   Repite las compuertas con la empresa bloqueada (`FOR UPDATE`); desliga a los
   superadministradores (`company_id = NULL, project_id = NULL`); borra de
   `app_users` a las personas de la empresa y a las cuentas cliente exclusivas;
   escribe la fila `DELETE` en `audit_log`; vacía las tablas con FK `NO ACTION`/
   `RESTRICT` (las lee del catálogo); borra `projects` y `companies`; borra los
   clientes exclusivos. **Cualquier fallo revierte todo**, auditoría incluida.
4. **Después del COMMIT**, el edge borra en `auth` exactamente las identidades que
   devolvió la RPC (`usuarios_auth`). Una que ya no existe (404) cuenta como borrada;
   las que fallen se devuelven en `auth_pendientes` con un `aviso`, y la lista
   completa queda en `audit_log.before.usuarios_auth`. Para terminarlas: Supabase ›
   Authentication › Users.

Códigos de la RPC → HTTP (`mapPurgeRpcError`): `PURGA_PARAMETROS`,
`PURGA_NOMBRE_NO_COINCIDE`, `PURGA_ACTOR_DE_LA_EMPRESA` → 400; `PURGA_SOLO_SUPERADMIN`
→ 403; `PURGA_EMPRESA_NO_ENCONTRADA` → 404; `PURGA_EMPRESA_ACTIVA`, `PURGA_EN_GRACIA`
y cualquier FK/guard que bloquee (`23503`, `23514`, `23001`) → 409 con el mensaje de
Postgres; el resto → 500 genérico. En todos, **no se borró nada**.

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

### Columnas sin llave foránea (sobreviven a la purga)

Estas columnas de producción **no tienen FK**, así que nada las borra en cascada y
la purga no las toca:

| Tabla | Columnas sin FK |
| --- | --- |
| `app_users` | `company_id`, `project_id`, `cliente_id` — la RPC las trata explícitamente |
| `audit_log` | `company_id`, `project_id` — a propósito: la auditoría sobrevive |
| `amenidades_bloqueos`, `broadcasts`, `conversation_access_rules`, `cuota_recordatorios_log`, `pasarela_eventos`, `pasarela_reembolsos`, `plantillas_tarea_cargo`, `registro_recordatorios_log`, `report_runs`, `rutas_ronda` | `company_id` |
| `broadcast_recipients` | `company_id`, `cliente_id` |
| `conversations`, `solicitud_mudanza_unidad`, `solicitud_renta_unidad` | `company_id`, `project_id`, `cliente_id` |
| `conta_ajustes_eventos`, `conta_ajustes_respaldos`, `conta_borradores_tc_resoluciones`, `conta_cargo_anulaciones`, `conta_cuota_anulaciones`, `conta_diferenciales_cambiarios`, `conta_sf_cuota_estado_eventos`, `conta_tasas_manuales` | `company_id`, `project_id` |
| `conta_anticipos`, `conta_notas_credito`, `conta_saldo_favor_aplicaciones`, `conta_saldo_favor_origenes` | `cliente_id` |

Además, con `ON DELETE SET NULL` hacia `projects` y sin FK hacia `companies`,
`pagos` y `registros` de la empresa sobreviven con `project_id = NULL` salvo que
caigan por otra vía (los `pagos` de un cliente exclusivo caen con él). Qué hacer con
estas filas es una decisión aparte: varias son bitácoras inmutables.

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

## Lo que sigue bloqueando la purga, a propósito

`conta.allow_system_write` se enciende **sólo dentro de la transacción de la purga**:
es el mecanismo que el esquema reserva a las funciones `SECURITY DEFINER` para las
escrituras de sistema (cuentas de catálogo, asientos publicados, presupuestos
aprobados, contratos fuera de borrador). Sin él, ninguna empresa con Contabilidad se
podría purgar.

Los guards **sin** ese escape siguen abortando la purga, entera y con su mensaje
(409): bitácoras inmutables (`conta_tg_bitacora_inmutable`: `pasarela_eventos`,
`pasarela_reembolsos`, `conta_notas_credito`, `conta_ajustes_*`, `conta_*_anulaciones`,
`conta_tasas_manuales`…), aplicaciones de saldo a favor, anticipos, turnos ya
iniciados, recepciones fuera de borrador y reglas de compra vigentes. Que una empresa
con historia financiera inmutable se pueda purgar —o se archive en vez de purgarse—
es una **decisión de negocio** que esta purga no toma.

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
