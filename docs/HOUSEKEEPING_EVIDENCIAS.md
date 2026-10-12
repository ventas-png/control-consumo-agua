# Housekeeping · evidencia fotográfica, autoría y borrado coordinado

Migraciones: `supabase/migrations/20261028000000_housekeeping_evidencias.sql` y
`supabase/migrations/20261028000100_housekeeping_servicios_por_proyecto.sql` (el servicio y sus textos, acotados al proyecto)
Pruebas: `supabase/tests/housekeeping_evidencias/run.sh` · `supabase/functions/_shared/__tests__/housekeepingLimpieza.test.ts` · `src/domain/condominios/__tests__/housekeepingEvidencias.test.ts`

## Qué hace
Cada servicio de housekeeping documenta cómo se encontró la unidad (texto + hasta 20 fotos) y cómo
quedó (texto + hasta 20 fotos), queda sellado **quién lo inició y quién lo completó**, y se puede
generar un informe PDF para compartir por WhatsApp. Las fotos se depuran a los 90 días; los textos y
la autoría **no se purgan nunca**.

## Quién puede qué (una sola regla: `hk_acceso`)
`hk_acceso(company_id, project_id)` = **empresa del usuario ∧ acceso al proyecto (`can_access_project`) ∧
permiso `condominios.tab.housekeeping`** (o super_admin). La usan la tabla, el bucket y las RPC, así que
no pueden divergir. Desde `20261028000100` también la usan las cuatro policies de `servicios_housekeeping`
(la fila del servicio lleva los **textos** de evidencia y los sellos): antes bastaban empresa + permiso, y un
operador de otro proyecto de la misma empresa leía y podía modificar esos textos (encontrado con inicio de
sesión real en el sandbox; ver «Verificación»).

| Acción | Tabla `servicio_housekeeping_fotos` | Bucket `housekeeping-evidencias` |
|---|---|---|
| Ver | `hk_acceso` | `hk_acceso` **y** la carpeta 1 = proyecto del servicio y la carpeta 2 = ese servicio |
| Subir | `hk_acceso` + ruta del servicio + máx. 20 por fase | igual + `<carpeta>/<carpeta>/<archivo>` + máx. 60 objetos por servicio |
| Modificar | **nadie** (sin privilegio `UPDATE`) | **nadie** (sin policy) |
| Borrar | **nadie directo** (sin privilegio `DELETE`) → RPC | **nadie** (sin policy) → lo retira el servidor |

Los privilegios están **revocados**, no solo sin policy: un intento falla con `permission denied` en vez
de afectar 0 filas en silencio. Un residente ve la *fila* del servicio de su unidad (política previa de
`servicios_housekeeping`, que ahora incluye los textos) pero **ninguna foto**.

Rutas: `<project_id>/<servicio_id>/<archivo>`, validadas en tres sitios — la policy de INSERT del bucket
(el servicio existe, es de ese proyecto y el usuario tiene `hk_acceso`), el trigger de la fila de foto (la
ruta es la de *ese* servicio) y un índice único (un objeto = una fila). Un servicio con fotos no puede
cambiar de empresa o proyecto (la ruta dejaría de ser suya).

## Borrado coordinado (fila + archivo)
La fila se borra en una transacción; el archivo vive en Storage y no puede borrarse en ella. Por eso:

1. **RPC autorizadas** (`SECURITY DEFINER`, `search_path` vacío, ejecutables solo por `authenticated`):
   - `hk_eliminar_foto(id)`: admin/owner de la empresa, o quien la subió mientras el servicio no esté
     completado. Lo ajeno responde «inexistente» (no revela que existe).
   - `hk_eliminar_servicio(id)`: solo `company_owner`/`admin` (misma regla que la policy de DELETE
     del servicio). Devuelve cuántos archivos quedaron encolados.
   - Ambas exigen **exactamente una fila afectada**; cualquier otra cosa lanza.
2. Un trigger `AFTER DELETE` sobre las fotos **encola el archivo** en `hk_limpieza_storage`, venga el
   borrado de donde venga (RPC, cascada de servicio/proyecto/empresa, o el `DELETE` directo que la
   policy previa le permite a un admin sobre `servicios_housekeeping`). La cola no tiene acceso para clientes.
