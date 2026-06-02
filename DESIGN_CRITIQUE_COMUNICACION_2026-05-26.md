# Design Critique — Comunicación · Paquetería · Dashboards · Email

**Fecha:** 2026-05-26
**Alcance:** Sistema de notificaciones multi-canal (in-app, email, WhatsApp), conversaciones, broadcasts, paquetería, dashboards (admin + general), integraciones de email.
**Objetivo:** Identificar puntos de mejora para unificar la capa de mensajería como **servicio SaaS multi-tenant** con plantillas por tenant, observabilidad y entregabilidad.
**Repo:** `ventas-png/control-consumo-agua` · v2.0.0
**Documentos relacionados:** `DESIGN_CRITIQUE_AGUA_2026-05-26.md`, `DESIGN_CRITIQUE_CONDOMINIOS_2026-05-26.md`, `DESIGN_CRITIQUE_PLATAFORMA_SAAS_2026-05-26.md`.

---

## 1. Resumen ejecutivo

La aplicación maneja **4 canales** de comunicación (in-app, Gmail API, EmailJS, WhatsApp via meta/twilio) y **3 modelos** distintos (conversaciones bidireccionales, broadcasts unidireccionales, notificaciones in-app). Cada uno está implementado por separado, con overlap y sin orquestación común.

**Fortalezas:**

- `useConversations` usa **Supabase Realtime** (`supabase.channel('conv-messages-...')`) para mensajes en vivo.
- `useNotifications` combina Realtime + polling fallback (60s).
- Edge function `notify-package` ya soporta provider switch entre Meta y Twilio.
- Edge function `send-email` centraliza Gmail con token refresh.
- `useBroadcasts` resuelve destinatarios client-side y hace batch INSERT de 500 recipients para evitar N+1.

**Debilidades graves:**

1. **`EMAILJS_PUBLIC_KEY` expuesta en el cliente** (`src/lib/email.ts` + `.env.example`). Cualquiera con la key puede enviar correos a través del template configurado.
2. **Sin orquestador central de notificaciones.** Cada feature elige canal y plantilla por su cuenta. No hay routing por preferencia del usuario ni fallback automático.
3. **Sin tracking de entrega/lectura/bounce** en email, WhatsApp ni in-app de broadcasts (`useBroadcasts` calcula `read_count` cliente-side sin tabla `notification_reads`).
4. **Plantillas hard-coded** en código (`enviarReciboEmail`, `enviarNotificacionRuta`). No hay editor por tenant.
5. **`ComunicacionSection.tsx` (958 líneas)** es god-section.
6. **Admin dashboard calcula KPIs client-side** sobre todos los registros. Sin vistas materializadas.
7. **Cero tests** de notificaciones, broadcasts, conversaciones, dashboards.
8. **`useBroadcasts` batch-inserta 500 recipients** desde el cliente — no es escalable a tenants con miles de residentes.

**Conteo de hallazgos:**

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 6 |
| 🟠 Alto    | 11 |
| 🟡 Medio   | 9 |
| 🔵 Bajo    | 3 |
| **Total** | **29** |

**Bloqueantes para SaaS:** N1 (EmailJS key expuesta), N2 (sin orquestador), N3 (plantillas hard-coded), N5 (broadcast scaling), N12 (KPIs cliente-side).

---

## 2. Eje N — Notificaciones y comunicación

### N1 · 🔴 Crítico — `EMAILJS_PUBLIC_KEY` expuesta en el cliente

`src/lib/email.ts` inicializa `@emailjs/browser` con `APP_CONFIG.EMAILJS_PUBLIC_KEY` que viene de `VITE_EMAILJS_PUBLIC_KEY` — visible en el bundle. Aunque EmailJS lo llama "public key", cualquier persona con la key + service_id + template_id puede enviar emails a través de la cuenta.

**Impacto:** Cualquiera puede spamear con tu cuenta EmailJS → cuota agotada, posible blacklist del dominio, factura inflada.

**Recomendación:** Eliminar EmailJS del cliente. Mover todo envío a edge functions:

- `send-email` ya existe vía Gmail API. Hacerla el único punto de envío.
- Si Gmail falla, fallback en edge function (Resend / Postmark / Mailgun con API key en Supabase Secrets).
- Cliente solo invoca `supabase.functions.invoke('send-email', { template, recipients, vars })`.

---

### N2 · 🔴 Crítico — Sin orquestador central de notificaciones

