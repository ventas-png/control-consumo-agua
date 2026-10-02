# Compras · Bloque C — PR correctivo

Corrige lo que quedó fuera de #916 (fusionado antes de incorporar las correcciones). **No edita ninguna migración
aplicada**: todo va en migraciones incrementales. Producción **no se tocó** en este PR.

## 1. Diagnóstico inicial (producción, solo lectura, autorizado)

| Comprobación | Resultado |
|---|---|
| Índice `uq_mov_suministro_origen_recepcion` | existe, válido y listo |
| Movimientos de inventario duplicados por línea de recepción | 0 |
| Respaldos de recepción (`recepcion_respaldos`) | 0 filas |
| Referencias `recepciones.respaldo_path` | 0 |
| Respaldos sin objeto en Storage / objetos sin registro | 0 / 0 |

**No hay datos que requieran intervención autorizada en producción.**

## 2. Defectos y correcciones

| # | Defecto | Corrección | Migración |
|---|---|---|---|
| 2 | «Pendiente por facturar» se calculaba sobre totales, mezclando diferencias de precio | Se calcula **por renglón**: `max(recibido − facturado, 0) × precio de la orden`; la diferencia de precio (facturas aprobadas) va aparte (`diferencia_precio_facturada`). Todo facturado ⇒ pendiente 0. Operaciones sigue recibiendo NULL en lo financiero | `20261023000000_compras_seguimiento_pendientes_por_renglon` |
| 3 | La evidencia podía apuntar a un objeto inexistente (INSERT directo o RPC) | Trigger servidor: ruta con forma exacta (empresa/proyecto/recepción/archivo, sin `..`), objeto existente en el bucket `recepciones-respaldo`, tamaño y mime contrastados si el objeto los trae, tipo según servicio/bienes; empresa, proyecto y autor fijados por el servidor. Nuevo trigger sobre `recepciones.respaldo_path`. RLS y permisos intactos. `compras_recepcion_adjuntar` pasa a `INSERT … ON CONFLICT` (concurrencia: un solo registro) | `20261023000100_compras_respaldos_validacion_servidor` |
| 4 | Retirar el respaldo principal dejaba la referencia colgada | Solo en borrador (bloqueo `FOR SHARE` contra el registro concurrente); la referencia se sustituye por el archivo más antiguo restante o NULL. En el cliente, el fallo de Storage ya no se silencia: `RetiroRespaldoError` (fase registro / almacenamiento, con ruta huérfana) y aviso explícito | `…0100` + `src/domain/compras/respaldos.ts` |
| 5 | La protección de inventario dependía de que el índice existiera | La migración exige el índice único válido; si hay duplicados históricos **se detiene con `COMPRAS_INVENTARIO_DUPLICADOS` y diagnóstico**, sin WARNING ni borrado; índice inválido ⇒ `REINDEX`; verificación final | `20261023000200_compras_inventario_indice_obligatorio` |
| 6 | Auditor de drift en rojo en `main` | Era la huella desactualizada tras #916; ya la refrescó #917 con captura real de producción. Tras aplicar **estas** tres migraciones en producción habrá que refrescarla de nuevo (captura de solo lectura, **requiere autorización**). No se fabricaron hashes ni se ampliaron excepciones | — |

## 3. Matriz por ambiente

| Migración | Local / CI | Sandbox | Producción |
|---|---|---|---|
| `20261023000000` | aplicada y probada | **aplicada** | **pendiente** (se aplica sola al fusionar) |
| `20261023000100` | aplicada y probada | **aplicada** | **pendiente** |
| `20261023000200` | aplicada y probada | **aplicada** | **pendiente** |

## 4. Evidencia

- **PostgreSQL real** (`supabase/tests/compras_bloque_b/run.sh`, EXIT 0): `assert_correcciones_c.sql` (pendientes: descuento,
  sobreprecio, parcial, todo facturado, Operaciones NULL; respaldos: INSERT directo y RPC sin objeto, otro bucket, metadatos, rutas,
  tipos, alcance de otra empresa/sin permiso, retiro del principal, inmutabilidad, reintentos), `indice_obligatorio.sh` (duplicados
  reales, índice inválido, ausente, ajeno) y concurrencia con sesiones reales: **O** mismo archivo adjuntado a la vez (1 registro),
  **P** retiro vs. registro (gana la inmutabilidad, evidencia intacta).
- **Vitest**: `retirarRespaldo.test.ts` (6), `respaldosRecepcion.test.tsx`, seguimiento con la nueva columna.
- **Sandbox** (`sandbox_correcciones_c.sql`, reversible, **38/38 OK**, sin residuo comprobado: 0 empresas/usuarios/objetos `5b5d0000…`).
  Ejecutado **por SQL**, no por pantalla. La herramienta SQL del sandbox no ejecuta sentencias `DELETE … WHERE`, por lo que el guion
  no las usa; el retiro (DELETE) está cubierto en PostgreSQL local, y no se hizo captura de pantalla del retiro en el sandbox.

## 5. Limitaciones

1. `sha256` del respaldo lo declara el cliente; el servidor compara tamaño y mime solo cuando el objeto los trae.
2. Si el borrado en Storage falla tras retirar el registro, queda un archivo huérfano (se avisa con su ruta; limpieza manual).
3. Riesgos previos documentados en `COMPRAS_BLOQUE_C.md` §5 siguen vigentes.
