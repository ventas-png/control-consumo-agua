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
| Aprobación / emisión | trigger de proveedor autorizado | máquina de estados en servidor, historial append-only, condiciones **congeladas desde la aprobación y también al emitir y después** (ni en la misma petición que emite), «devolver a borrador» = revisión con motivo y como operación propia, solicitante inmutable | **separación solicitante/aprobador**: implementada como bandera `compras_config.aprobacion_separada`, **apagada** (decisión §3) |
| Recepción parcial por línea | recepción GR/IR | aceptado/rechazado + motivo, destino físico, respaldo, responsable, bloqueo de filas contra concurrencia; **creación transaccional e idempotente** (`compras_recepcion_crear`: cabecera y líneas en una transacción; misma clave y contenido = recupera el mismo documento; otro contenido = rechazo) | — |
| Servicios | `destino servicio` | conformidad de servicio (`recepciones.tipo='servicio'`): no mueve inventario ni activos, devenga con la política existente | — |
| Activo desde equipo / inventario | triggers Fase 6 | cuentas del activo resueltas **por significado** (`conta_cuenta_especial`), no por código: se restauró lo que 20261021000100 había revertido (corregido en 20261021000600) | — |
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
7. `20261021000600_compras_correcciones_revision` — **correctiva** (#911): cuentas semánticas en la recepción de activos, condiciones congeladas al emitir y después, y `compras_recepcion_crear` (creación transaccional e idempotente) con `recepciones.hash_contenido`.
8. `20261021000700_compras_factura_aprobacion_endurecida` — **correctiva, posterior al merge de #911**: el servidor sella `aprobada_por`/`aprobada_at`/`match_forzado_por` con `auth.uid()` (el cliente no puede suplantar al autorizador); una factura ligada a una orden y sin renglones no se aprueba nunca; solo precio e IVA son forzables y con justificación (≥5 caracteres) y sesión real; renglón sin línea de orden, moneda distinta, facturar antes de recibir y exceso sobre lo pedido no son forzables (`COMPRAS_MATCH_NO_FORZABLE`).
9. `20261021000800_compras_factura_crear_transaccional` — `compras_factura_crear(company, project, cabecera, renglones)`: cabecera y renglones en una sola transacción, idempotente por `clave_idempotencia` + hash de contenido (misma clave y otro contenido → rechazo), valida empresa/proyecto/proveedor/orden/renglones, SECURITY INVOKER (RLS y permisos vigentes). **Aplicadas en el sandbox; pendientes en producción** (se aplicarían solas al fusionar el PR a `main`).

Ninguna edita una migración aplicada ni renumera: las correcciones de revisión son una migración NUEVA porque las seis primeras pueden estar ya aplicadas en Preview u otro entorno. Las notas «CÓMO REVERTIR» de las cabeceras de 0000…0500 quedan **superadas** por la sección 6 de este documento (no son reversiones sin pérdida).

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

* **Local, PostgreSQL 16 real** (`bash supabase/tests/compras_bloque_b/run.sh`): cadena completa de migraciones, cada migración nueva dos veces, 6 suites (ciclo, recepción, factura, seguimiento, operaciones y **correcciones de revisión**: cuentas semánticas con un catálogo SIN 1401/1409/5107, condiciones congeladas con peticiones directas al servidor, creación transaccional con fallo de líneas / respuesta perdida / clave con otro contenido) y **6 pruebas de concurrencia con sesiones reales** (dos recepciones que no caben, dos facturas por las mismas unidades, misma clave de idempotencia, y por la función: misma clave y contenido a la vez, misma clave con contenido distinto a la vez, fallo de línea con dos sesiones). Regresiones locales: `compras_flujo`, `proveedores_pr_a` (una aserción ajustada: saltarse la aprobación ahora es transición inválida), `migrations-guard`, `drift:auditar`.
* **Local, vitest/tsc/eslint**: seguimiento, esquema de recepción, panel de históricos y carga masiva de suministros + toda la suite existente.
* **CI**: lo que corra el PR; no se sustituye por lo anterior.
* **Sandbox real**: las 7 migraciones se aplicaron una por una y se verificaron, y el guion de recorrido completo terminó en `GUION_OK_REVERTIDO` (52/52, sin residuos). Detalle en `docs/COMPRAS_BLOQUE_B_EVIDENCIA_SANDBOX.md`. **Pendiente**: interfaz conectada al sandbox y capturas (el entorno de la sesión no alcanza el host).
* **Capturas de pantalla del flujo completo: no incluidas.**

## 5. Configuración antes de operar

Proveedores autorizados y habilitados por proyecto; catálogo contable sembrado (`compras_por_facturar` 2105, CxP 2104, IVA crédito); tasas mensuales de cada moneda extranjera; permisos de contabilidad para quien aprueba facturas; decidir `aprobacion_separada`.

## 6. Despliegue y recuperación (sin ejecutar nada)

* Sandbox `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`): **las 7 migraciones del bloque quedaron aplicadas el 2026-10-02** (última registrada `20261021000600`), una por una y en orden, por el workflow `apply-migrations-sandbox` disparado con la rama como ref (runs 26–32, SHA `12bbc44f`), con verificación de versión y esquema tras cada una. Detalle y resultado del recorrido completo en `docs/COMPRAS_BLOQUE_B_EVIDENCIA_SANDBOX.md`. Antes de aplicar se midió el historial real (estaba en `20261020000800`); cualquier cifra previa de pendientes quedó obsoleta.
* **Procedimiento usado para probar la rama sin fusionar**: el workflow (ya en `main` por #912) hace `checkout` de la referencia con la que se dispara; la rama trae el workflow (se trajo `main` a ella) y las 7 migraciones, así que se disparó 7 veces con la rama como ref. El PR no se fusionó. Cuando se fusione, el sandbox ya tendrá estas versiones registradas y el workflow no las repetirá.
* **Datos de prueba**: el guion es transaccional y se revierte; se verificó 0 residuos. El padrón persistente «ZZ Validación Bloque B» (UUID `5b5b1…`) **no se creó**: solo serviría para la prueba de interfaz, que está bloqueada (el entorno de la sesión no alcanza el host del sandbox; ver evidencia §4).
* Validación funcional: `supabase/tests/compras_bloque_b/sandbox_flujo_completo.sql` terminó en `GUION_OK_REVERTIDO` (52/52 comprobaciones obtenido=esperado) en el sandbox, y antes en PostgreSQL local. La excepción final es esperada y se distingue de un fallo real por su prefijo (`GUION_OK_REVERTIDO` / `GUION_FALLO` / cualquier otro mensaje).
* Producción: no se toca. El límite de 10 por corrida obliga a desplegar las 7 de este bloque (6 + la correctiva `…0600`) en una corrida propia, después de que #907 (ya aplicado) y las demás estén al día.
* **Recuperación — NO es una reversión sin pérdida.** Las migraciones del bloque agregan tablas y columnas que, una vez desplegadas, empiezan a guardar datos reales: `orden_compra_eventos` (historial de la orden), `recepcion_lineas.cantidad_rechazada` y `motivo_rechazo`, `recepciones.tipo`, `destino_fisico`, `respaldo_path`, `clave_idempotencia` y `hash_contenido`, `ordenes_compra.revision` y `motivo_devolucion`, `compras_config.aprobacion_separada`, `proveedor_id` y vínculos en suministros/proformas, entre otras. **Eliminar esas tablas o columnas con los `DROP` de las cabeceras BORRA lo registrado después del despliegue** (historial, rechazos y sus motivos, claves de idempotencia, vínculos con el catálogo) y no se puede reconstruir. Lo único que se puede deshacer sin pérdida son las **funciones y triggers** (restaurando la versión anterior con `CREATE OR REPLACE`), con la salvedad de que volver a una versión anterior reabre los defectos que la corrigieron (la recepción volvería a buscar `1401/1409/5107` por código, la orden emitida volvería a no tener candado).
  * Antes de desplegar: respaldo verificable (copia o punto de restauración) y decidir quién autoriza perder lo posterior si hubiera que volver atrás.
  * Si algo falla después de operar: **corregir hacia adelante** con una migración nueva (el camino de #911), o restaurar la copia de respaldo **aceptando perder todo lo registrado desde entonces**.
  * No eliminar `recepciones.hash_contenido` ni `clave_idempotencia` con recepciones ya creadas: se pierde la huella que distingue un reintento legítimo de una clave reutilizada con otro contenido.
* Lo que sí es seguro: las migraciones son aditivas, así que desplegarlas **no** cambia ni borra filas existentes; el riesgo está en deshacerlas, no en aplicarlas.
