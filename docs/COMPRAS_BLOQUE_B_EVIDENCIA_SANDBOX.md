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
| **D-1** | **No había forma de facturar contra una orden desde la interfaz** (sin selector de orden ni renglones; el cuadre de 3 vías solo era alcanzable por SQL). `08` | `CuentasPorPagarTab` | **Corregido**. Primera versión: cabecera y renglones en dos solicitudes con borrado compensatorio (frágil). **Segunda versión (esta): una sola llamada a `compras_factura_crear` (migración 0800)**, transaccional e idempotente. Probado en pantalla contra el sandbox (§7) |
| **D-2** | El duplicado de factura mostraba el error crudo de Postgres | `CuentasPorPagarTab` | **Corregido** (`13`); ahora el servidor responde `COMPRAS_FACTURA_NUMERO_DUPLICADO` y la pantalla lo traduce |
| **D-3** | **Servidor:** una factura ligada a una orden y **sin renglones se aprobaba sin error** y generaba su asiento (doble gasto). Además el autorizador de la excepción (`match_forzado_por`, `aprobada_por`) lo escribía el cliente (suplantable) y la excepción dejaba pasar facturación anticipada, moneda distinta y exceso sobre lo pedido | `compras_tg_factura_match` | **Migración `20261021000700` (reescrita: «aprobación endurecida») + 0800. APLICADAS en el sandbox y probadas (§7). Pendientes en producción** |
| **D-4** | Operaciones mostraba un contador por **posición en la lista** (`OC-0001`), no el número real de la orden | `OrdenesCompraTab` | **Corregido** (+ 2 pruebas que fallan con el código anterior) |

### 5.4 Observaciones (no son defectos del bloque)

* La interfaz crea las líneas de orden sin cuenta (`Cuenta —` en el seguimiento): es por diseño (la resuelve una regla o el mapeo al contabilizar). Sin regla, el servicio se devengó a `5199 Otros gastos`; con cuenta explícita iría a la del renglón (probado en SQL, §3).
* El formulario de orden de Contabilidad no permite elegir el **insumo** del almacén, así que una línea de **inventario** no se puede crear desde ahí (se hace desde Suministros). Por eso el recorrido de pantalla cubrió servicio y activo fijo; el inventario (recepción parcial con rechazo, stock) está probado en SQL (65/65).
* El sandbox no tiene desplegada la función `log-security-event` (404) y el proxy del entorno no deja pasar el WebSocket de Realtime: ruido de consola del entorno, sin efecto en el flujo.
* En la primera visita de «Condominios» (compilación en frío del servidor de desarrollo) la lista de órdenes tardó en aparecer para el administrador; con la caché caliente carga a los pocos segundos.

## 7. Protección de facturas y facturación transaccional (migraciones 0700 y 0800)

**Autorización**: el propietario autorizó aplicar 0700 y 0800 **solo en el sandbox** `control-agua-rls-sandbox` (`jwpmivhvlstslncrtokb`, no la Preview del PR). Se aplicaron una por una, en orden, con el workflow `Apply Migrations to Sandbox` (ref = `claude/keen-carson-f9vmw3`, SHA `fbd59d5d`, runs 37022856010 y 37022912822). Verificación posterior: versión máxima `20261021000800`, ambas registradas, `compras_factura_crear` SECURITY INVOKER sin EXECUTE para `anon`, columnas/índice/trigger de idempotencia presentes, facturas previas del padrón intactas. Producción no se tocó.

### 7.1 Ejecutado en SQL (guion `sandbox_flujo_completo.sql`, reversible)
Resultado en el sandbox: **`GUION_OK_REVERTIDO: 80 comprobaciones coinciden`**, sin residuos (0 empresas/facturas/usuarios `5b5b0000…` después). Cubre, además del recorrido de la sección 3: factura por la función (total calculado por el servidor = 224, no el `1` que mandó el cliente); reintento con misma clave y contenido (misma factura, 1 cabecera + 2 renglones); misma clave con otro contenido → `COMPRAS_FACTURA_CLAVE_CONFLICTO`; renglón de otra orden → `COMPRAS_FACTURA_LINEA_AJENA` sin cabecera huérfana; número repetido → `COMPRAS_FACTURA_NUMERO_DUPLICADO`; orden cerrada → `COMPRAS_FACTURA_ORDEN_ESTADO`; **orden sin renglones nunca se aprueba, ni con justificación ni declarándose autorizador** (`COMPRAS_FACTURA_SIN_RENGLONES`); **facturar antes de recibir y moneda distinta no son forzables** (`COMPRAS_MATCH_NO_FORZABLE`); precio/IVA fuera de tolerancia solo con justificación y **el servidor sella como autorizador a quien ejecuta** (el contador que declaró `aprobada_por = admin` queda registrado como él mismo).
Local (PG real): 6 suites + `assert_factura_crear` (47) + `assert_aprobacion` (31) + concurrencia (misma clave y contenido a la vez, misma clave con contenido distinto, línea que falla, backend terminado antes del COMMIT: sin cabecera huérfana).

