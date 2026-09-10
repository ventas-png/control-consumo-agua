# Convención de migraciones

Esta carpeta contiene las migraciones SQL versionadas que evolucionan el schema del proyecto Supabase. Reglas que todo PR que toque `supabase/migrations/` debe seguir.

## Nomenclatura

```
<YYYYMMDDHHmmss>_<verbo>_<entidad>_<contexto?>.sql
```

Ejemplos:
- `20260318000000_enable_rls_public_schema.sql`
- `20260420000001_condominios_mvp.sql`
- `20260518000010_rbac_rls_condominios_phase1.sql`

El timestamp determina el orden de aplicación. Una migración con timestamp anterior a otra que ya está en `main` rompe el orden cronológico, así que **nunca se debe insertar una migración con timestamp anterior al último mergeado** salvo en casos excepcionales como `infra:I39` (baseline de tablas legacy) que explícitamente se inyecta antes del primer `ENABLE RLS` para que la cadena de migrations sea aplicable desde cero.

### Elegir el número: por encima del máximo de `main`, no simplemente uno libre

Un número *libre* no basta, y la diferencia cuesta un renumerado por cada vez que se ignora. Hay dos guardas y **no** piden lo mismo:

| Guarda | Qué prohíbe |
| --- | --- |
| `scripts/migrations-guard.mjs`, regla (d) | que dos ficheros compartan versión |
| `scripts/schema-drift/auditar.mjs` | además, que una versión nueva sea `<=` la última que ya existe en la base (*intercalada*) |

Con `main` en `20260910000100`, un `20260910000001` pasa la primera y falla la segunda: es único, pero va por debajo. La regla práctica es tomar el máximo de `main` **en el momento de abrir el PR** y dejar holgura por delante (`…000200`, no `…000101`), porque `main` puede avanzar mientras el PR está en vuelo.

Y renumerar no es gratis: la preview branch de Supabase aplica migraciones en cada push, así que las versiones viejas se quedan en su historial remoto y el siguiente push falla con `Remote migration versions not found in local migrations directory` hasta que la branch se recree.

## Convenciones de contenido

### 1. Toda tabla nueva nace de una migración

Una tabla creada manualmente en producción y luego asumida por migrations posteriores (ej. `ALTER TABLE` sin un `CREATE TABLE` previo en el repo) rompe la reproducibilidad. El audit `infra:I39` (ver `DESIGN_CRITIQUE_INFRAESTRUCTURA_2026-05-26.md`) identificó 15 tablas legacy en producción sin migración; la fase 1 (4 tablas) ya está en este repo, las 11 restantes vendrán en fases posteriores.

A futuro: **nunca crear tablas vía SQL Editor en el dashboard de Supabase**. Crearlas con `CREATE TABLE` en una migración nueva.

### 2. `CREATE TABLE IF NOT EXISTS` para baseline legacy

Las migraciones que documentan retroactivamente tablas legacy usan `CREATE TABLE IF NOT EXISTS` para que sean idempotentes en producción (donde las tablas ya existen) sin saltarse el flujo normal en branches/staging/dev.

Las migraciones que crean tablas nuevas (no legacy) usan `CREATE TABLE` sin `IF NOT EXISTS` para que el error sea explícito si se intenta correr dos veces.

### 3. FKs y constraints en la misma migración

Cuando se crea una tabla, sus PKs, FKs internas, UNIQUEs y CHECKs deben ir en el mismo `CREATE TABLE`. Si una FK apunta a una tabla aún no creada (común en baseline por fases), documentarlo como `-- TODO infra:I39-fase2:` y agregarla en la fase correspondiente.

### 4. RLS en la propia migración que crea la tabla

`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` y las `CREATE POLICY` correspondientes van en la misma migración que crea la tabla (o inmediatamente después). Nunca enable RLS antes de que la tabla exista en el repo: ese fue el error que destapó `infra:I39`.

### 5. Reversibilidad

