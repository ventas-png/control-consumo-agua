# Runbook — Deploy, Staging, Canary & Rollback

> infra:I16/I17/I19/I20 — entornos, flujo de promoción, canary y reversa
> (frontend en Vercel, edge functions + DB en Supabase).

## Entornos

| Entorno | Qué es | Cómo nace | URL |
|---|---|---|---|
| **Preview** | 1 deployment efímero por PR | Vercel Git integration (automático en cada push al PR) + Supabase Preview Branch | `*-git-<branch>-…vercel.app` |
| **Staging** | deployment estable pre-prod | `deploy-staging.yml` (push a rama `staging` o manual) → alias estable | `STAGING_ALIAS` (default `staging-control-consumo-agua.vercel.app`) |
| **Producción** | lo que ven los clientes | merge a `main` → Vercel production (Git integration) | `administratodo.com` / `.app` |

**Infra real (descubierta vía MCP, para referencia — nada de esto se hardcodea):**
- Vercel: proyecto `control-consumo-agua` (`prj_O66OXOZapMO11TgzwqzxoSm5pxBu`), team `prestadora-de-servicios-projects`.
- Supabase: proyecto `control-agua` (`nnsqmeigtgewatameexo`).

### Lado base de datos de cada entorno (Supabase)

- **Preview:** cada PR levanta un **Supabase Preview Branch** efímero (lo verás
  comentado por `supabase[bot]` en el PR) — corre migraciones + seed aislados de
  prod. Es el lugar correcto para validar una migración **antes** de mergear.
- **Staging:** crea **una sola vez** un branch **persistente** llamado `staging`
  (Supabase → Branches → New branch, *persistent*; o `supabase branches create
  staging --persistent`). Apunta el frontend de staging a su URL/anon-key vía las
  env del entorno Preview de Vercel. Así pruebas el binario en un esquema que
  refleja prod sin tocar datos reales.
- **Producción:** el proyecto `control-agua`. Las migraciones llegan por
  `apply-migrations-prod.yml` (automático en el push a `main`); **nunca**
  `apply_migration` a mano.

> No provisionamos el branch persistente desde CI a propósito: es un recurso de
> pago/duradero — es una decisión del dueño (ver checklist de setup abajo).

## Secrets requeridos (GitHub → Settings → Secrets and variables → Actions)

| Secret | Para qué | De dónde sale |
|---|---|---|
| `VERCEL_TOKEN` | CLI de Vercel en CI | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | identifica el team | `.vercel/project.json` tras `vercel link`, o dashboard |
| `VERCEL_PROJECT_ID` | identifica el proyecto | idem |
| `SLACK_WEBHOOK_URL` | alertas de CI/deploy (opcional) | Incoming Webhook de Slack |

Variables opcionales de repo (no secretas): `STAGING_ALIAS`, `PROD_URL`.

> Sin los `VERCEL_*`, los workflows de staging/promote fallan con un mensaje que
> dice exactamente qué falta (no hacen nada peligroso a medias).

## Flujo de promoción: preview → staging → prod

```
PR abierto ──► Preview (Vercel) + Preview Branch (Supabase)   ← revisión + CI verde
   │
   merge a `staging` (o dispatch de deploy-staging.yml)
   ▼
Staging ──► smoke test automático (HTTP 200 del alias)         ← QA / stakeholders
   │
   workflow "Promote / Rollback Production", action=promote, target_url=<deployment de staging>
   ▼
Producción (mismo binario que se validó en staging)
```

**Por qué `promote` y no "rebuild en prod":** `vercel promote` marca como
producción un deployment **ya construido** (el de staging). El artefacto que
probaste es bit-a-bit el que sirve prod → se elimina la clase de bug
"compiló distinto en prod".

### Canary (qué es y qué no es aquí)

La app es una SPA estática en Vercel. **No** hay split de tráfico por porcentaje
sin un middleware de Edge (no lo tenemos). El "canary" práctico es:

