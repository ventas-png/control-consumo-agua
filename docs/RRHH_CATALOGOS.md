# Recursos Humanos · Configuración: catálogos de cargos y tipos de turno por condominio

Migración `20261031000300_rrhh_catalogos_cargos_y_turnos`. En **Condominios → Recursos Humanos** añade el tab
**Configuración**, donde cada condominio define sus **cargos** y sus **tipos de turno** (los del expediente del
empleado: diurno, nocturno, rotativo…). El resto del área deja de tener listas escritas a mano y «llama» al catálogo:
Personal, Actividades (plantillas, rutinas y carga masiva), Limpieza (áreas y ruta del día), Directorio, Cumpleaños,
Desempeño y Tareas por turno.

Decisiones: catálogo **por condominio**; se **precargan** los 6 cargos y 3 turnos de siempre en cada condominio
existente y en los nuevos; **desactivar, nunca borrar** (borrar sólo si nadie lo usa). Las jornadas de «Asignación de
turnos» (`plantillas_horario` / `bloques_turno`: mañana/tarde/noche) **no se tocan**.

## Archivos

| Qué | Dónde |
|---|---|
| Migración (RBAC del tab, tablas, RLS, siembra, validadores y triggers, en uso y borrado, carga masiva) | `supabase/migrations/20261031000300_rrhh_catalogos_cargos_y_turnos.sql` |
| Suite SQL (Postgres real, sesiones emuladas, 6 mutantes) | `supabase/tests/rrhh_catalogos/` (`run.sh`, `assert.sql`, `datos.sql`, `fixture_rrhh.sql`, `huella.sql`) |
| Dominio puro | `src/domain/condominios/rrhhCatalogos.ts` (+ `__tests__/rrhhCatalogos.test.ts`) |
| Datos | `fetchCondominiosRrhhCatalogosData` en `src/domain/condominios/sectionData.ts`; `fetchUsoCatalogoRrhh` en `tabQueries.ts`; `ctx.cargosPersonal` / `ctx.tiposTurno` en `tabRegistry.tsx` |
| Pantalla | `src/components/condominios/tabs/RrhhConfiguracionTab.tsx`, `src/components/condominios/CatalogoRrhhPanel.tsx` (+ `__tests__/RrhhConfiguracionTab.test.tsx`) |
| Consumidores | `PersonalTab`, `ActividadesCatalog` (vía `PlantillasCargoTab`, `VistaRutinas`), `ProgramacionLimpiezaTab` (`VistaAreas`, `VistaRuta`), `DirectorioTab`, `CumpleanosTab`, `DesempenoPersonalTab`, `TareasPersonalTab`; `tabs/limpieza/ui.ts` conserva `CARGO_LABEL` / `TURNO_LABEL` como `@deprecated` |
| Tipos | `src/types/condominios/operaciones.ts` (`CargoPersonal` y `TurnoPersonal` pasan a código, `CatalogoRrhhItem`, `UsoCargo`, `UsoTurno`), `src/types/database.types.ts` |
| Recuperación | `scripts/reversion-rrhh-catalogos.sql` |
| Sandbox | `supabase/tests/rrhh_catalogos/sandbox_datos_rrh.sql` (datos «ZZ RRH») y `sandbox_limpieza_rrh.sql` (retirada) |
| CI | paso «RRHH — catálogos de cargos y tipos de turno por condominio» en `.github/workflows/coverage.yml` |

## Modelo

`rrhh_cargos` y `rrhh_tipos_turno` son gemelas: `id`, `company_id`, `project_id`, **`codigo`** (slug
`^[a-z0-9][a-z0-9_]{0,39}$`, **inmutable**), `nombre` (2–60, único por proyecto sin mayúsculas ni espacios),
`descripcion`, `icono`, `orden`, `activo`, `creado_por` (sellado), `created_at`, `updated_at`.

- El **código** es la clave que guardan `personal_condominio.cargo/turno`, `plantillas_tarea_cargo.cargo`,
  `programacion_limpieza.cargo/turno` y `ejecuciones_limpieza.turno`. Se propone desde el nombre al crear
  («Supervisor de piscina» → `supervisor_de_piscina`) y después **no se cambia** (`RRHH_CATALOGO_INMUTABLE`, 23514):
  para renombrar se cambia el nombre de pantalla; para cambiar la clave se crea otro y se desactiva este.
- `company_id` lo sella el trigger desde `projects`: el cliente no decide la empresa.
- **Siembra**: cada proyecto existente recibió los 6 cargos (conserje 🧹, guardia 💂, jardinero 🌿, mantenimiento 🔧,
  administrador 👔, otro 👤) y 3 turnos (diurno ☀️, nocturno 🌙, rotativo 🔄); un proyecto nuevo los recibe al nacer
  (`trg_rrhh_sembrar_catalogos`, nunca aborta el alta). Re-sembrar no pisa lo personalizado (`ON CONFLICT DO NOTHING`).

