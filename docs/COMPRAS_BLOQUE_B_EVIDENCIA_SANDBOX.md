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

## 4. Qué se probó y con qué método (no se mezclan)

| Capa | Dónde | Estado | Qué demuestra | Qué NO demuestra |
|---|---|---|---|---|
| **Pruebas SQL locales** | PostgreSQL 16 efímero (`compras_bloque_b/run.sh`) | ✅ | reglas del servidor, concurrencia real, migraciones dos veces | nada del sandbox ni de la interfaz |
| **CI de GitHub** (último SHA `b9241185`) | GitHub Actions | ✅ 9/9 checks reales en verde: Type-check/test/build, E2E, RLS harness, RLS sandbox de recepción, Coverage gate, drift (auditor y pruebas), Supabase Preview, Vercel | el código compila, las suites del repo pasan | el comportamiento en el sandbox compartido |
| **SQL en el sandbox real** | `control-agua-rls-sandbox` | ✅ 7 migraciones aplicadas y verificadas; guion `GUION_OK_REVERTIDO` 52/52, 0 residuos | el esquema y las reglas funcionan sobre el sandbox, de punta a punta, como SQL | que la interfaz las use bien |
| **Interfaz conectada al sandbox** | navegador contra `jwpmivhvlstslncrtokb` | ⛔ **NO realizada** | — | — |

Las pruebas de componentes (vitest) prueban pantallas con datos simulados; **no** sustituyen a la interfaz contra el sandbox.

## 5. Prueba de interfaz: bloqueo y protocolo (pendiente de habilitación)

**Bloqueo.** El egress de la sesión deniega `jwpmivhvlstslncrtokb.supabase.co:443` (política de red de la organización). Se reprobó el 2026-10-02: sigue denegado. **No se elude** (ni túneles ni otro host). Opciones autorizadas:
1. El propietario añade ese host a los dominios permitidos del entorno (menú del entorno → Edit → Network access), o
2. la prueba se ejecuta desde una máquina con acceso permitido siguiendo este protocolo.

**Control de destino (obligatorio antes de abrir la aplicación).**
- `VITE_SUPABASE_URL` debe ser exactamente `https://jwpmivhvlstslncrtokb.supabase.co`; `VITE_SUPABASE_ANON_KEY` debe ser la llave pública de **ese** proyecto (su payload JWT dice `ref: jwpmivhvlstslncrtokb`).
- Se aborta si la URL o la llave contienen la referencia de producción (`nnsqmeigtgewatameexo`) o si el ref de la llave difiere.
- Con la app abierta se comprueba en la pestaña Red del navegador (o en el log de Playwright) que **todas** las peticiones a Supabase van al host del sandbox y ninguna al de producción; esa lista se adjunta como evidencia.

**Datos de prueba.** Padrón persistente identificable «ZZ Validación Bloque B» (UUID `5b5b1…`, distintos de los del guion `5b5b0…`), con usuarios administrador, operador y contador **de prueba**; credenciales fuera del repositorio. No se borra ni se modifica nada ajeno; al terminar se decide con el propietario si el padrón se conserva o se retira (solo filas `5b5b1…`).

**Recorrido de interfaz a registrar (con captura por paso y resultado esperado/obtenido).**
1. Operaciones → Órdenes de compra: crear con proveedor del catálogo (selector por id); aprobar y emitir (admin ≠ solicitante).
2. Compras → Recibir: recepción **parcial** con una cantidad rechazada y su motivo; registrar. Verificar pendiente y rechazado en el seguimiento.
3. Compras → Recibir: **conformidad de servicio** (sin movimiento de inventario).
4. Recepción **final** de inventario y activo (el activo aparece en la cuenta personalizada).
5. Cuentas por pagar: dos facturas parciales; ver el cuadre (IVA y moneda) y aprobar; ver asientos.
6. Seguimiento de la orden como contador (ve facturas) y como operador (no las ve).
7. Negativos en la interfaz: factura duplicada, recibir de más, usuario de otra empresa/proyecto.

## 6. No ejecutado (pendiente explícito)
* Todo el recorrido de §5 (interfaz contra el sandbox) y sus capturas.
* El padrón persistente: **no se creó** a propósito hasta que la prueba pueda ejecutarse (evita datos y credenciales de prueba sin uso).
