-- ════════════════════════════════════════════════════════════════════════════
-- Herramientas de un turno con su nombre, para quien lo ejecuta
-- (RPC herramientas_del_turno)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- «▶ Iniciar» (Limpieza → Ruta del día y «Tareas por turno») abre «Antes de
-- iniciar el turno», que lista las herramientas de las actividades del turno.
-- La pantalla las leía de plantilla_tarea_herramientas con el embed
-- equipos_comunes(nombre, estado) —e inventario_condominio(nombre, estado) para
-- las filas legadas, 20261122000000—. La puente sí la lee quien ejecuta
-- (tareas_personal) o programa la limpieza (prog_limpieza), pero los catálogos
-- no: equipos_comunes_select exige condominios.tab.equipos e
-- inventario_condominio_select condominios.tab.inventario. Un rol con sólo
-- Limpieza (ver/editar) recibía el embed en NULL y veía una lista de
-- «Herramienta · Obligatoria» sin saber cuál llevar. Se reprodujo con la app
-- real sobre una copia local: la API devolvió "equipos_comunes": null; un
-- company_owner veía «Escoba», «Trapeador». No es una regresión de
-- 20261122000000: con Inventario pasaba igual.
--
-- Los insumos no tienen el problema porque su plan se COPIA con nombre en la
-- tarea (tarea_bloque_suministros.nombre_suministro, 20260907000500). Para las
-- herramientas el dueño del producto eligió la lectura acotada y no la copia:
-- la preparación sigue leyendo la receta VIGENTE de cada actividad (lo de hoy),
-- no hay tabla nueva ni relleno de los turnos ya programados.
--
-- LO QUE HACE
--   herramientas_del_turno(p_bloque_id): SECURITY DEFINER, STABLE, con el
--   patrón de limpieza_calendario (20261103000000):
--   · proyección MÍNIMA: actividad, recurso (equipo_id / inventario_id),
--     cantidad, obligatoria, y del catálogo sólo NOMBRE y ESTADO. Nada de
--     categoría, ubicación, foto, notas, cantidad en existencia ni costos;
--   · sólo las herramientas de las actividades de las tareas de ESE turno, y
--     de la puente del mismo condominio que el turno (company_id y
--     project_id): una tarea cuya actividad fuera de otro condominio no abre
--     el catálogo de ese otro condominio;
--   · empresa (assert_company_scope), uno de los tabs que ven y trabajan las
--     tareas del turno —tareas_personal, turnos, revision_tareas,
--     prog_limpieza: los mismos que cerrar la tarea y consumir sus insumos
--     (consumir_insumos_tarea, 20260907000500)— y acceso al condominio del
--     turno (can_access_project). desempeno_personal lee el turno pero no lo
--     ejecuta: no la invoca.
--   · REVOKE a PUBLIC y anon; EXECUTE a authenticated y service_role.
--
-- LO QUE **NO** HACE: no toca las policies de equipos_comunes,
-- inventario_condominio ni plantilla_tarea_herramientas (Equipos e Inventario
-- siguen exigiendo su tab para el catálogo completo); no copia nada en la
-- tarea; no cambia qué herramientas pide la preparación ni cómo las agrupa.
--
-- IDEMPOTENTE: CREATE OR REPLACE + REVOKE/GRANT. El sandbox
-- supabase/tests/herramientas_turno la aplica dos veces y compara la huella.
--
-- REVERSA (manual):
--   DROP FUNCTION public.herramientas_del_turno(uuid);
--   y que la pantalla vuelva a leer plantilla_tarea_herramientas con el embed.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.herramientas_del_turno(p_bloque_id uuid)
RETURNS TABLE (
  plantilla_tarea_id uuid,
  equipo_id          uuid,
  inventario_id      uuid,
  cantidad           int,
  obligatoria        boolean,
  nombre             text,
  estado             text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  SELECT b.company_id, b.project_id INTO v_company, v_project
  FROM public.bloques_turno b WHERE b.id = p_bloque_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Turno inexistente' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_company_scope(v_company);

  IF NOT public.is_super_admin() THEN
    IF NOT (public.user_has_permission('condominios.tab.tareas_personal')
            OR public.user_has_permission('condominios.tab.turnos')
            OR public.user_has_permission('condominios.tab.revision_tareas')
            OR public.user_has_permission('condominios.tab.prog_limpieza')) THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access_project(v_project) THEN
      RAISE EXCEPTION 'Turno fuera de tu alcance' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- El recurso es del mismo condominio que la puente: lo garantizan sus FK
  -- compuestas (pt_herramienta_equipo_fk, pt_herramienta_recurso_fk). Por eso
  -- basta con acotar la PUENTE al condominio del turno.
  RETURN QUERY
  SELECT h.plantilla_tarea_id,
         h.equipo_id,
         h.inventario_id,
         h.cantidad,
         h.obligatoria,
         -- Equipo o, en las filas legadas, el artículo de Inventario: el CHECK
         -- pt_herramienta_recurso_check exige exactamente uno de los dos.
         COALESCE(e.nombre, i.nombre),
         COALESCE(e.estado, i.estado)
  FROM public.plantilla_tarea_herramientas h
  LEFT JOIN public.equipos_comunes e       ON e.id = h.equipo_id
  LEFT JOIN public.inventario_condominio i ON i.id = h.inventario_id
  WHERE h.company_id = v_company
    AND h.project_id = v_project
    AND h.plantilla_tarea_id IN (
      SELECT t.plantilla_id
      FROM public.tareas_bloque t
      WHERE t.bloque_id = p_bloque_id AND t.plantilla_id IS NOT NULL
    )
  ORDER BY h.plantilla_tarea_id, COALESCE(e.nombre, i.nombre), h.id;
END;
$$;

COMMENT ON FUNCTION public.herramientas_del_turno(uuid) IS
  'Herramientas de las actividades de las tareas de un turno, con nombre y estado del equipo (o del artículo de Inventario legado), para «Antes de iniciar el turno». SECURITY DEFINER: quien ejecuta o programa el turno no necesita el tab de Equipos ni el de Inventario para saber qué llevar. Proyección mínima; exige empresa, tareas_personal/turnos/revision_tareas/prog_limpieza y acceso al condominio del turno (20261231000000).';

REVOKE EXECUTE ON FUNCTION public.herramientas_del_turno(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.herramientas_del_turno(uuid) TO authenticated, service_role;