3. La edge function `housekeeping-limpieza` (service-role; valida el JWT: usuario de empresa → solo la
   cola de *su* empresa, super_admin → toda) **drena la cola**: toma un lote con arrendamiento
   (`FOR UPDATE SKIP LOCKED`, +10 min), borra del bucket, y solo entonces `hk_limpieza_confirmar`.
   - Fallo de Storage → la fila **se queda**, +1 intento, el error, y espera `5·2ⁿ` min (tope 24 h).
   - A los 10 intentos queda **atascada** (no se reintenta sola, conserva su último error).
   - `confirmar`/`fallar` devuelven filas afectadas; menos de las esperadas se **reporta**.
   - Solo toca el bucket de housekeeping; una fila de la cola con otro bucket se marca fallida.
4. Reintentos sin que nadie borre nada: cada hora `pg_cron` → `purgar-fotos-registros` con
   `mode: 'limpieza_housekeeping'` (mismos secretos de Vault que la purga; sin ellos es un no-op) drena la
   cola y **barre objetos huérfanos** (subidas cuya fila no se registró, de más de un día).

## Retención
Las fotos se depuran a los 90 días (`purgar-fotos-registros`, objetivo `housekeeping`): se borra el objeto
y se anula `path`; la fila sobrevive (fase, quién, cuándo). Anular `path` **no** encola nada (el objeto ya
lo retiró la propia purga). Textos y sellos no se tocan: están en `servicios_housekeeping`.

## Autoría
`iniciado_por/_en` y `completado_por/_en` los sella un trigger con `auth.uid()` **en la transición** de
estado; lo que mande el cliente se ignora, y un `UPDATE` posterior no los reescribe. Si un servicio se
reabre y se vuelve a completar, `completado_por` es quien lo hizo la última vez.

## Numeración y orden de fusión
Son **dos** migraciones (`20261028000000`, `20261028000100`) y van **después** de las diez de la PR #926
(`20261027000000` … `20261027000900`). Producción está en `20261026000500`; la guarda de migraciones
intercaladas obliga a que lo nuevo sea posterior. #926 ya agota el tope `MAX_APPLY = 10` de
`apply-migrations-prod` (aplica las `.sql` **añadidas en ese push**), así que estas dos **no pueden viajar en el
mismo push**: entran juntas en el suyo, el último. Orden acordado en #926 (cada uno en su propio push):
**#928 (2: `20261026000600_seguridad_asignaciones_proyecto` + `20261026000700_autoridad_principal_empresa`)
→ #926 (10: `20261027000000` … `20261027000900`) → PR de alcance por proyecto (`20261027001000`, futuro) →
#927 (2: `20261028000000` + `20261028000100`)**. Ninguno pasa de 10 archivos, así que `MAX_APPLY = 10` no
se toca. Con ese orden `schema_migrations` queda monótono. Si #927 se
fusionara antes que #926, las de #926 tendrían que renumerarse.

Historia: la primera versión de este PR se llamó `20261023000000` (chocaba con
`compras_seguimiento_pendientes_por_renglon`), luego `20261023000001` y `20261027000000` (chocaba con
`compras_aislamiento_referencias` de #926). Ninguna llegó a main ni a producción (0 migraciones de
housekeeping, 864 versiones, máx. `20261026000500`). Estado de los entornos al 2026-10-12 (lectura directa):

| Entorno | Versión de housekeeping registrada | Diseño que tiene |
|---|---|---|
| Producción | ninguna | — |
| Sandbox `control-agua-rls-sandbox` | `20261028000000` (run 38009275934) y `20261028000100` (run 38280940562), ambas con `apply-migrations-sandbox` | definitivo |
| Preview branch de la PR (`xycrwolnonmgcygfuebe`) | `20261023000001` (**ya no existe en el repo**) | antiguo: 3 policies en la tabla, policy `hk_evidencias_delete` en el bucket, sin `hk_acceso`, sin cola, sin RPC de borrado, sin cron |

