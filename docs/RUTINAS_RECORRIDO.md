# Limpieza · Rutinas como recorrido por áreas (arrastrar y soltar)

Migración `20261102000000_rutinas_recorrido_por_areas`. En **Condominios → Recursos Humanos → Limpieza → Rutinas**, una
rutina deja de ser una lista plana de actividades con un área opcional en la cabecera y pasa a ser un **recorrido**:

1. primero se eligen las **áreas**, en el orden en que se van a intervenir («Apartamento 1AB → Apartamento 1C →
   Gradas»), arrastrándolas desde la paleta y reordenándolas arrastrando su cabecera;
2. después a cada área se le **sueltan encima las actividades** del catálogo que se hacen ahí, también en orden. La
   misma actividad puede estar en varias áreas (se barre en cada pasillo);
3. el **tiempo se va acumulando**: cada área suma las duraciones de sus actividades y arranca donde terminó la
   anterior. Con jornada, se lee como hora estimada («07:00 → 07:07») y el total se compara con lo que dura la jornada
   (aviso si no cabe). Las actividades sin duración se cuentan aparte.

Quien recibe la rutina en su turno la hace en ese orden: **Generar tareas** crea las tareas con el área de su parada y
en el orden rutina → área → actividad.

![Armado en escritorio](capturas/rutinas_recorrido/10-armado-escritorio.png)

Sin arrastre (pantallas táctiles, teclado) cada gesto tiene su botón: **＋** en la paleta (las actividades van al área
seleccionada, la de borde resaltado), **↑ ↓** para reordenar —en el borde de un área la actividad cruza a la vecina— y
**✕** para quitar. Todo es **borrador hasta «Guardar»**: cabecera y recorrido se guardan juntos.

| Móvil | Modo oscuro |
|---|---|
| ![Móvil](capturas/rutinas_recorrido/20-movil.png) | ![Oscuro](capturas/rutinas_recorrido/30-oscuro.png) |

## Archivos

| Qué | Dónde |
|---|---|
| Migración (tabla de paradas, paso → parada, unicidad por área, RPC de guardado, materialización) | `supabase/migrations/20261102000000_rutinas_recorrido_por_areas.sql` |
| Suite SQL (cadena completa, huella del auditor, forma desconocida de producción, purga, 9 mutantes) | `supabase/tests/rutinas_recorrido/` (`run.sh`, `fixture.sql`, `assert.sql`, `assert_purga.sql`) |
| Guardas estáticas | `src/__tests__/rutinasRecorridoMigracion.test.ts`; `materializarRutinasRls.test.ts` e `insertSoloPendiente.test.ts` ahora vigilan la versión viva de la RPC |
| Dominio puro (cada gesto del editor y el tiempo acumulado) | `src/domain/condominios/rutinasRecorrido.ts` (+ `__tests__/rutinasRecorrido.test.ts`) |
| Datos | `fetchRutinasLimpieza` (trae `paradas`) en `tabQueries.ts`; `guardarRecorridoRutina` en `tabMutations.ts` |
| Pantalla | `src/components/condominios/tabs/limpieza/EditorRutina.tsx`, `VistaRutinas.tsx` (+ `__tests__/VistaRutinas.test.tsx`) |
| Tipos | `RutinaArea`, `ResultadoGuardarRecorrido`, `RutinaActividad.rutina_area_id` en `src/types/condominios/operaciones.ts`; `src/types/database.types.ts` |
| Recuperación | `scripts/reversion-rutinas-recorrido.sql` |
| CI | paso «Rutinas como recorrido por áreas…» en `.github/workflows/coverage.yml` |

## Modelo

- **`rutina_areas`** — las paradas: `rutina_id`, `area_id`, `orden`, `notas`. Una parada por área y rutina
  (`rutina_areas_unica`). FKs **compuestas** `(… , company_id, project_id)` hacia la rutina (CASCADE) y el área
  (RESTRICT); el trigger `rutina_area_coherente` sella el tenant desde la rutina. RLS con el gate
  `condominios.tab.prog_limpieza`, igual que `rutina_actividades`.
