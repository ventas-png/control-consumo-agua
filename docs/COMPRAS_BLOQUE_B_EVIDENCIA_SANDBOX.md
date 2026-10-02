# Compras · Bloque B — evidencia de validación en el sandbox

Entorno: `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`), identidad confirmada por nombre y ref. **Producción no se tocó.** Fecha: 2026-10-02. Autorización del propietario: aplicar las 7 migraciones por el workflow con la rama como ref, ejecutar el guion (transaccional, revertido) y crear el padrón persistente de prueba «ZZ Validación Bloque B» (creado el 2026-10-02 para la prueba de interfaz: ver §5). **La migración 0700 de este PR correctivo NO está aplicada en el sandbox** (no estaba autorizada).

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


## 3b. Ampliación del guion tras el merge (2026-10-02) — 65/65 en el sandbox

El guion se amplió con la sección 9 y se volvió a ejecutar en el sandbox: **`GUION_OK_REVERTIDO: 65 comprobaciones coinciden con lo esperado`**, y después **0 residuos** (empresas, proveedores, órdenes, facturas, asientos, activos y usuarios `5b5b…` = 0; última migración sin cambios `20261021000600`). Se ejecutó solo en el sandbox; producción no se usó.

Comprobaciones nuevas (todas obtenido = esperado):
* **Permisos de la orden**: el operador sin permiso de aprobar no aprueba (la orden sigue en `borrador`); devolver a borrador sin motivo → `COMPRAS_OC_DEVOLUCION_MOTIVO`; con motivo → `borrador` y `revision = 1`.
* **Factura con diferencias** (orden de 10 × 100 + IVA 120): precio +20 % visible y no se aprueba en silencio; IVA 0 contra 120 pedido (`iva_orden/iva_factura = 120.00/0.00`) bloquea; moneda `USD` contra `GTQ` bloquea; con justificación se aprueba, queda quién la forzó y se contabiliza **una sola vez**.
* **Proveedor suspendido entre aprobar y emitir** → `COMPRAS_PROVEEDOR_NO_AUTORIZADO`.

Reintentos y duplicados cubiertos en el recorrido completo (todos con conteo exacto): misma clave y mismo contenido → mismo documento; misma clave con otro contenido → `COMPRAS_RECEPCION_CLAVE_CONFLICTO`; línea ajena → sin cabecera huérfana; registrar dos veces la misma recepción → 1 asiento y stock sin duplicar; aprobar dos veces la misma factura → 1 asiento; factura duplicada → `unique_violation`; recibir de más → rechazado. Aislamiento: otra empresa no ve, no recibe ni factura contra la orden; otro proyecto de la misma empresa no la ve ni lista el proyecto.

**No se encontró ningún defecto**; no hay PR correctivo.

## 4. Qué se probó y con qué método (no se mezclan)

| Capa | Dónde | Estado | Qué demuestra | Qué NO demuestra |
|---|---|---|---|---|
| **Pruebas SQL locales** | PostgreSQL efímero (`compras_bloque_b/run.sh`, ahora con la migración 0700 y la sección 13; más cinco suites previas que aprueban facturas con orden) | ✅ | reglas del servidor, concurrencia real, migraciones dos veces | nada del sandbox ni de la interfaz |
| **CI de GitHub** (PR `1132efb4`, y **merge `17e45035` en `main`**: CI y Coverage gate en éxito) | GitHub Actions | ✅ 9/9 checks reales en verde | el código compila, las suites del repo pasan | el comportamiento en el sandbox compartido |
| **SQL en el sandbox real** | `control-agua-rls-sandbox` | ✅ 7 migraciones aplicadas; guion `GUION_OK_REVERTIDO` **65/65**, 0 residuos | el esquema y las reglas funcionan sobre el sandbox como SQL | que la interfaz las use bien |
| **Interfaz conectada al sandbox** | Chromium (Playwright) → app local (Vite) → `jwpmivhvlstslncrtokb` | ✅ **realizada el 2026-10-02** (§5), con **tres defectos hallados** (D-1, D-2, D-4) corregidos en este PR y uno de servidor (D-3) con migración preparada sin aplicar | el flujo completo desde la pantalla, con permisos, aislamiento y reintentos | el comportamiento con datos reales de producción |

