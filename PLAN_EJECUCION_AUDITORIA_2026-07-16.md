# Plan de ejecución — auditoría 2026-07-16, agrupado por áreas y PRs

**Base:** `AUDITORIA_LOGICA_SAAS_2026-07-16.md` · Los IDs (C1, S2, D1, V1, O1…) refieren a los
hallazgos de ese informe.

**Reglas del plan:**
- Cada PR es pequeño, mergeable solo, con tests, y cierra hallazgos identificables.
- Se reutilizan patrones que ya existen en el repo (se cita cuál en cada PR) — casi nada es
  arquitectura nueva.
- El Track 0 no son PRs: son acciones de operador (dashboard/secrets/config). Son las de mayor
  ROI del plan y desbloquean varios PRs.

---

## Track 0 · Acciones de operador (sin código — hacer esta semana)

| # | Acción | Cierra | Dónde |
|---|---|---|---|
| OP-1 | Generar `TENANT_SECRETS_ENC_KEY`, setearla en secrets de Edge Functions, redeploy, correr `backfill-tenant-secrets` (dry-run → por tabla) | **S1** (secretos en texto plano) | `docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md` |
| OP-2 | Verificar plan/PITR en Supabase, llenar el registro del runbook, agendar primer restore drill | **D9/P0#5** (backups sin verificar) | `docs/RUNBOOK_BACKUP_DR.md` |
| OP-3 | Configurar *required reviewers* en el environment `production-db` y restringir los secrets `SUPABASE_*` a ese environment | **P0#9** (gate de migraciones no bloquea) | GitHub Settings → Environments |
| OP-4 | Crear los 2 secrets del vault (`edge_function_url`, `service_role_key`) para activar reportes programados | **V5** (activación) | `docs/SAVED_REPORTS_SCHEDULE.md` |
| OP-5 | Configurar `E2E_BASE_URL` (staging) + cuentas de prueba para que la suite E2E corra en main | **F7** | `.github/workflows/coverage.yml` |
| OP-6 | Confirmar `SLACK_WEBHOOK_URL` en ci-alert para que las alertas lleguen | **P0#4** (residual) | `.github/workflows/ci-alert.yml` |

---

