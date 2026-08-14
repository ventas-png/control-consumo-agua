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

- **Catálogo de cuentas** (`conta_cuentas`): jerárquico hasta 8 niveles (clase → grupo → mayor → sub-cuenta → auxiliares), multi-tenant, con plantilla seed LATAM (GT/MX) adaptada a condominios/agua. Cuentas de banco/caja pueden llevar moneda propia.
- **Carga masiva del catálogo** (Excel/CSV): la plantilla lleva **una columna por nivel** (`n_1`…`n_8`, con 0 en los niveles que la cuenta no usa) más `nombre`/`tipo`/`naturaleza`/`es_detalle`/`moneda`/`descripcion`. La jerarquía sale de esos números —el código (`1.1.1.3`) y la cuenta padre se derivan solos— porque un `codigo` con guiones lo convierte Excel en fecha (`1102-03`) y el padre escrito a mano se equivocaba. `tipo` y `naturaleza` se heredan del padre: el nivel 1 declara el tipo y la naturaleza solo se escribe donde va contra-natura (depreciación acumulada y sus hijas). Un mismo archivo se aplica a **varias contabilidades a la vez** (la de la empresa y/o la de cada proyecto), creando padres antes que hijos y omitiendo con motivo lo que ya existe, se repite, cicla o excede el nivel 8. Con la opción de actualizar, las cuentas existentes se refrescan sin moverse de rama. El formato viejo (`codigo` + `padre_codigo`) se sigue aceptando.
- **Baja de cuentas del catálogo ✅**: se elimina una cuenta desde su fila o varias con casillas + barra de selección, sujeto al permiso de borrado del rol. Antes de borrar, la RPC `conta_cuentas_en_uso` dice qué cuentas están referenciadas y por quién —descubre las FK bloqueantes en `pg_constraint`, así que una tabla nueva que apunte a `conta_cuentas` queda cubierta sola—: así el lote borra lo que puede y explica el resto (movimientos, cuentas hijas, presupuesto, mapeos, bancos, compras) en vez de abortar entero con un error de FK. Las cuentas del seed (`es_sistema`) no se borran nunca: trigger `conta_cuenta_proteger_borrado`, se desactivan.
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
- **Carga masiva de partidas (Excel/CSV) ✅**: plantilla con una fila por cuenta y una columna por mes (`codigo_cuenta`/`nombre_cuenta`/`total_anual`/`ene`…`dic`). La cuenta se resuelve por CÓDIGO contra el catálogo del ledger del presupuesto, y solo entran cuentas de detalle activas de ingreso/gasto — el resto se omite con su motivo. Se llenan los meses (estacionalidad) o solo `total_anual`, que se reparte en 12 con `distribuirAnual`; mandar ambos y que no cuadren es error, no una adivinanza. Un código repetido en varias filas se suma (desglose por concepto). La importación NO escribe: vuelca las partidas en el editor (combinando con lo capturado o reemplazándolo) y se guardan con el flujo de siempre, que es el que respeta la inmutabilidad de un presupuesto aprobado.
- **Baja de presupuestos no autorizados ✅**: se elimina un presupuesto en borrador o propuesto (con sus partidas, por CASCADE) desde la lista, sujeto al permiso de borrado del rol. Los aprobados y archivados NO se borran — sostienen el comparativo vs real, las alertas de partida excedida y el versionado — y la regla vive en BD (trigger `presupuesto_proteger_borrado`), no solo en la UI: la RLS dejaba borrar a company_owner/admin sin mirar el estado.
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

## Fase 6 — Ciclo de compras (proveedor autorizado → pago) ✅

El riel que faltaba: **proveedor AUTORIZADO → orden de compra → recepción → factura → contraseña de pago → cancelación**, con todo documento llevando `company_id` + `project_id` (NULL = empresa), así que funciona igual para la contabilidad de la empresa y para la de cada proyecto. Migraciones `20260821*`.

Antes de esto la cadena existía a medias y partida en dos módulos: `proveedores` solo tenía `activo` (sin autorización), `ordenes_compra` vivía en condominios con el proveedor en **texto libre sin FK**, sin líneas, sin contabilidad y con RLS que no miraba el rol; no había recepción (solo un `estado='recibida'` que alguien marcaba), no existía registro de activos fijos ni sus cuentas, la factura no se cuadraba contra nada, y la contraseña de pago no existía.

