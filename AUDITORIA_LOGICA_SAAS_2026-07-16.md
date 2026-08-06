# Revisión integral de la lógica del SaaS — comercial, funcional, seguridad y analítica de datos

**Fecha:** 2026-07-16 · **Base:** `main@25dc2df` · **Alcance:** solo análisis (sin cambios de código)

**Método:** 5 dimensiones analizadas por agentes independientes en paralelo (comercial,
funcional, seguridad, datos, delta vs auditoría 2026-07-10) + 2 dimensiones de reportes/
visualización/analítica analizadas directamente. Los hallazgos de impacto alto/medio pasaron
por **verificación adversarial** (un agente independiente instruido a refutarlos contra el
código real): **18 confirmados · 7 parciales (corregidos en este texto) · 0 refutados**
(25 de 45 hallazgos alto/medio verificados; el resto se incluye sin verificación adversarial
y se marca con ◇). Ver [Límites](#límites-de-esta-revisión).

---

## Veredicto ejecutivo

1. **El equipo ejecutó el roadmap "0–30 días" de la auditoría del 07-10 casi completo en 6
   días.** De los 11 P0: **5 cerrados** (doble suscripción, dunning, MRR, MFA exigible,
   ESLint boundary) y **6 parciales** — todos con el código hecho y **solo la activación
   operativa pendiente** (llave de cifrado sin aprovisionar, PITR sin verificar, reviewers del
   environment sin configurar, SLOs sin call sites, QR de paquetes, candado mensual del
   ledger). De los 10 P1: **6 cerrados**, incluido el más importante — **el residente ya puede
   pagar en línea** en ambas verticales.
2. **El patrón dominante de riesgo hoy no es código faltante: es "cableado pero no
   encendido".** Cifrado de secretos en passthrough, backups sin verificar, gate de
   migraciones que no bloquea, E2E que nunca corre, reportes programados sin secrets. Cerrar
   esto es días de trabajo de operador, no de desarrollo.
3. **Hay 2 riesgos comerciales activos nuevos** introducidos por las features recientes: el
   proveedor de pago por defecto `sandbox` permite a un residente **liquidar deuda real sin
   dinero real** en tenants que no configuraron payfac, y el CTA de upgrade ejecuta el cambio
   de plan en Stripe pero **muestra error al usuario** (cobra sin avisar que funcionó).
4. **La capa de análisis de datos es el área con más oportunidad del producto.** El SaaS
   captura datos ricos (lecturas históricas georreferenciadas, pagos, cuotas, amenidades,
   visitas, tickets, presupuesto, contabilidad de partida doble) pero los explota poco: 5
   gráficos básicos por tenant, KPIs calculados en el navegador sobre arrays truncados a
   5.000 filas, un KPI principal que hoy **mezcla años**, colores de gráficos rotos por pasar
   variables CSS al canvas, y cero correlación entre módulos. La infraestructura correcta ya
   existe en el propio repo (MV + RPC + cron del superadmin) — falta replicarla para el tenant.
5. **La estructura comercial es sólida y coherente** (pricing por uso enforced en BD, trial
   server-side, dunning, feature gating en 3 capas), pero deja dinero en la mesa: sin comisión
   transaccional sobre el pago en línea, anualidad incobrable, tier Enterprise inexistente,
   vertical de energía regalada y timbrado fiscal (add-on cobrable) aún en stub.

---

## 1 · Progreso desde la auditoría 2026-07-10

Verificado en código, PR por PR (`0073e4e..25dc2df`, ~48 PRs).

### Cerrado ✅

| Brecha (auditoría 07-10) | Cerrado por | Evidencia |
|---|---|---|
| P0 #1 Doble suscripción al cambiar plan | swap in-place con prorrateo + idempotencyKey | `create-checkout-session/index.ts:201-275` |
| P0 #2 Pago fallido sin dunning | past_due_since + 14 días gracia + solo-lectura + email + banner + tests (#605) | `20260710030000_dunning_past_due_readonly.sql` |
| P0 #3 MRR del superadmin erróneo | MV suma `monthly_total_cents` por uso, excluye trials | `20260710000000_fix_mrr_superadmin_usage_based.sql:56-62` |
| P0 #10 MFA no exigible | `companies.mfa_required` + MfaGate (⚠ solo client-side, ver Seguridad) | `src/App.tsx:346-351` |
| P0 #11 Boundary sin ESLint | `no-restricted-imports` como gate de CI; hoy 0 imports directos | `eslint.config.js:43-53`, `ci.yml:35` |
| P1 Pago en línea del residente | payfac pluggable + QPayPro real + confirmación server-side + abonos parciales + tests (#604) | `create-charge`, `confirm-charge`, `PagoEnLineaModal.tsx` |
| P1 Facturación masiva por ciclo | `condominios_cerrar_ciclo` + `agua_cerrar_ciclo` set-based + avisos in-app/email | migraciones `20260713110000`, `20260714010000` |
| P1 Cobranza automatizada | cron diario de recordatorios pre/post vencimiento + convenios con calendario | `20260713090000_recordatorios_cuotas_cron.sql` |
| P1 Captura offline de lecturas | cola localStorage + sync idempotente por clave natural | `src/lib/lecturasOutbox.ts` |
| P1 Tarifas escalonadas | bloques increasing-block con punto único de cálculo | `src/lib/business.ts:53-99` |
| P1 WhatsApp por tenant (server-side) | bóveda deny-all + despacho Meta Cloud API en el outbox (#611) | `20260716000000_whatsapp_tenant_vault.sql` |
| P1 Portal propietario vs inquilino | `unidad_residentes`, dual login, cuotas por rol responsable | migraciones `20260712020000`→`20260713080000` |
| Quick wins | SetupWizard en producción, `validarLectura` cableada (2 call sites) | `App.tsx:398-435`, `LecturasSection.tsx:210` |
| P2 N+1 de Condominios (parcial) | abrir el Panel pasó de ~141 queries a 9 (#610) | `src/domain/condominios/sectionData.ts` |
| Seguridad (hallazgos propios del equipo) | fail-open trivaluado en `payfac_estatus`/`fiscal_pac_estatus` corregido; rama RLS suelta en solicitudes corregida | `20260716000000:138-227`, `20260713100000_solicitudes_enforce_rbac_gate.sql` |

### Parcial ⚠ — código listo, activación pendiente (el tema recurrente)

| Brecha | Qué falta (operador, no desarrollo) | Verificación |
|---|---|---|
| P0 #7 Cifrado de secretos de tenant | `encryptSecret` es **passthrough a texto plano** hasta setear `TENANT_SECRETS_ENC_KEY` y correr el backfill | ✅ confirmado — `secretsCrypto.ts:109-112` |
| P0 #5 Backups/DR | Runbook con RPO/RTO definidos, pero el checklist del owner **sin marcar** (PITR sin confirmar, 0 restore drills) | ✅ confirmado — `docs/RUNBOOK_BACKUP_DR.md:28-41` |
| P0 #9 Gate de migraciones | Environment `production-db` creado pero **sin required reviewers: no bloquea nada** | `apply-migrations-prod.yml:72-79` ◇ |
| P0 #4 Alertas de runtime | Tags de Sentry OK, cron de `/health` cada 15 min OK, pero SLOs de **pagos** sin call sites (1/14 instrumentado) | `src/lib/slo.ts:38-62` ◇ |
| P0 #8 QR inseguro | Garita corregida (token cripto + render local); **paquetería** sigue con `Math.random` + `api.qrserver.com` (que además la CSP bloquea) | ✅ confirmado — `src/lib/paquetes.ts:6-15` |
| P0 #6 Candado de periodos contables | Candado **anual** cerrado en ambos ledgers; el cierre **mensual** del ledger de empresa sigue sin existir | `20260710010000:21-24` ◇ |
| P1 E2E en CI | El "verde no-op" ya es visible (warning), pero la suite (9 specs) **sigue sin ejecutarse nunca** — falta `E2E_BASE_URL` | `coverage.yml:85-120` ◇ |

### Sin avance desde 07-10 ✗

- **Timbrado fiscal real (FEL/CFDI)** — verificado parcial: el PAC ya fue elegido (Ainnova) y el
  adapter existe con credenciales en bóveda, pero el transporte está deshabilitado fail-safe:
  **ningún comprobante emitido tiene valor legal** (`getFiscalProvider.ts:35-41`).
- **Conciliación de payouts agrupados** — cero referencias a payouts en el repo; con el pago en
  línea ya operativo este hueco se vuelve más visible.
- **Web push / SMS** — el canal push del outbox sigue `supported:false`; la PWA no tiene Web Push.

---

## 2 · Dimensión comercial

### Fortalezas verificadas

- **Pricing por uso end-to-end**: 4 componentes (base + proyecto extra + unidad primaria +
  unidad extra), checkout con line items del uso real, sync diario de quantities a Stripe con
  prorrateo, calculadora del landing que espeja el seed de la BD.
- **Enforcement de monetización en 3 capas**: límites de plan por triggers de BD (imposibles de
  saltar desde el front), feature gating server-side con RLS RESTRICTIVE sobre tablas premium,
  y `FeatureGate`/`UpgradeCTA` en UI.
- **Trial de 14 días sin tarjeta** que cubre todos los flujos de alta, con expiración
  server-side a solo-lectura.
- **Ciclo de vida de empresa protegido**: suspensión con motivo, 90 días de gracia antes de
  purga, cancelación de Stripe *antes* de borrar (fail-closed).
- **Checkout con madurez fiscal**: Stripe Tax, tax_id, dirección, códigos de promoción.
- **Métricas de plataforma correctas y pre-agregadas** (MV + RPC definer + serie diaria de MRR).

### Hallazgos

| # | Hallazgo | Impacto | Verif. | Recomendación |
|---|---|---|---|---|
| C1 | **Pago 'sandbox' por defecto liquida deuda REAL sin dinero real.** El proveedor por defecto de toda empresa es `sandbox`, el portal lo considera payfac válido y ofrece "Pagar en línea"; `SandboxPaymentProvider` aprueba siempre y `confirm-charge` inserta `pagos` estado `aplicado` y marca la cuota `pagada`. Todo tenant productivo sin QPayPro configurado tiene residentes que pueden autoliquidarse la deuda. | **alto** | ✅ | No ofrecer el botón cuando el proveedor efectivo es `sandbox` (salvo flag demo explícito); marcar esos pagos `metodo='sandbox'` y excluirlos de conciliación/EEFF. Esfuerzo bajo. |
| C2 | **UpgradeCTA ejecuta el cambio de plan en Stripe pero muestra ERROR.** El fix del P0 #1 devuelve `{swapped:true}` sin URL; `UpgradeCTA` solo destructura `{url,error}` y lanza "No se obtuvo URL de checkout". Un tenant de pago que hace clic en "Actualizar" es upgradeado (con cobro prorrateado) mientras ve un mensaje de fallo. `PerfilSection` sí lo maneja; el CTA de conversión no. | **alto** (QW) | ✅ parcial | Manejar `swapped` en `UpgradeCTA.tsx:49-67`: toast de éxito + `refresh()` de feature flags. ~15 líneas. |
| C3 | **Pagos hospedados abandonados quedan `pending` para siempre.** `confirm-charge` está diseñado para "retorno del portal + cron de reconciliación", pero ese cron no existe en ninguna migración y QPayPro no tiene webhook entrante. Residente que paga y cierra la pestaña = dinero cobrado sin acreditar hasta reclamo manual. | medio | ◇ | pg_cron cada 15 min que invoque `confirm-charge` para `payment_requests` pending con `provider_ref`; la idempotencia ya está resuelta. Esfuerzo bajo. |
| C4 | **Cero monetización transaccional sobre el pago en línea.** Modelo bring-your-own-credentials: sin Stripe Connect, sin `application_fee`, sin registro contable de comisión. Es la línea de ingreso estándar de la categoría (F4 del propio diseño, `docs/DISENO_PAGO_EN_LINEA_RESIDENTE.md:119-123`). | medio | ◇ | Stripe → Connect destination charges con application fee; QPayPro → columna `fee_cents` por pago para facturarla al tenant. |
| C5 | **El plan picker muestra el precio flat legacy ($10/$15) cuando el cobro real es por uso.** Un tenant con 200 unidades paga ~$215/mes y el picker le muestra "$10.00/mes" — expectativa rota al llegar la factura. | medio (QW) | ◇ | Renderizar el total proyectado con el uso actual (`calculate_monthly_total_cents` ya existe) o "desde $X". |
| C6 | **MRR cuenta suscripciones 'active' grandfathered que nunca se cobran.** Backfills dejaron pilotos `active` sin `stripe_subscription_id` (una con period_end a 100 años); `sync-stripe-quantities` las salta pero la MV las suma → MRR reportado > MRR cobrable, y esos tenants operan gratis sin camino a conversión. | medio | ◇ | Separar "MRR cobrable" de "MRR potencial" en la MV + campaña de conversión de pilotos. Esfuerzo bajo. |
| C7 | **Anualidad: botón 'Anual' visible que siempre falla** (los planes tienen `price_yearly_cents` seedeado pero el checkout rechaza `yearly` con 400). | medio (QW) | ◇ | Corto plazo: ocultar el botón (1 línea). Mediano: crear los prices yearly (con descuento) — la anualidad mejora cashflow y retención. |
| C8 | **Timbrado fiscal = add-on cobrable no explotado** (cobro por DTE es estándar de la categoría). Bloqueado por el contrato PAC (ver delta). | medio | ✅ parcial | Al habilitar transporte: contador de timbres por tenant + precio por DTE o cuota por plan. |
| C9 | Tier **Enterprise** inexistente: `automation`/`api_access`/`white_label`/`enterprise_sso` reservados "vía UPDATE manual" sin plan comprable ni CTA sales-led. | bajo | ◇ | Seedear plan enterprise sales-led ("Contactar ventas"). |
| C10 | **Vertical de energía completa regalada** dentro del módulo agua (sin feature_code ni precio propio). | bajo | ◇ | Decisión de producto: add-on de precio o tercer módulo del pricing. |
| C11 | **Funnel de dinero sin instrumentar**: el catálogo FUNNEL de PostHog no tiene eventos checkout_started/upgrade/trial_converted; no hay KPI de conversión trial→pago ni ARPU. | bajo (QW) | ◇ | 5-6 eventos en call sites existentes + conversión 30d y ARPU en la MV. |
| C12 | Todo trial es 'bundle' aunque el signup elija un solo módulo (sesga la conversión y el MRR potencial). | bajo | ◇ | Asignar plan trial según los flags del signup. |

---

## 3 · Dimensión funcional / arquitectura

### Fortalezas verificadas

- **Routing declarativo con guards componibles** (`APP_ROUTES` + ErrorBoundary > RoleGuard >
  gate de módulo); App.tsx bajó a 556 líneas.
- **Capa `src/domain` consolidada**: 34 dominios con keys/queries/mutations sobre TanStack
  Query; el boundary components→domain tiene enforcement real en CI (0 imports directos hoy).
- **RBAC por acción en dos niveles** (16 módulos × 6 acciones + RBAC granular por tab de
  condominios) y gating por línea de servicio.
- **184 tabs de condominios en un registry declarativo type-checked** con lazy() por tab y
  navegación con fuente única; deep-links con estado en URL.
- **Portal del residente maduro**: dual-service, 11 tabs, pago en línea real en ambas verticales.
- Higiene alta: ~33 TODOs en todo src, tipos por dominio, UI compartida real (DataTable,
  Dialog, CommandPalette…).

### Hallazgos

| # | Hallazgo | Impacto | Verif. | Recomendación |
|---|---|---|---|---|
| F1 | **CondominiosSection sigue siendo god-component**: 143 useState (líneas 156-336), contexto de ~140 colecciones, y al abrir el primer tab ≠ Panel dispara el **batch completo de ~143 queries** aunque el tab consuma 1 colección. Solo 18 de 196 tabs se auto-alimentan vía `tabQueries`. #610 mitigó la carga inicial (9 queries), no la estructura. | **alto** | ✅ | Continuar la migración tab-por-tab a tabQueries/React Query (patrón probado en 18 tabs y en ServiciosEnergiaSection, que se auto-gestiona 100%). |
| F2 | **El permiso de 'ver' por tab de condominios solo filtra la navegación: un deep-link lo salta.** `canViewCondominiosTabByPermission` se aplica en la nav y el command palette, pero el render del tab activo (`CondominiosSection.tsx:854`) no lo verifica. Un usuario sin permiso de vista abre `/condominios/<tab>` directo. (Mitigado por RLS para los datos; expone UI/acciones de UI.) | medio (QW) | ✅ | Check de 3 líneas antes del render → `<AccessDenied/>`. |
| F3 | **/energia sin gate de vista**: la ruta no declara `module` y la sección solo resuelve create/edit/delete — cualquier usuario del tenant puede ver el módulo. | medio (QW) | ✅ | Añadir `module: 'servicios_energia'` a las 2 entradas de APP_ROUTES; el guard genérico ya existe. Trivial. |
| F4 | **Estrategia 'espejo' entre verticales institucionalizada**: cierre de ciclo duplicado en 2 RPCs (191 y 261 líneas SQL) + 2 UIs casi idénticas, con paridad mantenida por comentario ("espejo de…"). Cada mejora futura se implementa 2 veces o diverge. | medio | ✅ | Extraer el flujo UI compartido a `shared/` + test de contrato que compare los 2 RPCs. |
| F5 | **Asimetría de cobranza entre verticales**: condominios tiene ciclo completo (recordatorios cron, mora, campañas, convenios, judicial); agua solo tiene el recordatorio de rutas al lecturista — el cliente de agua moroso no recibe nada automático. | medio | ✅ parcial | Extender `enqueue_recordatorios` al modelo de `registros` reutilizando cron y plantillas. |
| F6 | **El cierre de ciclo es manual y por diálogo** — para N condominios / M proyectos son N+M cierres al mes tecleando el período en un PromptDialog; se olvidan o se teclean mal. | medio | ◇ | Config por proyecto "cierre automático el día D" invocando los RPCs existentes desde pg_cron + aviso del resultado. |
| F7 | **E2E sigue sin correr nunca** (gate por secret sin configurar); ídem harness RLS server-side. | medio | ◇ | Configurar `E2E_BASE_URL` → staging; correr al menos en main. Config, no código. |
| F8 | Cliente tipado `db`: adopción real pero parcial — ~15/76 archivos del domain (5 a medio migrar importando ambos clientes); los writes tipados a veces se anulan con casts. | medio | ✅ parcial | Continuar por módulo priorizando contabilidad/bancos (dinero contable). Mecánico. |
| F9 | Código muerto/navegación rota: overlay `ComentariosTicketTab` inalcanzable; sección 'paquetes' con path sin ruta (la notificación de paquete redirige a /clientes). | bajo | ◇ | Cablear o eliminar; mapear paquetes → `/condominios/paqueteria`. |
| F10 | Paginación/carga completa client-side sigue siendo el patrón dominante del shell (ver Datos D1). | medio | ◇ | Ver D1. |

---

## 4 · Dimensión seguridad

### Fortalezas verificadas

- **Cifrado de secretos bien diseñado** (AES-256-GCM envelope `enc:v1:`, llave solo en edge
  env, dual-read, backfill idempotente con dry-run, runbook) — solo falta encenderlo (S1).
- **Bóveda WhatsApp con el patrón correcto** (deny-all, token nunca proyectado, RPC estatus
  fail-closed con lógica trivaluada correcta) — y el mismo PR cazó y corrigió un fail-open real
  en `payfac_estatus`/`fiscal_pac_estatus`.
- **Camino de dinero server-side sólido**: autorización por propiedad del ítem, ambiente
  sandbox/prod decidido por el servidor, confirmación contra el provider (nunca contra el body).
- **Defensa en profundidad multi-tenant**: security-guard contra el catálogo de producción en
  cada push + nocturno, harness RLS de 7 invariantes, storage 100% por tenant.
- **Higiene de PII/telemetría por encima del promedio**: PostHog opt-in RGPD sin session
  recording, Sentry sin PII por diseño en front y edges, CSP sin unsafe-inline en scripts, HSTS.
- Anti-open-relay en send-email (scope atado al rol real, no al body); auth-hardening con HIBP.

### Hallazgos

| # | Hallazgo | Impacto | Verif. | Recomendación |
|---|---|---|---|---|
| S1 | **Cifrado de secretos INACTIVO (passthrough)**: hasta aprovisionar `TENANT_SECRETS_ENC_KEY`, las llaves Stripe/PayPal/PAC/tokens Gmail de todos los tenants siguen **en texto plano en reposo** — un dump de backup o fuga de service_role los expone. | **alto** (QW) | ✅ | Ejecutar el runbook (openssl rand → `supabase secrets set` → redeploy → backfill). Horas, no días. |
| S2 | **MFA exigible solo client-side**: ninguna política RLS ni edge consulta el claim `aal` del JWT. Un atacante con la contraseña de un owner (empresa con `mfa_required=true`) ignora la UI y llama PostgREST directo con su JWT AAL1: lee y escribe todo. La propia migración lo admite ("el enforcement vive en el cliente"). | **alto** | ✅ | Política RESTRICTIVE / helper RLS que exija `aal2` cuando la company del usuario tenga `mfa_required` (patrón documentado por Supabase). |
| S3 | **Paquetería**: código de retiro `Math.random()` (~31 bits, client-side) + QR renderizado en `api.qrserver.com` (fuga del código a un tercero, y la CSP actual **rompe la imagen**). El patrón correcto ya existe en garita. | medio (QW) | ✅ | Reusar `generarToken()` + `QRCodeSVG` local; idealmente generar server-side. |
| S4 | **El token de WhatsApp solo puede entrar hoy en texto plano y está EXCLUIDO del backfill de cifrado** (el interin documentado es INSERT por SQL editor; no existe `whatsapp-save-credentials`). | medio (QW) | ✅ | Añadir `company_whatsapp_configs` a `TEXT_TABLES` del backfill (1 línea) + edge writer con cifrado (plantilla payfac ya existe). |
| S5 | **El harness RLS no cubre las tablas nuevas de julio**: `SECRET_TABLES` omite `company_whatsapp_configs`; sin invariantes para `payment_requests`, `unidad_residentes`, `cuota_recordatorios_log`. El punto fuerte de la postura multi-tenant se está quedando atrás del esquema. | medio (QW) | ✅ parcial | Añadir las bóvedas nuevas a SECRET_TABLES y las tablas de pago/portal a los invariantes de tenant. |
| S6 | **Rate limiting estancado: el camino de dinero no tiene límite** — `create-charge`, `confirm-charge`, `create-payment-intent`, `timbrar-documento` sin `enforceRateLimit` (10/37 funciones cubiertas). | medio (QW) | ✅ | ~10 líneas por función con el helper existente. |
| S7 | Comparación de secretos no constante en ≥7 edges pese a existir `timingSafeEqualSecret`. | bajo (QW) | ◇ | Reemplazo mecánico. |
| S8 | Lockout de login client-side (sessionStorage) — se evade con otra pestaña; mitigado por rate limit IP de GoTrue + HIBP. | bajo | ◇ | Contador server-side por email vía `log-security-event`. |
| S9 | Sentry en 4/37 edges; el resto falla a ciegas. Cero zod server-side en los bodies de las 37 edges. | bajo | ◇ | Envolver los catch raíz críticos; zod en funciones de dinero/credenciales. |
| S10 | Soft delete sin purga: lo "borrado" es recuperable indefinidamente y visible por RLS (retención/RGPD). | bajo | ◇ | Retención por tabla + cron de purga real. |
| S11 | Sin SECURITY.md, canal de divulgación, secret scanning ni Dependabot en CI. | bajo (QW) | ◇ | Config de GitHub, sin código. |

---

## 5 · Dimensión manejo de datos

### Fortalezas verificadas

- **Integridad referencial real a escala**: 231 tablas, ~645 FKs, ~785 CHECKs, ~106 UNIQUEs;
  índices correctos de series de tiempo en `registros` (fecha desc, por cliente, por contador).
- **Agregación financiera 100% server-side**: contabilidad/EEFF/CxP/presupuesto agregan en SQL
  vía RPCs (48 call sites `.rpc()` en el domain) — el patrón correcto ya está en casa.
- **KPIs de plataforma en MVs con refresh cada 15 min** y acceso solo por RPC definer.
- **Capa de acceso disciplinada**: queryClient central (staleTime 60s), timeout 15s por query,
  keys por módulo, 0 componentes llamando supabase directo.
- **Redondeo monetario correcto en el núcleo**: `redondear2` con EPSILON; los RPCs de cierre
  espejan el redondeo del front; la última cuota de convenios absorbe el residual.
- Cierres de ciclo set-based; crons idempotentes por UNIQUE; fotos a Storage (nunca base64
  nuevo); export de datos de empresa/usuario (portabilidad) ya existe.

### Hallazgos

| # | Hallazgo | Impacto | Verif. | Recomendación |
|---|---|---|---|---|
| D1 | **Caps de 5.000 filas truncan totales, series y exports SIN aviso.** `useRegistrosQuery` baja todo el histórico con `limit(5000)` y ese único array alimenta dashboard, cobros, historial **y los exports XLSX/CSV/PDF**; ídem `cuotas_condominio` (el propio código lo llama "salvaguarda interina", TODO Fase 6). Una empresa con >5.000 lecturas obtiene KPIs y reportes silenciosamente incompletos. | **alto** | ✅ parcial | Totales/KPIs → RPCs de agregación (como contabilidad); listados → `.range()` + count exact; exports → refetch server-side por chunks. |
| D2 | **El KPI principal de agua mezcla AÑOS**: `DashboardSection` filtra "mes actual" solo por `getMonth()` — con >1 año de histórico, julio 2025 + julio 2026 se suman juntos. Además `new Date('YYYY-MM-DD')` parsea UTC: en GMT-6 las lecturas del día 1 caen al mes anterior. | **alto** (QW) | ✅ parcial | Añadir comparación de año + helper date-only local-safe. Minutos de fix. |
| D3 | **Soft delete inconsistente en `registros`**: la columna existe (porque las edges la proyectan) pero `softDelete.ts` no incluye la tabla, la app sigue haciendo DELETE físico y **ninguno de los 21 SELECT filtra `deleted_at`** — el día que algo escriba el flag, los "borrados" siguen apareciendo en dashboards y exports. | medio (QW) | ✅ | Extender `SoftDeletableTable`, migrar `deleteRegistro`, añadir `.is('deleted_at', null)` a los consumidores. |
| D4 | **Duplicados posibles en el camino del dinero**: sin UNIQUE natural en `registros` ni `cuotas_condominio`; la idempotencia de la captura offline es check-then-insert app-level — dos syncs concurrentes duplican la lectura → doble cargo. | medio | ✅ | Índices únicos parciales (`WHERE deleted_at IS NULL`) + upsert `ON CONFLICT DO NOTHING`. |
| D5 | **Cortes de período anclados a UTC en operación GMT-6**: una lectura del 31 a las 19:00 locales cae al ciclo del mes siguiente en el cierre masivo. | medio | ◇ | Parametrizar los RPCs de cierre con la zona del tenant (`AT TIME ZONE`). |
| D6 | **0 ENUMs en 231 tablas**; ~24 columnas `estado` con CHECK y otras desnudas; doble máquina de estados en `registros` (`estado` + `factura_estado`) con normalización defensiva en el cliente. | medio | ◇ | CHECKs a las columnas desnudas + completar el backfill estado→factura_estado. |
| D7 | **N+1 residual de Condominios**: panel = 9 queries ✓, pero el primer tab ≠ Panel dispara el batch completo de ~143 selects (ver F1). | medio | ◇ | Fase 6 (fetch por tab) ya planificada en el código. |
| D8 | **Cero particionado y cero retención**: `audit_log` (row_data jsonb completo por cada write de tablas críticas), `notification_events`, `email_send_queue`, `billing_sync_log` crecen sin límite ni purga. | medio (QW) | ✅ | Política de retención + cron mensual de purga; pg_partman para audit_log si escala. |
| D9 | **Backups/DR sin verificación operativa** (ver delta). | medio (QW) | ✅ | 15 min del owner + drill trimestral. |
| D10 | Caché de React Query mutado a mano en agua (setQueryData sin invalidate — riesgo de drift); formateo monetario manual creció a 350 `toFixed(2)`; columna legacy `registros.foto` base64 sin backfill a Storage. | bajo | ◇ | useMutation+invalidate; regla ESLint anti-toFixed; job one-shot de fotos. |

---

## 6 · Reportes, visualización y analítica de datos

> Foco solicitado de esta revisión. Los dos agentes de esta dimensión fallaron por errores de
> infraestructura (529) y el análisis se hizo directamente sobre el código; los hallazgos
> llevan ◇ salvo donde cruzan con hallazgos verificados de Datos.

### 6.1 Inventario de lo que existe hoy

| Superficie | Qué muestra | Cómo se calcula | Estado |
|---|---|---|---|
| **Agua · Dashboard staff** (`DashboardSection`) | 3 stat cards (consumo mes, recaudo, pendientes) + línea consumo 6m | Client-side sobre `registros` (cap 5.000) | ⚠ KPI mezcla años (D2); colores rotos (V1) |
| **Agua · Admin dashboard** (`AdminDashboardCharts`) | Línea dual-eje consumo+recaudo 6m + dona estados pagado/pendiente/mora | Client-side, una pasada O(n) memoizada | ⚠ colores rotos (V1) |
| **Condominios · Dashboard Ejecutivo** (`DashboardEjecutivoTab`) | 3 hero-KPIs con sparkline y delta vs mes anterior (cobranza %, emitido, cobrado) + gastos vs presupuesto + tickets por prioridad + convivencia + unidades con deuda + tendencia 6m (barras DIV) | Client-side sobre ~9 colecciones del god-component | ✓ el mejor dashboard de tenant; sparklines resuelven color bien |
| **Superadmin** (`SuperAdminDashboardTab`) | MRR/activas/trial/churn + MRR 90d (línea) + altas/bajas 12m (barras) | **Server-side**: MV + RPC + snapshot diario por cron | ✓✓ el patrón de referencia (colores hex, estados vacíos, aria-labels) |
| **Portal residente** (`CustomerPortal`) | Barras últimos meses (m³ o importe) + línea de tendencia | Client-side sobre sus registros | ⚠ color de tendencia `var(--at-warning)` roto (V1) |
| **Mapa** (`MapaSection`, Leaflet) | Pins de medidores coloreados por estado de cobro + heatmap de consumo + clustering | Client-side desde lecturas con GPS | ✓ solo vertical agua |
| **Contabilidad/EEFF** | Balance, Estado de Resultados, Flujo, Libro Mayor, aging CxP, presupuesto vs real | **RPCs SQL** (server-side) | ✓ datos correctos… sin un solo gráfico (V4) |
| **Exports** (`exportData`) | XLSX/CSV/PDF genérico de tablas planas + PDFs custom (carta de cobro, estado de cuenta, reporte de asamblea) | Client-side sobre los arrays cargados | ⚠ hereda el cap de 5.000 (D1); anti CSV-injection ✓ |
| **Reportes guardados/programados** (`report_templates`) | Plantillas por tabla+columnas+filtros; schedule mensual/semanal; email CSV por cron | Server-side (edge `process-scheduled-reports`) | ⚠ inactivo (vault secrets); whitelist de solo 5 tablas de condominios; scheduled solo CSV |
| Analytics interno | PostHog (funnel producto, opt-in RGPD) | — | ✓ para el operador del SaaS, no para el tenant |

### 6.2 Hallazgos de visualización

| # | Hallazgo | Impacto | Recomendación |
|---|---|---|---|
| V1 | **Los gráficos de tenant pasan `var(--at-*)` directo a Chart.js y el canvas no resuelve variables CSS** — las líneas/donas renderizan con colores por defecto o negro, no la marca (y el theming por tenant/branding nunca llega a los charts). Afecta `DashboardSection`, `AdminDashboardCharts` y la línea de tendencia del portal. El patrón correcto **ya existe en el repo** (`Sparkline.tsx:70` resuelve con `getComputedStyle`; superadmin usa hex). | **alto** (QW) ◇ | Helper `resolveChartColor(token)` con getComputedStyle (o adoptar el de Sparkline) y usarlo en los 3 componentes. Horas. |
| V2 | **Toda la analítica de tenant se calcula en el navegador sobre arrays truncados** (cruza con D1/D2 ✅): los KPIs y series de una empresa grande son incorrectos hoy, y cada apertura de dashboard re-paga el costo de bajar todo. El superadmin ya demuestra el patrón MV+RPC. | **alto** | La pieza central de la recomendación 6.4. |
| V3 | **Los gráficos no responden preguntas de negocio, decoran**: sin rangos de fecha seleccionables (todo fijo a 6m/90d), sin comparativo YoY, sin drill-down (clic en el mes → sus lecturas), sin export de la vista del gráfico, y la dona de estados cuenta **recibos** (no montos) — 100 recibos de Q10 pesan más que 10 de Q1.000. | medio ◇ | Selector de rango + modo monto/conteo + drill-down a la tabla filtrada + export desde el gráfico. |
| V4 | **Cobertura desigual entre módulos**: contabilidad tiene los datos más ricos (partida doble, RPCs listos) y **cero visualización** — sin gráfico de presupuesto vs real (el RPC existe), sin tendencia de ingresos/egresos, sin aging visual de cartera en cobros; energía y calidad de agua sin serie temporal; asistencia/uso de amenidades sin ocupación. | medio ◇ | Priorizar: presupuesto vs real (datos 100% listos), aging de cartera, tendencia de flujo. |
| V5 | **Reportes guardados no cubren la vertical agua ni contabilidad**: whitelist = 5 tablas de condominios; `registros` (lecturas/consumo — el corazón del producto original) no se puede guardar ni programar; el envío programado es solo CSV y está inactivo por secrets del vault. | medio ◇ | Ampliar whitelist (registros, pagos ya está, asientos); activar los 2 secrets; XLSX en el run programado. |
| V6 | **El residente no tiene contexto de su consumo**: ve sus barras pero no "tu consumo vs promedio de tu comunidad", ni "vs mismo mes del año pasado", ni proyección del próximo recibo con la tarifa escalonada. El dato ya existe completo. | medio ◇ | 2-3 anotaciones en el gráfico del portal + proyección con `calcularCostoTarifa` (ya existe). Reduce disputas y da valor percibido. |
| V7 | El mapa solo pinta la **última** lectura por cliente: no hay capa de morosidad por monto, antigüedad de deuda, ni evolución del heatmap en el tiempo (los datos GPS históricos están). | bajo ◇ | Capas conmutables: deuda (monto), antigüedad, consumo promedio. |
| V8 | Accesibilidad de gráficos desigual: superadmin tiene `aria-label`/`role="img"`; los charts de tenant no exponen alternativa textual ni tabla de datos. | bajo ◇ | aria-label + botón "ver como tabla" (la tabla ya existe en la mayoría de vistas). |

### 6.3 Oportunidades de correlación de datos (lo que el SaaS podría analizar y hoy no)

Los datos que ya se capturan soportan análisis que ningún competidor regional ofrece de serie.
Priorizadas por (valor comercial × datos ya disponibles ÷ esfuerzo):

**★ O1 · Detección de anomalías de consumo (fugas y medidores parados)** — datos: `registros`
por contador con fecha (histórico completo). `validarLectura()` ya valida **en captura**; falta
el análisis **retrospectivo**: job (pg_cron) que marque consumo > Nσ del histórico del medidor
(fuga probable) y N ciclos consecutivos en cero (medidor parado/bypass), tarjeta "Alertas de
consumo" en el dashboard y aviso opcional al residente por el outbox (canales listos). Es el
diferenciador "IoT-lite sin hardware" del research 2025-2026, con los datos que ya están en la
BD. *Feature premium natural (plan superior o add-on).*

**★ O2 · Aging de cartera + score de riesgo de morosidad** — datos: `cuotas_condominio` +
`registros` + `pagos` (fechas de vencimiento y pago reales). Buckets 0-30/31-60/61-90/90+ por
unidad/cliente (RPC de agregación), tendencia de la mora, y un score simple por unidad
(retraso promedio histórico, reincidencia, monto) que priorice la cobranza — el cron de
recordatorios existente pasaría de "recordar a todos" a "escalar a los de riesgo". La
predicción de morosidad 30-60 días es el P3 "IA aplicada" de la auditoría previa; esta es su
versión determinista alcanzable hoy. *El argumento de venta más directo: mejora la cobranza
del cliente, medible en Q.*

**★ O3 · Presupuesto vs real visual + proyección de cierre de año** — datos: 100% listos
(`presupuesto_vs_real` RPC ya existe; gastos por categoría). Gráfico comparativo mensual con
desviaciones y proyección lineal de fin de año por categoría. *Esfuerzo más bajo de la lista;
habla el idioma de la asamblea de condóminos.*

**★ O4 · Benchmarking de portafolio (administradoras multi-condominio)** — datos: todo por
`project_id`. Comparativo entre los N condominios del mismo tenant: tasa de cobranza, mora por
unidad, gasto por unidad, tickets abiertos, consumo m³/unidad. A futuro: benchmark anónimo
entre tenants (mediana de la plataforma) como feature premium — nadie en la categoría regional
lo ofrece. *Retención de las cuentas más grandes (administradoras).*

**★ O5 · Consumo comparado del residente + proyección de recibo** — datos: listos. En el
portal: tu consumo vs mediana de tu comunidad (anónimo), vs tu mismo mes del año pasado, y
proyección del recibo con la tarifa escalonada vigente. *Reduce disputas de lectura (menos
tickets) y sube el valor percibido del portal — el driver de adopción que monetiza O2/pago
en línea.*

**Segundo anillo** (valen, pero requieren capturar datos nuevos o más esfuerzo):

- **O6 · Agua no facturada (pérdidas)**: requiere capturar producción/compra de agua por
  proyecto (dato que hoy NO existe) vs suma facturada → % pérdida, la métrica #1 de un
  operador de agua.
- **O7 · Eficiencia de lecturistas/rutas**: lecturas por hora, cobertura de ruta, % re-lecturas
  (timestamps ya existen; falta sesión de ruta).
- **O8 · Amenidades**: ocupación por franja/amenidad (pricing y reglas), correlación
  reservas ↔ morosidad para políticas de bloqueo.
- **O9 · Salud de comunicación**: tasa de entrega/apertura por canal del outbox (los eventos ya
  se registran en `notification_events`) — hoy nadie la ve.

### 6.4 Infraestructura analítica recomendada (cómo hacerlo sin re-arquitectura)

1. **Replicar el patrón superadmin para el tenant**: una MV (o tabla agregada por cron)
   `kpis_tenant_mensual` con grano (company_id, project_id, mes): emitido, cobrado, tasa de
   cobranza, mora, consumo m³, gastos, tickets. Refresh cada 15 min con el cron ya existente.
   RLS por tenant. Esto a la vez: corrige D1/D2 (KPIs exactos server-side), acelera los
   dashboards (no más bajar 5.000 filas), y es la **fuente única** para O3/O4 y los gráficos
   comparativos.
2. **RPCs de agregación para lo no-mensual** (aging de cartera, anomalías, ocupación) — el
   patrón de contabilidad (`conta_*`) ya lo demuestra con 48 call sites.
3. **Chart.js está bien como librería** a esta escala; lo que falta es disciplina de datos
   (server-side) y un helper de color (V1). No se necesita BI embebido ni warehouse todavía;
   cuando un tenant enterprise pida explorar datos libremente, la salida natural es exponer
   las MVs/RPCs vía la `api_access` ya reservada como feature enterprise (C9).
4. **Activar la cadena de reportes programados** (2 secrets del vault) y ampliar la whitelist —
   convierte los análisis anteriores en el email mensual que el administrador reenvía a su
   junta directiva: distribución del producto sin costo de adquisición.

---

## 7 · Matriz consolidada de prioridades

### P0 — corregir ya (riesgo activo de dinero/datos/reputación)

| # | Ítem | Dim | Esfuerzo |
|---|---|---|---|
| 1 | Sandbox liquida deuda real (C1) | comercial | bajo |
| 2 | UpgradeCTA cobra y muestra error (C2) | comercial | bajo |
| 3 | Encender cifrado de secretos — llave + backfill (S1) | seguridad | bajo (operador) |
| 4 | MFA enforcement server-side (S2) | seguridad | medio |
| 5 | Verificar PITR + primer restore drill (D9) | datos/ops | bajo (operador) |
| 6 | KPI de agua mezcla años + TZ (D2) | datos/viz | bajo |
| 7 | Reviewers del environment production-db (delta) | ops | bajo (config) |
| 8 | Cron de reconciliación de pagos pending (C3) | comercial | bajo |

### P1 — siguiente iteración (correctitud y confianza)

Totales/exports sin truncar — RPCs de agregación + MV tenant (D1/V2, la pieza que habilita
toda la sección 6) · colores de gráficos (V1) · rate limit en el camino de dinero (S6) ·
harness RLS actualizado (S5) · WhatsApp: backfill + edge writer + UI (S4) · gate de vista en
deep-links y /energia (F2/F3) · UNIQUEs naturales anti-duplicado (D4) · picker con precio real
(C5) · activar E2E y reportes programados (F7/V5) · recordatorios de cobranza para agua (F5) ·
QR de paquetería (S3).

### P2 — escala y producto

Continuar descomposición de CondominiosSection + fetch por tab (F1/D7) · cierre de ciclo
automático programable (F6) · timbrado real + monetización del timbre (C8) · comisión
transaccional (C4) · anualidad cobrable (C7) · MRR cobrable vs potencial + funnel de billing
(C6/C11) · retención/purga + particionado (D8/S10) · zona horaria del tenant en cierres (D5) ·
completar tipado db (F8) · oportunidades analíticas O1-O5 (sección 6.3).

---

## 8 · Roadmap sugerido

1. **Esta semana (P0):** los 8 ítems de arriba — 5 son de horas. Con eso el pago en línea es
   seguro, el upgrade convierte, los secretos quedan cifrados y hay red de backups verificada.
2. **2–4 semanas (P1 + analítica base):** MV `kpis_tenant_mensual` + RPCs de agregación
   (corrige D1/D2/V2 de raíz) → re-basar los 3 dashboards de tenant sobre ella → helper de
   color → activar reportes programados con whitelist ampliada. En paralelo los P1 de
   seguridad (rate limit, harness, WhatsApp).
3. **1–3 meses (diferenciación analítica):** O3 presupuesto vs real → O2 aging + score de
   morosidad → O5 portal comparativo → O1 anomalías de consumo → O4 benchmarking de
   portafolio. Cada una es un release comunicable y las últimas dos son feature premium.
4. **3–6 meses:** timbrado real + comisión transaccional (las dos líneas de ingreso nuevas),
   Web Push, conciliación de payouts, descomposición completa de Condominios.

---

## Límites de esta revisión

- Los 2 agentes de la dimensión reportes/visualización fallaron por errores de servidor (529)
  y esa sección se analizó directamente (marcada ◇ salvo cruces con hallazgos verificados);
  el hallazgo V1 (colores en canvas) está verificado a nivel de código pero no con captura de
  pantalla en runtime.
- 20 hallazgos de impacto alto/medio quedaron sin verificación adversarial por límites de
  cómputo (caps de 6 por dimensión y 5 verificaciones fallidas por infraestructura); se
  incluyen marcados ◇. Ningún hallazgo verificado fue refutado, lo que da confianza razonable
  en los ◇ de los mismos analistas.
- No se ejecutó la app ni se corrieron tests; es análisis estático del código en `25dc2df`.
- Este informe no sustituye un pentest ni una auditoría SOC 2 formal.
