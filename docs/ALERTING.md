# Alerting

> infra:I18 — alertas de **pipeline** (CI/deploy) y de **runtime** (errores de
> producción). Las alertas de **SLO** y **uptime** viven en
> [`MONITORING_SLO.md`](./MONITORING_SLO.md); esto las complementa, no las repite.

## Dos planos

| Plano | Qué vigila | Mecanismo | Destino |
|---|---|---|---|
| **Pipeline** | CI / deploy de edge functions falla | `.github/workflows/ci-alert.yml` | Slack |
| **Runtime** | errores/exceptions en prod (front + edge) | Sentry Alert Rules | Slack / email |
| **SLO** | breaches de latencia/error-rate | Sentry (tag `slo_breach`) — ver MONITORING_SLO.md | Slack |
| **Uptime** | `/health` caído | UptimeRobot/Better Uptime — ver MONITORING_SLO.md | Slack / SMS |

## 1. Pipeline — fallo de CI/Deploy → Slack

`ci-alert.yml` escucha el resultado de los workflows críticos (CI, Coverage gate,
migraciones a producción, security guard, promote/rollback, deploy staging,
deploy de edge functions y Health check) vía `workflow_run`, solo en `main`, y si
fallaron postea a Slack.

**Activación:** crea un [Incoming Webhook de Slack](https://api.slack.com/messaging/webhooks)
y guárdalo como secret `SLACK_WEBHOOK_URL` (Settings → Secrets and variables →
Actions). **Sin** el secret, el workflow hace no-op con un aviso (no falla).

El mensaje incluye workflow, branch, commit corto, autor y link al run.

### Falsos positivos: el run rojo que nunca llegó a ejecutarse

Cuando GitHub no asigna runner, el job se queda en cola, acaba `cancelled` **sin
logs y sin steps**, y el run entero se marca `failure`. En la pestaña Actions se
ve idéntico a un fallo real, pero no hay nada que arreglar en el repo.

Para distinguirlo: abre el job y mira si tiene logs. Sin logs y sin runner
asignado ⇒ es infraestructura de Actions; re-lanza el run cuando la cola se
normalice. `ci-alert.yml` hace ese triage por sí solo (consulta los jobs del run
y solo alerta si alguno terminó en `failure`, o si el run ni siquiera arrancó por
YAML inválido), así que estos casos ya no llegan a Slack.

El probe de `/health` reintenta 3 veces (~40 s) antes de darse por caído, de modo
que un 5xx puntual o un cold start del edge runtime tampoco despiertan a nadie.

## 2. Runtime — errores de producción → Sentry

Configurar en Sentry (org **`administratodocom`**, proyecto **`sentry-pink-ribbon`**)
→ **Alerts → Create Alert Rule**. Reglas recomendadas:

### a) Issue nuevo en producción
```
When:    a new issue is created
If:      environment   equals   production
Then:    notify  Slack #incidents  (y/o email del equipo)
```

### b) Pico de errores (regresión post-deploy)
```
When:    number of errors
If:      environment = production  AND  count > 25 in 1 minute
Then:    notify  Slack #incidents
```
Ideal para cazar una regresión en los ~15 min de vigilancia post-`promote`.

### c) Errores de una edge function concreta
El helper `supabase/functions/_shared/sentry.ts` etiqueta cada captura con
`function:<nombre>` (ej. `function:stripe-platform-webhook`). Esto habilita:
```
When:    number of errors
If:      tags[function] = stripe-platform-webhook  AND  count > 5 in 5 minutes
Then:    notify  Slack #incidents
```
Alinéalo con el SLO `edge.error_rate` (< 2%) de MONITORING_SLO.md. Repite para
`timbrar-documento` y `create-charge` (dinero + fiscal).

### d) SLO breaches
Ya descritas en [`MONITORING_SLO.md`](./MONITORING_SLO.md) (tag `slo_breach=true`,
segmentado por `slo_severity`). No se duplican aquí.

### Email además de Slack
Sentry → Settings → Alerts permite **email** como acción junto a Slack. Para una
bandeja compartida, añade la dirección del equipo a la regla (a/b/c).

## 3. Release health (recomendado)

Si el build sube source maps con `release` (ver `vite.config.ts` +
`VITE_APP_VERSION`), activa **Sentry → Releases → Alerts**: avisa cuando una
release nueva supera un umbral de *crash-free sessions*. Es la señal más limpia
para decidir un `rollback`.

## Inventario de configuración

| Dónde | Clave | Para |
|---|---|---|
| GitHub Actions Secrets | `SLACK_WEBHOOK_URL` | alerta de CI/deploy |
| Sentry Alert Rules | (UI) | errores de prod / edge / SLO |
| Supabase Edge Secrets | `SENTRY_DSN` | que las edge functions reporten |
| Vercel env (Production) | `VITE_SENTRY_DSN` | que el frontend reporte |
| UptimeRobot/Better Uptime | — | probe a `/functions/v1/health` |

## Escalación por severidad

| Severidad | Ejemplos | Canal | Tiempo de respuesta |
|---|---|---|---|
| **critical** | login/pago caídos, `/health` 503, crash-free < 99% | Slack #incidents + email | inmediato |
| **high** | edge.error_rate > target, pico de errores en un módulo | Slack #incidents | < 1 h |
| **medium** | breaches de latencia no críticos | Slack #engineering | siguiente día hábil |

Cuando suena una alerta, sigue el **Runbook** de `MONITORING_SLO.md`
("Cuando suena alerta") y, si es por un deploy, el de
[`RUNBOOK_DEPLOY_ROLLBACK.md`](./RUNBOOK_DEPLOY_ROLLBACK.md).