Hoy cada feature decide:
- Recibo de cobro → `enviarReciboEmail` (Gmail/EmailJS).
- Asignación de ruta → `enviarNotificacionRuta` + `dispararRecordatorioRuta`.
- Paquete recibido → `notify-package` edge function.
- Broadcast → `enviarComunicadoBroadcast` itera clientes.
- Notificación in-app → `INSERT INTO user_notifications` directo.

Sin tabla `notifications_outbox` central, sin enrutamiento por preferencia del usuario, sin fallback (si email falla, intentar WhatsApp), sin retry policy.

**Recomendación:** Servicio unificado:

```
Tabla notifications_outbox (
  id, tenant_id, recipient_user_id, recipient_email, recipient_phone,
  channel (email|sms|whatsapp|inapp|push), template_key, vars jsonb,
  status (queued|sending|sent|delivered|read|failed|bounced),
  attempts, next_retry_at, sent_at, delivered_at, read_at, error
)

Edge function dispatch-notifications (cron 1m):
  - Toma queued/retry_due
  - Aplica preferencias del usuario (silencio horario, opt-out)
  - Renderiza plantilla con vars
  - Envía por adapter (gmail/resend/twilio/meta/expo-push)
  - Actualiza status
```

UI: `centro de notificaciones` por usuario, dashboard ops por tenant.

---

### N3 · 🔴 Crítico — Plantillas hard-coded en código

`enviarReciboEmail`, `enviarNotificacionRuta`, `enviarComunicadoBroadcast` arman el HTML/cuerpo del email en TypeScript. No hay tabla `notification_templates` por tenant.

**Impacto:** Cada cambio de copy/branding requiere code push. Tenants no pueden personalizar.

**Recomendación:**

```
Tabla notification_templates (
  id, tenant_id, key (recibo_cobro|asignacion_ruta|...),
  channel, subject, body_template (handlebars/liquid),
  variables_required jsonb, version, active
)
```

UI editor con preview + variables disponibles. System templates seedeadas, custom override por tenant.

---

### N4 · 🔴 Crítico — Sin tracking de entrega/lectura/bounce

- Email: no se rastrea si llegó (no se procesan webhooks de bounce de Gmail).
- WhatsApp: edge function envía pero no recibe status callback.
- In-app: `useBroadcasts` calcula `read_count` en cliente sobre `broadcast_recipients` (¿se actualiza al ver?) sin tabla dedicada de lecturas con índice.

**Recomendación:** Dentro de `notifications_outbox`, campos `sent_at`, `delivered_at`, `read_at`, `bounced_at`, `error_code`, `error_message`. Webhooks específicos por provider (`sendgrid-webhook`, `twilio-webhook`).

---

### N5 · 🔴 Crítico — `useBroadcasts` batch-inserta 500 recipients desde el cliente

`useBroadcasts.ts` resuelve destinatarios client-side (recorre `clientes` con `resolveClienteIds`) y luego hace `INSERT` batch 500. Con tenants de miles de residentes esto es lento, fallable y consume cuota Postgres del cliente.

**Recomendación:** Edge function `create-broadcast`: recibe segmento (filtros) + plantilla. Resuelve destinatarios server-side (consulta + RLS) y encola en `notifications_outbox`. Cliente recibe id + count + cola para tracking.

---

### N6 · 🔴 Crítico — `ComunicacionSection.tsx` god-section (958 LOC)

Mezcla en un archivo: lista de conversaciones, vista de detalle, panel de difusión, segmentación, adjuntos, asignación de equipo, notas internas, reglas de acceso.

**Recomendación:** Romper en:
- `/comunicacion/conversaciones` (lista)
- `/comunicacion/conversaciones/:id` (detalle)
- `/comunicacion/difusion` (broadcasts)
- `/comunicacion/centro` (preferencias + reglas de acceso)
- Hooks dedicados por dominio.

---

### N7 · 🟠 Alto — Sin segmentación dinámica para broadcasts

Hoy: todos / por proyecto / por unidades / por clientes seleccionados. No hay segmentación por:
- Estado de cobro (todos los morosos).
- Rol (todas las juntas directivas).
- Última interacción (sin login en 30 días).
- Tags personalizables.

**Recomendación:** `audience_segments` (tenant_id, query_dsl, recomputable). UI tipo Mailchimp.

---

### N8 · 🟠 Alto — Sin programación a futuro ni recurrencia

No hay "enviar el primero de cada mes" ni "enviar el 15 de junio a las 8am".

