# Compras · Bloque B — evidencia de validación en el sandbox

Entorno: `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`), identidad confirmada por nombre y ref. **Producción no se tocó.** Fecha: 2026-10-02. Autorización del propietario: aplicar las 7 migraciones por el workflow con la rama como ref, ejecutar el guion (transaccional, revertido) y crear padrón persistente (no se creó: ver «No ejecutado»).

## 1. Estado antes y después (historial real, solo lectura)

| Momento | Última migración registrada | Del bloque B aplicadas | Datos `5b5b…` |
|---|---|---|---|
| Antes | `20261020000800` | 0 (sin `revision`, sin `orden_compra_eventos`, sin `proveedor_id` en suministros) | 0 |
| Después | `20261021000600` | 7 | 0 |

## 2. Aplicación, una por una y en orden (workflow `Apply Migrations to Sandbox`, `workflow_dispatch`, ref = `claude/keen-carson-f9vmw3`, SHA `12bbc44f`)

Tras cada corrida se leyó la versión registrada y se verificó el esquema que esa migración introduce:

| # | Migración | Corrida | Verificación posterior |
|---|---|---|---|
| 1 | `20261021000000_compras_orden_ciclo_y_eventos` | run 26 ✅ | columnas `revision`, `motivo_devolucion`; tabla `orden_compra_eventos` con RLS; `aprobacion_separada`; 3 triggers de ciclo |
| 2 | `20261021000100_compras_aceptacion_y_conformidad` | run 27 ✅ | `tipo`, `destino_fisico`, `respaldo_path`, `clave_idempotencia`; `cantidad_rechazada`, `motivo_rechazo`; 5 checks; `uq_recepciones_clave` |
| 3 | `20261021000200_compras_factura_diferencias` | run 28 ✅ | `compras_validar_match` devuelve IVA y moneda |
| 4 | `20261021000300_compras_seguimiento` | run 29 ✅ | 2 funciones; 0 permisos para `anon`, 2 para `authenticated` |
| 5 | `20261021000400_operaciones_proveedor_compartido` | run 30 ✅ | `proveedor_id` en suministros y proformas, `orden_compra_id` en proformas; 2 triggers; 2 funciones |
| 6 | `20261021000500_compras_integridad_cruzada` | run 31 ✅ | 4 triggers de integridad |
| 7 | `20261021000600_compras_correcciones_revision` | run 32 ✅ | `compras_recepcion_crear`, `recepciones.hash_contenido`; versión registrada |

## 3. Recorrido funcional (`sandbox_flujo_completo.sql`)

Una sola sentencia que **revierte todo** y termina SIEMPRE en excepción. Cómo se lee: `GUION_OK_REVERTIDO` = todas las comprobaciones coinciden con lo esperado (excepción esperada, código P0001); `GUION_FALLO` = alguna no coincide; cualquier otro mensaje = fallo real del recorrido. Cada línea trae **obtenido y esperado**; el veredicto sale de compararlos, no de que exista el mensaje.

**Resultado en el sandbox: `GUION_OK_REVERTIDO: 52 comprobaciones coinciden con lo esperado`.** Verificación posterior: 0 empresas, proyectos, usuarios, órdenes, proveedores y asientos de prueba. (El mismo guion corrió antes en PostgreSQL local con el mismo resultado; un primer intento local detectó 11 diferencias de formato/expectativa, lo que prueba que el comparador sí falla cuando debe.)

Cubre: orden aprobada y emitida (solicitante ≠ aprobador); **condiciones inmutables** (cambiar proveedor/moneda de una orden emitida y marcarla «recibida» a mano → rechazados); **recepción transaccional e idempotente** (nueva con clave; reintento = mismo documento; misma clave con otro contenido → conflicto; línea ajena → falla sin cabecera huérfana); recepción parcial (40 de 100, 5 rechazados con motivo); conformidad de servicio sin inventario ni activo; recepción final y sobre-recepción rechazada; dos facturas parciales; **cuentas personalizadas** (servicio en `6205` por cuenta explícita; activo en `9101` por mapeo; inventario `1106`; puente `2105` en 0; CxP `2104` = 2576); asientos balanceados y sin borradores; sin duplicados (3 de recepción, 2 de factura); pendientes por línea (60/1/1 tras la parcial; 0 al final); seguimiento (comprometido 2576, recibido 2300, facturado 2576, pagado 0; el operador no ve facturas); **restricciones**: otra empresa no ve ni recibe ni factura contra la orden; otro proyecto de la misma empresa no la ve ni lista el proyecto; factura duplicada rechazada; operador sin permisos no aprueba.

## 4. No ejecutado (pendiente explícito)

* **Interfaz conectada al sandbox y capturas**: el entorno de esta sesión no alcanza `jwpmivhvlstslncrtokb.supabase.co` (el proxy de salida deniega el host por política de la organización). Hace falta añadir ese host a los dominios permitidos del entorno (menú del entorno → Edit → Network access) o ejecutar la prueba desde otra máquina.
* **Padrón persistente «ZZ Validación Bloque B»**: no se creó. Solo tendría sentido junto con la prueba de interfaz; el guion transaccional no deja residuos. Si se crea, usará UUID `5b5b1…` (distintos de los del guion) y quedará identificado por ese prefijo.
* Las pruebas de CI, E2E y la suite SQL local siguen siendo evidencias distintas y no sustituyen a la interfaz contra el sandbox.
