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
- **Carga masiva del catálogo** (Excel/CSV): plantilla descargable con `codigo`/`nombre`/`tipo`/`naturaleza`/`padre_codigo`/`es_detalle`/`moneda`/`descripcion`; el padre se referencia por CÓDIGO y se resuelve por ledger. Un mismo archivo se aplica a **varias contabilidades a la vez** (la de la empresa y/o la de cada proyecto), creando padres antes que hijos, calculando el nivel, y omitiendo con motivo lo que ya existe, se repite, cicla o excede el nivel 5. Con la opción de actualizar, las cuentas existentes se refrescan sin moverse de rama.
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
- **Desglose de IVA crédito fiscal ✅ (2026-06-11)**: cuenta 1105 + mapeo `iva_credito` (seed con backfill); el devengo separa gasto (base) + IVA (1105) contra CxP cuando la factura trae `iva_monto` (sin mapeo, comportamiento anterior).
- **Proyección de pagos ✅ (2026-06-11)**: RPC `cxp_proyeccion_pagos` (vencido / 0–7 / 8–14 / 15–30 / +30 / sin fecha por proveedor) + vista "Proyección de pagos" en CxP — complemento forward-looking del aging.
- Diferido a demanda: órdenes multi-factura (una orden liquidando varias facturas). El caso común — pagos parciales y varias órdenes por factura — ya está cubierto; el lote multi-factura requiere rediseñar la relación orden↔factura y se hará cuando la operación lo pida.

## Fase 3 — Presupuesto avanzado ✅

- Partidas presupuestarias **mensualizadas y ligadas a cuentas contables**: `presupuestos` (cabecera por empresa/proyecto/año) + `presupuesto_partidas` (cuenta_id, periodo YYYY-MM, monto). El modelo legacy `presupuesto_condominio` (año+categoría) sigue intacto en condominios.
- Comparativo presupuesto vs real calculado **desde la balanza** (asientos publicados, RPC `presupuesto_vs_real`), con variación absoluta, % de ejecución y marca de excedido.
- Flujo de aprobación (borrador → propuesto → aprobado → archivado) con **versionado**: aprobar una nueva versión archiva automáticamente la vigente; aprobados/archivados son de solo lectura.
- UI: tab Presupuesto en Contabilidad — editor mensualizado (cuentas × 12 meses con "repartir anual") y comparativo con filtro por mes.
- **Control presupuestario y alertas ✅ (2026-06-11)**: RPC `presupuesto_estado_partida` advierte en el alta de gastos cuando la partida del mes quedaría excedida (no bloquea: decisión del admin); trigger `presupuesto_tg_alerta_gasto` notifica in-app a admin/owner vía `notifications_outbox` al contabilizarse el gasto que excede la partida (dedupe por cuenta+periodo).

## Fase 4 — Bancos y conciliación ✅

- `cuentas_bancarias`: banco, número enmascarado (solo últimos dígitos), moneda, atada 1:1 a su cuenta contable de detalle — da hogar formal a los bancos multimoneda de Fase 1.
- Importación de extractos (XLSX) a `banco_movimientos` con dedup por (cuenta, fecha, monto, referencia) y parsers tolerantes (símbolos de moneda, paréntesis negativos, DD/MM/YYYY).
- **Conciliación**: sugerencias automáticas por monto exacto ±3 días contra `pagos` (ingresos) y `ordenes_pago` (egresos), vía RPCs que validan tenant y bloquean conciliar el mismo documento dos veces; desconciliación controlada.
- **Ajustes** (comisiones/intereses): generan póliza automática contra la cuenta contable del banco (gasto_otros / ingreso_otros) y concilian el movimiento; `conta_generar_asiento` v2 acepta `cuenta_id` directo en las líneas.
- Estado de conciliación por cuenta/periodo: saldo libro (moneda base y origen) vs saldo extracto, pendientes y diferencia.
- **Matching difuso ✅ (2026-06-11)**: las sugerencias clasifican su `confianza` — exacta (mismo monto ±3 días) o aproximada (mismo monto a 4–7 días, o diferencia ≤ max(1.00, 0.5%) a ±3 días para comisiones descontadas); la UI distingue ✓/≈. Diferido a demanda: depósitos agrupados (un abono = varios pagos; requiere relación movimiento↔documentos M:N) e importación de formatos bancarios propietarios (se agregan parsers cuando haya muestras reales de los bancos del cliente).