**Recomendación:** `scheduled_at`, `recurrence_rule` (RRULE iCal) en `broadcasts` / `notifications_outbox`. Edge function cron.

---

### N9 · 🟠 Alto — Sin preferencias de canal por usuario

Un residente que prefiere WhatsApp no puede silenciar email. Un cliente que solo quiere recibos no puede opt-out de comunicados.

**Recomendación:** `user_notification_preferences` (user_id, category, channel, enabled, quiet_hours_start/end).

---

### N10 · 🟠 Alto — Sin "centro de preferencias" para residente

Relacionado con N9. No hay UI para que el residente gestione sus preferencias / opt-out global / suscripciones.

**Recomendación:** Página `/portal/preferencias` con toggles por categoría y canal. Link unsubscribe en cada email.

---

### N11 · 🟠 Alto — Adjuntos en `conv-attachments` sin política por unidad

Bucket privado con `useSignedUrl`, pero los signed URLs tienen TTL largo (probablemente 1h). Si un atacante con permiso puntual lo captura, puede leerlo después.

**Recomendación:** TTL ≤ 5 minutos + revalidación. Si el usuario revoca permiso, invalidar URLs activas.

---

### N12 · 🔴 Crítico — Admin dashboard calcula KPIs client-side

`admin-dashboard/` (9 componentes, ~50KB) corre todas las agregaciones en cliente sobre `registros`, `clientes`, etc. Para un tenant con 100K registros, el browser se cae al login.

**Recomendación:** Vistas materializadas en Postgres:

```sql
create materialized view mv_dashboard_kpis as
  select
    company_id, project_id, periodo,
    sum(consumo) as consumo_total,
    sum(case when estado='pagado' then monto end) as recaudo,
    count(*) filter (where estado='pendiente') as pendientes,
    count(*) filter (where estado='mora') as en_mora,
    count(distinct cliente_id) filter (where estado='pagado') as clientes_activos
  from registros
  group by company_id, project_id, periodo;
```

Job cron refresca cada N minutos. Dashboard hace `SELECT * FROM mv_dashboard_kpis WHERE company_id=$1`.

---

### N13 · 🟠 Alto — Dos dashboards (`admin-dashboard/` y `dashboard/`) divergentes

`admin-dashboard/` (admin global con filtros) vs `dashboard/` (operador, mes actual, sin filtros). Reimplementan los mismos KPIs con código distinto.

**Recomendación:** Un componente `<DashboardWidgets>` configurable por rol/scope. Filtros como prop.

---

### N14 · 🟠 Alto — Sin alertas / scorecard de salud

Dashboard muestra KPIs pero no resaltan situaciones críticas (cobranza <80%, mora >15%, fondo de reserva <objetivo).

**Recomendación:** `<HealthScorecard />` configurable por tenant con umbrales. Alertas por canal de comunicación al `company_owner`.

---

### N15 · 🟡 Medio — `useNotifications` con polling fallback de 60s

Si Realtime falla (Supabase channel down, red intermitente), cae a polling cada 60s. Pero polling completo (no incremental) sobrecarga DB si hay 100 usuarios concurrentes.

**Recomendación:** Polling incremental (`updated_at > last_known_at`).

---

### N16 · 🟡 Medio — Tag "notas internas" guardadas en mismo `conversation_messages`

Notas internas (visibles solo para staff) en `conversation_messages` con flag. Riesgo de fuga si una consulta mal hecha las muestra al cliente.

**Recomendación:** Tabla separada `conversation_internal_notes` con RLS estricto (solo admin/staff).

---

### N17 · 🟡 Medio — `notify-package` soporta meta/twilio pero sin fallback

Si el provider está caído, no hay segundo intento con otro proveedor.

**Recomendación:** Política de retry + fallback configurable por tenant.

---

### N18 · 🟡 Medio — Sin tabla de remitentes verificados (SPF/DKIM/DMARC)

Para entregabilidad alta, cada tenant debe verificar su dominio (records DNS). No hay UI para esto.

**Recomendación:** Si se adopta Resend/Postmark, integrar verificación de dominio + UI con instrucciones DNS por tenant.

---

### N19 · 🟡 Medio — Paquetes solo `recibidos`, sin flujo "saliente"

`paquetes_recibidos` modela entrada al portería. Para mudanzas o paquetes que salen no hay tabla dedicada.

**Recomendación:** `paquetes_salida` con flujo separado y firma del receptor.

---

