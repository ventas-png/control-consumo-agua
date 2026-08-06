# Auditoría integral vs estándares de la industria — 2026-07-10

> Análisis de las 11 dimensiones del SaaS (AdministraTodo) contrastado con OWASP ASVS 5.0,
> SOC 2, WCAG 2.2 AA y el estado del arte de la categoría (ComunidadFeliz, Neivor, TownSq,
> Kiper, AppFolio, Buildium, Yardi). Base: `main@0073e4e`.
>
> **Método:** 73 agentes de análisis/verificación, ~1.586 operaciones de lectura sobre el
> código. Cada brecha de impacto alto/medio se **verificó adversarialmente** por un agente
> independiente instruido a refutarla contra el código real → **46 confirmadas, 13 parciales,
> 0 refutadas**. Este documento no modificó código; es el backlog priorizado.

## Veredicto ejecutivo

La amplitud funcional es de líder de categoría y los cimientos de ingeniería están por encima
del SaaS LATAM promedio. Lo que decide el negocio es lo menos maduro: **la última milla**. El
residente no puede pagar en línea (checkout placeholder), no hay push ni WhatsApp operativos
(stubs "no implementado"), y la operación está documentada pero no cableada (hoy no dispara
ninguna alerta de runtime, nadie monitorea `/health`, cero doc de backups/DR). Hay además 3
riesgos de facturación activos. El motor está construido; faltan los cables que cobran, avisan
y protegen — y varias piezas ya existen escritas, solo sin cablear.

## Scorecard por dimensión

| Dimensión | Nota | Síntesis |
|---|---|---|
| Contabilidad y finanzas | A− | ERP real de partida doble; bordes: fiscal sin PAC real, sin candado de periodos en ledger de empresa. |
| Producto condominios | B+ | Amplitud líder (193 tabs); el residente no puede pagar en línea y no hay push/WhatsApp. |
| Seguridad | B+ | RLS universal + guard en CI, MFA, CSP; faltan cifrado de secretos, MFA exigible, SCA con gate. |
| Producto agua | B+ | Mini-CIS completo; falta campo offline, facturación masiva por ciclo, tarifas escalonadas. |
| Arquitectura | B+ | Domain layer + rutas declarativas + tabs lazy; tipos de BD sin usar, god-component, cero ESLint. |
| Performance | B | Code splitting excepcional; abrir Condominios dispara ~148 queries, casi todo pagina client-side. |
| UX / A11y / i18n | B | Baseline a11y en CI; adopción a medias: i18n 11/414, inputs sin labels programáticos. |
| Testing y CI/CD | B− | Gate duro de dinero/auth; E2E/RLS "verdes no-op", 30/35 edges sin test, migraciones sin gate. |
| SaaS y billing | B− | Pricing por uso sólido; ciclo post-alta roto: cambio de plan duplica sub, sin dunning, MRR erróneo. |
| Comunicación | B− | Outbox de nota A; operativamente bicanal (WhatsApp/push son stubs), sin tracking de entrega. |
| Ops y observabilidad | C+ | SLOs como código y runbooks; 13/14 SLOs sin medir, alertas rotas, sin backups/DR. |

## Fortalezas a proteger (verificadas)

- **ERP financiero de partida doble** — asientos automáticos desde 6 flujos, conciliación difusa, EEFF desde asientos, ledger por proyecto, multimoneda con FX.
- **Aislamiento multi-tenant demostrable** — RLS en 100% de tablas + guard fail-closed contra el catálogo prod + harness de 7 invariantes en CI (ASVS V8).
- **Amplitud condominios 11/11** — cuotas→cobranza judicial, amenidades con reglas testeadas, asambleas con voto ponderado, garita completa, STR, mudanzas, mantenimiento.
- **Dos verticales en una plataforma** — agua (FEL/CFDI en el flujo) + condominios comparten tenant, RBAC por acción, billing y contabilidad.
- **Pipeline de release maduro** — preview→staging→promote con artefacto inmutable y rollback instantáneo.
- **Notificaciones con arquitectura correcta** — outbox transaccional con claim atómico, backoff, preferencias, supresión y plantillas por tenant (el rielado para WhatsApp/push ya está).

---

## P0 — Riesgos activos (corregir ya)

Once hallazgos confirmados que hoy pueden costar dinero, datos o reputación.