## Reglas (las hace cumplir la base)

| Dónde | Regla |
|---|---|
| `personal_condominio` | al insertar, o al **cambiar** cargo/turno/proyecto, el cargo y el turno deben estar **activos** en el catálogo del condominio (`RRHH_CARGO:` / `RRHH_TURNO:`, 23514); se guardan normalizados (` Conserje ` → `conserje`) |
| `plantillas_tarea_cargo` | mismo trigger `trg_plantillas_cargo_controlado` de siempre; su función ahora lee el catálogo (`PLANTILLAS_CARGO:`, 23514) |
| `programacion_limpieza` | `NULL` sigue siendo comodín; si no, activo en el catálogo |
| `ejecuciones_limpieza.turno` | registro derivado: exige que el turno **exista** (activo o no) |
| Históricos | los triggers sólo validan cuando el valor **cambia** (`IS DISTINCT FROM`): una ficha con un cargo apagado o legado se sigue editando entera |
| Borrar | `rrhh_tg_cargo_borrable` / `rrhh_tg_turno_borrable` abortan con `RRHH_CARGO_EN_USO` / `RRHH_TURNO_EN_USO` (23503) si algún empleado, actividad, programación o ejecución lo usa |
| CHECK literales | `prog_limpieza_cargo_check`, `prog_limpieza_turno_check` y `ejec_limpieza_turno_check` se retiran **después** de instalar los triggers |
| Carga masiva | `plantillas_import_evaluar` lee los cargos **activos** del condominio; acepta el código o el nombre de pantalla y guarda el código; sin cargos activos: «Este condominio no tiene cargos activos: configúralos en Recursos Humanos → Configuración» |

Validadores `rrhh_cargo_valido(p_project, p_codigo, p_solo_activos = true)` / `rrhh_turno_valido(…)`: STABLE
SECURITY DEFINER (regla de integridad: el veredicto no depende de la RLS del llamador; devuelven un booleano).
`rrhh_cargo_en_uso` / `rrhh_turno_en_uso` devuelven los conteos para «en uso: N»; fuera del alcance del llamador,
ceros. Las internas (`rrhh_sembrar_defaults`, `rrhh_cargo_uso`, `rrhh_turno_uso`, los triggers) no son ejecutables
por `authenticated`.

## Permisos y alcance

Tab `condominios.tab.rrhh_config` (categoría `recursos_humanos`) con `.create`, `.edit`, `.change_status`,
`.approve`, `.delete`. La migración lo concede al Administrador General y, por herencia, a cada rol que ya tenía
**allow** sobre la clave homónima de `personal` (sólo allow → allow; los deny se ponen desde el editor de roles).

- **Lectura**: toda la empresa con acceso al proyecto (catálogo transversal: lo necesitan los selects de Personal,
  Actividades y Limpieza aunque no se tenga el tab).
- **Crear / editar / borrar**: `rrhh_config.create` / `.edit` / `.delete` (`user_has_permission` ya responde true a
  super_admin / company_owner / admin) y acceso al proyecto. Borrar además exige uso 0 (trigger).

## Pantalla

`RrhhConfiguracionTab` monta dos `CatalogoRrhhPanel` (cargos y tipos de turno): nombre, código (propuesto y editable
sólo al crear), ícono, orden, estado, descripción; tarjetas con código, orden, estado y «en uso: N» (empleados ·
actividades · programaciones, o empleados · programaciones · ejecuciones); Editar, Desactivar/Activar y, sólo con
`.delete` y uso 0, Eliminar. Duplicados por código o nombre normalizado se avisan antes de guardar; los errores del
servidor se traducen (`mensajeErrorCatalogo`).

Los consumidores reciben `cargos` / `tiposTurno` por props y resuelven etiquetas e íconos con `etiquetaCargo`,
`iconoCargo`, `etiquetaTurno`, `iconoTurno` (catálogo → valor de siempre → código crudo). Los selects usan
`opcionesSelect`: los **activos** en su orden y, si el valor actual no está entre ellos, ese valor al final marcado
«(inactivo)» o «(histórico)» con un aviso. Sin catálogo (un entorno sin la migración) se ofrecen los seis cargos y
tres turnos de siempre.

## Pruebas