Las pruebas de componentes (vitest) usan datos simulados; **no** sustituyen a la interfaz contra el sandbox.

## 5. Prueba de interfaz contra el sandbox (2026-10-02)

**Método.** Aplicación local (Vite) con `VITE_SUPABASE_URL=https://jwpmivhvlstslncrtokb.supabase.co` y la llave pública de **ese** proyecto (su payload JWT dice `ref: jwpmivhvlstslncrtokb`), pasadas por entorno de proceso, sin archivos `.env`. Antes de abrir la app, un control aborta si la URL o la llave contienen `nnsqmeigtgewatameexo` (producción) o si el `ref` de la llave no es el del sandbox. Chromium sale por el proxy del entorno (política de red: el host del sandbox se habilitó; producción sigue denegada con 403) con una CA de confianza aislada para la prueba, **sin desactivar la verificación TLS**. Además, una salvaguarda del propio script aborta y registra cualquier petición a producción.

**Destino de red** (`capturas/compras_bloque_b/red-destino.txt`): en un recorrido de login → Compras → Seguimiento → Cuentas por pagar, **109 peticiones, todas a `jwpmivhvlstslncrtokb.supabase.co`; 0 a producción; 0 bloqueadas por la salvaguarda.**

**Datos de prueba.** Padrón persistente identificable «ZZ Validación Bloque B» (UUID `5b5b1000…`, distinto de los `5b5b0000…` del guion): 2 empresas, 3 proyectos, 5 usuarios (`zz-bloqueb-*@example.com`; contraseña de prueba fuera del repositorio), 2 proveedores autorizados, 51 cuentas (dos personalizadas: 6205 servicios y 9101 activos), tipo de cambio. Plantilla: `supabase/tests/compras_bloque_b/sandbox_padron_ui.sql.tpl`. **No se tocó ningún registro ajeno** (las 3 empresas previas siguen igual). Retiro: borrar solo filas `5b5b1000…` (decisión del propietario).

### 5.1 Recorrido (admin del padrón; capturas en `docs/capturas/compras_bloque_b/`)

| # | Paso en pantalla | Resultado obtenido (esperado = obtenido) | Verificado además en el servidor |
|---|---|---|---|
| 1 | Compras → Nueva orden (servicio 300+36 IVA, activo fijo 2×500+120 IVA) → Crear borrador | Orden en **Borrador** por GTQ 1,456.00 · `01` | total 1456.00 |
| 2 | Aprobar → Emitir → Seguimiento | Estados Aprobada → Emitida; historial con 3 eventos · `02` | |
| 3 | Recibir (bienes): 1 aceptada, **1 rechazada con motivo** | Recepción creada y registrada: «aceptado 1, rechazado 1» · `03` | orden `recibida_parcial`; línea recibida 1 de 2; 1 activo; asiento Dr 9101 500 / Cr 2105 500 |
| 4 | Recepción final con **doble clic** en «Crear recepción» | **Una sola** recepción (REC-000002), no dos · `05` | |
| 5 | Conformidad de servicio | REC-000003 «conformidad de servicio», sin inventario · `04` | asiento Dr 5199 300 / Cr 2105 300 |
| 6 | Activos fijos | 2 activos (AF-000001, AF-000002) · `06` | |
| 7 | Seguimiento tras recibir | Estado Recibida; recibido GTQ 1,300.00, pendiente 0 · `07` | |
| 8 | **Registrar factura** contra la orden (ver D-1) | Selector de orden, renglones por facturar, total 1,456.00 (IVA 156.00) · `08` (antes) y `09` (después) | |
| 9 | Revisar y aprobar | Cuadre de 3 vías: ambos renglones «Cuadra» (precio, IVA y moneda) · `10`; factura Aprobada · `11` | Dr 2105 1,300 + Dr 1105 IVA 156 / Cr 2104 1,456; **2105 en cero**; orden **cerrada**; facturado 1/1 y 2/2 |
| 10 | Seguimiento como **contador** | Ve la factura F-ZZ-0001, facturado GTQ 1,456.00 · `14` | |
| 11 | Seguimiento como **operador** | «Facturas y pagos solo los ve Contabilidad»; no ve facturas ni montos facturados · `15` | |