1. Desplegar a **staging** y dejarlo "hornear" (smoke test + uso real de QA).
2. Si Sentry/PostHog no muestran regresión en staging → **promote** a prod.
3. Vigilar Sentry los primeros ~15 min post-promote (release health).
4. A la primera señal de error elevado → **rollback** (abajo).

Si en el futuro se quiere canary real por %: añadir `middleware.ts` que enrute un
% de sesiones (cookie sticky) a un deployment alterno vía Edge Config. Fuera de
alcance de este runbook.

## Rollback de deploy (frontend)

**Opción A — workflow (recomendada):** Actions → *Promote / Rollback Production*
→ `action: rollback`. Sin `target_url` revierte al **deployment de producción
anterior**; con `target_url` a uno específico. Es **instantáneo** (sin rebuild).

**Opción B — dashboard:** Vercel → proyecto → Deployments → el último bueno →
**Instant Rollback** / *Promote to Production*.

**Opción C — git:** `git revert <sha>` y merge a `main` (reconstruye; más lento).
Úsala solo si además hay que dejar el código revertido en `main`.

> Verificación post-rollback: el step de smoke test del workflow ya pega un GET a
> `PROD_URL` y falla si no es 200. Confirma además en Sentry que la tasa de error
> baja.

## Rollback de edge functions

Las edge functions se despliegan con `deploy-functions.yml` (push a `main` que
toque `supabase/functions/**`). Para revertir una:

1. `git revert` del cambio de esa función → merge a `main` → el workflow
   re-despliega la versión anterior. **O**
2. Manual: `supabase functions deploy <fn> --project-ref nnsqmeigtgewatameexo`
   desde el commit bueno (con `SUPABASE_ACCESS_TOKEN` en el entorno).

Las edge functions son **stateless**: revertir el código revierte el comportamiento
sin pasos extra.

## Rollback de migraciones (DB) — el delicado

Las migraciones son **forward-only** (`supabase/migrations/<timestamp>.sql`). NO
hay "down". Reglas:

1. **Nunca** edites ni borres una migración ya aplicada. Para corregir, escribe
   una **nueva** migración en el siguiente timestamp (banda por track/día) que
   **compense** el cambio.
2. **SQL idempotente** siempre (`IF NOT EXISTS`, `DROP ... IF EXISTS`,
   `CREATE OR REPLACE`) — una corrección puede re-aplicarse sin romper.
3. **Expand/contract** para cambios destructivos: primero agrega (expand) y
   migra datos en una release; elimina lo viejo (contract) en otra, ya verificada.
   Así un rollback de la app no choca con un esquema que se adelantó.
4. **Valida en el Preview Branch del PR** (Supabase comenta el estado de
   Migrations en el PR). **No** corras `apply_migration` contra prod a mano.
5. **Emergencia (corrección puntual en prod):** Actions → *Apply Migrations to
   Production* (`apply-migrations-prod.yml`), dispatch **con `migration_file`
   explícito**. El workflow valida el nombre (basename dentro de
   `supabase/migrations`, formato `<14 dígitos>_<nombre>.sql`) y **rechaza una
   versión ya registrada** en `schema_migrations`: una corrección se hace con una
   migración NUEVA, nunca reaplicando una histórica. Es la vía auditable y evita
   ejecutar SQL suelto desde un dashboard. Dejar `migration_file` VACÍO es el modo
   reconciliar — leé el aviso de abajo antes.

   > ✅ **El gate de aprobación humana está ACTIVO.** El Environment
   > `production-db` quedó protegido con:
   >
   > - **Required reviewers** activo, con al menos un revisor: un dispatch (y
   >   cualquier corrida del job `apply`) queda en espera hasta que una persona lo
   >   apruebe.
   > - **Deployment branches and tags** en *Selected branches and tags*, con `main`
   >   como **única** regla: ninguna otra rama puede desplegar contra este
   >   Environment.
   > - **Allow administrators to bypass configured protection rules** DESACTIVADO:
   >   la aprobación tampoco se salta siendo admin.
   >
   > **Procedencia del dato:** esta configuración fue **validada manualmente por el
   > administrador del repositorio el 2026-09-01**, revisando Settings → Environments
   > → production-db. **No la verifica CI ni ningún test de este repo**, y no es
   > comprobable desde una sesión de Claude Code (la API de Environments responde 403
   > a través del proxy). O sea: es una atestación humana con fecha, no un check
   > automatizado — si alguien cambia esos ajustes, **nada en el repositorio se
   > pondrá rojo para avisarlo**.
   >
   > La confirmación funcional llega sola: la primera corrida de
   > `apply-migrations-prod` que quede en estado `waiting` esperando aprobación es la
   > prueba de que el gate actúa. Hasta el 2026-09-01, ninguna de las últimas 100
   > corridas había quedado nunca en ese estado — todas anteriores a esta
   > configuración.

   > El antiguo *Apply SQL Migration* (`apply-migration.yml`) se eliminó: escribía
   > al mismo proyecto sin el cortafuegos append-only, sin el tope `MAX_APPLY` y
   > sin siquiera declarar el Environment, además de interpolar la entrada del
   > dispatch en el shell (auditoría 2026-05-26, I9).