## Reconciliación del preview branch de la PR — PREPARADA, NO EJECUTADA
Síntoma (pushes del 9 y 10/10): `Remote migration versions not found in local migrations directory` — el
preview tiene registrada `20261023000001_housekeeping_evidencias` y el repo ya no tiene ese archivo. Lo
confirman los `workflow_run_logs` de la rama (`ERROR Remote migration versions not found…`, tras «Remote DB/
API/Auth/Storage config is up to date»). La rama figura con estado `MIGRATIONS_FAILED` desde su creación.

Episodio aislado (push de las 16:22 del 12/10): el check falló en ~1 s con `Failed to update config for
branch` y sin ningún `workflow_run_logs` (falla del orquestador de Supabase antes de clonar). Fue
**transitorio**: los pushes de las 16:57 y 17:30 volvieron a pasar «Configurations ✅» y a fallar solo en
«Migrations» con el mismo `Remote migration versions not found`. La causa vigente es, por tanto, únicamente
el registro `20261023000001` sin archivo en el repo.

Evidencia actual (`workflow_run_logs` de la rama, 12/10 a las 16:57, 17:30 y 17:31 UTC): «Remote DB/API/Auth/
Storage config is up to date» seguido de `ERROR Remote migration versions not found in local migrations
directory.`; el registro del preview conserva `20261023000001 housekeeping_evidencias` (558 versiones).

**Resuelto por recreación (autorizada, 2026-10-12 ~20:05 UTC):** se confirmó el identificador
(`e13b7d2b-7cbc-4204-8d5c-2a1f936108ec`, proyecto `xycrwolnonmgcygfuebe`, git
`claude/cleaning-documentation-images-85lefu`, PR 927, no persistente, no default) y se borró **solo** esa rama;
las de #926, #928, #929 y `main` quedaron intactas. Un push no basta para recrearla (la integración marca el
check como *skipped*: «This git branch is not associated with any Supabase Branch. You can open a PR to create a
new branch»), así que se cerró y reabrió la PR (sigue en borrador). Rama nueva: `4b83fb3e-c96f-4f3f-bdd8-344228780e54`,
proyecto `ptuysryhfejssnnsglll`. Verificado en ella (solo lectura, 20:11 UTC): registro con `20261028000000` y
`20261028000100` (última de 559; `20261023000001` ausente), `hk_acceso`, tabla de fotos, cola, policies
`hk_evidencias_insert/select`, 4 policies del servicio por proyecto, bucket privado, RPC de borrado y
`run_hk_limpieza_storage`; Edge Functions `housekeeping-limpieza` (v1) y `purgar-fotos-registros` desplegadas en
ese build, ambas `verify_jwt = false`. Check «Supabase Preview» ✅ en `5fc305c`. Las dos salidas que se habían
preparado, limitadas a esa rama efímera:

1. **Reconciliar sin resetear** — `supabase/tests/housekeeping_evidencias/reconciliar_preview_pr927.sql`:
   guarda (aborta si la base no tiene `20261023000001` o si ya tiene una versión definitiva, así que en
   producción y en el sandbox no hace nada), aplica las dos migraciones definitivas (idempotentes, convergen
   desde el estado antiguo), y en una transacción saca `20261023000001` del registro y mete las dos nuevas.
   Probado contra una base que imita el preview en `run.sh` §8 (resultado `2|t|t|{hk_evidencias_insert,
   hk_evidencias_select}|4`; una segunda pasada aborta en la guarda).