### N20 · 🟡 Medio — `paquetesNotify.ts` sin retry visible

Si la edge function falla (red, provider down), el paquete queda sin notificar y nadie lo detecta.

**Recomendación:** Tabla `paquetes_notificaciones` con estado y retry. Listar fallidos en dashboard.

---

### N21 · 🟡 Medio — Sin "no molestar" / quiet hours por tenant

Tenants podrían querer no enviar WhatsApp después de las 10pm. No hay configuración global.

**Recomendación:** `tenant.quiet_hours_start/end`. Orquestador respeta.

---

### N22 · 🟡 Medio — Chart.js sin lazy import en dashboards

`admin-dashboard/` carga chart.js al boot. Si el usuario nunca entra al dashboard, paga el costo igual.

**Recomendación:** `import('chart.js/auto')` dinámico al renderizar el chart.

---

### N23 · 🟡 Medio — Sin tracking de email open / click

Pixel tracking, link tracking — no implementado.

**Recomendación:** Si se adopta Resend/Postmark, ya viene con tracking.

---

### N24 · 🟠 Alto — Sin export histórico de comunicaciones

No hay "exportar todos los emails enviados al cliente X en el último año" ni "histórico de mensajes WhatsApp por residente".

**Recomendación:** `notifications_outbox` con índice por recipient. Vista paginada en perfil del cliente.

---

### N25 · 🟠 Alto — Sin templates de SMS

EmailJS y WhatsApp existen, SMS no. Para regiones donde WhatsApp es menos universal, falta el canal.

**Recomendación:** Adapter Twilio SMS dentro del orquestador.

---

### N26 · 🟠 Alto — Sin webhook bounce de Gmail

`send-email` envía via Gmail API pero no escucha bounces. Un cliente con email inexistente sigue recibiendo intentos eternamente.

**Recomendación:** Manejar response codes de Gmail + parsear "delivery status notification" para marcar `bounced_at`.

---

### N27 · 🔵 Bajo — Sin métricas Prometheus/Grafana en edge functions

`send-email`, `notify-package`, `route-reminders` no exponen métricas (tiempo, success rate, throughput).

**Recomendación:** Logs estructurados → PostHog/Datadog.

---

### N28 · 🔵 Bajo — Sin internacionalización de plantillas

Plantillas en español hard-coded.

**Recomendación:** Cuando se introduzca i18n, plantillas también localizadas.

---

### N29 · 🔵 Bajo — Sin cifrado de mensajes sensibles en `conversation_messages`

Conversación entre cliente y administrador podría contener datos sensibles. Hoy `body` está en texto plano.

**Recomendación:** Cifrar at-rest (Postgres pgcrypto) los campos sensibles con clave por tenant.

---

## 3. Roadmap para robustecer como SaaS

> `[+]` marca trabajo compartido con critiques previos.

### Fase 1 — Fundaciones
- `[+]` Router por dominio (`/comunicacion/*`).
- `[+]` Capa de datos `src/domain/comunicacion/` con TanStack Query.
- Romper `ComunicacionSection` (N6) + dashboards en componentes (N13).
- Lazy import de chart.js (N22).

### Fase 2 — Servicio unificado de notificaciones
- **Eliminar EmailJS del cliente** (N1). Todo email vía `send-email` o adapter Resend/Postmark.
- **Tabla `notifications_outbox`** + edge function `dispatch-notifications` cron (N2, N4).
- **Templates por tenant** (`notification_templates`) + editor UI (N3).
- **`create-broadcast`** edge function que resuelve audiencia server-side (N5).
- Webhooks de bounce/delivery (N4, N26).
- Adapter Twilio SMS (N25).
- TTL bajo en signed URLs (N11).
- Notas internas en tabla separada (N16).

### Fase 3 — UX
- `[+]` Adoptar `<DataTable>` shared en listados de notificaciones.
- Centro de preferencias para residente (N9, N10).
- Segmentación dinámica de audiencias (N7).
- Programación + recurrencia (N8).
- Health scorecard con alertas (N14).
- `[+]` `<EmptyState>` consistente.

### Fase 4 — Operaciones SaaS
- **Vistas materializadas** para KPIs (N12).
- Verificación SPF/DKIM/DMARC + UI por tenant (N18).
- Quiet hours por tenant (N21).
- Tracking open/click (N23).
- Export histórico por recipient (N24).
- Métricas de funciones (N27).
- Paquetes salientes (N19).
- Retry / fallback de paquetes (N17, N20).