- **Proveedor autorizado**: `proveedores.estado` (borrador → en_revision → autorizado → suspendido/vetado) con quién autorizó, cuándo y **hasta cuándo** (`autorizacion_vence`: vencida deja de habilitar sin que nadie tenga que acordarse). `proveedor_documentos` guarda la papelería (RTU, patentes, constancias) con su vencimiento. `activo` se conserva como proyección sincronizada por trigger, para no romper la UI que lo lee.
- **Orden de compra contable**: se EVOLUCIONÓ `ordenes_compra` (no una tabla paralela) — `proveedor_id` con backfill por nombre, `project_id` nullable para que **la empresa también compre**, correlativo por contabilidad, totales, y `orden_compra_lineas` con `destino_tipo` (`inventario` | `activo_fijo` | `servicio` | `gasto`), que es la bisagra de toda la fase. **El candado**: aprobar o emitir exige proveedor autorizado y vigente. RLS realineada con `conta_puede_escribir`. La orden **no genera asiento** (es un compromiso); para verlo está la RPC `compras_compromisos`.
- **Recepción con asiento GR/IR**: `recepciones` + `recepcion_lineas`. Al registrar: Dr Inventario/Activo/Gasto contra **Cr 2105 «Bienes y servicios por facturar»**, se mueven existencias y se dan de alta los activos. Cuentas nuevas retro-sembradas en todos los ledgers: `1106`, `14`+`1401..1404`, `1409` Depreciación acumulada (contra-natura), `2105` y `5107`.
- **Inventario**: la recepción alimenta `suministros_condominio` vía `movimientos_suministro`, y de paso se corrigió un bug real — el stock lo recalculaba **el navegador** con dos escrituras no atómicas. Ahora lo hace un trigger, con costo promedio ponderado, y la BD ignora los UPDATE directos a `stock_actual`.
- **Activos fijos**: `activos_fijos` (no existía nada), alta automática desde la recepción, con vida útil y las tres cuentas ya guardadas.
- **Cuadre de 3 vías**: `facturas_proveedor.orden_compra_id` + `factura_proveedor_lineas`, RPC `compras_validar_match` (pedido vs recibido vs facturado, en cantidad y precio) y tolerancias en `compras_config`. Fuera de tolerancia **no se aprueba** salvo que alguien con permiso lo autorice dejando la justificación por escrito. El devengo aprende la ruta GR/IR: con orden y recepción, el debe va contra 2105 (no contra el gasto, que ya se registró al recibir) y la 2105 cierra en cero.
- **Contraseña de pago**: `contrasenas_pago` + `contrasena_pago_facturas` (M:N) — el acuse con correlativo y fecha programada que se le devuelve al proveedor, agrupando **varias facturas suyas**. `ordenes_pago` gana `contrasena_pago_id` con `factura_id` ya opcional y un CHECK de exactamente uno, y **una sola orden cancela todas las facturas de la contraseña**: eso entrega de paso el «órdenes multi-factura» que la Fase 2 dejó diferido. La contraseña no genera asiento (es un acuse, no un hecho económico).
- **Verificación**: `supabase/tests/compras_flujo/run.sh` — 59 invariantes ejecutables contra un PostgreSQL desechable (candado, asiento cuadrado, kardex, activos, tolerancias, reversos simétricos, aislamiento entre contabilidades) y las 5 migraciones aplicadas dos veces para probar idempotencia.

### Límites declarados de la Fase 6

- **Depreciación mensual**: no entra. Se sembraron las cuentas (`1409`, `5107`) y los campos del activo (vida útil, valor residual, las tres cuentas) para que después sea un RPC y un trigger, no un rediseño.
- ~~**`gastos_condominio` ↔ `facturas_proveedor` sin unificar**~~: **cerrado por la Fase 7** (abajo).
- **Variación de precio de compra**: se reconoce como **gasto del periodo**, no se capitaliza. Es a propósito: el kardex y el registro de activos se valúan al precio de la ORDEN, y capitalizar la diferencia dejaría el mayor por encima del auxiliar de forma permanente.
- **`proformas_condominio` → orden de compra**: sigue sin enlace (`convertida_oc` es solo un estado).
- **El alta de un proveedor ya no autoriza por sí sola**: es lo pedido, pero cambia el flujo — un proveedor nuevo nace en `borrador` y no aparece en los selectores hasta que se le autoriza.