Cada migración debe poder revertirse si se detecta un error productivo. Hoy las migraciones no tienen archivo `down.sql` separado; mientras se introduce una convención formal, **documenta en un comentario al inicio del archivo cómo revertir la migración**.

### 6. Search path explícito en funciones

Las funciones (`CREATE FUNCTION`) deben fijar `SET search_path = ''` para evitar inyección por mutación de `search_path`. Patrón seguido en `20260521000001_security_harden_trigger_functions.sql`.

### 7. Comentar el "por qué"

El SQL describe el "qué". El comentario al inicio del archivo o en bloques debe explicar el "por qué". Ejemplo:

```sql
-- Necesitamos un índice parcial en (status, project_id) WHERE deleted_at IS NULL
-- porque las queries de dashboard filtran por proyecto y excluyen soft-deletes.
-- Sin él, el query plan hace seq scan sobre 60K rows en proyectos grandes.
```

## Checklist pre-merge para PRs que toquen migrations

- [ ] La migración tiene comentario explicando el "por qué".
- [ ] FKs internas declaradas; FKs cross-fase documentadas como TODO.
- [ ] RLS y policies en la misma migración que crea la tabla.
- [ ] Funciones nuevas usan `SET search_path = ''`.
- [ ] Si toca tablas con datos productivos, agregar nota de impacto.
- [ ] Si afecta `companies/projects/user_project_assignments/pagos/clientes/registros`, ejecutar test manual con Supabase CLI (`supabase db reset` local) antes de mergear. Si no es posible, validar contra preview branch.

## Estado de baselines (infra:I39)

| Fase | Cobertura | Estado |
|------|-----------|--------|
| 1    | 5 tablas (`app_users`, `companies`, `projects`, `user_project_assignments`, `pagos`) | ✅ `20260317000000_baseline_legacy_tables_phase1.sql` |
| 2    | 11 tablas (`empresa`, `security_logs`, `user_sessions`, `fuentes_agua`, `clientes`, `registros`, `registros_calidad`, `convenios_pago`, `payment_requests`, `password_reset_tokens`, `empresa_pagos_config`) + 7 funciones legacy + FKs cross-fase de la fase 1 | ✅ `20260317000001_baseline_legacy_tables_phase2.sql` |
| 3+   | Objetos adicionales (triggers, vistas, secuencias) que aparezcan en errores subsiguientes | Iterativo, según se detecten |

La intención de las fases era que Supabase Branching levantara branches limpias y que `supabase db reset` aplicara la cadena de extremo a extremo. **Medido hoy, todavía no es así**, y conviene saberlo antes de perder una tarde:

Una branch creada **desde cero** (`create_branch` por API, `with_data: false`) registra las cinco primeras migraciones —hasta `20260318000002`— y se detiene. En ese punto `information_schema.tables` devuelve **cero tablas en `public`**: las baselines de la fase 1 y 2 usan `CREATE TABLE IF NOT EXISTS` contra tablas que dan por existentes, así que sobre una base vacía se registran sin crear nada, y la siguiente migración —`20260320000000_fix_superadmin_app_users_uuid`, que abre con `DROP POLICY … ON public.app_users`— cae sobre una tabla que no existe. Es la misma razón por la que la branch de `main` figura como `MIGRATIONS_FAILED`.

Lo que **sí** funciona, y es lo que usa el PR normal, son las branches que crea la integración de GitHub: clonan el esquema del proyecto padre y aplican **sólo las migraciones nuevas** («*only new migration files are pushed*»). De ahí que una branch de PR llegue al día y una creada a mano no.

Consecuencia práctica: una preview branch **no se recrea a mano**. Se recrea con un push que toque `supabase/**`, que es lo que dispara a la integración. Y su `reset` tampoco es una salida: sobre una base con el esquema entero, el bloque de limpieza que ejecuta toma un lock por objeto en una sola transacción y muere con `out of shared memory (SQLSTATE 53200)`.

Cerrar de verdad el hueco es completar las baselines hasta que la cadena arranque desde vacío; hasta entonces, ninguna de las dos afirmaciones de arriba se puede dar por cierta.