### Fase 5 — Calidad continua
- Tests de envío, plantillas, bounces, segments.
- `[+]` axe-core en CI.
- `[+]` i18n de plantillas (N28).
- Polling incremental de notifications (N15).
- Cifrado de mensajes sensibles (N29).

---

## 4. Tabla consolidada

| ID  | Sev. | Hallazgo                                                       | Evidencia                                                                  | Fase |
|-----|------|----------------------------------------------------------------|----------------------------------------------------------------------------|------|
| N1  | 🔴   | `EMAILJS_PUBLIC_KEY` expuesta en el cliente                    | `src/lib/email.ts`, `.env.example`                                         | 2    |
| N2  | 🔴   | Sin orquestador central de notificaciones                       | sin `notifications_outbox`                                                  | 2    |
| N3  | 🔴   | Plantillas hard-coded                                            | `src/lib/email.ts` con HTML inline                                          | 2    |
| N4  | 🔴   | Sin tracking de entrega/lectura/bounce                           | sin webhooks                                                               | 2    |
| N5  | 🔴   | `useBroadcasts` batch INSERT 500 desde cliente                   | `src/hooks/useBroadcasts.ts`                                               | 2    |
| N6  | 🔴   | `ComunicacionSection.tsx` god-section                            | `src/components/comunicacion/ComunicacionSection.tsx:958 LOC`              | 1    |
| N7  | 🟠   | Sin segmentación dinámica                                         | `DifusionTab.tsx`                                                          | 3    |
| N8  | 🟠   | Sin programación a futuro / recurrencia                          | sin `scheduled_at`                                                         | 3    |
| N9  | 🟠   | Sin preferencias de canal por usuario                            | sin `user_notification_preferences`                                        | 3    |
| N10 | 🟠   | Sin centro de preferencias para residente                        | portal residente                                                           | 3    |
| N11 | 🟠   | Adjuntos `conv-attachments` con TTL largo                        | `useSignedUrl`                                                             | 2    |
| N12 | 🔴   | Admin dashboard calcula KPIs client-side                         | `src/components/admin-dashboard/*` (~50KB)                                 | 4    |
| N13 | 🟠   | Dos dashboards divergentes                                        | `admin-dashboard/` vs `dashboard/`                                          | 1    |
| N14 | 🟠   | Sin alertas / health scorecard                                    | dashboards                                                                 | 3    |
| N15 | 🟡   | Polling fallback 60s no incremental                              | `useNotifications`                                                         | 5    |
| N16 | 🟡   | Notas internas en mismo `conversation_messages`                   | schema                                                                     | 2    |
| N17 | 🟡   | `notify-package` sin fallback de provider                         | edge function                                                              | 4    |
| N18 | 🟡   | Sin SPF/DKIM/DMARC por tenant                                     | sin UI ni verificación                                                     | 4    |
| N19 | 🟡   | Paquetes solo entrada                                              | `paquetes_recibidos` único                                                 | 4    |
| N20 | 🟡   | `paquetesNotify` sin retry                                         | `src/lib/paquetesNotify.ts`                                                | 4    |
| N21 | 🟡   | Sin quiet hours por tenant                                         | sin config                                                                 | 4    |
| N22 | 🟡   | chart.js sin lazy import                                            | `admin-dashboard/*`                                                        | 1    |
| N23 | 🟡   | Sin tracking de open/click                                          | sin webhook                                                                | 4    |
| N24 | 🟠   | Sin export histórico de comunicaciones por cliente                  | sin UI                                                                     | 4    |
| N25 | 🟠   | Sin templates SMS                                                  | no adapter Twilio SMS                                                      | 2    |
| N26 | 🟠   | Sin webhook bounce de Gmail                                         | `send-email`                                                               | 2    |
| N27 | 🔵   | Sin métricas/telemetría en edge functions                           | logs simples                                                               | 5    |
| N28 | 🔵   | Sin i18n de plantillas                                              | español hard-coded                                                          | 5    |
| N29 | 🔵   | Sin cifrado at-rest de mensajes sensibles                           | `conversation_messages.body` plain                                          | 5    |

---

## 5. Priorización para SaaS

**Bloqueantes (Fase 1-2):** N1 · N2 · N3 · N4 · N5 · N6 · N12.
**Importantes (Fase 2-4):** N7 · N8 · N9 · N10 · N11 · N13 · N14 · N18 · N24 · N25 · N26.
**Mejoras:** resto.
