# Runbook — Respaldos y recuperación ante desastres (DR)

> P0 #5 (auditoría 2026-07-10). Antes no existía ninguna documentación de
> respaldos/PITR/DR para una base que guarda cobros, contabilidad de partida
> doble y comprobantes fiscales. Las migraciones son **forward-only** (sin
> `down`), así que el respaldo es la **única** red de seguridad de datos.

## Estado del proyecto (a documentar/verificar)

| Dato | Valor |
|---|---|
| Proyecto Supabase | `control-agua` (`nnsqmeigtgewatameexo`) |
| Región | `us-east-2` (AWS) |
| Postgres | 17.6 (engine 17, canal GA) |
| Creado | 2025-11-20 |

## Objetivos (RTO / RPO)

| Objetivo | Meta | Justificación |
|---|---|---|
| **RPO** (máx. pérdida de datos) | **≤ 5 min** | Requiere **PITR** (los backups diarios solos dan RPO de hasta 24 h — inaceptable para cobros/contabilidad). |
| **RTO** (tiempo de recuperación) | **≤ 2 h** | Restore de PITR + reconciliación de migraciones + smoke de caminos de dinero. |
| Retención de PITR | **≥ 7 días** | Ventana para detectar y revertir corrupción/borrados. Objetivo enterprise: 28 días. |

> **SLA público (referencia):** el estándar enterprise es 99.9% de uptime
> mensual (≤ 43 min de downtime/mes). Ver `docs/MONITORING_SLO.md`.

## ✅ Acción requerida del owner (una sola vez)

Estos pasos **no** se pueden automatizar desde el repo — requieren el dashboard
de Supabase con permisos de owner. **Verificar y marcar:**

- [ ] **PITR habilitado.** Dashboard → Database → Backups → *Point in Time Recovery*.
      PITR es feature de plan **Pro o superior**. Si el proyecto está en Free,
      solo hay backups diarios (RPO ~24 h) → **subir de plan** para cumplir el RPO.
- [ ] **Retención de PITR ≥ 7 días** configurada.
- [ ] **Daily backups** activos (complemento de PITR).
- [ ] **2FA** obligatorio en la organización de Supabase (protege el acceso al
      panel que puede restaurar/borrar la base).
- [ ] Registrar aquí la **fecha de la última verificación** y el **plan actual**:
      `Plan: ____  ·  PITR: sí/no  ·  Retención: __ días  ·  Verificado: ____`

## Procedimiento de restauración (PITR)

En caso de corrupción de datos, borrado accidental masivo o incidente:

1. **Contener.** Poner la app en mantenimiento si el incidente sigue escribiendo
   datos malos (Vercel → pausar el deployment de producción, o rotar a una página
   estática). Identificar el **timestamp objetivo** (justo antes del incidente).
2. **Restaurar.** Dashboard → Database → Backups → PITR → elegir el timestamp →
   *Restore*. Supabase restaura **el proyecto completo** al punto en el tiempo.
   ⚠️ Es destructivo respecto al estado actual: todo lo posterior al timestamp se
   pierde. Si hay datos válidos posteriores, exportarlos antes (ver paso 5).
3. **Reconciliar migraciones.** Como las migraciones son forward-only, tras el
   restore el schema queda en el estado de ese timestamp. Ejecutar
   `supabase migration list` (o revisar `supabase_migrations.schema_migrations`)
   y **re-aplicar** cualquier migración posterior al punto restaurado
   (`.github/workflows/apply-migrations-prod.yml` es idempotente).
4. **Verificar (smoke).** Correr los caminos de dinero/auth: login, una lectura→
   cobro, una cuota→pago, y `GET /functions/v1/health` (debe dar `200 status:ok`).
   Reusar los specs E2E de `e2e/` apuntando al proyecto restaurado.
5. **Datos huérfanos.** Si en el paso 2 se perdieron escrituras válidas
   posteriores al timestamp, re-ingresarlas desde el export previo o desde los
   sistemas de origen (Stripe conserva su propio historial de pagos; los
   comprobantes fiscales timbrados están en el PAC).
6. **Post-mortem.** Documentar causa raíz, timeline y acción correctiva.

## Restore drill (simulacro) — trimestral

Un backup no verificado no es un backup. Cada trimestre:

1. Crear un **proyecto/branch de staging** o un restore a un proyecto temporal.
2. Restaurar desde PITR a un timestamp de hace ~1 h.
3. Medir el **RTO real** (cronometrar pasos 2–4) y confirmar que se cumple ≤ 2 h.
4. Verificar integridad: conteos de `pagos`, `conta_asientos`, `registros`,
   `cuotas_condominio` coherentes con el timestamp.
5. Registrar la fecha y el RTO medido:

| Fecha del drill | RTO medido | Resultado | Notas |
|---|---|---|---|
| _(pendiente el primero)_ | — | — | — |

## Qué NO cubre el respaldo de la base

- **Storage** (fotos de medidores/visitantes, logos, adjuntos): los buckets de
  Supabase Storage tienen su propia política de backup — verificar por separado.
- **Secretos de edge functions** (env vars): no están en la base; documentados en
  `docs/SECURITY_SECRETS_INVENTORY.md`. Mantener una copia segura fuera de línea.
- **Configuración de Stripe/PAC**: viven en esos proveedores; el mapeo por tenant
  sí está en la base (`company_payment_secrets`, `fiscal_pac_secrets`).

## Referencias

- Deploy y rollback del frontend: `docs/RUNBOOK_DEPLOY_ROLLBACK.md`.
- SLOs y monitoreo: `docs/MONITORING_SLO.md`, `docs/ALERTING.md`.
- Inventario de secretos: `docs/SECURITY_SECRETS_INVENTORY.md`.
- Supabase PITR: https://supabase.com/docs/guides/platform/backups