| # | Brecha | Dimensión | Esfuerzo | Fix |
|---|---|---|---|---|
| 1 | **"Cambiar plan" crea una SEGUNDA suscripción en Stripe** — siempre `mode:'subscription'`, nunca `subscriptions.update` con prorrateo; la sub vieja queda viva → doble cobro. | billing | medio | Swap con prorrateo sobre la sub existente; checkout solo si no hay `stripe_subscription_id`. |
| 2 | **Pago fallido sin dunning ni degradación** — `payment_failed` solo marca `past_due`; `company_write_enabled` lo trata como habilitado indefinidamente. | billing | medio | Retry Stripe + emails de dunning + banner + degradación a solo-lectura tras N días. |
| 3 | **MRR del superadmin incorrecto** — `mv_superadmin_plataforma` suma `price_monthly_cents` (legacy) e incluye trials $0; el snapshot diario ya acumula serie errónea. | billing | bajo | Recalcular la MV con `monthly_total_cents` por uso; excluir `trialing`. |
| 4 | **Ninguna alerta de runtime funciona** — tags `slo_breach` van como `extra` (no `tags`); 13/14 SLOs sin call site; nadie llama `/health`; `ci-alert` escucha 2/12 workflows. | ops | bajo | `Sentry.withScope+setTags`; cron 5 min a `/health`; ampliar `ci-alert`; instrumentar SLOs de pagos. |
| 5 | **Cero plan de backups/DR** — ninguna mención de PITR/RTO/RPO; migraciones forward-only (el backup es la única red). | ops | bajo | Verificar PITR, documentar retención/RTO/RPO, ejecutar restore drill. |
| 6 | **Ledger sin candado de periodos (empresa) ni años cerrados** — `conta_publicar_asiento` solo valida periodo cuando `project_id IS NOT NULL`. | contabilidad | bajo | Extender `conta_periodo_cerrado` al ledger de empresa; validar contra `cierres_anuales`. |
| 7 | **Secretos de tenant en texto plano** — llaves Stripe/PayPal/PAC en columnas `text`/`jsonb` sin cifrado. | seguridad | medio | Supabase Vault o `pgp_sym_encrypt` con llave fuera de la BD. |
| 8 | **QR de acceso inseguro + fuga de PII** — token `Math.random()` (8 chars) y QR renderizado en `api.qrserver.com` (tercero). | seguridad | medio | `crypto.randomUUID()` + librería QR local + modo escaneo en garita. |
| 9 | **Migraciones se auto-aplican a prod sin gate** — cada push a main aplica SQL directo, sin coordinación con el deploy del frontend. | ci/cd | medio | `environment` con aprobación + paso por staging + disciplina expand/contract. |
| 10 | **MFA no exigible a roles privilegiados** — TOTP opt-in puro; sin `mfa_required` por empresa/rol (ASVS L2 pide MFA exigido). | seguridad | medio | Flag por empresa/rol que bloquee el shell hasta enrolar TOTP. |
| 11 | **Cero enforcement del boundary: no hay ESLint** — la regla "componentes no importan supabase" es convención; ya reaparecieron 3 imports directos. Mayor ROI del informe. | arquitectura | bajo | ESLint con `no-restricted-imports` + `react-hooks` como gate de CI. |

## P1 — Table stakes del mercado que faltan