### 5.2 Reintentos, permisos y aislamiento (por interfaz)

| Prueba | Resultado |
|---|---|
| Doble clic al crear recepción | 1 documento (la clave de idempotencia se reutiliza) |
| Doble clic al registrar factura (F-ZZ-0002) | 1 factura |
| Factura con número repetido (F-ZZ-0001, mismo proveedor) | Rechazada por `uq_facturas_prov_numero`; mensaje crudo antes (`12`), claro después (`13`, D-2) |
| Operador de compras | No ve «+ Nueva OC», ni aprobar/emitir; la denegación del servidor está probada en SQL (§3b) |
| Contador | Entra a Contabilidad; no ve el módulo Condominios («sin acceso») |
| Operador del **otro proyecto** (misma empresa) | Ve su condominio «ZZ Otro proyecto» sin órdenes · `16` |
| Admin de **otra empresa** | Compras: 0 órdenes · `17`; Cuentas por pagar: no ve la factura ni el proveedor · `18` |

### 5.3 Defectos hallados y su estado

| ID | Defecto | Dónde | Estado |
|---|---|---|---|
| **D-1** | **No había forma de facturar contra una orden desde la interfaz**: el formulario «Registrar factura» no tenía selector de orden ni renglones (solo proveedor y categoría); el cuadre de 3 vías solo era alcanzable por SQL. `08` | `CuentasPorPagarTab` | **Corregido en este PR** (selector de orden, renglones por facturar, total calculado; cabecera+renglones con compensación si fallan). Probado en pantalla contra el sandbox (`09`–`11`) |
| **D-2** | El duplicado de factura mostraba el error crudo de Postgres | `CuentasPorPagarTab` | **Corregido** (`13`) |
| **D-3** | **Servidor:** una factura ligada a una orden y **sin renglones se aprueba sin error** y genera su asiento, saltándose el cuadre de 3 vías (el cuadre es por renglón y devolvía cero filas). Reproducido con una sonda local reversible (`APROBADA SIN ERROR · renglones=0 · asientos=1`) | `compras_tg_factura_match` | **Migración `20261021000700` preparada, con pruebas locales (sección 13) y las 5 suites previas en verde. NO aplicada en el sandbox ni en producción** (requiere autorización; al fusionar se aplicaría en producción) |
| **D-4** | Operaciones mostraba un contador por **posición en la lista** (`OC-0001`), no el número real de la orden (`OC-000001`); cambiaba al agregar órdenes. `20` → `19` | `OrdenesCompraTab` | **Corregido** (+ 2 pruebas que fallan con el código anterior) |

### 5.4 Observaciones (no son defectos del bloque)

* La interfaz crea las líneas de orden sin cuenta (`Cuenta —` en el seguimiento): es por diseño (la resuelve una regla o el mapeo al contabilizar). Sin regla, el servicio se devengó a `5199 Otros gastos`; con cuenta explícita iría a la del renglón (probado en SQL, §3).
* El formulario de orden de Contabilidad no permite elegir el **insumo** del almacén, así que una línea de **inventario** no se puede crear desde ahí (se hace desde Suministros). Por eso el recorrido de pantalla cubrió servicio y activo fijo; el inventario (recepción parcial con rechazo, stock) está probado en SQL (65/65).
* El sandbox no tiene desplegada la función `log-security-event` (404) y el proxy del entorno no deja pasar el WebSocket de Realtime: ruido de consola del entorno, sin efecto en el flujo.
* En la primera visita de «Condominios» (compilación en frío del servidor de desarrollo) la lista de órdenes tardó en aparecer para el administrador; con la caché caliente carga a los pocos segundos.

## 6. No ejecutado (pendiente explícito)
* **Migración 0700 en el sandbox**: no se aplicó (sin autorización). La interfaz corregida **no depende de ella**: captura siempre los renglones.
* Línea de **inventario** desde la pantalla de orden (no hay selector de insumo en ese formulario).
* Facturas en moneda extranjera y diferencias de precio/IVA **por pantalla**: probadas en SQL (65/65) y el cuadre las muestra (`10`), pero no se capturó su recorrido en pantalla.
* Retiro del padrón `5b5b1000…`: a decidir por el propietario.