```bash
PATH=/usr/lib/postgresql/16/bin:$PATH PGPORT_TEST=55566 supabase/tests/rrhh_catalogos/run.sh
npx vitest run src/domain/condominios/__tests__/rrhhCatalogos.test.ts src/components/condominios/__tests__/RrhhConfiguracionTab.test.tsx \
  src/components/condominios/tabs/__tests__/PersonalTab.catalogo.test.tsx src/components/condominios/tabs/__tests__/PlantillasCargoTab.test.tsx \
  src/__tests__/rrhhCatalogosMigracion.test.ts
```

La suite SQL (53 comprobaciones) aplica 20261031000200 y la migración dos veces sobre el fixture (RBAC real,
catálogo de actividades, personal, programación y ejecuciones **con los tres CHECK literales**, un empleado legado
`Polivalente`/`mixto` y una actividad `Conserje` insertados antes) y ejerce, como cada persona: A backfill (6+3 por
proyecto, CHECK fuera, 13 triggers, 6 claves, Admin General, herencia sólo allow, ACL de las DEFINER), B proyecto
nuevo, C CRUD y RLS (alcance por proyecto y empresa, `company_id` y `creado_por` sellados, código inmutable, nombre
único normalizado, forma, DELETE por permiso, anon), D desactivar vs borrar en uso y `rrhh_*_en_uso` (ceros fuera de
alcance), E validación en las cuatro tablas (activo, inactivo, inexistente, normalizado, NULL comodín, de otro
proyecto, mover de proyecto, ejecución con turno apagado), F históricos editables, G carga masiva (código, nombre,
inactivo, inexistente, vacío, catálogo vacío), H re-sembrar. Seis mutantes (activo ignorado, `IS DISTINCT FROM`,
guarda de borrado, acceso al proyecto en SELECT, lista literal en la carga, siembra al crear el proyecto) hacen fallar
la suite. `limpieza_catalogos`, `plantillas_importacion` y `fail_open_sin_perfil` (221 funciones) siguen en verde.

## Verificación en el sandbox (`jwpmivhvlstslncrtokb`, 2026-10-16)

Migración `20261031000300` aplicada por `apply-migrations-sandbox.yml` (run 76). Comprobado por SQL: 7 proyectos
con 6 cargos y 3 turnos cada uno (42 / 21), los tres CHECK retirados, los 7 triggers, 6 claves RBAC y las 6 del
Administrador General, 0 empleados fuera del catálogo, las 14 funciones `rrhh_*` con su modo y ACL (`authenticated`
sólo en los dos validadores y los dos `en_uso`; `anon` en ninguna).

Datos «ZZ RRH» (`sandbox_datos_rrh.sql`, prefijo `5b5b6000`): empresa A con P1 y P2, empresa B con PB (los tres
nacieron sembrados por el trigger); h1 dueña, h2 operadora P1 con rol «ZZ RRH Config» (rrhh_config + create/edit/
delete, personal, plantillas, limpieza), h3 «ZZ RRH Solo personal», h4 admin de B; en P1 el cargo propio «ZZ RRH
Temporal» (`zz_temporal`, apagado tras asignarlo a Carla), Ana (conserje), Beto (jardinero), actividad «ZZ RRH
Barrido» y programación «ZZ RRH Pasillos» (cargo jardinero).

**Navegador real** (Chromium + Playwright, build de la rama contra el sandbox; capturas en
`docs/capturas/rrhh_catalogos/`):

| Paso | Resultado |
|---|---|
| h2 · Configuración | «7 cargos (6 activos) · 3 tipos de turno (3 activos)»; conserje «en uso: 2» (1 empleado · 1 actividad), jardinero «en uso: 2» (1 empleado · 1 programación) **sin botón Eliminar**; ZZ RRH Temporal inactivo con «en uso: 1»; administrador «en uso: 0» con Eliminar |
| + Nuevo cargo «Supervisor de piscina» | código propuesto `supervisor_de_piscina`, cambiado a `supervisor_piscina`, ícono 🏊 → tarjeta nueva, `creado_por` = h2 |
| + Nuevo cargo « CONSERJE » con código `conserje_2` | «Ya existe «Conserje» en este condominio…» antes de guardar |
| Desactivar Jardinero (en uso) · Eliminar Administrador (sin uso) · + Nuevo tipo de turno «Fin de semana» | jardinero Inactivo; administrador desaparece; turno `fin_de_semana` |
| h2 · Personal | Beto muestra «Jardinero», Carla «ZZ RRH Temporal»; el alta ofrece Conserje, Guardia, Mantenimiento, Otro, Supervisor de piscina (ni Jardinero ni Temporal) y Diurno, Nocturno, Rotativo, Fin de semana; «ZZ RRH Fede» creado como Supervisor de piscina / Fin de semana |
| Editar a Beto | el select trae «🌿 Jardinero (inactivo)» seleccionado con el aviso; se guarda el teléfono sin tocar el cargo |
| h2 · Plantillas → + Nueva actividad | el select de cargo ofrece los activos, incluido Supervisor de piscina, sin Jardinero |
| h3 (solo personal) | el tab Configuración muestra acceso denegado; en Personal el alta sí lee el catálogo |
| peticiones directas | h2 `DELETE` jardinero → 409 `23503 RRHH_CARGO_EN_USO: … 1 empleado(s), 0 actividad(es) y 1 programación(es)`; h2 `PATCH codigo` → 400 `23514 RRHH_CATALOGO_INMUTABLE`; h2 personal con cargo `portero` → 400 `23514 RRHH_CARGO`; con `jardinero` (inactivo) → 400 `23514`; h2 cargo en P2 (no asignado) → 403 `42501`; h3 `INSERT` cargo → 403 `42501`; h3 `PATCH activo` → 200 y 0 filas; h4 (otra empresa) `SELECT` cargos de A → `[]` y `rrhh_cargo_en_uso` → ceros |

