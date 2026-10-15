# STR · carga masiva de reservas desde una plantilla propia (CSV / XLSX)

Migración `20261031000100_str_reservas_importar`. Permite cargar de un archivo las reservas de corto plazo de un
proyecto (en curso, cargadas o futuras) con **validación en el servidor y vista previa**, en vez de teclearlas una a
una. Es el mismo molde que la carga masiva de renglones de compras (`compras_lineas_importar_*`,
[`COMPRAS_BLOQUE_C.md`](COMPRAS_BLOQUE_C.md)) y usa el mismo lector de archivos del navegador que la carga de
proveedores.

## Archivos

| Qué | Dónde |
|---|---|
| Migración (lotes, evaluación por fila, previsualizar / aplicar / descartar) | `supabase/migrations/20261031000100_str_reservas_importar.sql` |
| Suite SQL (Postgres real, sesiones emuladas y reales, 5 mutantes) | `supabase/tests/str_importacion/` (`run.sh`, `assert.sql`, `datos.sql`, `fixture_str.sql`, `concurrencia_prep.sql`, `huella.sql`) |
| Dominio (plantilla, lector, RPC) | `src/domain/condominios/strImportacion.ts` (+ `__tests__/strImportacion.test.ts`) |
| Pantalla | `src/components/condominios/tabs/ImportarReservasSTRModal.tsx` (botón «⬆️ Carga masiva» en `STRTab.tsx`) (+ `__tests__/ImportarReservasSTRModal.test.tsx`) |
| Tipos | `src/types/condominios/comercial.ts` (`FilaImportacionSTR`, `VistaPreviaImportacionSTR`, `ResultadoImportacionSTR`), `src/types/database.types.ts` |
| Recuperación | `scripts/reversion-str-importacion.sql` |
| CI | paso «STR — carga masiva de reservas» en `.github/workflows/coverage.yml` |

## Flujo

1. **Plantilla** (`PLANTILLA_RESERVAS_STR`): CSV o XLSX con hoja «Instrucciones»; todas las columnas como texto.
2. **Archivo** → el navegador solo lo convierte en filas de texto (CSV/XLSX reales, sin fórmulas, ≤ 5 MB, ≤ 500 filas;
   `leerArchivoReservasSTR`).
3. **Vista previa** (`str_reservas_importar_previsualizar(proyecto, filas, archivo)`): el servidor crea el **lote** y
   evalúa **cada fila** (datos normalizados, errores por campo, advertencias). **No escribe reservas.**
4. **Confirmar** → `str_reservas_importar_aplicar(lote)`: **todo o nada**; re-evalúa cada fila contra el estado de hoy;
   inserta las reservas **confirmadas** en una transacción. Reaplicar un lote aplicado devuelve su resultado
   (`reutilizada`). El mismo contenido no se importa dos veces al mismo proyecto mientras sus reservas sigan ahí.
5. Cerrar sin confirmar → `str_reservas_importar_descartar(lote)`.

## Columnas y reglas (las hace cumplir el servidor, `str_import_evaluar`)

| Columna | Regla |
|---|---|
| `unidad` * | nombre exacto (sin mayúsculas ni espacios de más) entre las unidades **activas** del proyecto; 0 → error, 2+ → ambigua. Nunca se crea. |
| `huesped_nombre` * | 2–150 caracteres |
| `huesped_email`, `huesped_telefono` | correo básico; teléfono ≤ 30 (puede empezar por `+`) |
| `fecha_entrada` *, `fecha_salida` * | `AAAA-MM-DD` reales; salida > entrada |
| `hora_llegada_estimada`, `hora_salida_estimada` | `HH:MM` |
| `num_adultos`, `num_ninos`, `num_bebes` | enteros; adultos ≥ 1 (vacío = 1), el resto ≥ 0 (vacío = 0) |
| `plataforma` | airbnb, booking, vrbo, directo, otro (vacío = directo) |
| `codigo_confirmacion` | ≤ 60. Repetido en una reserva **no cancelada** del proyecto, o repetido en el archivo → **error** |
| `fecha_reservacion` | `AAAA-MM-DD` |
| `monto_noche`, `monto_total` | punto decimal, hasta 2 decimales; total vacío = noches × monto_noche |
| `politica_cancelacion` | flexible, moderada, estricta, no_reembolsable, na, otra (vacío = na) |
| `mascotas` | si / no (vacío = no) |
| `notas` | ≤ 1000 |

