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
| 5 | La protección de inventario dependía de que el índice existiera | La migración exige el índice único válido; si hay duplicados históricos **se detiene con `COMPRAS_INVENTARIO_DUPLICADOS` y diagnóstico**, sin WARNING ni borrado; índice inválido ⇒ `REINDEX`; verificación final **exacta**: se construye en la misma transacción un índice de referencia con la definición esperada y se comparan campo a campo catálogo (columnas, clases de operador, colaciones, opciones, método, unicidad, `NULLS NOT DISTINCT`, expresiones y predicado deparseado). Ya no se busca texto con `LIKE`: un índice con `AND cantidad > 0` contiene todos los fragmentos esperados pero dejaría sin proteger los movimientos con cantidad ≤ 0, y ahora se rechaza | `20261023000200_compras_inventario_indice_obligatorio` |
| 6 | Auditor de drift en rojo en `main` | Era la huella desactualizada tras #916; ya la refrescó #917 con captura real de producción. Tras aplicar **estas** tres migraciones en producción habrá que refrescarla de nuevo (captura de solo lectura, **requiere autorización**). No se fabricaron hashes ni se ampliaron excepciones | — |

## 3. Matriz por ambiente

| Migración | Local / CI | Sandbox | Producción |
|---|---|---|---|
| `20261023000000` | aplicada y probada | **aplicada** | **pendiente** (se aplica sola al fusionar) |
| `20261023000100` | aplicada y probada | **aplicada** | **pendiente** |
| `20261023000200` | aplicada y probada | **aplicada** | **pendiente** |

## 4. Evidencia — tres entornos distintos

No son lo mismo y no se mezclan los resultados:

| Entorno | Qué es | Qué se probó aquí |
|---|---|---|
| **Postgres desechable** (local con `run.sh` y el job de CI «RLS sandbox de recepción» / «RLS harness») | Un clúster PostgreSQL vacío que se crea y se destruye en cada corrida; cadena completa de migraciones + datos sintéticos | Todas las pruebas de abajo, incluidas concurrencia con sesiones reales y duplicados reales |
| **Sandbox existente** (`control-agua-rls-sandbox`, proyecto `jwpmivhvlstslncrtokb`) | Proyecto Supabase persistente con Storage y Auth reales; **no** es producción | Las 3 migraciones aplicadas por el workflow y el guion `sandbox_correcciones_c.sql` |
| **Supabase Preview** (rama de base de datos del PR) | Base efímera que Supabase crea al abrir el PR y le aplica las migraciones nuevas | Solo comprueba que las migraciones se aplican y que el seed corre (✅ en el SHA `517a762e`); no corre las pruebas de comportamiento |

**Postgres desechable** (`supabase/tests/compras_bloque_b/run.sh`, EXIT 0, 602 comprobaciones ✓):
- `assert_correcciones_c.sql`: pendientes (descuento, sobreprecio, parcial, todo facturado, Operaciones NULL); respaldos (INSERT directo y RPC sin objeto, otro bucket, metadatos, rutas, tipos, otra empresa / sin permiso, retiro del principal, inmutabilidad, reintentos).
- `indice_obligatorio.sh` (casos con duplicados reales, siempre revertidos; la base queda intacta, 8 movimientos antes y después):
  1 índice válido ⇒ pasa · 2 duplicados ⇒ se detiene con diagnóstico, no borra, no crea · 3 índice no único ⇒ se detiene · 4 índice inválido ⇒ se reconstruye · 5 ausente ⇒ se crea y rechaza duplicados nuevos ·
  **6 mismo nombre y columnas, único, con predicado más restrictivo `AND cantidad > 0` ⇒ RECHAZADO (el mensaje muestra el predicado actual)** ·
  **7 predicado que no cubre `recepcion_lineas_anulada` ⇒ rechazado** · **8 mismas columnas en otro orden ⇒ rechazado** · 9 la verificación no deja índices auxiliares.
- Concurrencia con sesiones reales: **O** mismo archivo adjuntado a la vez (1 registro), **P** retiro vs. registro (gana la inmutabilidad, evidencia intacta). Guard append-only de migraciones.
- Una primera versión de la comparación exacta falló en el propio índice válido (el árbol `indpred` almacenado incluye posiciones de texto distintas según cómo se escribió el `CREATE`); lo detectó `run.sh` y se cambió a comparar el predicado deparseado.
- **Vitest** completo: 7 037 pruebas ✓ (157 omitidas de antes); `tsc` y `eslint` sin errores. `retirarRespaldo.test.ts` (6), `respaldosRecepcion.test.tsx`, seguimiento con la nueva columna.