2. **Recrear** — borrar *solo* esa rama de preview en el panel (Branches → `claude/cleaning-documentation-
   images-85lefu` → Delete) y hacer un push o cerrar/reabrir la PR: el worker la crea desde cero con los
   archivos actuales y despliega las funciones (así se resolvió la de #926). Destruye el estado del preview
   (solo datos de prueba de la propia rama).

Después, en cualquiera de las dos: check «Supabase Preview» verde en el HEAD; en la rama, la consulta del
paso 4 del script y `list_edge_functions` con `housekeeping-limpieza` y `purgar-fotos-registros`.

Producción no necesita reconciliación: nunca tuvo la versión antigua.

## Despliegue
Cada PR en **su propio push a `main`**, en el orden de arriba; `apply-migrations-prod` aplica las `.sql`
añadidas en ese push (tope `MAX_APPLY = 10`, sin cambios) y `deploy-functions` (solo en push a `main`)
despliega `purgar-fotos-registros` y `housekeeping-limpieza`, ambas con `--no-verify-jwt`
(`.github/workflows/deploy-functions.yml`).

1. #928 (2 migraciones) → comprobar → #926 (10) → comprobar → (alcance, 1, cuando exista) → **#927 (2)**.
2. Tras el push de #927, **comprobaciones posteriores** (solo lectura): sección final de
   `scripts/reversion-housekeeping-evidencias.sql` — registro con las 2 versiones, tablas de fotos y cola, 4
   policies del servicio con `hk_acceso`/`can_access_project`, policies `hk_evidencias_insert/select` en el
   bucket, bucket privado, cron horario activo, número de secretos de Vault (solo nombres), cola sin atascadas;
   y en el panel, las dos Edge Functions con `verify_jwt = false`.
3. **Manual**: cargar `purga_fotos_url` y `purga_fotos_service_key` en el Vault de producción (procedimiento
   abajo). Sin la key la cola solo se drena al borrar desde la pantalla, no cada hora.

**Recuperación** (`scripts/reversion-housekeeping-evidencias.sql`, no corre en CI): preferir avanzar con
una migración nueva. A) revierte exactamente `20261028000100` (restaura las 4 policies previas); B) contiene
`20261028000000` sin perder datos (parar el cron horario, las subidas y las RPC de borrado; se reanuda
reaplicando el archivo, idempotente); C) la reversión completa no se guioniza porque borraría fotos de
clientes. Si `apply-migrations-prod` falla a mitad, la migración afectada no queda registrada y se reaplica
tal cual (todas son idempotentes).

### Cargar `purga_fotos_service_key` en Vault sin exponerla
1. Panel de Supabase del proyecto → *Project Settings → API Keys* → copiar la clave `service_role` (o
   *secret key*) al portapapeles. No pegarla en chats, issues, commits, el editor SQL ni ningún log.
2. *Integrations → Vault* (en paneles antiguos, *Project Settings → Vault*) → *Secrets → Add new secret*: nombre `purga_fotos_service_key`, valor = pegar.
   Guardar. (El editor SQL con `vault.create_secret(...)` también sirve, pero deja el valor en el historial
   de consultas del panel: evitarlo.)
3. Comprobar sin leer el valor: `SELECT count(*) FROM vault.decrypted_secrets WHERE name IN
   ('purga_fotos_url','purga_fotos_service_key');` → 2, y `SELECT public.run_hk_limpieza_storage();` seguido de
   `SELECT status_code FROM net._http_response ORDER BY id DESC LIMIT 1;` → 200.

**Qué se habilita al cargarla** (las dos únicas funciones que leen esa key): `run_hk_limpieza_storage`
(cron `hk_limpieza_storage_hourly`, `17 * * * *`: drena la cola de housekeeping) y `run_purga_fotos_storage`
(cron `purgar_fotos_storage_monthly`, `30 3 1 * *`: retención de fotos de lecturas `registros` > 90 d,
fotos de fichajes `presencia_personal` > 365 d —anula también el GPS—, fotos de housekeeping > 90 d, cola y
barrido de huérfanos de housekeeping). Ninguna otra función ni cron lee esa key (revisado `pg_proc` y `cron.job`: 21 jobs; los demás no
dependen de ella). `purgar_datos_expirados` (solo SQL, `0 3 1 * *`) ya está activo y no depende de la key.

Lo que se eliminaría HOY en el sandbox (medido el 12/10 ~20:05 UTC; la purga anula columnas, nunca borra filas):

| Objetivo | Criterio | Afectado hoy |
|---|---|---|
| `registros.foto` → objeto en `registro-fotos` | `fecha` > 90 d, sin base64 (`data:%` se excluye) | 0 (0 fotos en total) |
| `presencia_personal.foto_entrada/_salida` → `presencia-evidencias` | `fecha` > 365 d; anula también `gps_entrada/_salida` | 0 fotos, 0 GPS (0 fotos en total) |
| `servicio_housekeeping_fotos.path` → `housekeeping-evidencias` | `created_at` > 90 d | 0 (0 filas) |
| huérfanos de `housekeeping-evidencias` | objeto sin fila, > 1 día | 0 |
| cola `hk_limpieza_storage` | filas pendientes | 0 |

