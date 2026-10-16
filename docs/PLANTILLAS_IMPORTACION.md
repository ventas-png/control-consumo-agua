# Catálogo de actividades · carga masiva y recursos en bloque

Migración `20261031000200_plantillas_actividades_importar_y_recursos_bloque`. En **Condominios → Plantillas → Catálogo de
actividades** añade dos cosas:

1. **Carga masiva de actividades** desde una plantilla propia (CSV / XLSX) con sus **insumos, herramientas y equipo por
   nombre**, con validación en el servidor y vista previa, todo o nada. Mismo molde que la carga masiva de reservas STR
   ([`STR_IMPORTACION.md`](STR_IMPORTACION.md)) y el mismo lector de archivos del navegador.
2. **Recursos en bloque**: casillas en las tarjetas → «Recursos en bloque» → agregar o quitar insumos, herramientas y
   equipo a varias actividades en **una llamada atómica**.

## Archivos

| Qué | Dónde |
|---|---|
| Migración (lotes, evaluación por fila, previsualizar / aplicar / descartar, recursos en bloque) | `supabase/migrations/20261031000200_plantillas_actividades_importar_y_recursos_bloque.sql` |
| Suite SQL (Postgres real, sesiones emuladas y reales, 8 mutantes) | `supabase/tests/plantillas_importacion/` (`run.sh`, `assert.sql`, `datos.sql`, `fixture_plantillas.sql`, `concurrencia_prep.sql`, `huella.sql`) |
| Dominio | `src/domain/condominios/plantillasImportacion.ts` (plantilla, lector, RPC) y `plantillasRecursos.ts` (bloque, `parsearRecursoTexto`) (+ `__tests__/`) |
| Pantalla | `src/components/condominios/tabs/ImportarActividadesModal.tsx`, `src/components/condominios/RecursosEnBloqueModal.tsx`, cambios en `ActividadesCatalog.tsx` (botón «⬆️ Carga masiva», casillas, «Seleccionar todas», barra de selección) (+ `__tests__/`) |
| Tipos | `src/types/condominios/operaciones.ts` (`FilaImportacionActividad`, `VistaPreviaImportacionActividades`, `ResultadoImportacionActividades`, `ResultadoRecursosBloque`), `src/types/database.types.ts` |
| Recuperación | `scripts/reversion-plantillas-importacion.sql` |
| Sandbox | `supabase/tests/plantillas_importacion/sandbox_datos_pla.sql` (datos «ZZ PLA») y `sandbox_limpieza_pla.sql` (retirada) |
| CI | paso «Plantillas — carga masiva de actividades y recursos en bloque» en `.github/workflows/coverage.yml` |

## Carga masiva

1. **Plantilla** (`PLANTILLA_ACTIVIDADES`): CSV o XLSX con hoja «Instrucciones»; todas las columnas como texto.
2. **Archivo** → el navegador solo lo convierte en filas de texto (CSV/XLSX reales, sin fórmulas, ≤ 5 MB, ≤ 500 filas;
   `leerArchivoActividades`).
3. **Vista previa** (`plantillas_importar_previsualizar(proyecto, filas, archivo)`): el servidor crea el **lote** y evalúa
   **cada fila** (datos normalizados, recursos resueltos, errores por campo). **No escribe actividades.**
4. **Confirmar** → `plantillas_importar_aplicar(lote)`: **todo o nada**; re-evalúa cada fila contra el estado de hoy;
   inserta las actividades (activas) y después sus puentes de insumos y herramientas/equipo, en una transacción. Reaplicar
   un lote aplicado devuelve su resultado (`reutilizada`). El mismo contenido no se importa dos veces al mismo proyecto
   mientras sus actividades sigan ahí.
5. Cerrar sin confirmar → `plantillas_importar_descartar(lote)`.

### Columnas y reglas (las hace cumplir el servidor, `plantillas_import_evaluar`)

