# Estado consolidado + Tracks paralelos — corte 2026-06-04

**Fecha:** 2026-06-04
**Base:** `main` @ #375 (`5e5c41e`)
**Supersede:** [`ESTADO_Y_TRACKS_PARALELOS_2026-06-02.md`](./ESTADO_Y_TRACKS_PARALELOS_2026-06-02.md) (sigue siendo la
referencia del **ledger por dominio** y el **detalle de los 8 tracks**; aquí solo va el *delta verificado*, las
**reservas de migración** del día y el **orden de ejecución** de la sesión paralela en curso).

> **Por qué este corte:** los checkboxes de las épicas #300–#307 (creadas el 06-03) quedaron **por detrás del
> código**. Este documento reconcilia el estado real verificado en `main` y reserva bandas de migración para
> lanzar T2/T3/T5 **en paralelo sin colisiones**.

---

## 1. Delta verificado desde el 06-02 (comprobado en el árbol de `main`, no en los checkboxes)

| Track | Antes (06-02) | Ahora (#375) | Evidencia en código |
|---|---|---|---|
| **T7 · Capa de datos** | scaffold pendiente | **scaffold ✅ + `useData.ts` ELIMINADO** | `src/domain/{queryClient,queryFetch}.ts` + `domain/agua/{keys,queries,schemas}` (con tests) + `domain/condominios/schemas`. `src/hooks/useData.ts` **ya no existe** (16→0 colecciones; `agua:A4` cerrado en #364). |
| **T7 · god-components** | A2/A3/P12/P13 ❌ | **A3 en curso** | `agua:A3` props drilling de `App.tsx` migrando a contexto: `SessionContext` (#370), `PermissionsContext`/`userRole` (#372), layout+guards (#375), prefetch+desacople `useAuth` (#373). `src/hooks/useAuth.ts` aún ~29 KB → `plat:P13` sigue abierto. |
| **T1 · Servicios** | ~0 | **17/29 cerrados** | Los 5 🔴 (S1/S2/S13/S20/S22) + S6/S12/S14/S15/S16/S17/S18/S19/S21/S25/S26/S27 (PRs #323–#367). |
| **T5 · Infra (I14)** | storage scoping ❌ | **casi completo** | 8 buckets scopeados (#336–#368) + `condominios-media` (`20260603220000`) + `allowed_mime_types` (`20260603230000`). Hardening de grants arrancado (`20260603120000`). |

**Convención de migraciones:** `YYYYMMDDHHMMSS_desc.sql`. Última usada: `20260603230000`. Total: **232** archivos.

---

## 2. Estado por track (8 épicas #300–#307)

| Épica | Track | Ola | Estado | Foco inmediato |
|---|---|---|---|---|
| #300 | **T1 · Servicios** | A | **17/29** | cola: S3-S5 refactor, S23 tipologías a DB, S29 plugin (coordina T7) |
| #301 | **T2 · Comunicación** | A | **0/29** | 🔴 N2/N3/N4 orquestador (**en curso** esta sesión) |
| #302 | **T3 · Plataforma** | A | ~0 | 🔴 P3 invitaciones (**en curso** esta sesión) |
| #303 | **T5 · Infra/Seguridad** | A | parcial (I14) | 🔴 I2 rate-limit + hardening advisors (**en curso** esta sesión) |
| #304 | **T7 · Capa de datos** | B | **go-first, en curso** | cerrar A3 → P12 `EmpresaSection` (3.547 L) → P13 `useAuth` (779 L) → N6 |
| #305 | **T4 · Facturación** | B | bloqueado por T7 | Factura estados/mora/IVA + Tenant |
| #306 | **T6 · UX** | B | pendiente | DataTable cierre + switcher multi-condominio + i18n |
| #307 | **T8 · Performance/QA** | B | pendiente | tests auth/RBAC + condominios (hoy 0) + vistas materializadas + E2E |

---

## 3. Reservas de migración — 2026-06-04 (clave anti-colisión)

> **Lección #361:** `schema_migrations` keya por **versión** (`YYYYMMDDHHMMSS`); dos archivos con el mismo
> timestamp chocan (`duplicate key … schema_migrations_pkey`). Cada track en paralelo reserva una **banda de
> horas disjunta** para el día.

| Track | Banda EXCLUSIVA (2026-06-04) | Archivos esperados |
|---|---|---|
| **T2 · Comunicación** | `100000`–`125959` | `20260604100000_notifications_outbox.sql`, `20260604110000_notification_templates.sql` |
| **T3 · Plataforma** | `130000`–`155959` | `20260604130000_user_invitations.sql` |
| **T5 · Infra/Seguridad** | `200000`–`225959` | `20260604200000_security_harden_search_path.sql` (+ siguientes en horas redondas) |
| *(libre)* | `160000`–`195959`, `230000`+ | reservar al asignar nuevos tracks que escriban SQL |

SQL **idempotente** siempre: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`→`CREATE POLICY`,
`ADD COLUMN IF NOT EXISTS`, RLS explícito. Validar en el **Supabase Preview del PR** (no aplicar a prod a mano).

---

## 4. Orden de ejecución de esta sesión

**Sprint 0 (este documento):** reconciliación + reservas de banda. Docs-only, colisión cero.

**Ola A lanzada en paralelo (worktrees aislados, PRs en DRAFT):**
- **T2** → `claude/t2-notifications-orchestrator`: `notifications_outbox` + `notification_templates` + edge
  `notifications-dispatcher`. Ownership: `supabase/functions/notifications-dispatcher/`, banda T2, lado lectura
  de `useNotifications.ts`. **No toca** `ComunicacionSection.tsx` (N6/T7).
- **T3** → `claude/t3-user-invitations`: tabla `user_invitations` + edge `invite-user`/`accept-invitation` +
  landing `/aceptar-invitacion`. Ownership: `src/components/{auth,onboarding}/`, edge nuevas, banda T3.
  ⚠️ Routing: huella mínima; `App.tsx` es de T7.
- **T5** → `claude/t5-server-rate-limit-hardening`: rate-limit server-side en edge de auth + hardening de
  advisors. Ownership: `supabase/functions/_shared/` + edge de auth + banda T5.

**T7 sigue su goteo** (go-first de la Ola B): A3 → P12 → P13 → N6. Un PR a la vez sobre `App.tsx`/contextos.

**Ola B (detrás de T7):** T4 Facturación · T6 UX · T8 QA continuo.

---

## 5. Reglas anti-colisión vigentes (resumen; detalle en el 06-02 §4)

1. **Archivos compartidos** (`App.tsx`, `useAuth.ts`, `business.ts`, `shared/`, `i18n.tsx`) → propiedad de los
   tracks transversales **T7/T6/T4**. Los tracks de dominio tocan **solo su carpeta** + su `types/<dominio>.ts`.
2. **Migraciones** → banda de horas reservada por track (§3) + SQL idempotente.
3. **T7 nunca en paralelo consigo mismo** → un solo PR a la vez sobre `App.tsx`/contextos (cuello de botella de
   toda la Ola B).
4. **PRs atómicos por hallazgo**, en DRAFT, validados en Supabase Preview + Vercel Preview antes de `main`.

> Re-evaluar al cerrar la Ola A en curso y versionar el siguiente corte como
> `ESTADO_Y_TRACKS_PARALELOS_YYYY-MM-DD.md`.
