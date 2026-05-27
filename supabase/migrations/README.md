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

Una vez completas las fases 1 y 2 (y eventuales fases 3+ si surgen), Supabase Branching debería levantar branches limpias sin errores y `supabase db reset` debería aplicar todas las migraciones de extremo a extremo.