| Columna | Regla |
|---|---|
| `titulo` * | 2–150 caracteres. Si ya existe una actividad con el mismo título y cargo en el proyecto (activa o inactiva), o el archivo la repite → **error** (la carga solo crea) |
| `cargo` * | conserje, guardia, jardinero, mantenimiento, administrador, otro (sin distinguir mayúsculas) |
| `servicio` * | limpieza, mantenimiento, seguridad, jardineria, administracion, otro («Jardinería» → jardineria) |
| `descripcion`, `instrucciones_seguridad` | texto libre, ≤ 2000 |
| `duracion_min` | entero > 0; **obligatoria si el servicio es limpieza** (regla de la pantalla) |
| `icono` | uno de los íconos de la pantalla; vacío = el del servicio |
| `area` | nombre exacto entre las áreas **activas** del proyecto; 0 → error, 2+ → ambigua. Nunca se crea |
| `orden` | entero ≥ 0 (vacío = 0) |
| `requiere_foto`, `requiere_comentario`, `requiere_checklist` | si / no (vacío = no) |
| `checklist` | pasos separados por `\|` (≤ 50); con `requiere_checklist = si` debe traer ≥ 1 paso |
| `insumos` | `Nombre [x cantidad]; …` → suministros **activos** del proyecto por nombre (0 → error, 2+ → ambiguo); cantidad decimal > 0 (vacío = 1); repetido en la fila → error; `!` no se admite |
| `herramientas` | igual, contra el inventario con `categoria = herramienta` y no dado de baja; cantidad entera; sufijo `!` = obligatoria |
| `equipo` | igual, `categoria = equipo` |

Además: un valor que empiece por `=`, `+`, `-` o `@` se rechaza (posible fórmula; los campos libres solo rechazan `=`, `+`
y `@`); cualquier columna fuera de la lista (`activo`, `id`, `company_id`…) rechaza la fila.

Los recursos se resuelven **bajo la RLS del llamador** (SECURITY INVOKER): ver suministros exige
`condominios.tab.suministros` y ver el inventario exige `condominios.tab.inventario`. Sin ese permiso, la fila no dice
«no existe» sino que pide el permiso de la pestaña correspondiente (misma regla en el bloque).

## Recursos en bloque

Con permiso de **editar** el catálogo (`canActInCondominiosTab(…, 'plantillas_cargo', 'edit')`) aparecen casillas en las
tarjetas y «Seleccionar todas» sobre las tarjetas **visibles** (respeta los filtros de servicio, estado y cargo). La barra
de selección abre «Recursos en bloque»: pestañas Insumos / Herramientas / Equipo (solo activos y no dados de baja al
agregar), cantidad por recurso y «obligatoria» para herramientas y equipo, y la acción **Agregar** o **Quitar**.

`plantillas_recursos_en_bloque(proyecto, actividades[], accion, insumos, inventario)` (INVOKER, atómica; hasta 200
actividades × 50 recursos): comprueba el permiso de editar, el acceso al proyecto, que **todas** las actividades y los
recursos sean de ese proyecto (si no, `PLANTILLAS_BLOQUE_ALCANCE`), toma un `pg_advisory_xact_lock` por proyecto y
escribe por pares. **Agregar** usa `ON CONFLICT DO NOTHING`: los vínculos que ya existían conservan su cantidad y su
«obligatoria». **Quitar** borra los pares que existan. Devuelve `{plantillas, recursos, pares, agregados, ya_estaban,
quitados, no_estaban}` y la pantalla lo muestra. Nada de esto se ofrece en consulta (Limpieza → Actividades) ni en modo
selector (armado de rutinas).

## Permisos y alcance

- Carga masiva: lo mismo que «+ Nueva actividad» (`plantillas_import_puede_crear()`, espejo SQL de
  `canActInCondominiosTab(…, 'create')`, `COALESCE(…, false)`); si no → `PLANTILLAS_IMPORT_PERMISO` (42501).
- Bloque: lo mismo que «✏️ Editar» (`plantillas_puede_editar()`); si no → `PLANTILLAS_BLOQUE_PERMISO` (42501).
- El proyecto debe ser de la empresa del llamador y accesible (`can_access_project`); si no →
  `PLANTILLAS_IMPORT_PROYECTO` / `PLANTILLAS_BLOQUE_PROYECTO` (23514).
- Todo es **SECURITY INVOKER**: las actividades y los puentes se insertan bajo la RLS vigente del catálogo y de
  `plantilla_tarea_suministros` / `plantilla_tarea_herramientas`, con el tenant copiado por `plantilla_recurso_coherente`
  y `creado_por` sellado por `trg_sellar_creado_por`. No se amplía ningún permiso.
- Los lotes (`plantillas_importaciones`, `plantillas_importacion_filas`) solo los escriben las RPC (candado por GUC de
  sesión `plantillas.import_rpc`, trigger `plantillas_tg_imp_solo_rpc`); se leen por empresa y proyecto accesible; nadie
  los borra por la API.
- Concurrencia: aplicar y el bloque toman un `pg_advisory_xact_lock` por proyecto; el mismo lote (o el mismo contenido)
  aplicado por dos sesiones a la vez se escribe una sola vez.

## Errores del servidor (prefijo que la pantalla quita)