Además: un valor que empiece por `=`, `+`, `-` o `@` se rechaza (posible fórmula; el teléfono solo rechaza `=` y `@`);
cualquier columna fuera de la lista (`estado`, `id`, `company_id`…) rechaza la fila; toda reserva nace
`confirmada`. **Advertencias** (no bloquean): solape de fechas con otra reserva no cancelada de la misma unidad; fila
que repite otra del archivo (misma unidad, fechas y huésped).

## Permisos y alcance

- Quien importa necesita lo mismo que «+ Nueva Reserva» en pantalla (`canActInCondominiosTab(…, 'str', 'create')`):
  dueño/admin/super_admin, o ver la pestaña **y** (crear en la pestaña o el par legado
  `platform.condominios.view` + `.create`). Espejo en SQL: `str_import_puede_crear()` (`COALESCE(…, false)`: una
  sesión sin perfil se rechaza). Si no → `STR_IMPORT_PERMISO` (42501).
- El proyecto debe ser de la empresa del llamador y accesible (`can_access_project`); si no → `STR_IMPORT_PROYECTO`.
- Las RPC son **SECURITY INVOKER**: la unidad y las reservas con las que se compara son las que la RLS deja ver, y las
  reservas se insertan bajo la RLS de `reservas_str` y con `creado_por` sellado por `trg_sellar_creado_por`. No se
  amplía ningún permiso.
- Los lotes (`str_importaciones`, `str_importacion_filas`) solo los escriben las RPC (candado por GUC de sesión
  `str.import_rpc`, trigger `str_tg_imp_solo_rpc`); se leen por empresa y proyecto accesible; nadie los borra por la API.
- Concurrencia: aplicar toma un `pg_advisory_xact_lock` por proyecto, así que el mismo lote (o el mismo contenido)
  aplicado por dos sesiones a la vez se escribe una sola vez.

## Errores del servidor (prefijo que la pantalla quita)

`STR_IMPORT_PERMISO` (42501) · `STR_IMPORT_PROYECTO`, `STR_IMPORT_VACIA`, `STR_IMPORT_LIMITE`, `STR_IMPORT_LOTE`,
`STR_IMPORT_CON_ERRORES` (23514) · `STR_IMPORT_DUPLICADO` (23505) · `STR_IMPORT_SOLO_RPC` (42501, escritura directa).

## Pruebas

```bash
PATH=/usr/lib/postgresql/16/bin:$PATH PGPORT_TEST=55564 supabase/tests/str_importacion/run.sh
npx vitest run src/domain/condominios/__tests__/strImportacion.test.ts src/components/condominios/tabs/__tests__/ImportarReservasSTRModal.test.tsx
```

La suite SQL (67 comprobaciones) aplica la migración dos veces sobre el fixture (RBAC real + `unidades` +
`reservas_str` con sus policies vigentes y su sello) y ejerce, como cada persona: A vista previa (22 filas: cada regla
por campo, código repetido existente y en el archivo, solape y fila repetida como avisos, defectos; nada escrito), B
aplicar con errores no escribe, C aplicar OK (confirmada, unidad resuelta, total calculado, `creado_por`, lote sellado,
`reutilizada`), D el mismo contenido no entra dos veces (y sí tras borrar sus reservas), E re-evaluación al aplicar, F
descartar, G permisos y alcance (ver sin crear, sin permiso, otro proyecto, otra empresa, dueña, admin acotado,
asignación, sin perfil, anon, límite, vacío, proyecto inexistente), H candado por RPC y lectura de lotes, I inventario.
Con **sesiones reales**: el mismo lote aplicado a la vez (una creación, la otra «reutilizada») y dos lotes con el
mismo contenido a la vez (uno entra, el otro se rechaza). Cinco mutantes (código repetido, permiso, acceso al
proyecto, re-evaluación, unidad del proyecto) hacen fallar la suite. `fail_open_sin_perfil` registra
`str_import_puede_crear` y exige que rechace una sesión sin perfil.