Los tres buckets están vacíos. En producción, en cambio, la primera ejecución del día 1 sí retiraría las fotos de
lecturas de más de 90 días y las de fichajes de más de 365: medirlo allí antes de cargar la key.

## Verificación en el sandbox existente (sin resetearlo)
### Versión aplicada, funciones, cron y Vault (2026-10-12)
- `supabase_migrations.schema_migrations` del sandbox: `20261028000000 housekeeping_evidencias` y
  `20261028000100 housekeeping_servicios_por_proyecto`, junto a las diez de #926.
- **Edge Functions desplegadas en el sandbox** (no estaban): `housekeeping-limpieza` (v1) y
  `purgar-fotos-registros` (v1), ambas `verify_jwt = false` como en `config.toml` (validan el token a mano).
  Se subieron con la herramienta de Supabase desde los archivos del repo; en `_shared/cors.ts` y
  `_shared/housekeepingLimpieza.ts` se omitieron solo comentarios (código idéntico).
- **Cron** activo: `hk_limpieza_storage_hourly` (`17 * * * *`) y `purgar_fotos_storage_monthly` (`30 3 1 * *`).
- **Vault**: `purga_fotos_url` creado (apunta a la función del sandbox; no es secreto).
  `purga_fotos_service_key` **NO** está cargado: la key no se puede obtener por ninguna vía de esta sesión sin
  exponerla (un workflow temporal que la leyera quedó bloqueado por la política de la sesión y no se subió).
  Debe cargarla una persona por el panel (procedimiento arriba). Hasta entonces el cron horario es un no-op
  seguro y la cola se drena cuando la pantalla llama a `housekeeping-limpieza` tras cada borrado. Pendiente
  tras cargarla: drenaje programado a las :17, reintentos y conservación de textos y autoría con el cron real.

### Guiones SQL reversibles (sesión simulada con `SET ROLE` + claim del JWT)
Seis guiones `sandbox_housekeeping_parte1..6.sql` (generados por `generar_guion_sandbox.py`); cada uno termina
SIEMPRE con una excepción que revierte todo y tras cada pasada no queda residuo.

| Parte | Cubre | Sandbox |
|---|---|---|
| 1 | visibilidad (A), subida y autoría (B), rutas manipuladas y tope de 60 objetos (C), sin UPDATE (D), sellos (E) | 52/52 (tras `…000100`) |
| 2 | tope de 20 por fase (F), inventario (J), **servicio acotado al proyecto (K)** | 24/24 (tras `…000100`) |
| 3 | borrado de una foto por RPC (G) | 12/12 (antes de `…000100`) |
| 4 | borrado de un servicio con fotos, cascada y cola (G) | 9/9 (antes de `…000100`) |
| 5 | cola: arrendamiento, reintentos, atascadas, cero filas, permisos (H) | 19/19 (antes de `…000100`) |
| 6 | huérfanas; la purga conserva textos y sellos (H, I) | 9/9 (antes de `…000100`) |

Las partes 3–6 solo cambiaron en el preflight; con las dos migraciones pasan en el PostgreSQL local (`run.sh`
§7: 125/125). D2, D4, G11, G12, G29–G31, K12 y K13 (DELETE/TRUNCATE directos, residente) solo corren en local:
la herramienta SQL del entorno retiene ese tipo de sentencias.

### Inicio de sesión REAL (GoTrue, contraseña) en Chromium con los módulos reales de la app
Cuatro usuarios de prueba (`zz-hk-e2e-*@example.invalid`): dueña de la empresa A, operador de A1, operador de
A2 (misma empresa, otro proyecto) y admin de la empresa B. El navegador carga un paquete con el cliente
Supabase, el dominio (`housekeepingEvidencias`, `tabMutations`) y el generador de PDF **reales**; no se usó la
pantalla React aquí; eso es la sección siguiente.

