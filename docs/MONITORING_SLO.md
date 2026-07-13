# Monitoring & SLOs

> infra:I3 — guía de monitoreo, alertas y Service Level Objectives.

## Componentes

| Pieza | Propósito | Configuración |
|---|---|---|
| **Sentry** | Error tracking + traces | `VITE_SENTRY_DSN` |
| **PostHog** | Product analytics + dashboards SLO | `VITE_POSTHOG_KEY` |
| **Health endpoint** | Uptime probe externa | `/functions/v1/health` |
| **SLO catalog** | Targets versionados en `src/lib/slo.ts` | Código |

## SLO Targets

### Latencia (p95, cliente)

| SLO key | Target | Severity |
|---|---|---|
| `login.complete` | < 3.0s | critical |
| `auth.oauth.callback` | < 3.0s | critical |
| `payment.checkout.open` | < 3.0s | critical |
| `payment.manual.submit` | < 2.5s | critical |
| `datatable.initial` | < 800ms | high |
| `datatable.search` | < 400ms | medium |
| `datatable.sort` | < 300ms | medium |
| `tab.switch` | < 500ms | high |
| `modal.open` | < 200ms | medium |
| `feature_flags.load` | < 600ms | high |

### Error rate (ventana 5 min)

| SLO key | Target | Severity |
|---|---|---|
| `login.error_rate` | < 1.0% | critical |
| `edge.error_rate` | < 2.0% | high |
| `payment.error_rate` | < 0.5% | critical |

### Availability (mensual)

| SLO key | Target | Severity |
|---|---|---|
| `health.uptime` | ≥ 99.9% | critical |

99.9% mensual = ≤ 43 min downtime/mes.

## Uso en código

### `measureSLO()` — wrap async operations

```ts
import { measureSLO } from '../lib/slo'

await measureSLO('datatable.initial', async () => {
  const data = await supabase.from('cuotas').select('*')
  setCuotas(data)
}, { tenant_id: companyId })
```

Si excede el target → emite `slo.breach` event a Sentry (con tags) + PostHog.

### `trackSLOBreach()` — emitir breach manualmente

```ts
import { trackSLOBreach } from '../lib/slo'

const elapsed = performance.now() - start
if (elapsed > 2000) {
  trackSLOBreach('login.complete', {
    measured: elapsed,
    target: 2000,
    severity: 'critical',
    extra: { route: '/login' },
  })
}
```

### `reportSLOError()` — emitir error a error_rate

```ts
import { reportSLOError } from '../lib/slo'

try {
  await login(email, password)
} catch (e) {
  // Solo reportar errores inesperados, NO bad credentials.
  if (e.code !== 'invalid_credentials') {
    reportSLOError('login.error_rate', { code: e.code })
  }
  throw e
}
```

## Alerting

### Sentry — recomendado

Configurar en Sentry un Alert Rule:

```
when: event.tags["slo_breach"] = "true"
and: event.tags["slo_severity"] = "critical"
threshold: 3 events in 5 minutes
notify: Slack #incidents
```

Para severity `high`:

```
threshold: 10 events in 15 minutes
notify: Slack #engineering
```

### PostHog — dashboards

Crear dashboards con:
- Histogram de `slo.latency.elapsed_ms` agrupado por `slo_key`
- Counter de `slo.breach` últimas 24h por severity
- Funnel de errors via `slo.error.slo_key`

## Health endpoint

`GET /functions/v1/health` retorna:

```json
{
  "status": "ok" | "degraded",
  "timestamp": "2026-06-02T...",
  "uptime_ms": 123456,
  "checks": {
    "supabase_url": true,
    "supabase_anon_key": true,
    "service_role_key": true
  }
}
```

Status: 200 OK / 503 si algún check falla.

Configurar **UptimeRobot** o **Better Uptime** apuntando a:
```
https://nnsqmeigtgewatameexo.supabase.co/functions/v1/health
```

Frecuencia: cada 5 min. Alert si 2 fallos consecutivos.

## Runbook — Cuando suena alerta

### `slo.breach` critical (login/payment/oauth)

1. Verificar Sentry para el stack trace específico.
2. Revisar Vercel deployments — algún rollback reciente?
3. Verificar Supabase status: https://status.supabase.com
4. Si afecta solo a un tenant → revisar quotas / billing.

### `health.uptime` breach (503 sostenido)

1. Verificar Supabase project status.
2. Verificar Vercel deployment current.
3. Si ambos OK → posible problema de network/CDN. Escalar.

### `edge.error_rate` breach

1. Sentry filter por `function_name` para encontrar la edge function afectada.
2. Verificar logs en Supabase Dashboard.
3. Si es Stripe webhook → verificar Stripe Dashboard.

## Próximos pasos (refinamiento)

- Pasada 2-4 semanas con data real:
  - Ajustar targets que nunca breach (bajarlos)
  - Refactorizar flows que breach >5% del tiempo
- Considerar agregar:
  - `dashboard.load` — landing del admin
  - `report.export` — generación PDF/XLSX
  - `realtime.subscription` — conexión WebSocket