## Fase 7 — Un hecho económico, un solo asiento ✅

Cierra el límite más serio que dejó declarado la Fase 6: `gastos_condominio` y `facturas_proveedor` posteaban al **mismo libro sin conocerse**, así que el mismo desembolso capturado por las dos rutas se contabilizaba **dos veces** y nada lo detectaba. Migraciones `20260823*`.

La causa era estructural, no un descuido: la clave de idempotencia de los asientos es `(company_id, origen_tabla, origen_id, origen_evento)`, y como `origen_tabla` forma parte de la clave, un gasto y su factura producen **claves distintas, cero conflicto** y dos débitos a la misma cuenta. El índice garantizaba *un asiento por evento de documento*, no *un asiento por hecho económico*.

**Qué es cada tabla, ahora por escrito** (`COMMENT ON TABLE`): `gastos_condominio` es el desembolso **SIN** factura de proveedor —caja chica, reembolsos, compras menores—; lo facturado entra por el riel de compras y lo contabiliza `facturas_proveedor`.

- **El enlace**: `gastos_condominio.factura_id` → `facturas_proveedor`. Con enlace, `conta_tg_gastos` **no genera asiento**: la factura ya lo hizo. Sin enlace el comportamiento es idéntico al de siempre, así que es aditivo y degradable.
- **Coherencia obligatoria** (`gastos_tg_factura_coherente`): la factura tiene que ser del **mismo ledger** y del **mismo proveedor** (si el gasto no lo tenía, lo hereda), y no puede estar anulada. Enlazar un gasto **ya contabilizado** exige anularlo en la misma operación —su asiento se reversa por la ruta de siempre—, porque un asiento reversado **sigue ocupando su clave única** y no se puede «re-emitir». Desenlazar vuelve a contabilizar: el enlace no es de un solo sentido.
- **`proveedor_id` revivido**: el campo existía desde junio y estaba muerto —la UI capturaba el proveedor como **texto libre** y el payload nunca escribía la FK—. Ahora es un selector del catálogo, con backfill por nombre para las filas creadas después del backfill original. Sin esto la detección no tendría con qué cruzar.
- **Detección del histórico**: `conta_gastos_duplicados` propone pares (gasto, factura) con **puntaje y razones legibles** —mismo comprobante, mismo proveedor, monto dentro de tolerancia, fecha dentro de ±N días—, excluyendo enlazados, anulados y descartados. `conta_duplicados_descartados` recuerda lo ya revisado, con motivo y quién: sin esa memoria el mismo par reaparece cada mes y el reporte se vuelve ruido que nadie mira. **Nunca corrige solo**: propone y una persona decide, en la sub-vista «Posibles duplicados» de Compras.
- **Aviso en la captura**: `conta_gasto_duplicado_probable` avisa al escribir el gasto —«esto ya está como factura A-4471»— con salida a **enlazar** ahí mismo. Advierte, no bloquea.
- **Verificación**: `supabase/tests/gastos_duplicados/run.sh`, con el mismo patrón que la Fase 6. Incluye lo que de verdad mata estos reportes —que **no** marque dos pagos legítimamente distintos del mismo proveedor por el mismo monto— y la no-regresión del gasto sin factura.

## Dependencias y orden

```
Fase 1 (contabilidad) ──► Fase 2 (CxP)      ──► Fase 4 (bancos/conciliación)
        │                     │                    │
        │                     ▼                    │
        │              Fase 6 (compras)            │
        │                     │                    │
        └──────────► Fase 3 (presupuesto) ◄────────┘
                              │
                              ▼
                     Fase 5 (EEFF + cierre)
```

Fase 6 depende de la 2 (proveedores y facturas) y de la 1 (catálogo y asientos automáticos); alimenta a la 3 avisando cuando una orden compromete más de lo presupuestado. Fase 7 depende de la 6 y de la 2, y corrige hacia atrás lo que las dos dejaban duplicado.

Fase 3 puede arrancar en paralelo con Fase 2 (solo depende del catálogo de cuentas). Fase 5 requiere 1–4 para que los estados financieros estén completos, aunque P&L/balance básicos funcionan desde Fase 1.
