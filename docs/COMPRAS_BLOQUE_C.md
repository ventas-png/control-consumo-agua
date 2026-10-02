# Compras · Bloque C — inventario desde la orden, carga masiva de renglones, respaldos de recepción y seguimiento compartido

Sobre `main` actualizado (incluye #913). **No hay un segundo motor de compras**: se reutiliza el catálogo
compartido de proveedores y el circuito `ordenes_compra → recepciones → facturas_proveedor → contrasenas_pago`.
Este documento recoge **solo las brechas**; lo que ya existía se cita para dejar claro que no se tocó.

## 1. Qué ya existía y qué faltaba

| Tema | Ya existía (no se rehízo) | Brecha cubierta aquí |
|---|---|---|
| **A. Inventario desde la orden** | `orden_compra_lineas.suministro_id` y `destino_tipo`; trigger de recepción que da entrada de inventario y asiento por **aceptado**; rechazado como cantidad aparte | El insumo era opcional y sin validar: un renglón de inventario podía aprobarse sin insumo y una recepción no sabía a qué existencia entrar. Faltaban empresa/proyecto/unidad/inactivo y el selector. Sin índice único, un reintento podía duplicar la entrada |
| **B. Carga masiva de renglones** | Importador de proveedores/contratos (#907) y el lector de archivos del cliente | No existía importación de renglones de una orden. Se generalizó el lector (`ClavePlantilla`) y se creó el circuito preview → confirmación → aplicar en servidor |
| **C. Respaldos de recepción** | `recepciones.respaldo_path` (un archivo opcional al crear) y el patrón de bucket privado de `contratos-respaldo` | Un solo archivo, sin metadatos, hash, tipo ni consulta posterior; nada para conformidad de servicio; la evidencia podía cambiarse |
| **D. Seguimiento compartido** | RPC `compras_seguimiento_orden` / `compras_seguimiento_lista` y el modal por orden (Bloque B) | Sin pantalla filtrable; la lista no traía facturado/pagado/pendientes; el detalle no traía pagos ni respaldos |

## 2. Qué se implementó

**A.** Migración `20261022000000_compras_inventario_desde_orden`: trigger de renglón que valida que el insumo exista en la
empresa **y en el proyecto de la orden**, esté activo, tenga la **misma unidad**, y que el destino sea `inventario` (un renglón con
insumo no se mezcla con activo, servicio ni gasto). Con la orden aprobada el insumo, destino y unidad quedan congelados; una orden
con renglones de inventario sin insumo **no se aprueba**. Índice único `uq_mov_suministro_origen_recepcion`: una entrada por línea de
recepción, aunque se reintente. La entrada sigue siendo **solo lo aceptado**; emitir la orden o rechazar no mueve existencias.
UI: selector de insumo («ZZ Cloro · litro · stock 0») en la orden de Contabilidad y de Operaciones.

**B.** Migración `20261022000100_compras_lineas_importar`: tablas de lote/filas con RLS, `compras_lineas_importar_previsualizar`
(valida todo, errores y advertencias **por fila**, no escribe renglones), `…_aplicar` (todo o nada, transaccional, idempotente por
lote; el mismo contenido en la misma orden se rechaza mientras sus renglones sigan ahí) y `…_descartar`. **No crea proveedores,
cuentas ni insumos** (nombre/código inexistente o ambiguo = error); no aprueba, emite, recibe ni contabiliza; solo órdenes en
borrador; tope 500 filas / 5 MB; valores que empiezan con `= + - @` se rechazan. Escritura directa a las tablas del lote cerrada
por trigger (`conta.allow_system_write` / `compras.import_rpc`). El navegador solo lee el archivo a texto; la validación es del servidor.

**C.** Migración `20261022000200_compras_respaldos_de_entrega` (nombre sin «recepcion» a propósito: el guard de la cadena de recepción
del sembrado sandbox clasifica por nombre): bucket **privado** `recepciones-respaldo` (PDF/JPG/PNG/WEBP, 10 MB), ruta
`<empresa>/<proyecto|empresa>/<recepción>/<archivo>` autorizada por función DEFINER (empresa, proyecto, permiso de ver/capturar
órdenes), tabla `recepcion_respaldos` (nombre, tipo `entrega|conformidad`, mime, bytes, **sha256**, quién y cuándo) y
`compras_recepcion_adjuntar` (idempotente por recepción+ruta; otro contenido en la misma ruta = conflicto). La evidencia **no se
edita ni se borra** una vez la recepción salió de borrador; se puede **añadir** evidencia adicional y eso **no altera** asientos,
movimientos ni existencias (probado). Un servicio acepta «conformidad», no «entrega».

**D.** Migración `20261022000300_compras_seguimiento_pendientes`: redefine las dos RPC (el detalle suma pagos y respaldos; la lista
suma facturado, facturado neto, pagado y pendientes por recibir/facturar/pagar y conteos). Pantalla `SeguimientoComprasPanel`
(Contabilidad › Compras › Seguimiento y Operaciones › Órdenes compra › Seguimiento) con filtros por proyecto, proveedor, estado y
fechas. Cada orden va **en su moneda; nunca se suman monedas** (los totales se agrupan por moneda). Lo financiero (facturado, pagado,
pendientes por facturar/pagar, facturas y pagos del detalle) se devuelve **NULL desde el servidor** sin
`prov_puede_ver_papeleria()`: Operaciones no lo recibe ni por pantalla ni por API de las RPC.

## 3. Matriz de migraciones por ambiente

| Migración | Local / CI | Sandbox (`jwpmivhvlstslncrtokb`) | Producción |
|---|---|---|---|
| `20261022000000_compras_inventario_desde_orden` | aplicada y probada | **aplicada** (workflow, rama del PR) | **pendiente** |
| `20261022000100_compras_lineas_importar` | aplicada y probada | **aplicada** | **pendiente** |
| `20261022000200_compras_respaldos_de_entrega` | aplicada y probada | **aplicada** (bucket, políticas y grants verificados) | **pendiente** |
| `20261022000300_compras_seguimiento_pendientes` | aplicada y probada | **aplicada** | **pendiente** |

Producción **no se tocó**. Las cuatro se aplicarían solas al fusionar a `main` (`apply-migrations-prod.yml`); por eso el PR queda
**sin fusionar**. Tras desplegar habrá que refrescar la huella de producción (`huella-produccion.json`); el auditor de drift
quedará en rojo hasta que #915 (huella) esté en `main` y se fusione `main` en esta rama.

## 4. Evidencia

**Pruebas automatizadas**
- PostgreSQL real (`supabase/tests/compras_bloque_b/run.sh`, EXIT 0): suites de inventario, importación, respaldos y seguimiento +
  escenarios de **concurrencia con sesiones reales**: **L** misma recepción registrada por dos sesiones (una entrada, un asiento),
  **M** mismo lote aplicado a la vez (una creación), **N** dos lotes iguales a la vez (uno se aplica, otro se rechaza). Guard
  append-only de migraciones.
- Vitest completo: **438 archivos / 7 021 pruebas en verde** (1 archivo y 157 pruebas omitidas de antes); `tsc` y `eslint` sin errores. Dos guards que fallaron en una
  corrida previa (envoltura `(SELECT …)` de políticas RLS y cadena de recepción del sembrado sandbox) se corrigieron en `36f6c8c8`. Componentes nuevos: importación (doble clic no
  duplica), respaldos, panel de seguimiento, selector de insumo.

**Sandbox, recorrido de aceptación** (`sandbox_bloque_c.sql`, reversible, **54/54 OK**, sin residuo): importar con errores por fila
→ corregir → confirmar → reintento no duplica → aprobar/emitir → recepción parcial 40 aceptadas + 5 rechazadas (existencia 40, una
entrada, un asiento; reintento no duplica) → respaldo (idempotente, tipo/tamaño/objeto inexistente/otra empresa rechazados) →
completar (60) + conformidad de servicio → conciliación **1106 = 1 000 = valor de entradas** → factura (reintento = misma) →
aprobar → seguimiento: contador ve 1 456 facturado, operador recibe NULL, otra empresa ve 0.

**Pantalla contra el sandbox** (`docs/capturas/compras_bloque_c/`, hechas con navegador real, 0 peticiones a producción):
`C1` vista previa con errores por fila · `C2/C2b` sin errores y confirmación previa al guardado · `C3/C4` renglones guardados y orden
aprobada (OC-000003, GTQ 1 456) · `C5` seguimiento (contador/admin) · `C6` seguimiento del **operador sin columnas financieras** ·
`C7/C8` respaldos de una recepción registrada (subida real al bucket) · `C9` selector de insumo en la nueva orden.
Lo que se hizo **solo por SQL** (no por pantalla): concurrencia, aislamiento entre empresas, rechazo de tipos/tamaños, conciliación.

## 5. Riesgos y brechas que quedan

1. **Lectura directa de tablas**: `facturas_proveedor` y `conta_asientos` tienen RLS a nivel de empresa; un usuario de la empresa
   (incluido Operaciones) puede leerlas con la API de tablas aunque las RPC de seguimiento no las expongan. Es **previo a este bloque** y
   no se cambió; cerrarlo exige una política por permiso y revisar quién las lee hoy.
2. La creación de una orden desde la interfaz sigue en **dos peticiones** (cabecera y renglones), sin transacción (la importación sí es
   transaccional). Una caída entre ambas deja una orden en borrador sin renglones, visible y corregible.
3. `compras_tg_factura_acumular` captura excepciones y las ignora; se documenta, no se cambió (fuera de alcance).
4. Importar es todo o nada y rechaza el mismo contenido mientras sus renglones existan: para cargar de nuevo hay que borrar o editar.
5. La evidencia de una recepción contabilizada es **inmutable**: un archivo subido por error solo se corrige añadiendo otro (decisión).
6. Padrón de pruebas del sandbox (`5b5b1000…`) conservado; esta validación añadió la orden OC-000003 y un respaldo en REC-000001
   (este último no se puede retirar por diseño).
