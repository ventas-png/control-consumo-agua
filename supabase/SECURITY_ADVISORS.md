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