| # | Resultado |
|---|---|
| Subida | 20 fotos de ingreso (comprimidas en el navegador: 225 KB → 82 KB, 1280×960) + 3 de cierre; la 21.ª rechazada («Máximo 20 fotos por fase») |
| Autoría | `creado_por`, `iniciado_por`, `completado_por` = el operador que actuó; un UPDATE del cliente no los reescribe |
| Visualización | el operador de A1 y la dueña ven las 23 fotos y las descargan |
| PDF | 980 KB, 2 páginas, 23 fotos descargadas del bucket, textos y autoría (`informe-sandbox.pdf`, revisado a ojo) |
| Aislamiento A2 / B | no ven el servicio ni sus textos, 0 fotos, no descargan, no listan la carpeta, no suben, no insertan filas, no borran (RPC «inexistente»), no crean ni modifican servicios de A1 |
| Borrado | el operador no borra en un servicio completado (42501); el borrado directo en Storage borra 0; la dueña borra una foto y el servicio (21 archivos) por RPC; la limpieza real responde `ok` y los archivos dejan de existir |
| Drenaje y empresa | la limpieza disparada por B toma 0 filas de A; la de A retira sus 2 huérfanos (la foto 21 rechazada y un objeto sin fila) |
| Reintentos | una fila de la cola que apunta a otro bucket no se borra: queda como fallo con `intentos = 1`, error guardado y reintento a ~5 min; mientras espera no se vuelve a tomar |

**Dos hallazgos de esta prueba, corregidos en el PR:**
1. *Textos del servicio visibles y editables desde otro proyecto* → `20261028000100` (bloque K: 14 pruebas;
   en el sandbox, A2 pasó de ver el servicio de A1 a no verlo).
2. *Caché del navegador entre sesiones*: Storage sirve los objetos privados con `Cache-Control: public,
   max-age=3600` y sin `Vary`. En el mismo navegador, tras cambiar de usuario, Chromium devolvió desde caché fotos
   que el usuario anterior había visto, aunque el servidor se las deniega (HTTP 400). Las fotos se suben ahora
   con `cacheControl: '0'` (`public, max-age=0`, comprobado): el navegador revalida con el token vigente y el
   usuario siguiente ya no las recibe (comprobado en el mismo perfil de navegador).

### Pantalla React real con inicio de sesión (Chromium, build de `93b3427`)
Distinta de la anterior: se compiló la app (`vite build` con las variables del sandbox) y se sirvió por HTTPS
local bajo un nombre con forma de preview de Vercel (lo exige el CORS de las funciones del sandbox). Login por
el formulario, navegación y **clics en los botones reales** de la pestaña Housekeeping.

| # | Paso | Resultado |
|---|---|---|
| P1–P4 | operador A1: login, pestaña, crear servicio por el formulario (textos de ingreso) | ✅ |
| P5 | «Iniciar» | ✅ «Inició: ZZ HK E2E Operador A1» |
| P6–P9 | 18 fotos de ingreso y luego 4 más | ✅ aviso «Máximo 20 por fase; se subirán 2» → 20/20; «Agregar» desaparece en la fase llena |
| P10–P11 | 3 fotos de cierre; visor | ✅ imagen firmada 1280×960 |
| P12 | «Completar» con observaciones | ✅ «Completó: ZZ HK E2E Operador A1» |
| P13 | PDF / WhatsApp | ✅ descarga de PDF de 2 páginas (2,4 MB) con textos, autoría y 23 fotos |
| P14–P15 | operador borra foto / servicio completado | ✅ rechazado: «No tienes autorización para eliminar…» |
| P16–P17 | **cambio de usuario en el mismo navegador** → operador A2 | ✅ condominio A2 activo, A1 no aparece, 0 datos de A1 |
| P18–P19 | admin de la empresa B | ✅ condominio B1, 0 datos de A |
| P20–P23 | dueña de A: ve servicio, autoría y 20+3 fotos; borra una foto (19/20) y luego el servicio | ✅ |

En BD al terminar el operador: textos guardados, `creado_por/iniciado_por/completado_por` = operador A1, 20+3
filas, 23 objetos con `cacheControl` `max-age=0`. Tras la dueña: 0 servicios, 0 fotos, 0 objetos, cola en 0.
Para la prueba se dio a los usuarios su asignación de proyecto y los permisos `….create/.edit`; después se
volvieron a bloquear.