`PLANTILLAS_IMPORT_PERMISO` (42501) · `PLANTILLAS_IMPORT_PROYECTO`, `_VACIA`, `_LIMITE`, `_LOTE`, `_CON_ERRORES` (23514) ·
`PLANTILLAS_IMPORT_DUPLICADO` (23505) · `PLANTILLAS_IMPORT_SOLO_RPC` (42501, escritura directa) ·
`PLANTILLAS_BLOQUE_PERMISO` (42501) · `PLANTILLAS_BLOQUE_PROYECTO`, `_ACCION`, `_VACIO`, `_LIMITE`, `_RECURSO`, `_ALCANCE`
(23514).

## Pruebas

```bash
PATH=/usr/lib/postgresql/16/bin:$PATH PGPORT_TEST=55565 supabase/tests/plantillas_importacion/run.sh
npx vitest run src/domain/condominios/__tests__/plantillasImportacion.test.ts src/domain/condominios/__tests__/plantillasRecursos.test.ts \
  src/components/condominios/tabs/__tests__/ImportarActividadesModal.test.tsx src/components/condominios/__tests__/ActividadesCatalog.bloque.test.tsx
```

La suite SQL (117 comprobaciones) aplica la migración dos veces sobre el fixture (RBAC real + catálogo, puentes, áreas,
suministros e inventario con sus policies vigentes, incluidas las que exigen `tab.suministros` y `tab.inventario`) y
ejerce, como cada persona: A vista previa (30 filas: cada regla por campo, catálogos ambiguos, recurso inactivo o dado de
baja, equipo en la columna de herramientas, `!` en insumos, actividad existente activa e inactiva, repetida en el archivo,
valores por omisión; nada escrito), B aplicar con errores no escribe, C aplicar OK (actividad con todos sus campos,
puentes con cantidad y obligatoria, tenant del trigger, `creado_por`, `reutilizada`), D el mismo contenido no entra dos
veces (y sí tras borrar sus actividades), E re-evaluación al aplicar, F descartar, G permisos y alcance (ver sin crear, sin
permiso, otro proyecto, otra empresa, dueña, admin acotado, asignación, crear sin editar, sin permiso de Suministros o de
Inventario con mensaje claro, sin perfil, anon, límite, vacío, proyecto inexistente), H candado por RPC y lectura de
lotes, I inventario, J recursos en bloque (agregar con conteos, repetir = 0, quitar, alcance, inactivo y dado de baja,
acción y cantidades inválidas, permisos, dueña, sin perfil, anon). Con **sesiones reales**: el mismo lote aplicado a la
vez y dos lotes con el mismo contenido a la vez. Ocho mutantes (actividad repetida, permiso de crear, acceso al proyecto,
re-evaluación, categoría del inventario, permiso de editar, alcance del bloque, ON CONFLICT) hacen fallar la suite.
`fail_open_sin_perfil` registra `plantillas_import_puede_crear` y `plantillas_puede_editar`.

## Verificación en el sandbox (`jwpmivhvlstslncrtokb`, 2026-10-15)

Migración `20261031000200` aplicada por `apply-migrations-sandbox.yml` (run 75); inventario comprobado por SQL (nueve
funciones con sus ACL y modo INVOKER/DEFINER, dos tablas con RLS y policies, dos triggers del candado, cero lotes).
Datos «ZZ PLA» (`sandbox_datos_pla.sql`): operadora g2 (rol con `plantillas_cargo` + `.create` + `.edit` +
`tab.suministros` + `tab.inventario`, asignada a P1), g3 solo ver, dueña, admin de otra empresa; área «ZZ PLA Pasillos»,
insumos Escoba / Bolsa / Cloro (inactivo), inventario Trapeador y Carretilla (herramienta) e Hidrolavadora (equipo),
actividad previa «ZZ PLA Barrido» (conserje) y «ZZ PLA Otra» en P2.

El primer intento del navegador descubrió que el inventario no se resolvía: la RLS real de `inventario_condominio`
(20260518000010) exige `condominios.tab.inventario`, que el fixture de la suite no replicaba. Se corrigió el fixture, se
añadió el permiso al rol de prueba y la migración ahora devuelve un mensaje claro cuando falta ese permiso (como ya hacía
con Suministros; comprobaciones G10c y J15b). **Esa revisión posterior de `plantillas_import_evaluar` y
`plantillas_recursos_en_bloque` no quedó aplicada en el sandbox**: el `CREATE OR REPLACE` por el conector se retuvo
(60 s) en cada intento, y `apply-migrations-sandbox.yml` no reaplica una versión ya registrada. Solo cambia el mensaje
para quien no ve Inventario; el sandbox siguió probándose con la versión del run 75 y una operadora con ambos permisos
(mismas rutas de código). Producción recibirá la migración definitiva.