SQL tras la prueba: en P1 jardinero inactivo (`updated_at` movido), `supervisor_piscina` 🏊 orden 80 y
`fin_de_semana` con `creado_por` = h2, administrador ausente; Fede con `supervisor_piscina` / `fin_de_semana`, Beto
sigue `jardinero` con el teléfono nuevo, Carla sigue `zz_temporal`.

Retirada: `sandbox_limpieza_rrh.sql` (ensayo → aplicar) borra también lo que creó la prueba. Se corre desde el
editor SQL del sandbox (el conector retiene los `DELETE`).

## Despliegue

Solo la migración; no hay funciones Edge ni secretos nuevos. Producción se aplica por `apply-migrations-prod.yml`
al fusionar en `main` (evento `push`, aprobación `production-db`); la huella de producción se refresca después en una
PR aparte (como #945). Impacto en datos: ninguna fila existente cambia de valor; se insertan 6 cargos y 3 turnos por
condominio (8 condominios → 48 + 24 filas). Producción (solo lectura, 2026-10-16) usa exclusivamente los valores de
siempre, así que ningún empleado, actividad ni programación queda fuera del catálogo.

**Desplegada el 2026-10-16** (PR #946 fusionada como `efbab83a`; run 38945427734 de «Apply Migrations to Production», evento
`push` al fusionar, `success` a las 18:11 UTC tras la aprobación de `production-db`). Comprobación posterior de solo lectura en
producción (18:20 UTC): 886 migraciones, máx. `20261031000300`; 8 proyectos con 6 cargos y 3 turnos cada uno (48 / 24 filas);
los tres CHECK literales retirados; los 7 triggers; 6 claves RBAC, 6 grants del Administrador General y 30 grants en total;
0 empleados, actividades o programaciones fuera del catálogo; las 14 funciones `rrhh_*` con su modo (DEFINER salvo los tres
triggers de validación INVOKER) y ACL (`authenticated` solo en los dos validadores y los dos `en_uso`; `anon` en ninguna).
Huella de producción recapturada a las 18:20 UTC (`scripts/schema-drift/huella-produccion.json`): 9 grupos cambiados y 42
nuevos, 3657 → 3699, exactamente los que el auditor de la PR anunció; los 3646 grupos que la PR no toca son idénticos a la
captura anterior y el sha256 completo coincide con el medido en producción; `drift-conocido.json` no cambia. «ZZ RRH» retirado
del sandbox el mismo día (comprobación de solo lectura: 0 empresas, usuarios, roles, cargos y personal).

## Recuperación

`scripts/reversion-rrhh-catalogos.sql`: A) reabrir la escritura sin catálogo (quitar los triggers, volver a la lista
literal en actividades, re-ADD de los tres CHECK); B) localizar valores fuera de la lista original y lo que cada
condominio personalizó (solo lectura); C) reversión exacta con respaldo; D) comprobaciones.

## Límites conocidos

- El turno del catálogo es el del expediente del empleado; las jornadas con horario siguen en Asignación de turnos y
  `TURNO_A_TURNO_PERSONAL` (manana/tarde → diurno, noche → nocturno) sigue siendo un puente fijo.
- Una ficha con un cargo apagado o legado se edita, pero no se puede devolver a ese valor una vez cambiado.
- «En uso: N» se calcula al abrir el tab (una RPC por código); la base lo vuelve a comprobar al borrar.
- `CARGO_LABEL` / `TURNO_LABEL` de `tabs/limpieza/ui.ts` quedan como fallback: cualquier pantalla nueva debe leer
  `ctx.cargosPersonal` / `ctx.tiposTurno`.