### 7.2 Probado en pantalla (sandbox, padrón `5b5b1000…`, admin «ZZ Admin»)
| Caso | Resultado | Captura |
|---|---|---|
| Factura contra orden OC-000002 (conformidad recibida de 10 × GTQ 100 + IVA 120) | selector de orden, renglones «por facturar», total 1,120.00 calculado | `160` |
| Mismo documento con **precio 120 (+20 %) e IVA 0** | se registra (una llamada al servidor); cuadre marca «Precio fuera de tolerancia», IVA OC 120.00 / factura 0.00 | `161`, `170` |
| Aprobar sin justificación | el servidor rechaza; sigue «Registrada» | — |
| Aprobar con justificación escrita | «Aprobada»; asiento: 2105 débito 1,000 (lo recibido al precio de la orden), 5199 débito 200 (diferencia), 2104 crédito 1,200; `match_forzado_por = aprobada_por =` quien ejecutó | `173` |
| **Moneda extranjera**: factura directa USD 100 (TC mensual 7.75 sembrado en el padrón) | registrada y aprobada; asiento en moneda base: 5199 débito 775.00 / 2104 crédito 775.00 | `180`, `182` |

No se pudo probar por pantalla: facturar con moneda distinta a la de la orden (el formulario de orden no tiene campo de moneda; probado en SQL), suplantación del autorizador (la interfaz ya no envía esos campos; probado en SQL enviándolos a mano), línea de inventario.
Dato en el sandbox: el padrón quedó con OC-000002 (cerrada tras la factura), conformidad CONF de OC-000002, F-ZZ-0003 (aprobada con justificación) y F-ZZ-USD-1 (aprobada, USD). Se conserva; el retiro lo decide el propietario.

## 8. Corrección 0900: el reintento recupera la factura aunque la orden esté cerrada

**Defecto**: `compras_factura_crear` validaba el estado de la orden ANTES de buscar la clave de idempotencia. Si la factura creada cerraba la orden, un reintento legítimo (respuesta perdida, doble clic) recibía `COMPRAS_FACTURA_ORDEN_ESTADO` en lugar de la factura que sí existía. Reproducido localmente con solo 0800 (la prueba 11a falla con ese error).
**Corrección** (`20261021000900`, `CREATE OR REPLACE` de la misma función; no edita 0800): primero identidad, empresa, acceso (RLS), alcance (proyecto, proveedor, orden y renglones de esa orden) y huella; luego la clave (mismo contenido → original, `reutilizada: true`; otro contenido → `COMPRAS_FACTURA_CLAVE_CONFLICTO`); después el estado de la orden, que solo frena facturas nuevas. Sin cambios de firma ni de permisos; quien no ve la factura por RLS no la recupera.
**Pruebas** (`assert_factura_crear.sql` §11, 14 comprobaciones; guion `sandbox_flujo_completo.sql`, 84): crear → aprobar (la orden se cierra) → repetir: mismo id, 0 facturas/renglones/asientos/líneas de asiento nuevos, lo facturado no cambia; misma clave con otro contenido → rechazo; clave nueva sobre orden cerrada → `COMPRAS_FACTURA_ORDEN_ESTADO` sin factura; otra empresa con la misma clave → `COMPRAS_FACTURA_EMPRESA`. Local: suite completa verde y guion 84/84.
**Sandbox** (autorizado por el propietario; solo 0900, con el workflow `Apply Migrations to Sandbox`, ref = rama): versión máxima `20261021000900`, 0700/0800/0900 registradas, `compras_factura_crear` SECURITY INVOKER, sin EXECUTE para `anon`, con EXECUTE para `authenticated`; guion reversible `GUION_OK_REVERTIDO: 84 comprobaciones`, sin residuos (0 empresas/facturas/usuarios `5b5b0000…`; el padrón `5b5b1000…` intacto). Producción no se tocó.

| Ambiente | 0700 | 0800 | 0900 |
|---|---|---|---|
| Local / CI | aplicada | aplicada | aplicada |
| Sandbox | aplicada | aplicada | **aplicada** (run 37027482249, SHA `a3332db7`) |
| Producción | pendiente | pendiente | pendiente |

## 6. No ejecutado (pendiente explícito)
* **Migraciones 0700 y 0800 en producción**: no aplicadas (se aplicarían solas al fusionar el PR a `main`).
* Línea de **inventario** desde la pantalla de orden (no hay selector de insumo en ese formulario).
* Moneda distinta a la de la orden por pantalla (sin campo de moneda en el formulario de orden): solo SQL.
* Riesgo residual: `compras_tg_factura_acumular` captura excepciones con WARNING (si fallara al acumular lo facturado, la aprobación seguiría). Recomendado endurecer en un PR aparte.
* Retiro del padrón `5b5b1000…`: a decidir por el propietario.