**Navegador real** (Chromium + Playwright, build de la rama contra el sandbox; capturas en
`docs/capturas/plantillas_importacion/`):

| Paso | Resultado |
|---|---|
| g2 · «⬆️ Carga masiva» → «Descargar CSV» | `plantilla_actividades.csv` con las 16 columnas |
| archivo con errores (cargo «cocinero», insumo inexistente, título «ZZ PLA Barrido» ya existente, checklist obligatorio sin pasos, equipo en la columna de herramientas) | fila 1 válida con sus 4 recursos resueltos; filas 2–6 marcadas en su fila con el motivo; **«Confirmar y guardar» deshabilitado**; Cancelar descarta el lote |
| archivo limpio (3 filas; área en minúsculas, «Jardinería», `Trapeador x2!`, `Hidrolavadora!`) | «3 válidas · 0 con error · 5 recursos» → confirmación → **3 actividades** en las tarjetas con «Recursos (4)», «(0)» y «(1)» |
| volver a subir el mismo archivo | «ya se importó a este proyecto», guardar deshabilitado; además las filas salen con «Ya existe una actividad…» |
| g2 · filtro Guardia → «Seleccionar todas» → 1; «Todos» → marcar Barrido y Poda → 3 | barra «3 actividades seleccionados» → «Recursos en bloque»: Cloro (inactivo) no se ofrece; en «Equipo» no aparece el Trapeador |
| agregar Escoba ×2 + Bolsa + Hidrolavadora obligatoria a las 3 | servidor: 9 pares, **8 agregados, 1 ya estaba** (Poda ya tenía la Hidrolavadora); tarjetas «Recursos (3)» las tres; selección limpia |
| quitar Escoba de las 3 (sin cantidades al quitar) | **3 quitados**, tarjetas «Recursos (2)» |
| g3 (solo ver) | ni «Carga masiva» ni casillas; 8 tarjetas visibles |
| peticiones directas | g3 bloque → 403 `PLANTILLAS_BLOQUE_PERMISO`; g3 previsualizar → 403 `PLANTILLAS_IMPORT_PERMISO`; g2 con una actividad de P2 → 400 `PLANTILLAS_BLOQUE_ALCANCE`; g2 sobre P2 (no asignado) → 400 `PLANTILLAS_BLOQUE_PROYECTO`; columna `activo` y celda `=SUMA(1)` → fila con error |

SQL tras la prueba: «ZZ PLA Trapeado pasillos» nace activa con área resuelta, orden 2, foto y checklist (`["Barrer","Trapear"]`),
insumos Bolsa ×2 y Escoba ×1, inventario Hidrolavadora ×1 y Trapeador ×2 obligatoria; las tres actividades del bloque
quedan con Bolsa ×1 e Hidrolavadora ×1 obligatoria tras quitar la Escoba; todas las puentes con el tenant del trigger y
`creado_por` = g2; lotes: 1 aplicado (3/0), 4 descartados y 1 que quedó «previsualizado» (un cierre abrupto del navegador
en el primer intento; es historial, no se borra por la API).

Retirada: `sandbox_limpieza_pla.sql` (ensayo → aplicar) borra también lo que creó la prueba (actividades, puentes y
lotes de la empresa). **Retirado el 2026-10-15** por la persona responsable desde el editor SQL del sandbox (el conector
retiene los `DELETE`); comprobación posterior de solo lectura: 0 empresas, usuarios, roles, actividades, lotes, insumos e
inventario «ZZ PLA».

## Despliegue

Solo la migración; no hay funciones Edge ni secretos nuevos. Producción se aplica por `apply-migrations-prod.yml` con la
aprobación `production-db`; la huella de producción se refresca después en una PR aparte (como #942 / #943).

## Recuperación

`scripts/reversion-plantillas-importacion.sql`: A) cerrar las RPC a la API conservando el historial de lotes; B) localizar
lo que importó un lote (solo lectura; las actividades se desactivan o eliminan desde el catálogo); C) reversión exacta con
respaldo previo; D) comprobaciones.

## Límites conocidos

- El catálogo no tiene UNIQUE por título: la carga lo exige por fila (título + cargo), pero la pantalla sigue permitiendo
  duplicados manuales.
- Las áreas, insumos e inventario se resuelven por nombre dentro del proyecto: dos con el mismo nombre bloquean la fila
  hasta renombrar uno.
- Herramientas y equipo viven en la misma tabla (`inventario_condominio`); la columna decide por `categoria`. Otras
  categorías (material, mobiliario, vehículo, otro) no se importan ni se ofrecen en el bloque.
- La vista previa guarda un lote aunque luego se cancele (queda `descartado`): es historial, no se borra por la API.