## Fase 5 — Estados financieros y cierre ✅ (núcleo)

- **Estado de resultados (P&L)** por rango de meses, **balance general** al cierre de un periodo (con el resultado sin cerrar integrado al capital para que siempre cuadre) y **flujo de efectivo** por cuenta de dinero (caja/bancos/pasarelas) — todo server-side desde los asientos publicados, por empresa o por proyecto, exportable a Excel.
- **Cierre anual** (`conta_cierre_anual` + `conta_cierres_anuales`): asiento publicado al 31/12 con tipo propio `cierre` que salda ingresos/gastos contra 3201 Resultado del ejercicio; un cierre por año, y el P&L excluye los asientos de cierre para que los años cerrados sigan siendo consultables.
- El bloqueo de asientos en periodos cerrados de proyecto (vía `cierres_mensuales`) viene de la Fase 1.
- **Revaluación FX periódica ✅ (2026-06-11)**: RPC `conta_revaluar_fx(fecha, aplicar)` — previsualiza/aplica el ajuste de cuentas con moneda propia contra 3301 a la tasa vigente (idempotente por cuenta+fecha; sin tasa → no ajusta). UI: botón "Revaluar FX" en la Balanza.
- **Comparativo vs periodo anterior ✅ (2026-06-11)**: toggle en el Estado de resultados que trae el mismo P&L del rango inmediato anterior de igual longitud y muestra Anterior + Variación (absoluta y %, favorable en verde) por cuenta y en totales; exportable a Excel.
- **Reporte ejecutivo para asamblea (PDF) ✅ (2026-06-11)**: botón "Informe asamblea" en EEFF — un PDF con resumen ejecutivo (ingresos/gastos/resultado/efectivo), estado de resultados, balance general (con verificación de cuadre) y flujo de efectivo del periodo.

### Pendientes diferidos a demanda (cierre del roadmap, 2026-06-11)

- **Unificación de caja chica (1103) y fondo de reserva (1301) legacy**: contabilizarlos automáticamente requiere definir la política operativa (fondo fijo vs reposición, migración de saldos legacy) con el cliente; el patrón de triggers ya está probado y se aplica cuando se decida.
- **`conta_saldos_mensuales` materializada**: el volumen actual no lo exige — los RPCs server-side (balanza/EEFF) agregan en milisegundos; se materializa si el tenant más grande lo pide.
- **Depósitos agrupados en conciliación y formatos bancarios propietarios**: ver Fase 4.
- **Órdenes multi-factura**: ver Fase 2.

## Contabilidad por entidad (ledger) ✅ (2026-06-12)

La contabilidad pasó de "una por empresa" a una ENTIDAD CONTABLE por (empresa, proyecto): la empresa lleva sus libros y **cada proyecto lleva los suyos, en su moneda predominante** (la ya configurada del proyecto), con **catálogo, mapeos, folios, apertura, cierre anual y revaluación FX propios**. Decisiones: contabilidades aisladas con **vista consolidada como reporte de solo lectura ✅ (2026-06-12)** — RPC `conta_consolidado` y vista "Consolidado" en EEFF: una fila por entidad (empresa + proyectos) con P&L del rango y balance al corte convertidos a la moneda de la empresa con la tasa de cierre del periodo; entidades sin tasa se muestran en su moneda, fuera del total y con advertencia —, tipos de cambio compartidos por empresa con conversión cruzada vía pivote (`conta_tasa_entre`), bancos asignables a un ledger, y los asientos pre-ledger migrados a los libros de la empresa con nota `[pre-ledger]`. La UI tiene un **selector de contabilidad** (Empresa | proyecto) que fija el ledger activo para los 9 tabs. Migraciones `20260612*`.

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