### Datos de prueba que quedaron en el sandbox
Fotos, servicios y archivos se borraron por las RPC y la limpieza (bucket y cola en 0). Los usuarios están
**bloqueados** (`banned_until` 2999, contraseña aleatoria desconocida). Inventario exacto (12/10):

| Tabla | Filas | Identificadores |
|---|---|---|
| `companies` | 2 | `e2e0000a-0000-4000-8000-00000000000a`, `e2e0000b-0000-4000-8000-00000000000b` |
| `projects` | 3 | `e2e000a1-0000-4000-8000-000000000001`, `e2e000a2-0000-4000-8000-000000000002`, `e2e000b1-0000-4000-8000-000000000001` |
| `auth.users` / `app_users` / `auth.identities` | 4 / 4 / 4 | `e2e00000-0000-4000-8000-0000000000{01,03,04,07}` |
| `auth.sessions` / `auth.refresh_tokens` | 7 / 7 | de esos 4 usuarios |
| `roles` / `role_permissions` / `user_roles` | 1 / 3 / 2 | rol `e2e0001e-0000-4000-8000-0000000000a8` |
| `user_project_assignments` / `user_presence` | 2 / 4 | de esos 4 usuarios |
| `permission_audit_log` / `bitacora_acciones` / `audit_log` / `subscriptions` | 6 / 22 / 2 / 2 | del rol, los usuarios o las 2 empresas |
| `servicios_housekeeping` / fotos / objetos / cola | 0 | — |

**No** son de la prueba (otra empresa, `e4668da9-…`, id aleatorio que empieza por «e2e»): `conta_asientos
e2eace36-…` y sus 2 líneas, y 3 filas de `bitacora_acciones`. Por eso la retirada usa ids exactos, nunca `LIKE`.

Comprobado antes de borrar (12/10): barrido de **todas** las columnas uuid/texto de id en `public`, `auth`,
`storage`, `net`, `cron`, `vault`: los 10 ids solo aparecen en las 16 tablas del inventario; las filas mixtas
(`permission_audit_log`, `user_roles`, `user_project_assignments`, `audit_log`, `subscriptions`, `bitacora_acciones`,
`user_presence`) solo cruzan ids de la prueba entre sí (`actor_id` nulo).

`supabase/tests/housekeeping_evidencias/limpieza_datos_e2e_sandbox.sql` (un bloque atómico): guardas (nombres
exactos de empresas, rol y correos; sin servicios, objetos ni cola de prueba), borrado hijos→padres y **la
auditoría al final**, porque los disparadores de `roles`, `role_permissions`, `user_roles` y `subscriptions`
insertan filas al borrar y las FK de `permission_audit_log` ponen `target_*` a NULL (se identifican por el rol y
los usuarios exactos de `details`); verificación de que no queda nada de la prueba y de que el número de filas
ajenas no cambia. `modo := 'ensayo'` revierte y devuelve el informe; `'aplicar'` confirma.

**Autorizado el 12/10, pendiente de confirmación en la herramienta:** la herramienta SQL de Supabase retiene los
`DELETE` hasta que una persona los confirma; dos intentos (ensayo y aplicar) caducaron a los 60 s sin llegar a la
base (los conteos siguen iguales). Se puede confirmar en el siguiente intento o pegar el script con
`modo := 'aplicar'` en el editor SQL del panel del **sandbox**.

## Límites conocidos
- Los residentes ven los **textos** (`hallazgos_ingreso`, `observaciones_cierre`) del servicio de su unidad
  (rama de residente de la policy de `servicios_housekeeping`, sin cambios). Las fotos no.
- Las fotos subidas antes de `cacheControl: '0'` (solo en entornos de prueba) conservan `max-age=3600`.
- Un objeto subido cuyo registro de fila falla queda sin fila hasta que el barrido horario lo retira
  (pasado un día); mientras tanto ocupa espacio y cuenta para el tope de 60 objetos por servicio.
- La concurrencia del tope de 20 se prueba con sesiones reales en PostgreSQL 16 desechable, no en PG17 ni
  tras el pooler.