- **`rutina_actividades.rutina_area_id`** — de qué parada cuelga el paso, por FK compuesta `(rutina_area_id, rutina_id)`
  hacia el ancla `(id, rutina_id)`: un paso no puede colgar de la parada de otra rutina. Quitar una parada se lleva sus
  pasos. `NULL` = **paso legado** (las rutinas anteriores): se ven como «Actividades sin área», primero, y se
  materializan exactamente como antes (área de la actividad o, si no tiene, la de la rutina). Se pueden arrastrar (o
  bajar con ↓) a un área.
- La unicidad del paso pasa de `(rutina, actividad)` a `(rutina, parada, actividad)` `NULLS NOT DISTINCT`.
- **`tareas_bloque`**: `uq_tareas_bloque_plantilla_area (bloque, plantilla, área) NULLS NOT DISTINCT` reemplaza a
  `(bloque, plantilla)`. «Cargar tareas del cargo» dos veces sigue sin duplicar (misma área); «barrer» en dos
  apartamentos son dos tareas.
- **`guardar_recorrido_rutina(p_rutina_id, p_recorrido jsonb)`** — **SECURITY INVOKER**: recibe la foto completa del
  recorrido y la reconcilia en una transacción por identidad natural (área; área + actividad): conserva lo que sigue
  (con sus notas), crea lo nuevo, borra lo que no viene. Valida la foto entera antes de escribir y bloquea la rutina
  (`FOR UPDATE`) para que dos guardados no se mezclen.
- **`materializar_rutinas_turno`** — misma firma y controles; el área de cada tarea es la de su parada, el orden sigue
  al recorrido, la parada de un área dada de baja no genera trabajo nuevo y «ya existe» compara también el área.
- `rutinas_limpieza.area_id` queda como **legado** (sólo aplica a pasos sin parada); el editor ya no lo ofrece.

## Despliegue: los índices de `tareas_bloque`

`tabla:tareas_bloque/indices` tenía **drift declarado** contra producción desde el 2026-09-01 (#826). Esta migración
**tiene que** tocar ese grupo, porque es la única forma de que la misma actividad exista en dos áreas de un turno. Con el
drift declarado, el auditor de tres vías la marcaba **CAMBIO AMBIGUO**.

Se midió producción (`pg_indexes`, 2026-10-19). La unicidad `uq_tareas_bloque_plantilla` existe allá con el mismo nombre
y la misma forma que en el repositorio. Las diferencias eran otras tres:

- el nombre del índice `(bloque_id, orden)`;
- la definición del índice de `completado_por`;
- un índice de `plantilla_id` que producción no tiene.

ventas-png/control-consumo-agua#953 (`20261101000000`) hace converger el repositorio a esa forma: es no-op en producción y
retira la entrada de `drift-conocido.json`. **Se fusiona antes que este PR**; con eso, este cambio pasa a ser CAMBIO
PLANIFICADO.

Esta migración, además:

- **Retira la unicidad vieja por sus columnas** `(bloque_id, plantilla_id)`, sea índice o constraint y se llame como se
  llame. El aviso `RUTINAS_RECORRIDO: retirada la unicidad …` queda en el log del deploy.
- **Aborta en un pre-vuelo** toda la migración, sin tocar nada, si hubiera filas repetidas en (bloque, actividad, área).
- **Devuelve el índice líder de la FK `plantilla_id`** (`idx_tareas_bloque_plantilla_id`, política de `20260606170000`),
  que producción nunca tuvo y que la unicidad nueva no cubre.

Después del despliegue hay que refrescar la huella de producción, como en los PR de huella anteriores.

## Recuperación

`scripts/reversion-rutinas-recorrido.sql`: A) diagnóstico de solo lectura (cuántos recorridos hay y qué filas chocarían
con los UNIQUE originales); B) reversa completa, que **aborta** si ya hay datos que sólo el modelo nuevo admite en vez de
borrarlos.

## Límites conocidos

- El arrastre nativo de HTML no existe en todos los navegadores táctiles; ahí se arma con los botones.
- Una parada por área: el recorrido no pasa dos veces por la misma área (la tarea se identifica por bloque, actividad y
  área, así que una segunda pasada con la misma actividad sería la misma tarea).
- Independiente de este cambio: desde `20261031000300`, la purga de una empresa que tenga actividades en el catálogo se
  traba en `RRHH_CARGO_EN_USO` (reproducido en Postgres local, en la forma de llaves de producción). La suite de purga de
  este cambio mide sólo las paradas por eso; el arreglo va aparte.