## Verificación en el sandbox (`jwpmivhvlstslncrtokb`, 2026-10-15)

Migración `20261031000100` aplicada por `apply-migrations-sandbox.yml` (run 74); inventario comprobado por SQL
(seis funciones con sus ACL y modo INVOKER/DEFINER, dos tablas con RLS y policies, dos triggers del candado, cero
lotes). Datos «ZZ HKF» (`supabase/tests/housekeeping_flujo/sandbox_datos_hkf.sql`): la operadora STR g5 (rol con
`condominios.tab.str` + `.create`, asignada a P1), unidades «ZZ HKF Apto 1A» / «ZZ HKF Apto 2B», reserva previa
`HKF-FUTURA` confirmada.

**Navegador real** (Chromium + Playwright, build de la rama contra el sandbox; capturas en
`docs/capturas/str_importacion/`):

| Paso | Resultado |
|---|---|
| «⬆️ Carga masiva» → «Descargar CSV» | `plantilla_reservas_str.csv` con el encabezado de las 19 columnas |
| archivo con errores (unidad «Nada», salida antes de la entrada, código `HKF-FUTURA` ya usado) | fila 1 válida (total Q 200.00); filas 2–4 marcadas en su fila con el motivo; **«Confirmar y guardar» deshabilitado**; Cancelar descarta el lote |
| archivo limpio (unidad en minúsculas, teléfono con `+`, `mascotas=si`, sin `monto_total`) | «2 válidas · 0 con error · total Q 440.00» → confirmación → **2 reservas** en la pestaña |
| volver a subir el mismo archivo | «ya se importó a este proyecto», guardar deshabilitado; además las filas con código ya existente salen con error |

SQL tras la carga: las dos reservas nacen `confirmada`, con la unidad resuelta por nombre, `monto_total` calculado
(100 × 2 = 200; 80 × 3 = 240), `mascotas` true/false y `creado_por` = g5 (sello de `trg_sellar_creado_por`).

## Despliegue

Solo la migración; no hay funciones Edge ni secretos nuevos. Producción se aplica por `apply-migrations-prod.yml`
con la aprobación `production-db`.

**Desplegada el 2026-10-15** (PR #940 fusionada como `3bc06d4c`; run 38809183788 de «Apply Migrations to
Production», `success` a las 21:22 UTC, aprobación `production-db` de la persona responsable). Comprobación
posterior de solo lectura en producción: 884 migraciones, máx. `20261031000100`; tablas `str_importaciones` y
`str_importacion_filas` con RLS activa y policies `str_imp_select/insert/update` (más la compuerta MFA global);
las seis funciones presentes; `str_reservas_importar_previsualizar` ejecutable por `authenticated` y
`str_reservas_importar_aplicar` cerrada a `anon`; 0 lotes y 0 filas. Huella de producción recapturada a las
21:24 UTC (`scripts/schema-drift/huella-produccion.json`): 0 grupos cambiados y 26 nuevos, 3599 → 3625,
exactamente los que el auditor de la PR anunció; `drift-conocido.json` no cambia.

## Recuperación

`scripts/reversion-str-importacion.sql`: A) cerrar las RPC a la API conservando el historial de lotes; B) localizar lo
que importó un lote (solo lectura; las reservas se cancelan o eliminan desde la pestaña); C) reversión exacta con
respaldo previo; D) comprobaciones.

## Límites conocidos

- Las unidades se resuelven por nombre dentro del proyecto: dos unidades con el mismo nombre bloquean la fila hasta
  renombrar una.
- El solape de fechas es un aviso, no un error: hay proyectos que registran reservas consecutivas con check-out y
  check-in el mismo día (no se solapan) y otros que cargan históricos corregidos a mano.
- La vista previa guarda un lote aunque luego se cancele (queda `descartado`): es historial, no se borra por la API.