- **Pago en línea de cuotas del residente** (brecha #1 del producto): `PortalMiCuentaTab` es solo lectura; `StripeCheckoutModal` es un placeholder literal. Habilita comisión por transacción.
- **Web push** sobre la PWA + **WhatsApp por tenant** en el outbox (hoy stubs; el único WhatsApp real usa credenciales globales y no pasa por el outbox). SMS inexistente.
- **Cobranza automatizada de morosidad** — recordatorios pre/post vencimiento (hoy manual con links `wa.me`); convenios sin calendario de cuotas.
- **Captura offline de lecturas** — el lecturista pierde el trabajo sin señal (escritura directa, sin cola local).
- **Facturación masiva por ciclo** — emisión/timbrado/envío son por fila; no hay "cerrar el ciclo del mes".
- **Timbrado fiscal real (FEL/CFDI) + cancelación** — hoy sandbox por defecto; ningún comprobante tiene valor legal.
- **Tarifas de agua escalonadas (N tramos)** — modelo plano sin bloques ni categorías.
- **Portal propietario vs inquilino** — un solo login por unidad, sin cargos diferenciados.
- **Conciliación de payouts agrupados** — matching 1:1; un depósito de Stripe con N pagos no se concilia.
- **Quick wins ya escritos sin cablear:** `SetupWizard` de onboarding (montado solo en dev), `validarLectura()` (detección de anomalías con 12 tests, sin call site), anualidad seedeada e incobrable, suite E2E que no corre en ningún workflow.

## P2 — Ingeniería para escalar

**Datos/performance:** ~148 queries al abrir Condominios (god-component, 145 useState fuera de React Query); paginación server-side casi inexistente (`.range()` solo en auditoría, caps de 5.000 filas que truncan totales); jsPDF estático en ~20 tabs; Sentry+PostHog bloquean el arranque; precache PWA ~7 MB a todo residente; sin performance budgets; `database.types.ts` (18.715 líneas) no se importa en ningún archivo.

**Calidad/confiabilidad:** 30/35 edge functions sin test (incluidos los webhooks de Stripe); E2E/RLS pueden quedar "verdes no-op" y no corren contra el preview del PR; smoke de deploy = GET 200 al index; UI ~9% coverage sin ratchet; Sentry en 3/35 edges; sin lockout por cuenta.

**Cumplimiento/enterprise:** SCA sin gate y sin secret scanning; sin SECURITY.md/canal de divulgación/pentest externo; retención/purga sin aplicar; rate limiting en 10/40 edges; sin status page.

**UX/a11y/i18n:** 1.245 inputs con solo 23 `id`/82 `htmlFor`; contraste AA sin validar end-to-end; 31 modales ad-hoc sin semántica de diálogo; i18n en 11/414 componentes y 341 `toFixed(2)` con moneda a mano.

## P3 — Diferenciadores (hacia dónde va la categoría, research 2025-2026)

- **Fintech embebida:** domiciliación/autopay, referencia única por unidad (CLABE/boleta) con conciliación automática, seguros embebidos.
- **IA aplicada:** predicción de morosidad 30-60 días antes, cobranza asistida por WhatsApp, asistente conversacional transversal (AppFolio Realm-X marca la tendencia).
- **Operación física:** escaneo QR en garita → LPR/porterías remotas; IoT/AMI en agua (fuga nocturna, medidor parado); e-firma con evidencia.
- **Comunidad y enterprise:** feed social + marketplace; SCIM + export de audit logs a SIEM + SLA con status page + DPA en flujo de venta (SSO SAML ya existe); multi-comunidad consolidado para administradoras.

## Contraste con estándares técnicos

| Estándar / control | Estado | Detalle |
|---|---|---|
| ASVS V8 · Autorización multi-tenant | ✅ cumple | RLS universal + guard fail-closed + harness en CI. |
| ASVS V6 · Autenticación L2 | 🟡 parcial | TOTP + step-up AAL2 ✓; falta MFA exigible y lockout por cuenta. |
| ASVS · Protección de datos | 🔴 falta | Secretos de tenant sin cifrar; retención sin aplicar. |
| SOC 2 · CC6 acceso lógico | 🟡 parcial | RBAC por acción + audit append-only ✓; MFA opcional. |
| SOC 2 · CC7 operaciones | 🔴 falta | Monitoreo/alertas no operativos; sin pentest externo. |
| SOC 2 · Availability | 🔴 falta | Sin backups/DR, sin uptime monitoring ni status page. |
| WCAG 2.2 AA | 🟡 parcial | axe en CI + Radix + dark mode ✓; labels, contraste e2e y target-size pendientes. |
| Enterprise · SSO SAML | ✅ cumple | SAML por dominio con runbook. |
| Enterprise · SCIM / SLA / status | 🔴 falta | Sin SCIM; SLA sin fuente de uptime; sin status page. |
| Supabase RLS · performance | ✅ cumple | initPlan wrapping, políticas consolidadas, índices sobre columnas de política. |

## Roadmap recomendado

1. **0–30 días — cerrar riesgos activos (P0):** fixes de billing (#1–3), operación mínima viable (#4–5), integridad contable + QR (#6, #8), prevención (#9, #11), MFA exigible + cifrado (#7, #10), quick wins de producto.
2. **1–3 meses — última milla del residente (P1):** pago en línea, web push + WhatsApp, cobranza automática, captura offline, facturación masiva.
3. **3–6 meses — escala y confianza:** timbrado fiscal real, payouts agrupados, Condominios por tab + paginación server-side, tests de webhooks, E2E contra preview.
4. **6–12 meses — diferenciación (P3):** fintech, IA de morosidad, IoT/AMI, comunidad social, camino a SOC 2.

## Límites de la auditoría

23 brechas de impacto medio y 4 bajas quedaron sin verificación adversarial (se incorporaron
solo las consistentes con hallazgos verificados). 1 verificación falló por límite de cómputo
(validación de solape de reservas server-side — hipótesis: hoy el chequeo es client-side).
Este informe no sustituye un pentest ni una auditoría SOC 2 formal.