## Track A · Riesgos comerciales activos (P0 — semana 1)

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **A1** | `fix(pagos): no ofrecer pago en línea con proveedor sandbox salvo demo explícito` | En `CustomerPaymentsTab`/`PagoEnLineaModal`: si el proveedor efectivo es `sandbox`, ocultar el botón salvo flag de demo del tenant; en `confirm-charge`, marcar `pagos.metodo='sandbox'` cuando aplique y excluirlos de conciliación/EEFF. Tests de handler (patrón #604 ya existe). | **C1** | bajo |
| **A2** | `fix(billing): UpgradeCTA maneja swapped + instrumentación del funnel de dinero` | Manejar `{swapped:true}` en `UpgradeCTA.tsx` (toast de éxito + `refresh()` de feature flags, espejo de lo que ya hace `PerfilSection`); añadir eventos FUNNEL `checkout_started/upgrade_completed/trial_converted` en los call sites. | **C2, C11** | bajo |
| **A3** | `feat(pagos): cron de reconciliación de payment_requests pendientes` | Migración pg_cron (cada 15 min) que invoque `confirm-charge` para `pending` con `provider_ref` > N min (la idempotencia ya está resuelta; patrón de cron→edge ya existe en `email_send_queue`). | **C3** | bajo |
| **A4** | `fix(dashboard-agua): KPI de mes actual no debe mezclar años ni desplazar por TZ` | Comparar año en el filtro de `DashboardSection`; helper date-only local-safe compartido (lo reutilizan D5 y C2-viz después). Test unitario con histórico multi-año. | **D2** | bajo |
| **A5** | `fix(rbac): gate de vista en deep-links de condominios y módulo /energia` | Check de vista antes del render del tab activo (`CondominiosSection.tsx:854` → `<AccessDenied/>`) y `module: 'servicios_energia'` en las 2 rutas de energía (el guard genérico ya existe). | **F2, F3** | trivial |

---

## Track B · Seguridad (semanas 1–3)

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **B1** | `feat(auth): enforcement server-side de MFA exigible (aal2 en RLS)` | Helper RLS que exija `(auth.jwt()->>'aal')='aal2'` cuando la company tenga `mfa_required` + política RESTRICTIVE en las tablas núcleo (patrón documentado por Supabase). Casos en el harness RLS. | **S2** | medio |
| **B2** | `sec(edges): rate limit en el camino de dinero + comparación constante de secretos` | `enforceRateLimit` en `create-charge`, `confirm-charge`, `create-payment-intent`, `timbrar-documento` (~10 líneas c/u, helper existente); barrido `===` → `timingSafeEqualSecret` en las 7+ edges. | **S6, S7** | bajo |
| **B3** | `feat(whatsapp): cifrado del token + edges de configuración + UI` | `company_whatsapp_configs` en `TEXT_TABLES` del backfill (1 línea); edges `whatsapp-save-credentials`/`whatsapp-test-connection` (plantilla: `payfac-save-credentials`); tarjeta de configuración usando el RPC `whatsapp_estatus`. | **S4**, delta#9 | bajo-medio |
| **B4** | `test(rls): harness al día con las tablas de julio` | `company_email_configs` y `company_whatsapp_configs` en `SECRET_TABLES`; invariantes de tenant para `payment_requests`, `unidad_residentes`, `cuota_recordatorios_log`; caso para los RPCs `*_estatus` (guard trivaluado). | **S5** | bajo |
| **B5** | `fix(paquetes): código de retiro criptográfico + QR local` | Reusar `generarToken()` de garita y `QRCodeSVG` en `paquetes.ts` (además hoy la CSP rompe la imagen de qrserver — esto también es un bugfix visual). | **S3** | bajo |
| **B6** | `chore(sec): SECURITY.md + secret scanning + Dependabot + zod en edges de dinero` | Config de GitHub + SECURITY.md; esquemas zod para los bodies de `create-charge`/`confirm-charge` (ya tienen tests que lo facilitan). | **S11, S9** | bajo |

---

## Track C · Infraestructura analítica (semanas 2–5) — la apuesta central

> Orden estricto: C1 es la fundación; C2–C5 se montan encima.

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **C1** | `feat(analitica): MV kpis_tenant_mensual + RPCs de agregación` | MV (o tabla agregada por cron) con grano (company, project, mes): emitido, cobrado, tasa cobranza, mora, consumo m³, gastos, tickets. Refresh 15 min (cron ya existe para las MVs del superadmin — mismo patrón), acceso por RPC con RLS de tenant. RPCs puntuales para KPIs no mensuales. | **D1 (núcleo), V2** | medio |
| **C2** | `refactor(dashboards): re-basar los 3 dashboards de tenant sobre la MV + colores correctos` | `DashboardSection`, `AdminDashboardCharts` y el chart del portal leen de C1 (adiós arrays de 5.000); helper `resolveChartColor()` con `getComputedStyle` (patrón de `Sparkline.tsx:70`); estados vacíos/carga y `aria-label` (patrón del superadmin); dona de estados con modo monto/conteo. | **V1, V3 (parte), V8** | medio |
| **C3** | `feat(datos): paginación server-side y exports sin truncar` | `.range()` + count exact en los listados grandes (registros, cuotas, visitantes) con `keepPreviousData`; exports que refetchean por chunks server-side en vez de volcar el array en memoria. | **D1 (resto), F10** | medio |
| **C4** | `feat(reportes): whitelist ampliada + XLSX programado` | `registros`, `pagos` (ya está), `asientos` en la whitelist de `report_templates`; formato XLSX en el run programado; (la activación es OP-4). | **V5** | bajo |
| **C5** | `feat(portal): consumo comparado del residente + proyección de recibo` | En el chart del portal: tu consumo vs mediana anónima de la comunidad (RPC sobre C1) y vs mismo mes del año anterior; proyección del próximo recibo con `calcularCostoTarifa` (ya existe). | **V6, O5** | bajo-medio |

---

## Track D · Analítica de negocio — features estrella (mes 2–3)

> Cada una es un release comunicable al cliente. Orden por (valor × datos listos ÷ esfuerzo).

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **D1** | `feat(presupuesto): presupuesto vs real visual + proyección de cierre` | Gráfico comparativo mensual por categoría con desviaciones y proyección fin de año. El RPC `presupuesto_vs_real` **ya existe** — es solo la vista. | **O3, V4 (parte)** | bajo |
| **D2** | `feat(cobranza): aging de cartera + score de riesgo de morosidad` | RPC de aging (0-30/31-60/61-90/90+) por unidad/cliente; vista en Cobros/Cuotas con tendencia; score determinista (retraso promedio, reincidencia, monto) que prioriza el cron de recordatorios existente. | **O2, V4 (parte)** | medio |
| **D3** | `feat(agua): alertas de anomalías de consumo (fugas y medidores parados)` | Job pg_cron retrospectivo: consumo > Nσ del histórico del medidor → alerta de fuga; N ciclos en cero → medidor parado. Tabla de alertas + tarjeta en dashboard + aviso opcional al residente por el outbox (canales listos). La lógica de umbral puede partir de `validarLectura`. *Candidata a feature premium.* | **O1** | medio |
| **D4** | `feat(portafolio): benchmarking multi-condominio del tenant` | Comparativo entre proyectos del mismo tenant (cobranza, mora/unidad, gasto/unidad, tickets, m³/unidad) sobre la MV de C1. Fase 2 (posterior): benchmark anónimo entre tenants como feature premium. | **O4** | medio |

---

## Track E · Integridad de datos (intercalar en semanas 2–6)

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **E1** | `fix(datos): llaves naturales UNIQUE anti-duplicado en registros y cuotas` | Índices únicos parciales (`WHERE deleted_at IS NULL`) + inserts a `ON CONFLICT DO NOTHING` reportando omitidas (cierra la carrera del sync offline). | **D4** | bajo |
| **E2** | `fix(datos): soft delete consistente en registros` | `registros` en `SoftDeletableTable`, `deleteRegistro` → `softDelete()`, `.is('deleted_at', null)` en los 21 SELECT consumidores. | **D3** | bajo |
| **E3** | `feat(datos): retención y purga programada` | Política por tabla (audit_log 18m, notification_events 6m, email_send_queue 3m, soft-deleted N días) + cron mensual de purga. | **D8, S10** | bajo-medio |
| **E4** | `fix(ciclos): cortes de período en la zona horaria del tenant` | Parametrizar los RPCs de cierre con `AT TIME ZONE` del tenant y derivar defaults de período en hora local (usa el helper de A4). | **D5** | medio |
| **E5** | `chore(datos): CHECKs en columnas estado desnudas + backfill factura_estado` | Endurecer los estados sin ENUM/CHECK; completar la migración de la doble máquina de estados de registros. | **D6** | bajo |

---

## Track F · Comercial y funcional de fondo (mes 2 en adelante)

| PR | Título sugerido | Contenido | Cierra | Esfuerzo |
|---|---|---|---|---|
| **F1** | `fix(billing): picker con precio real por uso + retirar botón Anual` | Total proyectado con el uso del tenant (`calculate_monthly_total_cents` existe) o "desde $X"; ocultar Anual hasta que existan los prices yearly. | **C5, C7 (corto)** | bajo |
| **F2** | `feat(billing): MRR cobrable vs potencial + plan trial según signup` | Separar grandfathered en la MV del superadmin; asignar plan trial según los flags del signup. | **C6, C12** | bajo |
| **F3** | `feat(ciclos): cierre de ciclo automático programable por proyecto` | Config "cerrar el día D" que invoque los RPCs existentes desde pg_cron + aviso del resultado. Al tocar esto, extraer el flujo UI compartido de cierre a `shared/` (de paso ataca F4-espejo). | **F6, F4 (parte)** | medio |
| **F4** | `feat(agua): recordatorios de cobranza pre/post vencimiento` | Extender `enqueue_recordatorios` al modelo de `registros` reutilizando cron y plantillas de condominios. | **F5** | medio |
| **F5…Fn** | `refactor(condominios): tab X a tabQueries` (serie) | Descomposición tab-por-tab del god-component (patrón probado en 18 tabs); cada PR migra 3-5 tabs y elimina su colección del contexto. Al terminar, retirar el batch de ~143 queries. | **F1-aud, D7** | serie mecánica |
| **F6…Fn** | `feat(tipos): dominio X al cliente tipado db` (serie) | Continuar por módulo priorizando contabilidad/bancos/cxp. | **F8** | serie mecánica |
| **F7** | `feat(billing): comisión transaccional` | Stripe → Connect destination charges + `application_fee`; QPayPro → `fee_cents` por pago facturable al tenant. *Decisión de negocio previa: % o monto fijo.* | **C4** | medio-alto |
| **F8** | `feat(fiscal): habilitar transporte Ainnova + contador de timbres` | Al cerrar el contrato PAC: habilitar transporte, contador por tenant, precio por DTE o cuota por plan. *Bloqueado por contrato, no por código.* | **C8**, delta | alto |

---

## Secuencia recomendada (resumen)

| Ventana | Qué entra | Por qué |
|---|---|---|
| **Semana 1** | Track 0 completo (operador) + A1–A5 | Cierra los P0 activos: pago sandbox, upgrade roto, KPI erróneo, secretos, backups. Todo es de horas. |
| **Semanas 2–3** | B1–B4 + **C1** + F1 | Seguridad del camino de dinero + la fundación analítica (C1 desbloquea todo lo demás). |
| **Semanas 3–5** | C2, C3, C4, B5, E1, E2 | Dashboards correctos y rápidos, exports sin truncar, reportes programados vivos. |
| **Mes 2** | D1, D2, C5, F2, F3, F4, E3, E4 | Primeras features analíticas visibles al cliente + cobranza proactiva. |
| **Mes 3** | D3, D4, B6, E5, series F5/F6, F7 | Diferenciadores premium (anomalías, benchmarking) + deuda de fondo + nueva línea de ingreso. |

**Dependencias clave:** C2/C3/C5/D1/D2/D4 dependen de **C1** · D3 conviene después de E1 (sin
duplicados el σ es confiable) · F7/F8 requieren decisión de negocio (pricing de comisión,
contrato PAC) antes de codificar · OP-1 debe preceder a B3 (el token de WhatsApp debe nacer
cifrado).