**Sandbox existente**: tres migraciones aplicadas por el workflow; guion SQL reversible `sandbox_correcciones_c.sql` **38/38 OK**, sin residuo (0 empresas, usuarios y objetos `5b5d0000…`), ejecutado **por SQL, no por pantalla**.
- **Brecha declarada:** la reescritura de la verificación de `20261023000200` (comparación exacta) se hizo **después** de aplicar esa migración al sandbox. El workflow solo acepta la menor versión aún no registrada, así que no se puede reaplicar, y la herramienta SQL del sandbox se cuelga (60 s) con sentencias `DELETE … WHERE` y con el `DROP INDEX` que exige la prueba del predicado restrictivo; no se intentó esquivar. Se confirmó que el sandbox quedó intacto (el índice sigue válido y sin residuo). Por tanto la nueva verificación está probada en el Postgres desechable, **no** en el sandbox; en el sandbox sigue la versión anterior, cuyo efecto sobre un índice válido es el mismo.
- Tampoco hay captura de pantalla del retiro del respaldo en el sandbox por la misma limitación; el retiro está cubierto en el Postgres desechable y en Vitest.

**Producción**: no se tocó. Pendiente de tu autorización (y no hecho): comprobar en solo lectura que la comparación exacta acepta el índice real de producción antes de fusionar, y refrescar `huella-produccion.json` tras aplicar las migraciones.

## 4b. Comprobación en producción del índice (solo lectura, autorizada)

Antes de fusionar se comprobó que `uq_mov_suministro_origen_recepcion` en producción coincide con la definición que exige la
migración final `20261023000200`. **Solo consultas de lectura a los catálogos**: no se ejecutó la migración, no se creó ningún
índice, no se modificaron datos ni el historial de migraciones. Una primera ejecución fue denegada por la persona usuaria; se
volvió a pedir la autorización y se ejecutó una versión más corta de la misma consulta.

Consulta usada:

```sql
SELECT c.relname, t.relname AS tabla, am.amname, i.indisunique, i.indisvalid, i.indisready,
       i.indnatts, i.indnkeyatts, i.indkey::text AS cols, i.indclass::text AS clases,
       i.indcollation::text AS colaciones, i.indoption::text AS opciones,
       pg_get_expr(i.indexprs, i.indrelid) AS expresiones,
       pg_get_expr(i.indpred, i.indrelid) AS predicado,
       pg_get_indexdef(i.indexrelid) AS definicion
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_am am ON am.oid = c.relam
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'uq_mov_suministro_origen_recepcion';
```

Resultado en producción frente a lo que construye la migración (índice de referencia, medido en el Postgres desechable):

| Campo | Producción | Exigido |
|---|---|---|
| tabla / método | `movimientos_suministro` / `btree` | igual |
| único / válido / listo | sí / sí / sí | sí / sí / sí |
| columnas (`indkey`) | `15 16` = `(origen_tabla, origen_id)` | igual |
| clases de operador / colaciones / opciones | `3126 10065` / `100 0` / `0 0` | igual |
| `indnatts` / `indnkeyatts` | 2 / 2 (sin `INCLUDE`) | 2 / 2 |
| expresiones | ninguna | ninguna |
| predicado | `((origen_tabla = ANY (ARRAY['recepcion_lineas'::text, 'recepcion_lineas_anulada'::text])) AND (origen_id IS NOT NULL))` | idéntico, carácter por carácter |
| `NULLS NOT DISTINCT` | no (la definición no lo incluye) | no |

**Coincide**: la migración pasaría en producción sin cambiar nada (solo verifica). Límite: la comparación se hizo contra los
valores de catálogo del índice de referencia local, no ejecutando la migración (prohibido en esta comprobación).

## 5. Limitaciones

1. `sha256` del respaldo lo declara el cliente; el servidor compara tamaño y mime solo cuando el objeto los trae.
2. Si el borrado en Storage falla tras retirar el registro, queda un archivo huérfano (se avisa con su ruta; limpieza manual).
3. Riesgos previos documentados en `COMPRAS_BLOQUE_C.md` §5 siguen vigentes.