### ⛔ El dispatch de reconciliación (`migration_file` vacío)

*Apply Migrations to Production* aceptado sin `migration_file` **reconcilia**:
aplica todo lo que esté en `supabase/migrations/` y no en
`supabase_migrations.schema_migrations`. Suena inofensivo y no lo es.

**El 2026-08-03 esa opción tumbó producción.** El historial estaba incompleto
—solo registraba lo posterior al 2026-06-05, porque las anteriores se aplicaron
en su día por otra vía y nadie las apuntó—, así que el reconciliador dio por
pendientes **257 migraciones ya aplicadas** y las reejecutó en orden. Entre
ellas, `20260320000000_fix_superadmin_app_users_uuid`, que empieza con:

```sql
DROP TABLE IF EXISTS public.app_users CASCADE;
```

Se llevó todos los perfiles. Nadie pudo entrar, la autenticación seguía bien pero
la app trataba a todo el mundo como usuario nuevo, y hubo que restaurar el backup
de las 06:22 UTC perdiendo la mañana completa de trabajo.

Reglas que salen de ahí:

- **Antes de reconciliar, comprobar que el historial está completo.** Si no lo
  está: `scripts/backfill-schema-migrations.sql` (se ejecuta a mano, una vez).
- **Preferir siempre `migration_file` con UN archivo concreto.** Es más lento y
  es el punto: se ve qué se va a ejecutar antes de ejecutarlo.
- El workflow tiene un **tope duro** (`MAX_APPLY`, hoy 10). Si salta, NO subirlo
  para "que pase" — revisar por qué la selección se disparó. Un despliegue sano
  nunca trae decenas de migraciones pendientes.
- La regla 2 de arriba (SQL idempotente) **no** basta como red: una migración de
  marzo puede ser perfectamente idempotente y aun así destruir, porque
  reconstruye el estado de marzo sobre datos de agosto.

### Si una migración falla a medias

- Postgres aplica cada archivo en su propia transacción → un fallo deja ESA
  migración sin commitear, pero las anteriores quedaron. Revisa
  `supabase/migrations` vs `schema_migrations` para ver dónde se cortó.
- Escribe la migración correctiva idempotente y vuelve a aplicar. No reuses el
  timestamp que falló.
- Antes de mergear a `main`, confirma que el check de **Migrations** del Preview
  Branch del PR está en ✅.

## Checklist de release a producción

- [ ] CI verde en el PR (type-check + tests + build).
- [ ] Preview Branch de Supabase con Migrations ✅.
- [ ] Desplegado a **staging** y smoke test en verde.
- [ ] Sin regresión nueva en Sentry (staging) ni en PostHog.
- [ ] `promote` con el `target_url` del deployment de staging.
- [ ] Vigilar Sentry ~15 min (release health). Si error → `rollback`.
