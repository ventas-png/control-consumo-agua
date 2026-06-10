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

## Fase 2 — Cuentas por pagar / Proveedores ✅

- Tabla `proveedores` (NIT/RFC, contacto, días de crédito, categoría de gasto habitual); `gastos_condominio.proveedor_nombre` migrado → FK `proveedor_id` con backfill por nombre.
- `facturas_proveedor` (CxP) con estados (registrada → aprobada → pagada parcial/total → anulada) y vencimientos; `ordenes_pago` que liquidan facturas (pagos parciales soportados: varias órdenes por factura).
- Antigüedad de saldos por pagar (aging corriente/30/60/90+) server-side (`cxp_antiguedad_saldos`).
- Asientos automáticos: factura aprobada (devengo: gasto contra 2104 Proveedores por pagar), orden pagada (CxP contra banco/caja según método), reversos al anular. Multimoneda heredada de Fase 1.
- Flujo de aprobación: el operador puede registrar facturas/órdenes (RLS INSERT); aprobar, pagar y anular es de admin/owner (RLS UPDATE). Guardas de inmutabilidad: factura aprobada no cambia de monto, factura con pagos vivos no se anula, orden pagada solo se anula.
- Pendiente para fases posteriores: desglose de IVA crédito fiscal, órdenes multi-factura, proyección de pagos.

## Fase 3 — Presupuesto avanzado ✅

- Partidas presupuestarias **mensualizadas y ligadas a cuentas contables**: `presupuestos` (cabecera por empresa/proyecto/año) + `presupuesto_partidas` (cuenta_id, periodo YYYY-MM, monto). El modelo legacy `presupuesto_condominio` (año+categoría) sigue intacto en condominios.
- Comparativo presupuesto vs real calculado **desde la balanza** (asientos publicados, RPC `presupuesto_vs_real`), con variación absoluta, % de ejecución y marca de excedido.
- Flujo de aprobación (borrador → propuesto → aprobado → archivado) con **versionado**: aprobar una nueva versión archiva automáticamente la vigente; aprobados/archivados son de solo lectura.
- UI: tab Presupuesto en Contabilidad — editor mensualizado (cuentas × 12 meses con "repartir anual") y comparativo con filtro por mes.
- Pendiente para fases posteriores: alertas de desviación vía `notification_outbox` y control presupuestario en el alta de gastos (advertir/bloquear partida excedida).

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
