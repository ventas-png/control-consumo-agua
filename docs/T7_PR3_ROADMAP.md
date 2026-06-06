# T7 · PR3 — Migración a `domain/` (estado + backlog)

> **Objetivo de PR3 (track T7):** que **ningún componente importe `supabase` directo**;
> todo el acceso a datos vive en `src/domain/<módulo>/`. **Incremental, un PR atómico
> por módulo/lote, sin migraciones (solo front).**
>
> **Métrica:** componentes que importan `lib/supabase`: **190 → 43** (tras los lotes
> `auth/`, `empresa` RBAC/usuarios, `empresa` pagos y `empresa` correo). Restan **34** tabs
> "complejos" + **9** sueltos fuera de condominios.
>
> `grep -rlE "from '.*lib/supabase'" src/components | wc -l`  → debe ir a 0.

## ✅ Hecho

**Primera tanda (sesión previa):** `mapa` #440 · `tarifas` #441 · `rutas` #445 ·
`lecturas` #446 · `calidad` #447 · `contadores` #448 · `unidades` #449.

**Módulos chicos:** `cobros` #451 · `clientes` #452 · `admin-dashboard` #453 ·
`onboarding` #454 · `superadmin` #455 · `shared` #456 · `portal` #457.

**Condominios:**
- raíz — `Dashboard` + `ImportEmergenciasModal` #458; **`CondominiosSection`** (loader de ~141 tablas → `domain/condominios/sectionData.ts`) #459.
- `tabs/` CRUD **simple** — lotes #460 (15), #461 (27), #462 (20), #463 (18), #464 (15), #465 (16) = **111 tabs**.

**Auth (fuera de condominios):** `auth/` — `RegisterScreen`, `PasswordResetModal`,
`SignupCompanyScreen`, `OAuthOnboardingScreen`, `PasswordResetPage` → `domain/auth/account.ts`
(edge functions de alta + reset/updateUser/getSession/signOut).

**Empresa RBAC/usuarios:** `RolPermisosModal`, `CustomRoleEditor`, `AsignacionModal`,
`EmpresaUsuariosSection` → `domain/empresa/roles.ts` (roles/permissions/role_permissions/
user_roles) + `domain/empresa/usuarios.ts` (app_users.activo, user_project_assignments,
edges create-user/delete-user).

**Empresa pagos:** `StripePayPalConfig`, `PayfacConfigSection` → `domain/cobros/paymentConfig.ts`
(columnas Stripe/PayPal de `companies`, edges save-payment-config/test-stripe, override
`projects.proveedor_pago`).

**Empresa correo:** `GoogleEmailConfig` → `domain/comunicacion/emailConfig.ts`
(`company_email_configs`/`email_templates`/`email_send_log` con scope superadmin/empresa,
edges google-oauth-initiate/send-email).

**Helpers de dominio reutilizables** (úsalos en vez de re-crear):
- `domain/usuarios/queries`: `fetchActiveAppUsers()`, `fetchAppUserNamesByIds(ids)`.
- `domain/contadores/queries.resolveDefaultProjectCompany(userId, fallbackCompanyId)`.
- `domain/unidades/queries.resolveUnidadProjectCompany(userId, formProjectId, fallbackCompanyId)` · `checkUnidadesLimit(companyId)`.
- `domain/clientes/mutations.updateCliente(id, payload)` · `domain/agua/mutations.{createRegistro,updateRegistro,marcarRegistrosMora,uploadRegistroFoto}`.
- `domain/cobros/mutations.{createPago,uploadComprobantePago,…}`.
- `domain/auth/account`: `createClienteAccount` · `signupCompany` · `completeOAuthOnboarding` · `requestPasswordReset` · `updatePassword` · `hasActiveSession` · `signOut` · `signOutGlobal`.
- `domain/empresa/roles`: CRUD de roles/permisos RBAC (`fetchCompanyRoles`, `fetch*RolePermission*`, `insertUserRoles`, `createRole`, …). `domain/empresa/usuarios`: `setUsuarioActivo` · `*UserProjectAssignments` · `createCompanyUser` · `deleteCompanyUser`.
- **`domain/condominios/tabMutations`** — CRUD genérico de los tabs (ver abajo).

---

## Recetario (patrón probado)

1. `git fetch origin && git reset --hard origin/main`; **creá la rama ANTES de commitear** (`git checkout -b t7-pr3-<lote>`).
2. Por cada tabla/RPC del componente, creá/extendé `src/domain/<módulo>/`:
   - **lecturas** → `queries.ts`: `fetch…()` con el `select` (+ parse defensivo `schemas.ts` cuando aplique).
   - **escrituras** → `mutations.ts`: `create/update/delete…()`. El **armado del payload se queda en la UI**; solo baja el acceso a datos.
   - **storage** → wrappers `upload…/remove…/get…SignedUrl` (ver `domain/calidad`, `domain/shared/storage`, `domain/cobros.uploadComprobantePago`).
