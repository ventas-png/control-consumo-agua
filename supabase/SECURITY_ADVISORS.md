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
| `pagos-comprobantes` | `comprobantes/${user_id}/…` | ❌ pendiente (PII financiera) |
| `registro-fotos` | `registros/${cliente_id}_${ts}` | ❌ pendiente |
| `condominios-media` | `${unidad/proyecto}/…` | ❌ pendiente |
| `mudanza-docs` | `${unidad_id}/…` | ❌ pendiente |
| `project-logos` | `${project_id}/…` | ❌ pendiente (scope vía `projects.company_id`) |
| `conv-attachments` | varía | ⚠️ READ amplio (INSERT sí valida company/cliente) |

**Fase 1 (hecha):** `company-logos` WRITE scopeado por `get_my_company_id()` (o
`is_super_admin()`); `file_size_limit` en `conv-attachments` (10 MiB) y `report-attachments`
(25 MiB).

**Fases siguientes (tracked en #335, aún no en prod):**
1. Scopear READ/WRITE por company en cada bucket. Donde el id del path resuelve a company vía
   tabla de dominio (`pagos-comprobantes`→`app_users`, `project-logos`→`projects`) se usa
   policy-join sin migrar datos. Donde el id está embebido de forma frágil (`registro-fotos`:
   `${cliente_id}_${ts}`) hay que normalizar la convención de path y migrar objetos.
2. `allowed_mime_types` por bucket — requiere normalizar primero los content-types de subida
   (p. ej. `mimeFor()` emite `text/csv;charset=utf-8`).

> Validar cada fase en Supabase Preview antes de prod: los paths existentes deben matchear la
> policy nueva, o los archivos quedan inaccesibles.
