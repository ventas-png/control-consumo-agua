# Supabase Preview: qué falla de verdad, y qué haría falta para repararlo

> **Estado: diagnóstico y propuesta. No despliega nada.** Este PR no crea, no
> recrea y no resetea ninguna branch de Supabase, y no toca ninguna migración.

La preview branch del PR #847 quedó en `Migrations ❌` con
`out of shared memory (SQLSTATE 53200)`, y el intento de recrearla a mano dejó
una branch nueva en `MIGRATIONS_FAILED` con el esquema `public` **vacío**. La
conclusión que se sacó entonces —y que llegó a escribirse en
`supabase/migrations/README.md`— fue que *el historial de migraciones del
repositorio no puede reconstruir el esquema desde cero*.

**Esa conclusión es falsa, y conviene corregirla antes de gastar una semana en
baselines que no harían falta.**

## Lo que está medido

El repositorio ya tiene la herramienta que responde la pregunta: el auditor de
drift reconstruye el esquema entero desde una base vacía en cada PR.

```console
$ node scripts/schema-drift/reconstruir.mjs > /dev/null
· initdb
· arrancando
· bootstrap
· aplicando 463 migraciones
✓ 463/463 migraciones aplicadas

$ node scripts/schema-drift/reconstruir.mjs | grep -c '^tabla:[^/]*/columnas'
262
```

463 de 463 migraciones aplican **limpias** sobre un Postgres recién
inicializado, y dejan **262 tablas** en `public`. El árbol de `origin/main`
hace lo mismo (459 migraciones, 2484 grupos de huella) — el auditor lo
reconstruye en cada ejecución para su comparación de tres vías.

Lo único que hace falta además de las migraciones es
`scripts/schema-drift/bootstrap.sql`: el **andamiaje de plataforma** que las
migraciones dan por dado porque en Supabase viene de fábrica —los roles
`anon` / `authenticated` / `service_role` / `authenticator`, los esquemas
`auth` / `storage` / `vault` / `net` / `cron`, `auth.uid()`, `auth.users`,
`storage.objects`, las extensiones, y los `ALTER DEFAULT PRIVILEGES` del
esquema `public`—. Una branch de Supabase **ya tiene todo eso**.

### Por qué la explicación anterior no se sostiene

Decía que las baselines de las fases 1 y 2, al usar `CREATE TABLE IF NOT
EXISTS`, «se registran sin crear nada» sobre una base vacía, y que por eso
`20260320000000_fix_superadmin_app_users_uuid` caía al abrir con
`DROP POLICY … ON public.app_users`.

`CREATE TABLE IF NOT EXISTS` **sí crea la tabla cuando no existe** — el `IF NOT
EXISTS` sólo evita el error cuando ya está. `20260317000000` crea `app_users`,
`companies`, `projects`, `user_project_assignments` y `pagos`; para cuando
llega `20260320000000`, `public.app_users` existe. La reconstrucción de arriba
lo demuestra: si esa cadena se rompiera ahí, no habría 463 de 463.

## Lo que queda sin explicar

Dos observaciones siguen siendo ciertas y **no** las explica el historial:

| Observación | Detalle |
| --- | --- |
| Branch creada a mano | `create_branch` (`with_data: false`) → `MIGRATIONS_FAILED`, `public` vacío, cinco migraciones registradas |
| `reset_branch` sobre una branch con esquema | muere con `out of shared memory (SQLSTATE 53200)`: el bloque de limpieza toma un lock por objeto dentro de una sola transacción, y con 262 tablas más sus policies, índices y triggers no cabe en `max_locks_per_transaction` |

El segundo se explica solo y no tiene arreglo desde el repositorio: es el
tamaño del esquema contra el límite de locks del runner. El primero **no está
diagnosticado**, y desde aquí no se puede: el error real lo guarda la API de
Management para esa branch, y leerlo exige el token de la integración.

## Propuesta

En este orden, porque cada paso ahorra el siguiente.

### 1. Leer el error de verdad (lo único que falta)

Antes de escribir una sola migración de reparación, obtener el mensaje que la
API guarda para la branch fallida:

```
GET /v1/branches/{branch_id}   →  status, migration_version y el error
```

Con el token de la integración (el que ya usa el workflow de Supabase). El
resultado decide todo lo demás: si nombra una migración concreta, es un bug
puntual; si no llega a aplicar ninguna, es el ambiente de la branch y no hay
baseline que lo arregle.

**Hasta tener ese mensaje, cualquier "reparación" es una conjetura cara.**

### 2. No recrear preview branches a mano

Lo que funciona hoy —y es lo que usa el PR normal— son las branches que crea la
integración de GitHub: clonan el esquema del proyecto padre y aplican **sólo
las migraciones nuevas** (*«only new migration files are pushed»*). Por eso una
branch de PR llega al día y una creada por API no.

Consecuencia operativa, que conviene que esté escrita: **una preview branch se
recrea con un push que toque `supabase/**`**, no con `create_branch` ni con
`reset_branch`.

### 3. Comprobar una branch en vez de suponerla

`scripts/schema-drift/fingerprint.sql` es SQL portable a propósito —sin
meta-instrucciones de `psql`— para poder pegarlo en el Editor SQL de Supabase.
Correrlo contra una preview branch y `diff`ear su salida contra
`node scripts/schema-drift/reconstruir.mjs` responde «¿esta branch tiene de
verdad el esquema del PR?» sin interpretar el badge del bot.

### 4. Lo que NO hace falta

- **Más fases de baseline (`infra:I39`)** por este motivo. Pueden seguir siendo
  buena idea por el inventario de #826 —funciones editadas a mano en
  producción—, pero no son el bloqueo de Preview: la cadena ya reconstruye.
- **Tocar `20260317000000` / `20260317000001`.** Hacen lo que dicen.

## Reproducción

```console
node scripts/schema-drift/reconstruir.mjs > /tmp/huella.txt   # 463/463
grep -c '^tabla:[^/]*/columnas' /tmp/huella.txt               # 262
npm run drift:auditar                                          # reconstruye también origin/main
```

Requiere binarios de PostgreSQL (`initdb`/`pg_ctl`/`psql`). No toca ningún
proyecto remoto.