3. En el componente: importá esas funciones y **borrá `import { supabase }`**.
   Ojo `error.message`→`error` cuando el dominio mapea a `string` (la mayoría); en
   `domain/condominios/tabMutations` el error va con shape `{ message }` a propósito.
4. **Tests** de lo **puro** (parse / contrato `{ error }`).
5. **Verificá:** `grep` sin `supabase`, `npx tsc --noEmit` limpio, `npm run build` OK, tests del módulo verdes. (La suite completa local da **ruido de entorno** por `node_modules` de worktree — la señal autoritativa es el **CI del PR**.)
6. **PR atómico** draft → CI verde → squash-merge. **Sin migraciones.**

**Convenciones:** `lib/supabase` no está tipado con `Database` → payloads como `Record<string, unknown>`. Si la tabla ya tiene dominio (`registros`→`agua`, `companies`→`empresa`, `clientes`→`clientes`), **extendé** ese dominio.

---

## ⬜ Backlog restante (50 archivos)

### A) `condominios/tabs` "complejos" — 34 tabs

Los tabs **simples** (CRUD por id, datos por props) ya están migrados con los 3 helpers
genéricos de **`domain/condominios/tabMutations`** (`createCondominioRow` (+`Returning`),
`updateCondominioRow(table,id,patch)`, `deleteCondominioRow(table,id)`).

Estos 34 son **bespoke** porque hacen además: `select` (leen su propia data, no solo
props), `upsert`, `.eq()` sobre columna **no-id**, `.in(...)`, `storage` o `rpc`. Cada uno
necesita **funciones de dominio específicas** en `domain/condominios/` (queries para los
`select`, y mutations para upsert/`.in`/storage/rpc). Agrupá por sub-feature en lotes:

| Sub-feature (lote sugerido) | Tabs |
|---|---|
| Cuotas/cobranza | `CuotasTab`, `GeneracionCuotasTab`, `GeneradorCuotasTab`, `PlanPagoCondTab`, `CierreAnualTab`, `HistorialSaldosTab`, `InformeMensualTab`, `ConciliacionCobrosTab`, `SolicitudesRentaTab` |
| Asambleas/votaciones | `AsambleasTab`, `PortalAsambleasTab`, `VotacionesTab`, `EncuestasTab` |
| Amenidades/reservas | `AmenidadesTab`, `PortalReservasTab`, `EventosComunidadTab` |
| Seguridad/rondas | `SeguridadTab`, `RutasRondaTab`, `VisitantesTab`, `EstacionamientoVisitaTab` |
| Paquetería/storage | `PaqueteriaTab`, `PaqueteriaSalientesTab`, `PortalPaquetesTab` (rpc+storage), `PortalMudanzaTab` (storage) |
| Rentas/STR | `STRTab`, `PortalRentasTab`, `SolicitudesMudanzaTab` |
| Mantenimiento/otros | `MantenimientoPrevTab`, `AutomatizacionesTab`, `TareasPersonalTab` |
| Portal read-only | `DirectorioTab`, `MultiCondominioTab`, `PortalResidenteTab`, `PortalTransparenciaTab` |

> Para los `select` de estos tabs: si leen datos que **CondominiosSection ya carga**, evaluá
> pasarlos por props; si son lecturas propias (filtros distintos), creá `fetch…()` en
> `domain/condominios/queries.ts` (o un `tabQueries.ts`).

### B) Fuera de condominios — 9 archivos

`auth/` (5) ✅, `empresa` RBAC/usuarios (4) ✅, `empresa` pagos (2) ✅ y `empresa` correo
(1) ✅ hechos. Resta **`empresa`** residual (`SavedReportsModal`, `AuditLogModal`,
`FinancialAuditModal`, `PapeleraModal`, `EmpresaProyectosSection`, `EmpresaHeaderCard`) +
sueltos (`perfil/PerfilSection`, `tarifas/FiscalConfigSection`, `historial/HistorialSection`).
`grep -rlE "from '.*lib/supabase'" src/components | grep -v '/condominios/'`.

---

### Prompt de continuación (pegable)
```
Repo control-consumo-agua, branch desde main (creala ANTES de commitear). Track T7/PR3.
Seguí el Recetario de docs/T7_PR3_ROADMAP.md. Tomá UN lote del backlog (un sub-feature de
condominios/tabs "complejos", o los sueltos de empresa). Para cada tab/comp: bajá los
select→domain/condominios/queries, y upsert/.in/storage/rpc→domain/condominios (mutations),
reusando tabMutations para el CRUD simple por id. Borrá `import supabase`. DoD: sin
`import supabase` en los archivos del lote, tsc --noEmit limpio, vite build OK, test de
contrato del dominio nuevo, PR atómico draft→CI verde→squash-merge. Sin migraciones.
Repetí hasta que `grep -rlE "from '.*lib/supabase'" src/components | wc -l` quede en 0.
```
