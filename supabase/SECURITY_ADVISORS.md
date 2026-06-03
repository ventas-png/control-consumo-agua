# Advisors de seguridad de Supabase — estado y excepciones aceptadas

Registro de decisiones sobre los advisors de seguridad del proyecto `control-agua`
(`get_advisors type=security`). Pertenece al **Track T5 · Infra/Ops/Seguridad**.

## Resueltos

| Advisor | Qué se hizo | Dónde |
|---|---|---|
| `0011` `function_search_path_mutable` | `search_path` fijo en las funciones de `public` | `20260521000001_security_harden_trigger_functions.sql`, `20260603120000_security_harden_function_grants.sql` |
| `0028/0029` `anon … SECURITY DEFINER executable` | revocado `EXECUTE` de `anon` en 15 funciones (3 triggers + 4 de frontend + 8 de infra/worker) | `20260603120000_security_harden_function_grants.sql` (PR #324) |

## Excepciones aceptadas (no se accionan, con justificación)

### `0014` `extension_in_public` — `pg_net`
`pg_net` es **no-relocatable** (`pg_extension.extrelocatable = false`), por lo que
`ALTER EXTENSION pg_net SET SCHEMA …` **falla**. Además, todos sus objetos llamables
(`net.http_post`, `net.http_request_queue`, …) **ya viven en el schema `net`**, no en
`public`; el advisor se dispara solo porque el *namespace registrado* de la extensión es
`public`. Limpiarlo exige `DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA
extensions;`, lo que **borra la cola `net.http_request_queue` y los requests en vuelo** y
reinicia el worker — una ventana en la que todo el HTTP de cron (email worker c/5min,
billing sync, reportes, route reminders) falla. El beneficio de seguridad es marginal
(nada de pg_net queda expuesto en `public`). **Se acepta el WARN.** Revisar si Supabase
hace `pg_net` relocatable o publica un path soportado de migración de schema.

### `0028/0029` `anon … SECURITY DEFINER executable` — `user_has_permission`, `company_has_feature`
Son helpers usados **dentro de policies RLS** de ~150 tablas y se evalúan como parte del
query del propio rol. Revocar su `EXECUTE` a `anon` rompería la evaluación de las policies
en cualquier tabla accesible por `anon` (error de permisos en la función en vez de devolver
0 filas). Pendiente: **análisis de accesibilidad-`anon` por tabla** antes de cualquier
cambio (PR futuro de T5).

## Storage — aislamiento cross-tenant (`infra:I14`)

**Hallazgo:** varias policies de `storage.objects` chequean solo `bucket_id` para el rol
`authenticated`, sin scoping por company/path → un usuario logueado puede listar/leer/
escribir/borrar archivos de **otros tenants**. Causa raíz: el primer segmento del path no es
el `company_id` (salvo donde se indica).

| Bucket | Path de subida | Estado |
|---|---|---|
| `report-attachments` | `${company_id}/…` | ✅ ya scopeado (modelo a seguir) |
| `company-logos` | `${company_id}/…` | ✅ WRITE scopeado en fase 1 (`20260603150000`); READ amplio (logo no sensible) |
| `pagos-comprobantes` | `comprobantes/${auth.uid()}/…` | ✅ scopeado en fase 2 (`20260603160000`): WRITE carpeta-propia, READ dueño/staff-de-company |
| `registro-fotos` | `${cliente_id}/${ts}` | ✅ scopeado (`20260603210000`): path normalizado (era `registros/${id}_${ts}`); READ residente/staff-de-company, WRITE staff |
| `condominios-media` | `${project_id}/<categoría>/<ts>-<rand>` | ✅ scopeado (`20260603220000`, aplicado a prod 2026-06-03): path normalizado (era `<categoría>/…` sin tenant); READ/WRITE staff por `projects` RLS, residente ESTRICTO a projects de sus unidades. 42 objetos migrados (Storage API copy+delete) + 7 huérfanos en cuarentena `_orphans/` |
| `mudanza-docs` | `${unidad_id}/…` | ✅ scopeado (`20260603180000`) vía RLS de `unidades` (cubre residente y staff) |
| `project-logos` | `${project_id}/…` | ✅ WRITE scopeado (`20260603170000`) vía `projects.company_id`; READ amplio |
| `conv-attachments` | `${conversation_id}/…` | ✅ scopeado (`20260603200000`) vía RLS de `conversations` (READ/WRITE; cubre staff y residente) |

**Fase 1 (hecha):** `company-logos` WRITE scopeado por `get_my_company_id()` (o
`is_super_admin()`); `file_size_limit` en `conv-attachments` (10 MiB) y `report-attachments`
(25 MiB).

**Fase 2 (hecha):** `pagos-comprobantes` scopeado (`20260603160000`). El path es
`comprobantes/${auth.uid()}/…` (único uploader = portal residente; lector = gestor de cobros).
WRITE (insert/update/delete) → solo carpeta propia o `super_admin`; READ → dueño OR
`super_admin` OR staff de la company dueña del registro, vía `pagos.registro_id →
registros.project_id → projects.company_id` (misma lógica de roles que `pagos_select`).
> ⚠️ Hallazgo lateral: `PagoManualModal` (portal) inserta `pagos.project_id = null` y no hay
> trigger de backfill → los pagos creados desde el portal **no son visibles** para el gestor
> vía `pagos_select` (que filtra por `project_id`). El READ del comprobante se mapea por
> `registros.project_id` para ser robusto a esto, pero el fix de visibilidad de `pagos`
> (backfill de `project_id` desde el registro) queda pendiente en #335.

**Fase 3 (hecha):** `condominios-media` scopeado (`20260603220000`, aplicado a prod 2026-06-03).
Convención nueva `${project_id}/<categoría>/<archivo>`: los uploaders genéricos reciben el
project_id activo vía `MediaScopeContext` (provider en `CondominiosSection` para staff y en
`CondominiosClientPortal` para residentes). Policy con misma expresión en los 4 comandos: staff
(`get_my_company_id()` not null) por `projects` RLS; residente ESTRICTO a los projects de sus
unidades activas. Runbook ejecutado en orden (deploy código → migrar objetos → aplicar policy;
la policy va al final o los objetos en path viejo quedan invisibles):
- **42 objetos** referenciados migrados (copy+delete vía Storage API + update de columnas).
- **7 huérfanos** (sin fila que los referencie) movidos a cuarentena `_orphans/` (reversibles;
  purgables luego). Cobertura verificada en prod: 49 = 42 (→ 1 project único, 0 ambiguos) + 7.
- Verificado post-aplicación: 0 objetos en path viejo, 4 policies scopeadas, `get_advisors` sin
  hallazgos nuevos.
> Hallazgo lateral (higiene, no I14): ~53 referencias colgadas preexistentes (`visitantes.foto_*`,
> `novedades.foto_url`) apuntan a paths sin objeto (imágenes ya rotas); intactas, limpieza opcional.

**Fases siguientes (tracked en #335, aún no en prod):**
1. `allowed_mime_types` por bucket — requiere normalizar primero los content-types de subida
   (p. ej. `mimeFor()` emite `text/csv;charset=utf-8`).

> Validar cada fase en Supabase Preview antes de prod: los paths existentes deben matchear la
> policy nueva, o los archivos quedan inaccesibles.
