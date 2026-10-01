# Compras · Bloque B — orden, recepción, factura y seguimiento integrados

Construido sobre el catálogo compartido del PR A (#907) y la contabilidad del
#904, **sin un segundo motor de compras**: se endurece y se conecta el riel de la
Fase 6 (`ordenes_compra` → `recepciones` → `facturas_proveedor` → `contrasenas_pago`).

## 1. Matriz de brechas

| Tema | Ya existía | Se conectó / implementó aquí | Pendiente o requiere decisión |
|---|---|---|---|
| Proveedor por id en OC, contratos | #907 | OC en Operaciones usa `ProveedorSelector` | — |
| Proveedor por id en Suministros y Proformas | texto libre | `proveedor_id` + trigger (misma empresa, no suspendido/vetado, no suspendido/retirado en el proyecto) + selector; carga masiva liga por id (nombre repetido = ambiguo, se rechaza) | — |
| Históricos sin vínculo | vista previa de contratos (#907) | `operaciones_sin_proveedor_vista_previa()` + `operaciones_vincular_proveedor()` + panel: se identifica, **nunca se une solo**, uno a uno | — |
| Proforma → orden | solo un estado | `proformas_condominio.orden_compra_id`, misma empresa/proyecto/proveedor | proformas históricas sin proveedor del catálogo no se convierten hasta vincularlas |
| Cuenta de línea | resolvedor #907 | sin cambios | — |
| Aprobación / emisión | trigger de proveedor autorizado | máquina de estados en servidor, historial append-only, congelamiento tras aprobar, «devolver a borrador» = revisión con motivo, solicitante inmutable | **separación solicitante/aprobador**: implementada como bandera `compras_config.aprobacion_separada`, **apagada** (decisión §3) |
| Recepción parcial por línea | recepción GR/IR | aceptado/rechazado + motivo, destino físico, respaldo, responsable, idempotencia (`clave_idempotencia`), bloqueo de filas contra concurrencia | — |
| Servicios | `destino servicio` | conformidad de servicio (`recepciones.tipo='servicio'`): no mueve inventario ni activos, devenga con la política existente | — |
| Activo desde equipo / inventario | triggers Fase 6 | verificado con pruebas, sin cambios | — |
| Factura vs orden | cuadre cantidad/precio | + **IVA** (prorrateado) y **moneda**; moneda distinta nunca cuadra; sin autoaprobar; cabecera forzada deja quién/por qué | tolerancias: se usan las ya configuradas (`compras_config`, defaults 0 % cantidad / 5 % precio) |
| Varias facturas por orden / una por varias recepciones | parcial | probado (parcial, final, cierre automático de la orden) | — |
| Aislamiento entre empresas | RLS | triggers de integridad cruzada (recepción/factura/líneas contra orden de otra empresa o proveedor) | — |
| Moneda extranjera y periodo | #904 | probado: tasa mensual, sin tasa = asiento en borrador «tipo de cambio pendiente», no recalcula lo contabilizado, factura de mes cerrado va al periodo abierto | — |
| Configuración contable faltante | bandeja #929 | probado: la factura se aprueba, **no** se contabiliza, queda pendiente con motivo, y reprocesa una sola vez | — |
| Seguimiento compartido | `compras_compromisos` por proveedor | `compras_seguimiento_orden` / `compras_seguimiento_lista` + `SeguimientoOrdenModal` en Operaciones y Compras; comprometido/recibido/facturado/pagado separados; facturas/pagos solo con `prov_puede_ver_papeleria()` | filtros de la lista: RPC lista, **sin pantalla de listado dedicada** todavía |
| Pago a proveedor | contraseñas + órdenes de pago | sin cambios | **anticipos a proveedor: no implementados** (no se reutiliza saldo a favor de clientes) |
| Carga masiva de líneas de OC | importador #907 (proveedores/contratos) | **no implementado** (ver §3 decisión 7) | pendiente |

## 2. Migraciones (orden, todas nuevas, solo aditivas)

1. `20261021000000_compras_orden_ciclo_y_eventos` — ciclo, historial, revisión, solicitante, bandera de separación.
2. `20261021000100_compras_aceptacion_y_conformidad` — aceptado/rechazado, conformidad de servicio, idempotencia.
3. `20261021000200_compras_factura_diferencias` — IVA y moneda en el cuadre; bloqueo de líneas al aprobar.
4. `20261021000300_compras_seguimiento` — dos RPC de solo lectura.
5. `20261021000400_operaciones_proveedor_compartido` — `proveedor_id` en suministros/proformas, vínculo, vista previa.
6. `20261021000500_compras_integridad_cruzada` — 4 triggers de integridad entre empresa/orden/proveedor.

Ninguna edita una migración aplicada ni renumera. Reversa documentada en la cabecera de cada archivo.

## 3. Decisiones que **no** se tomaron (necesitan al usuario)

No existe documento que las resuelva; el código no las asume.

1. **Umbrales y aprobadores** (por monto, por tipo). *Hoy:* aprueba quien tenga el permiso. *Opción A:* mantenerlo. *Opción B:* matriz monto→rol (requiere tabla de umbrales).
2. **Separación solicitante/aprobador.** Existe `aprobacion_separada` (apagada). *Encender* impide autoaprobar (`COMPRAS_OC_AUTOAPROBACION`) pero bloquea a empresas de una sola persona.
3. **Tolerancias** distintas a 0 %/5 % por categoría o monto.
4. **Presupuesto**: advertir o bloquear al emitir (hoy: ninguno desde compras).
5. **Compra sin orden / emergencia** y **cuándo el contrato es obligatorio**.
6. **Facturas con distribución entre ledgers** (una compra que reparte entre proyectos): no se mezcla; una factura = un proveedor, una empresa, una contabilidad.
7. **Importación masiva de líneas de OC**: la infraestructura de lotes del #907 es específica de proveedores/contratos; aplicarla a líneas exige decidir cómo se agrupan en cabeceras y cómo se resuelven productos. No se implementó para no inventar el diseño.
8. **Anticipos a proveedor**, **devoluciones/notas de crédito** y **diferencias posteriores**: sin diseño ni implementación; no se automatizó nada.
9. **Reconocimiento de recepciones sin factura (GR/IR)**: se conserva la política vigente (Dr destino / Cr 2105 «por facturar»); la variación de precio sigue a gasto.
10. **Centro de costo, bodega y destino `costo`** en la línea: el esquema actual no los tiene; se mantienen destino inventario/activo/servicio/gasto y `destino_fisico` de texto.

## 4. Pruebas — qué es local, qué es CI y qué **no** se hizo

* **Local, PostgreSQL 16 real** (`bash supabase/tests/compras_bloque_b/run.sh`): cadena completa de migraciones, cada migración nueva dos veces, 5 suites (ciclo, recepción, factura, seguimiento, operaciones) y **3 pruebas de concurrencia con sesiones reales** (dos recepciones que no caben, dos facturas por las mismas unidades, misma clave de idempotencia). Regresiones locales: `compras_flujo`, `proveedores_pr_a` (una aserción ajustada: saltarse la aprobación ahora es transición inválida), `migrations-guard`, `drift:auditar`.
* **Local, vitest/tsc/eslint**: seguimiento, esquema de recepción, panel de históricos y carga masiva de suministros + toda la suite existente.
* **CI**: lo que corra el PR; no se sustituye por lo anterior.
* **Sandbox real**: **no ejecutado** (ver §6). No hay evidencia de sandbox en este PR.
* **Capturas de pantalla del flujo completo: no incluidas.**

## 5. Configuración antes de operar

Proveedores autorizados y habilitados por proyecto; catálogo contable sembrado (`compras_por_facturar` 2105, CxP 2104, IVA crédito); tasas mensuales de cada moneda extranjera; permisos de contabilidad para quien aprueba facturas; decidir `aprobacion_separada`.

## 6. Despliegue y recuperación (sin ejecutar nada)

* Sandbox `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`): última migración registrada `20261004000200`; **faltan 31 archivos** (`20261005000000` … `20261021000500`). **No se escribió ni se escribirá sin autorización**. Si se autoriza, se aplican **archivo por archivo, en orden** (no se sube el límite de 10 por corrida del workflow: tres corridas), con verificación de versión antes y después.
* Producción: no se toca. El límite de 10 por corrida obliga a desplegar las 6 de este bloque en una corrida propia, después de que #907 (ya aplicado) y las demás estén al día.
* Recuperación: cada migración es aditiva; las columnas nuevas son nulas/por defecto, así que se puede revertir con los `DROP` de cada cabecera sin pérdida de datos previos. Los documentos creados con las reglas nuevas conservan su historial.
