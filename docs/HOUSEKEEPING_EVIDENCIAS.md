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
#928 (`20261026000600`) → #926 (10) → PR de alcance por proyecto (`20261027001000`, futuro) → **#927
(`20261028000000` + `20261028000100`)**. Con ese orden `schema_migrations` queda monótono. Si #927 se
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

Reconciliación **sin resetear** el branch. Requiere autorización explícita porque borra una fila del
registro de migraciones y escribe en la base del preview; por eso no se ha ejecutado:

```sql
-- 1) aplicar el contenido de 20261028000000_housekeeping_evidencias.sql y después el de
--    20261028000100_housekeeping_servicios_por_proyecto.sql (ambos idempotentes; convergen desde el estado
--    antiguo, probado en run.sh §3). Deben terminar sin error ANTES del paso 2.
-- 2) mover el registro de la versión antigua a la definitiva (solo versión y nombre, como hace
--    apply-migrations-sandbox.yml)
BEGIN;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261023000001' AND name = 'housekeeping_evidencias';
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261028000000', 'housekeeping_evidencias'), ('20261028000100', 'housekeeping_servicios_por_proyecto')
ON CONFLICT (version) DO NOTHING;
COMMIT;
-- 3) verificar (debe dar 2 / true / true / {hk_evidencias_insert,hk_evidencias_select}):
SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name LIKE 'housekeeping\_%'),
       to_regprocedure('public.hk_acceso(uuid,uuid)') IS NOT NULL,
       to_regclass('public.hk_limpieza_storage') IS NOT NULL,
       (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'hk\_evidencias\_%');
```

Alternativa sin tocar el registro: cerrar y reabrir la PR, o borrar solo esta rama de preview (el worker la
recrea desde cero con los archivos actuales; así se resolvió la de #926). No se hace sin autorización:
destruye el estado del preview.

Producción no necesita reconciliación: nunca tuvo la versión antigua.

## Despliegue
1. Fusionar #928 y #926 en sus propios pushes y aplicar sus migraciones (`apply-migrations-prod`).
2. Fusionar esta PR **en un push aparte**; `apply-migrations-prod` aplica `20261028000000` y `20261028000100`
   (2 archivos); `deploy-functions` despliega `housekeeping-limpieza` y la nueva `purgar-fotos-registros`.
3. **Manual, ya pendiente**: crear los secretos de Vault `purga_fotos_url` y `purga_fotos_service_key`
   (`docs/PURGA_FOTOS_SCHEDULE.md`). Sin ellos la cola solo se drena al borrar (desde la pantalla), no cada hora.

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
  `purga_fotos_service_key` **NO** está configurado: la service key no se puede obtener por ninguna vía de esta
  sesión sin exponerla, y un workflow temporal que la leyera del entorno `sandbox-db` quedó bloqueado por la
  política de seguridad de la sesión (no se subió). Hasta que alguien con acceso la cargue (panel → SQL:
  `select vault.create_secret('<service_role key>', 'purga_fotos_service_key');`), el cron horario es un no-op
  seguro y la cola se drena cuando la pantalla llama a `housekeeping-limpieza` tras cada borrado (probado abajo).
  Ojo: con la key cargada, `purgar_fotos_storage_monthly` también purgará en el sandbox las fotos de
  lecturas (> 90 d) y de fichajes (> 365 d) el día 1.

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
pantalla React (los previews de Vercel no son alcanzables desde este entorno), así que no se probó el clic en
los botones, sí todo lo que esos botones llaman.

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

### Datos de prueba que quedaron en el sandbox
Las fotos, servicios y archivos de la prueba se borraron por las RPC y la limpieza (bucket y cola en 0). Los
4 usuarios, 2 empresas, 3 proyectos y 1 rol `ZZ HK E2E` **siguen** porque la herramienta SQL retiene los
`DELETE`; los usuarios están **bloqueados** (`banned_until` 2999, contraseña aleatoria desconocida). Para
retirarlos (requiere confirmación):

```sql
BEGIN;
DELETE FROM public.user_roles       WHERE role_id = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.role_permissions WHERE role_id = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.roles            WHERE id      = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.app_users        WHERE id::text LIKE 'e2e00000-0000-4000-8000-%';
DELETE FROM auth.identities         WHERE user_id::text LIKE 'e2e00000-0000-4000-8000-%';
DELETE FROM auth.users              WHERE id::text LIKE 'e2e00000-0000-4000-8000-%';
DELETE FROM public.projects         WHERE id::text LIKE 'e2e000__-0000-4000-8000-%';
DELETE FROM public.companies        WHERE id::text LIKE 'e2e0000_-0000-4000-8000-%';
COMMIT;
```

## Límites conocidos
- Los residentes ven los **textos** (`hallazgos_ingreso`, `observaciones_cierre`) del servicio de su unidad
  (rama de residente de la policy de `servicios_housekeeping`, sin cambios). Las fotos no.
- Las fotos subidas antes de `cacheControl: '0'` (solo en entornos de prueba) conservan `max-age=3600`.
- Un objeto subido cuyo registro de fila falla queda sin fila hasta que el barrido horario lo retira
  (pasado un día); mientras tanto ocupa espacio y cuenta para el tope de 60 objetos por servicio.
- La concurrencia del tope de 20 se prueba con sesiones reales en PostgreSQL 16 desechable, no en PG17 ni
  tras el pooler.
