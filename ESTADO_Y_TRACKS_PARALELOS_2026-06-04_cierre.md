# Estado consolidado + Tracks paralelos — corte de cierre 2026-06-04

**Base:** `main` (hasta PR #399). **Supersede** (para *estado vivo*) a los cortes previos
`ESTADO_Y_TRACKS_PARALELOS_2026-06-02.md` y `…_2026-06-04.md`.
**Propósito:** dejar a una sesión nueva listo el contexto — qué se entregó, qué falta, las
convenciones/lecciones, la recomendación de siguiente paso y un prompt de arranque.

---

## 1. Entregado esta sesión (todo en `main`)

| Área | PRs | Qué quedó |
|---|---|---|
| Sprint 0 / CI | #376, #384 | tracker + reserva de bandas de migración · `deno-check` advisory saneado (apunta a helpers puros) |
| **T5 Infra/Seguridad** | #377, **#380** | rate-limit server-side en edge de auth + hardening de advisors · **hotfix:** cerró RPCs del orquestador accesibles por `anon` |
| **T2 Comunicación** | #378 | orquestador `notifications_outbox` + dispatcher + `notification_templates` (N2-N4) |
| **T3 Plataforma** | #379 | invitaciones de usuario + landing `/aceptar-invitacion` (P3) |
| **T7 Capa de datos** | #381 | `EmpresaSection` 1259→112 LOC (P12) + `domain/empresa` |
| **T8 QA** | #382 | tests de edge functions (I22, lote 1: dispatcher/invite/accept/rate-limit) |
| **T4 Facturación AGUA** | #383, #385, #386 | agregado Factura (estados/IVA/mora) sobre `registros` + cron de mora + UI de cobros |
| **Fiscal FEL/CFDI** (serv:S11) | #387, #388, #389, #390 | núcleo provider-agnostic + UI timbrado (estatus/Timbrar/receptor) + config fiscal por locación + bóveda `fiscal_pac_secrets` + selector de PAC/conexión — **todo contra Sandbox** |
| **T6 UX** | #392, #393, #395, #397 | switcher multi-condominio + banner (B5/B6) · breadcrumbs (B11) · DataTable lote 1 (5 tabs) · i18n lote 1 (5 tabs) |
| **T4 Facturación CONDOMINIOS** | #398, #399 | agregado cuota (estados/mora) sobre `cuotas_condominio` + cron + UI (cobros/recargos); `RecargosTab` ahora usa `calcularMoraCuota` |
| **Parkeado** | issue **#391** | adapter REAL del PAC (bloqueado por decisión de proveedor) |

> Facturación **agua y condominios completas end-to-end**. Fiscal FEL/CFDI listo para "seleccionar PAC y conectar" contra Sandbox; falta solo el adapter real (#391).

---

## 2. Pendiente por track

- **T1 Servicios:** S3-S5 (refactor ServiciosEnergia), S7 tramos, S8 GPS/foto, S9 RLS colector, S10 tests, S23 tipologías a DB, S24, S28, S29.
- **T2 Comunicación:** N5 create-broadcast, N6 refactor god-section, tracking entrega/lectura/bounce, N7 segmentación, N8 programación, N12 KPIs, N13-N29.
- **T3 Plataforma:** P9 sesiones activas (UI) · P10 SSO/SAML · P11 notif. de seguridad · **P33-35 TOS/DPA/GDPR** · P18 locale/tz/currency · P19 perfil · P20/P28 branding/white-label · P14 superadmin paginación.
- **T5 Infra:** **I16 staging/prod · I19/I20 canary/rollback** · I13 validación server-side de uploads · I15 inventario secretos · I17 runbook · I18 alertas · I21 Vault/KMS · I24 CSP unsafe-inline · I31 SRI · I22 más tests de edge.
- **T6 UX:** lotes restantes de **DataTable** (~16 card-lists + patrón master-detail) e **i18n** (resto de tabs + labels del `tabRegistry`) · `cond:B4` responsive residual.
- **T7 Capa de datos:** **P13 `useAuth` (713 L)** · A2/A3 god-components restantes (`App.tsx`) · cond:A2/A4/A6.
- **T8 QA:** **cond:C3 (tests dominio condominios) y plat:P15 (auth/RBAC/RLS) — aún ~0** · paginación/virtualización (agua:D2, cond:D1) · vistas materializadas (com:N12) · **E2E Playwright** · axe enforce.
- **Fiscal:** adapter real del PAC (#391) + backfill `estado→cuota_estado` / `estado→factura_estado`.

---

## 3. Lecciones y convenciones OBLIGATORIAS (para no repetir)

1. **Seguridad Supabase (crítico):** toda función `SECURITY DEFINER` →
   `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated` **por nombre de rol** +
   `GRANT EXECUTE ... TO service_role`. Revocar solo `PUBLIC` **NO basta** (en Supabase, `anon`
   y `authenticated` reciben EXECUTE por *default privileges*). Se descubrió por una regresión real
   (#378 dejó 4 RPCs accesibles por `anon`; corregido en #380).
2. **Secretos:** tabla **deny-all, service-role-only** (patrón `company_payment_secrets` /
   `fiscal_pac_secrets`); el secreto **nunca** se proyecta al cliente — solo metadata/flags vía RPC
   `SECURITY DEFINER` acotada a admin/owner. Escritura solo vía edge function.
3. **Migraciones:** una **banda de timestamp por track/día** (`YYYYMMDDHHMMSS`) para no chocar
   `schema_migrations_pkey` con trabajo en paralelo. SQL idempotente (`IF NOT EXISTS`,
   `DROP POLICY/CONSTRAINT IF EXISTS`). **NO** `apply_migration` a prod — validar en el Supabase
   Preview del PR.
4. **Frontera Deno/Vite:** las edge functions no importan `src/`. La lógica pura compartida se
   **espeja** en `supabase/functions/_shared/` (p.ej. el cron de mora espejó `calcularMora`).
5. **Capa de datos:** seguir `src/domain/README.md` (TanStack Query: `keys`/`queries`/`mutations`
   por dominio; mutaciones invalidan keys).
6. **Agentes en paralelo:** solo con **ownership de archivos DISJUNTO**; PRs **atómicos en draft**;
   archivos compartidos (`App.tsx`, `useAuth.ts`, `business.ts`) son de los tracks transversales.
7. **Agentes pueden morir en silencio** (uno murió a los ~7 min sin pushear ni notificar). Mitigación:
   instruir **push temprano** + vigilar con un **guard** (watch de rama / timer) y **relanzar** si muere.

---

## 4. Recomendación de siguiente paso

1. **(Decisión del dueño) Elegir PAC** — GT: Infile / Guatefacturas / Megaprint · MX: Facturama /
   Finkok / SW sapién (+ credenciales de sandbox). Desbloquea el **adapter real (#391)** = timbrar de
   verdad, el mayor diferenciador para vender en GT/MX. UI/bóveda/selector **ya listos**.
2. **T8 — cobertura de tests** de dominio condominios (cond:C3) y auth/RBAC/RLS (plat:P15): hoy ~0, y
   esta sesión metió mucho billing/fiscal. De-risk antes de apilar más features.
3. **T3 — GDPR/enterprise:** sesiones (P9) + notif. seguridad (P11) + TOS/DPA/export (P33-35).

Orden sugerido: **(1) PAC → adapter** · **(2) T8 tests** · **(3) T3 GDPR**. T8 y T3 son disjuntos y
paralelizables; el adapter del PAC depende de la decisión del dueño.

---

## 5. Prompt de arranque para una sesión nueva

```
Repo: ventas-png/control-consumo-agua (SaaS multi-tenant agua/condominios, GT/MX; React/TS + Vite + Supabase + edge Deno + TanStack Query).

ORIÉNTATE PRIMERO:
1. git fetch origin main → trabaja desde ahí (sesión previa: ~20 PRs mergeados hasta #399).
2. Lee ESTADO_Y_TRACKS_PARALELOS_2026-06-04_cierre.md + revisa (GitHub MCP) las épicas #300–#307 y el issue #391 (adapter PAC, parkeado).
3. Lee src/domain/README.md (convenciones de la capa de datos).

QUÉ HACER:
- (Si ya se eligió PAC) integrar el adapter real en supabase/functions/_shared/fiscal/ (#391): mapeo DTE canónico→formato del PAC + HTTP + leer credenciales de fiscal_pac_secrets; el caller timbrar-documento NO cambia.
- En paralelo: T8 — tests dominio condominios (cond:C3) + auth/RBAC/RLS (plat:P15); y/o T3 — sesiones (P9) + notif. seguridad (P11) + GDPR/TOS/DPA (P33-35).

CONVENCIONES OBLIGATORIAS:
- Agentes en worktrees SOLO con ownership de archivos DISJUNTO; PRs atómicos en DRAFT; nunca mergear tú.
- Migraciones: BANDA de timestamp por track/día (YYYYMMDDHHMMSS) anti schema_migrations_pkey; SQL idempotente; NO apply_migration a prod (validar en Supabase Preview del PR).
- SEGURIDAD: toda función SECURITY DEFINER → REVOKE EXECUTE FROM PUBLIC, anon, authenticated POR NOMBRE + GRANT service_role (revocar solo PUBLIC NO basta). Secretos en tabla deny-all service-role-only; nunca al cliente.
- Edge (Deno) no importa src/: espeja la lógica pura.
- Pide a cada agente COMMIT/PUSH TEMPRANO; vigílalos con un guard (watch de rama o timer) y relánzalos si mueren.
- Cada PR: tsc --noEmit limpio + suite de tests verde.
```

---

## Adenda 2026-06-05 — Cierre de Track T3 (Plataforma, épica #302)

**T3 cerrable.** El único pendiente era SSO/SAML (P10). Se construyó **todo el andamiaje
app-level** y se **parqueó solo el handshake real** (depende de habilitar SSO a nivel proyecto
Supabase), igual que el adapter PAC en #391.

| PR | Qué quedó |
|---|---|
| **#428** (PR1) | Modelo de datos + lookup seguro: `company_sso_domains` (`domain citext` UNIQUE global; **gate `enforced ⇒ verified`** por CHECK → sin secuestro cross-tenant; RLS owner/admin de su empresa; anon/otros tenants = 0 filas) + RPC **anon-callable** `sso_lookup_domain` (descubrimiento PRE-login, salida mínima, nunca filtra identidad) + `src/domain/sso/*` + tests. Banda T3 `20260606130000`. |
| **#429** (PR2) | Edge `sso-admin` (deriva `company_id` de la sesión, exige owner/admin, gestiona solo su empresa; intenta registrar el proveedor SAML vía GoTrue Admin SSO API y, si SSO no está habilitado, **persiste la config y responde "parqueado"**). Lógica pura espejada en `_shared/sso.ts` + tests (I22). Columna `idp_metadata`, feature flag `enterprise_sso`, UI `SsoConfigSection` (gated) en `EmpresaSection`. Banda `20260606131000`. |
| **#430** (PR3) | Detección de SSO en `LoginScreen` (ofrece "Continuar con SSO"; oculta password si el dominio está `enforced`; **fallback graceful** a password si SSO falla) + `src/lib/sso.ts` (wrapper `signInWithSSO` + detección pura testeada). |

**Parqueo de P10:** issue **#430** (estilo #391) — enumera los pasos de habilitación: plan Pro,
`GOTRUE_SAML_ENABLED`, clave de firma SAML, registro de proveedor por IdP, verificación de dominio
automática. El login normal **nunca se rompe** sin SSO habilitado.

**Definición de hecho (cumplida):**
- Un owner/admin registra metadata IdP + dominio(s) de su empresa (persistido); el proveedor se
  sincroniza cuando SSO esté habilitado, y si no, responde "parqueado" sin romper nada.
- No se puede asociar/forzar un dominio sin verificar propiedad (sin secuestro cross-tenant).
- `LoginScreen` detecta dominios SSO y ofrece/forza SSO; sin SSO habilitado, login = password.
- Issue de parqueo de P10 (#430) abierto + épica #302 actualizada + esta nota de cierre.

> Nota CI: por el límite de **preview branches concurrentes** de Supabase, los PRs apilados pueden
> no levantar su propio preview simultáneamente; cada migración se valida en preview al liberarse un
> slot (p. ej. al mergear el PR previo de la pila).
