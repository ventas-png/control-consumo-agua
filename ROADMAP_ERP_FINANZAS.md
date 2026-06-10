# Roadmap ERP — Contabilidad, Finanzas y Presupuesto

Objetivo: evolucionar el módulo financiero actual (caja simple: cuotas/facturas, pagos, gastos, presupuesto anual por categoría, cierres mensuales) hacia un ERP financiero para administración de condominios y sistemas de agua.

Punto de partida (lo que ya existe):
- Ingresos: `registros` (facturas agua con IVA/mora/estados), `cuotas_condominio`, `pagos` (manuales + Stripe/PayPal), `convenios_pago`.
- Egresos: `gastos_condominio` (proveedor solo como texto), `caja_chica`/`movimientos_caja`, `fondo_reserva_condominio`, `obras_mejoras`.
- Presupuesto: `presupuesto_condominio` (año + categoría + monto).
- Cierres: `cierres_mensuales` (totales por periodo, borrador/cerrado).
- Fiscal: `documentos_fiscales` (FEL/CFDI provider-agnostic, sandbox).

---

## Fase 1 — Contabilidad de partida doble ✅ (esta rama)

La base de todo el ERP. Sin esto, las demás fases no tienen dónde registrar sus efectos.

- **Catálogo de cuentas** (`conta_cuentas`): jerárquico hasta 5 niveles (clase → grupo → mayor → sub-cuenta → auxiliar), multi-tenant, con plantilla seed LATAM (GT/MX) adaptada a condominios/agua. Cuentas de banco/caja pueden llevar moneda propia.
- **Pólizas/asientos** (`conta_asientos` + `conta_asiento_lineas`): estados borrador → publicado → anulado (por reverso, nunca borrado); folio correlativo por empresa; validación debe = haber server-side.
- **Asientos automáticos por triggers de Postgres** desde los flujos existentes: pago verificado/aplicado, gasto pagado, factura de agua emitida/anulada (devengo CxC + IVA), cuota de condominio emitida. Idempotentes y con reversos automáticos; nunca bloquean la operación de negocio.
- **Multimoneda**: contabilidad en moneda base de la empresa (`companies.default_currency`); líneas en moneda extranjera guardan monto origen + tipo de cambio (`conta_tipos_cambio`, mantenido por el admin); cuenta de diferencial cambiario en el seed.
- **Saldos iniciales**: asiento de apertura guiado (partidas de arranque) al iniciar la contabilidad.
- **Libro mayor y balanza de comprobación**: RPCs de agregación 100% en servidor.
- **Mapeo configurable** evento → cuenta (`conta_mapeo_cuentas`) por empresa con override por proyecto.

Límites declarados de la Fase 1 (se resuelven en fases posteriores): sin backfill de documentos históricos (se arranca con la apertura), sin revaluación FX periódica, cierre mensual existente aún no congela la contabilidad.

## Fase 2 — Cuentas por pagar / Proveedores

- Tabla `proveedores` (NIT/RFC, contacto, condiciones de pago, cuenta contable por defecto); migrar `gastos_condominio.proveedor_nombre` → FK con backfill por nombre.
- `facturas_proveedor` (CxP) con estados (registrada → aprobada → pagada parcial/total → anulada) y vencimientos; `ordenes_pago` que liquidan una o varias facturas.
- Antigüedad de saldos por pagar (aging 30/60/90) y proyección de pagos.
- Asientos automáticos: registro de factura (gasto/activo contra CxP), orden de pago (CxP contra banco).
- Flujo de aprobación de pagos (solicitado por operador, aprobado por admin/owner).

## Fase 3 — Presupuesto avanzado

- Partidas presupuestarias **mensualizadas y ligadas a cuentas contables** (reemplaza el año+categoría actual): tabla `presupuesto_partidas` (cuenta_id, periodo YYYY-MM, monto).
- Comparativo presupuesto vs real calculado **desde la balanza** (no desde tablas operativas), con variación absoluta y %.
- Flujo de aprobación del presupuesto anual (borrador → propuesto → aprobado por junta) y versionado.
- Alertas de desviación (umbral % por partida) vía el sistema de notificaciones existente (`notification_outbox`).
- Control presupuestario opcional en gastos: advertir/bloquear gasto que excede partida disponible.

## Fase 4 — Bancos y conciliación

- `cuentas_bancarias` (banco, número enmascarado, moneda, cuenta contable asociada) — da hogar formal a los bancos multimoneda de Fase 1.
- Importación de extractos (CSV/Excel) a `banco_movimientos`.
- **Conciliación**: matching automático por monto/fecha/referencia contra `pagos` y órdenes de pago, con pantalla de matching manual para el resto; ajustes de conciliación generan asientos (comisiones, intereses).
- Estado de conciliación por cuenta/mes (saldo banco vs saldo libro).

## Fase 5 — Estados financieros y cierre

- **Estado de resultados (P&L)**, **balance general** y **flujo de efectivo** generados desde la balanza, por empresa y por proyecto, exportables (PDF/Excel) y con comparativo vs periodo anterior y vs presupuesto.
- Reporte para asamblea/junta directiva (resumen ejecutivo financiero).
- **Cierre contable formal**: integrar `cierres_mensuales` con la contabilidad (cerrar periodo bloquea publicación de asientos); cierre anual con traslado de resultados (4xxx/5xxx → 3201/3101).
- Unificación de módulos legacy: caja chica como cuenta 1103 con sus movimientos contabilizados; fondo de reserva como cuenta 1301.
- Revaluación periódica de saldos en moneda extranjera (diferencial cambiario 3301).
- Performance: tabla materializada `conta_saldos_mensuales` actualizada al publicar asientos.

## Dependencias y orden

```
Fase 1 (contabilidad) ──► Fase 2 (CxP)      ──► Fase 4 (bancos/conciliación)
        │                                          │
        └──────────► Fase 3 (presupuesto) ◄────────┘
                              │
                              ▼
                     Fase 5 (EEFF + cierre)
```

Fase 3 puede arrancar en paralelo con Fase 2 (solo depende del catálogo de cuentas). Fase 5 requiere 1–4 para que los estados financieros estén completos, aunque P&L/balance básicos funcionan desde Fase 1.
