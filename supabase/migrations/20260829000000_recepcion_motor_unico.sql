-- ============================================================
-- Recepción: un solo motor para Paquetería y Correspondencia
-- ============================================================
-- Fase 1 de la convergencia (la Fase 0 fue 20260828000000).
--
-- QUÉ SE UNIFICA Y POR QUÉ. `paquetes_recibidos` y `correspondencia_condominio`
-- guardaban el mismo hecho —una pieza física en custodia de recepción a nombre
-- de una unidad— con dos vocabularios y dos niveles de madurez. Mantenerlas
-- separadas costaba: dos flujos de entrega, dos juegos de policies, la misma
-- guía registrable dos veces sin que nadie lo notara, y toda mejora hecha dos
-- veces (o, como pasó hasta la Fase 0, una sola).
--
-- La tabla ganadora es `paquetes_recibidos`: tiene fotos, firma, código de
-- retiro, notificación al residente y trazabilidad de entrega. Correspondencia
-- entra como una CLASE de pieza, no como una tabla aparte.
--
-- LO QUE NO SE FUSIONA. Cada clase conserva su vocabulario de subtipo y de
-- estado, con CHECKs condicionales por clase. Un paquete se 'entrega' o se
-- 'devuelve'; una carta se 'atiende' o se 'archiva'. Forzar un solo juego de
-- estados habría obligado a reinterpretar filas históricas — y "archivado" no
-- es "devuelto".
--
-- SEGURIDAD. Las policies pasan a resolver el permiso POR FILA según `clase`:
-- quien solo tiene condominios.tab.paqueteria no ve ni toca correspondencia, y
-- viceversa. Es exactamente la separación que daban las dos tablas; el gate
-- ahora es un CASE en vez de un nombre de tabla. En UPDATE, USING mira la fila
-- vieja y WITH CHECK la nueva: mover una pieza de clase exige AMBOS permisos.
--
-- RESPALDO. Las filas originales se copian a
-- `correspondencia_condominio_respaldo` antes de migrarlas. La tabla vieja se
-- dropea (su nombre lo hereda una vista de compatibilidad de solo lectura) y el
-- respaldo queda como red hasta verificar en producción; una migración
-- posterior lo elimina.

-- ── 1) Respaldo de las filas originales ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.correspondencia_condominio_respaldo AS
  TABLE public.correspondencia_condominio;

ALTER TABLE public.correspondencia_condominio_respaldo ENABLE ROW LEVEL SECURITY;

-- Solo super admin. No es una tabla operativa: es evidencia para verificar la
-- migración. Sin policies para el resto = nadie más la lee.
DROP POLICY IF EXISTS correspondencia_respaldo_select ON public.correspondencia_condominio_respaldo;
CREATE POLICY correspondencia_respaldo_select ON public.correspondencia_condominio_respaldo
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS correspondencia_respaldo_delete ON public.correspondencia_condominio_respaldo;
CREATE POLICY correspondencia_respaldo_delete ON public.correspondencia_condominio_respaldo
  FOR DELETE TO authenticated USING (public.is_super_admin());

COMMENT ON TABLE public.correspondencia_condominio_respaldo IS
  'Copia de correspondencia_condominio previa a la unificación en paquetes_recibidos (20260829000000). Eliminar tras verificar en producción.';

-- ── 2) Generalizar paquetes_recibidos ───────────────────────────────────────
ALTER TABLE public.paquetes_recibidos
  ADD COLUMN IF NOT EXISTS clase             text NOT NULL DEFAULT 'paquete',
  ADD COLUMN IF NOT EXISTS destinatario_tipo text NOT NULL DEFAULT 'unidad',
  ADD COLUMN IF NOT EXISTS destinatario      text,
  ADD COLUMN IF NOT EXISTS prioridad         text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS fecha_limite      date,
  -- Fecha del documento, distinta del instante de registro: una carta fechada
  -- el 10 puede registrarse el 12. Paquetería no la usa (queda NULL).
  ADD COLUMN IF NOT EXISTS fecha_pieza       date;

-- Correspondencia puede ir dirigida a la administración o a la junta, no solo a
-- una unidad. Se relaja la columna, pero el invariante de paquetería se
-- conserva como CHECK (abajo): un paquete SIEMPRE tiene unidad.
ALTER TABLE public.paquetes_recibidos ALTER COLUMN unidad_id DROP NOT NULL;

-- Borrar una unidad ya no destruye su historial de recepción. Antes era
-- CASCADE, tolerable cuando solo eran paquetes; con notificaciones legales
-- dentro, la constancia de entrega debe sobrevivir a la baja de la unidad
-- (queda huérfana, no borrada). Es el mismo criterio que tenía
-- correspondencia_condominio (ON DELETE SET NULL).
ALTER TABLE public.paquetes_recibidos
  DROP CONSTRAINT IF EXISTS paquetes_recibidos_unidad_id_fkey;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_recibidos_unidad_id_fkey
  FOREIGN KEY (unidad_id) REFERENCES public.unidades(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_clase_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_clase_chk CHECK (clase IN ('paquete','correspondencia'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_destinatario_tipo_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_destinatario_tipo_chk
      CHECK (destinatario_tipo IN ('unidad','administracion','junta','proveedor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_prioridad_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_prioridad_chk CHECK (prioridad IN ('normal','urgente'));
  END IF;
  -- Invariante heredado del NOT NULL que acabamos de relajar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_unidad_por_clase_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_unidad_por_clase_chk
      CHECK (clase <> 'paquete' OR unidad_id IS NOT NULL);
  END IF;
  -- Coherencia del destinatario: si se dirige a una unidad, tiene que haberla.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_destinatario_unidad_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_destinatario_unidad_chk
      CHECK (destinatario_tipo <> 'unidad' OR unidad_id IS NOT NULL);
  END IF;
END $$;

-- Subtipo por clase. Para clase='paquete' el conjunto es idéntico al
-- `paquetes_tipo_chk` anterior, así que reemplazarlo no puede invalidar filas.
ALTER TABLE public.paquetes_recibidos DROP CONSTRAINT IF EXISTS paquetes_tipo_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_tipo_chk CHECK (
    CASE clase
      WHEN 'paquete'        THEN tipo IN ('paquete','documento','sobre','otro')
      WHEN 'correspondencia' THEN tipo IN ('carta','notificacion_legal','factura','circular','otro')
      ELSE false
    END
  );

-- Estado por clase. Va NOT VALID a propósito: la tabla nunca tuvo CHECK de
-- estado y no podemos garantizar que doce meses de filas históricas se ciñan al
-- vocabulario. NOT VALID lo exige de aquí en adelante sin arriesgar que la
-- migración falle por una fila vieja; validarlo es un paso posterior, después
-- de auditar (SELECT DISTINCT estado …) en producción.
ALTER TABLE public.paquetes_recibidos DROP CONSTRAINT IF EXISTS paquetes_estado_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_estado_chk CHECK (
    CASE clase
      WHEN 'paquete'        THEN estado IN ('pendiente','entregado','devuelto')
      WHEN 'correspondencia' THEN estado IN ('pendiente','atendido','archivado')
      ELSE false
    END
  ) NOT VALID;

-- Dirección: correspondencia tiene salida propia (la administración despacha),
-- que NO es el 'saliente_tercero' de paquetería (el residente deja algo para
-- que un tercero lo retire con código). Son flujos distintos y se distinguen.
ALTER TABLE public.paquetes_recibidos DROP CONSTRAINT IF EXISTS paquetes_direccion_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_direccion_chk
  CHECK (direccion IN ('entrante','saliente','saliente_tercero'));

COMMENT ON COLUMN public.paquetes_recibidos.clase IS
  'paquete | correspondencia. Selecciona el vocabulario de tipo/estado y el permiso RBAC que gobierna la fila.';
COMMENT ON COLUMN public.paquetes_recibidos.fecha_pieza IS
  'Fecha del documento (correspondencia). hora_recepcion es cuándo se registró; no son lo mismo.';

-- ── 3) Migrar las filas de correspondencia ──────────────────────────────────
-- Se conserva el `id` original: cualquier referencia externa (enlaces, reportes
-- guardados) sigue apuntando a la misma pieza.
INSERT INTO public.paquetes_recibidos (
  id, company_id, project_id, unidad_id,
  clase, destinatario_tipo, tipo, descripcion, remitente, destinatario,
  num_guia, empresa_mensajeria, estado, direccion, prioridad,
  fecha_limite, fecha_pieza, notas, fotos, firma_path,
  entregado_a_nombre, entregado_via, hora_recepcion, hora_entrega,
  recibido_por, entregado_por, creado_por, created_at
)
SELECT
  c.id, c.company_id, c.project_id, c.unidad_id,
  'correspondencia',
  CASE WHEN c.unidad_id IS NULL THEN 'administracion' ELSE 'unidad' END,
  -- `correspondencia_condominio` NUNCA tuvo CHECK sobre categoria, estado ni
  -- prioridad: cualquier valor fuera de vocabulario (una fila insertada a mano,
  -- un import viejo) haría fallar los CHECKs nuevos y abortaría la migración en
  -- producción. Se normaliza al valor más conservador de cada campo; el valor
  -- original queda íntegro en `correspondencia_condominio_respaldo`.
  CASE WHEN c.categoria IN ('carta','notificacion_legal','factura','circular','otro')
       THEN c.categoria ELSE 'otro' END,
  c.asunto, c.remitente, c.destinatario,
  c.numero_guia, c.empresa_mensajeria,
  -- Un estado irreconocible va a 'archivado', no a 'pendiente': inventar
  -- trabajo pendiente que nadie pidió es peor que archivar de más.
  CASE WHEN c.estado IN ('pendiente','atendido','archivado')
       THEN c.estado ELSE 'archivado' END,
  CASE c.tipo WHEN 'salida' THEN 'saliente' ELSE 'entrante' END,
  CASE WHEN c.prioridad = 'urgente' THEN 'urgente' ELSE 'normal' END,
  c.fecha_limite, c.fecha, c.observaciones, c.fotos, c.firma_path,
  c.entregado_a_nombre, c.entregado_via,
  -- hora_recepcion := created_at, como se anunció en 20260828000000: es el
  -- único instante real que la tabla vieja guardaba. `fecha` (la del documento)
  -- se preserva aparte en fecha_pieza, sin inventar una hora.
  c.created_at, c.hora_entrega,
  c.recibido_por, c.entregado_por, c.creado_por, c.created_at
FROM public.correspondencia_condominio c;
-- SIN `ON CONFLICT DO NOTHING` a propósito. Una colisión de id entre las dos
-- tablas significaría que una pieza de correspondencia comparte identidad con
-- un paquete: saltarla en silencio dejaría la fila original sin migrar y el
-- DROP de abajo la borraría para siempre. Que reviente y no se aplique nada es
-- el resultado correcto. (Precheck en producción: 0 colisiones.)

-- ── 3b) Verificación fail-closed ANTES de borrar nada ───────────────────────
-- El DROP es irreversible dentro de esta transacción: si por cualquier motivo
-- una fila no llegó a su destino, aquí se aborta y la migración entera se
-- deshace, dejando la tabla original intacta.
DO $$
DECLARE
  v_origen    bigint;
  v_migradas  bigint;
  v_respaldo  bigint;
  v_faltantes bigint;
BEGIN
  SELECT count(*) INTO v_origen   FROM public.correspondencia_condominio;
  SELECT count(*) INTO v_respaldo FROM public.correspondencia_condominio_respaldo;
  SELECT count(*) INTO v_migradas FROM public.paquetes_recibidos WHERE clase = 'correspondencia';

  -- Comprobación fila por fila, no solo de totales: cada id original tiene que
  -- existir en el destino Y haber quedado con la clase correcta.
  SELECT count(*) INTO v_faltantes
    FROM public.correspondencia_condominio c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.paquetes_recibidos p
      WHERE p.id = c.id AND p.clase = 'correspondencia'
   );

  IF v_faltantes > 0 THEN
    RAISE EXCEPTION
      'Migración abortada: % de % filas de correspondencia no quedaron en paquetes_recibidos con clase=correspondencia',
      v_faltantes, v_origen;
  END IF;

  IF v_migradas < v_origen THEN
    RAISE EXCEPTION
      'Migración abortada: origen=% filas, migradas=% filas', v_origen, v_migradas;
  END IF;

  -- El respaldo es la red por si hay que reconstruir; si quedó vacío o corto,
  -- no hay red y no se dropea nada.
  IF v_respaldo <> v_origen THEN
    RAISE EXCEPTION
      'Migración abortada: el respaldo tiene % filas y el origen % — sin respaldo completo no se borra la tabla',
      v_respaldo, v_origen;
  END IF;

  RAISE NOTICE 'Correspondencia migrada: % filas (respaldo: %)', v_migradas, v_respaldo;
END $$;

-- ── 4) La tabla vieja cede su nombre a una vista de compatibilidad ──────────
DROP TABLE public.correspondencia_condominio;

-- Solo lectura, con el vocabulario viejo, para consultas externas (reportes,
-- SQL ad-hoc) y para la ventana en la que un frontend anterior siga desplegado.
-- security_invoker: la RLS que se aplica es la de paquetes_recibidos para el
-- usuario que consulta, no la del dueño de la vista.
CREATE VIEW public.correspondencia_condominio WITH (security_invoker = on) AS
SELECT
  id, company_id, project_id,
  CASE direccion WHEN 'saliente' THEN 'salida' ELSE 'entrada' END AS tipo,
  tipo               AS categoria,
  descripcion        AS asunto,
  remitente, destinatario,
  fecha_pieza        AS fecha,
  num_guia           AS numero_guia,
  empresa_mensajeria, prioridad, estado,
  notas              AS observaciones,
  unidad_id, created_at, fotos, firma_path,
  entregado_a_nombre, entregado_via, hora_entrega,
  recibido_por, entregado_por, fecha_limite, creado_por
FROM public.paquetes_recibidos
WHERE clase = 'correspondencia';

-- Acceso explícito, sin depender de los privilegios por defecto del esquema:
-- solo sesiones autenticadas, y la RLS de paquetes_recibidos sigue decidiendo
-- qué filas ve cada una. `anon` no entra.
REVOKE ALL ON public.correspondencia_condominio FROM PUBLIC, anon;
GRANT SELECT ON public.correspondencia_condominio TO authenticated;

COMMENT ON VIEW public.correspondencia_condominio IS
  'Compatibilidad de SOLO LECTURA tras la unificación (20260829000000). Las escrituras van a paquetes_recibidos con clase=''correspondencia''.';

-- ── 5) Policies por clase ───────────────────────────────────────────────────
-- El permiso deja de depender de la tabla y pasa a depender de la fila.
DROP POLICY IF EXISTS paquetes_recibidos_select ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_select ON public.paquetes_recibidos
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
    -- Residente: sus propias piezas. Rama idéntica a la que ya tenían las dos
    -- tablas por separado (20260713010000 y 20260713020000).
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS paquetes_recibidos_insert ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_insert ON public.paquetes_recibidos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  );

DROP POLICY IF EXISTS paquetes_recibidos_update ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_update ON public.paquetes_recibidos
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  );

-- DELETE: rol Y empresa Y permiso de la clase. Antes de la unificación, borrar
-- correspondencia exigía estar en `correspondencia_condominio`, cuyo DELETE ya
-- iba con este mismo rol; al fusionar las tablas, un admin con permiso solo de
-- paquetería habría podido borrar notificaciones legales sin tener el módulo.
-- El gate de clase cierra esa puerta, igual que en las otras tres operaciones.
DROP POLICY IF EXISTS paquetes_recibidos_delete ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_delete ON public.paquetes_recibidos
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  );

-- ── 6) Índices del motor unificado ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_paquetes_clase
  ON public.paquetes_recibidos(project_id, clase, hora_recepcion DESC);

CREATE INDEX IF NOT EXISTS idx_paquetes_fecha_limite
  ON public.paquetes_recibidos(project_id, fecha_limite)
  WHERE fecha_limite IS NOT NULL AND estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_paquetes_num_guia
  ON public.paquetes_recibidos(num_guia)
  WHERE num_guia IS NOT NULL;

-- ── 7) RPCs del portal: acotadas a la clase que les corresponde ─────────────
-- Sin este guard, la firma de recepción del residente podría cerrar una
-- notificación legal desde la pantalla de "mis paquetes". Cuerpo idéntico al de
-- 20260822010000 salvo la condición de clase.
CREATE OR REPLACE FUNCTION public.paquete_firmar_recepcion(
  p_paquete_id uuid,
  p_firma_path text,
  p_nombre     text
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.paquetes_recibidos;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.paquetes_recibidos p
    WHERE p.id = p_paquete_id
      AND p.estado = 'pendiente'
      -- Solo paquetería: la correspondencia se entrega en recepción, no se
      -- firma desde el portal (su acuse tiene otro flujo y otro permiso).
      AND p.clase = 'paquete'
      AND p.unidad_id IN (SELECT public.mis_unidades_ids())
  ) THEN
    RAISE EXCEPTION 'No autorizado o paquete no disponible';
  END IF;

  UPDATE public.paquetes_recibidos
     SET estado             = 'entregado',
         firma_path         = p_firma_path,
         entregado_a_nombre = COALESCE(NULLIF(btrim(p_nombre), ''), entregado_a_nombre),
         entregado_via      = 'portal',
         hora_entrega       = now()
   WHERE id = p_paquete_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) TO authenticated;

-- ── 8) Actividad del equipo: 'paquetes' sigue contando paquetes ─────────────
-- La métrica existía antes de la unificación y no contaba correspondencia.
-- Sin el filtro, el contador saltaría solo porque las filas cambiaron de tabla.
-- Cuerpo idéntico al de 20260731000300 salvo la línea marcada (misma práctica
-- que 20260822010000 con paquete_firmar_recepcion).
CREATE OR REPLACE FUNCTION public.actividad_equipo(
  p_project_id uuid,
  p_desde      date DEFAULT (now() - interval '30 days')::date,
  p_hasta      date DEFAULT now()::date
)
RETURNS TABLE (
  usuario_id            uuid,
  usuario_nombre        text,
  usuario_rol           text,
  lecturas              bigint,
  lecturas_m3           numeric,
  limpiezas             bigint,
  checklists            bigint,
  rondas_iniciadas      bigint,
  puntos_marcados       bigint,
  visitas_registradas   bigint,
  paquetes              bigint,
  solicitudes_creadas   bigint,
  tareas_cerradas       bigint,
  total                 bigint,
  ultima_actividad      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_desde   timestamptz := p_desde::timestamptz;
  -- p_hasta es inclusivo para el usuario: "al 31" incluye todo el día 31.
  v_hasta   timestamptz := (p_hasta + 1)::timestamptz;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  ) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH hechos AS (
    -- Lecturas de agua capturadas
    SELECT r.creado_por AS uid, 'lecturas'::text AS tipo,
           COALESCE(r.consumo, 0)::numeric AS m3, r.fecha AS cuando
      FROM public.registros r
     WHERE r.project_id = p_project_id
       AND r.deleted_at IS NULL
       AND r.creado_por IS NOT NULL
       AND r.fecha >= v_desde AND r.fecha < v_hasta

    -- Limpieza: ejecuciones del programa + tareas de bloque completadas
    UNION ALL
    SELECT pl.ejecutado_por, 'limpiezas', 0, pl.ultima_ejecucion::timestamptz
      FROM public.programacion_limpieza pl
     WHERE pl.project_id = p_project_id
       AND pl.ejecutado_por IS NOT NULL
       AND pl.ultima_ejecucion >= v_desde AND pl.ultima_ejecucion < v_hasta

    UNION ALL
    SELECT sh.creado_por, 'limpiezas', 0, sh.fecha::timestamptz
      FROM public.servicios_housekeeping sh
     WHERE sh.project_id = p_project_id
       AND sh.creado_por IS NOT NULL
       AND sh.fecha >= v_desde AND sh.fecha < v_hasta

    UNION ALL
    SELECT tb.completado_por, 'limpiezas', 0, tb.completado_en
      FROM public.tareas_bloque tb
      JOIN public.bloques_turno bt ON bt.id = tb.bloque_id
     WHERE bt.project_id = p_project_id
       AND tb.completado_por IS NOT NULL
       AND tb.completado_en >= v_desde AND tb.completado_en < v_hasta

    -- Checklists e inspecciones de área + bitácora de mantenimiento firmada
    UNION ALL
    SELECT ca.creado_por, 'checklists', 0, ca.fecha::timestamptz
      FROM public.checklist_areas ca
     WHERE ca.project_id = p_project_id
       AND ca.creado_por IS NOT NULL
       AND ca.fecha >= v_desde AND ca.fecha < v_hasta

    UNION ALL
    SELECT bm.creado_por, 'checklists', 0, bm.fecha::timestamptz
      FROM public.bitacora_manto bm
     WHERE bm.project_id = p_project_id
       AND bm.creado_por IS NOT NULL
       AND bm.fecha >= v_desde AND bm.fecha < v_hasta

    -- Rondas de seguridad abiertas y puntos de control marcados
    UNION ALL
    SELECT rs.creado_por, 'rondas_iniciadas', 0, rs.inicio
      FROM public.rondas_seguridad rs
     WHERE rs.project_id = p_project_id
       AND rs.creado_por IS NOT NULL
       AND rs.inicio >= v_desde AND rs.inicio < v_hasta

    UNION ALL
    SELECT vc.visitado_por, 'puntos_marcados', 0, vc.visitado_en
      FROM public.visitas_control vc
      JOIN public.rondas_seguridad rs2 ON rs2.id = vc.ronda_id
     WHERE rs2.project_id = p_project_id
       AND vc.visitado_por IS NOT NULL
       AND vc.visitado_en >= v_desde AND vc.visitado_en < v_hasta

    -- Visitas registradas en caseta
    UNION ALL
    SELECT v.registrado_por, 'visitas_registradas', 0, v.created_at
      FROM public.visitantes v
     WHERE v.project_id = p_project_id
       AND v.registrado_por IS NOT NULL
       AND v.created_at >= v_desde AND v.created_at < v_hasta

    -- Paquetes recibidos
    UNION ALL
    SELECT pr.creado_por, 'paquetes', 0, pr.created_at
      FROM public.paquetes_recibidos pr
     WHERE pr.project_id = p_project_id
       -- ÚNICO CAMBIO respecto de 20260731000300: la tabla ahora también
       -- guarda correspondencia. La métrica contaba paquetes y sigue contando
       -- paquetes; sin este filtro subiría sola el día de la unificación.
       AND pr.clase = 'paquete'
       AND pr.creado_por IS NOT NULL
       AND pr.created_at >= v_desde AND pr.created_at < v_hasta

    -- Solicitudes levantadas
    UNION ALL
    SELECT sr.creado_por, 'solicitudes_creadas', 0, sr.created_at
      FROM public.solicitudes_residente sr
     WHERE sr.project_id = p_project_id
       AND sr.creado_por IS NOT NULL
       AND sr.created_at >= v_desde AND sr.created_at < v_hasta

    UNION ALL
    SELECT sc.creado_por, 'solicitudes_creadas', 0, sc.created_at
      FROM public.solicitudes_concierge sc
     WHERE sc.project_id = p_project_id
       AND sc.creado_por IS NOT NULL
       AND sc.created_at >= v_desde AND sc.created_at < v_hasta

    -- Tareas cerradas
    UNION ALL
    SELECT tc.cerrado_por, 'tareas_cerradas', 0, tc.fecha_cierre::timestamptz
      FROM public.tareas_condominio tc
     WHERE tc.project_id = p_project_id
       AND tc.cerrado_por IS NOT NULL
       AND tc.fecha_cierre >= v_desde AND tc.fecha_cierre < v_hasta
  ),
  agregado AS (
    SELECT
      h.uid,
      count(*) FILTER (WHERE h.tipo = 'lecturas')            AS lecturas,
      COALESCE(sum(h.m3) FILTER (WHERE h.tipo = 'lecturas'), 0) AS lecturas_m3,
      count(*) FILTER (WHERE h.tipo = 'limpiezas')           AS limpiezas,
      count(*) FILTER (WHERE h.tipo = 'checklists')          AS checklists,
      count(*) FILTER (WHERE h.tipo = 'rondas_iniciadas')    AS rondas_iniciadas,
      count(*) FILTER (WHERE h.tipo = 'puntos_marcados')     AS puntos_marcados,
      count(*) FILTER (WHERE h.tipo = 'visitas_registradas') AS visitas_registradas,
      count(*) FILTER (WHERE h.tipo = 'paquetes')            AS paquetes,
      count(*) FILTER (WHERE h.tipo = 'solicitudes_creadas') AS solicitudes_creadas,
      count(*) FILTER (WHERE h.tipo = 'tareas_cerradas')     AS tareas_cerradas,
      count(*)                                               AS total,
      max(h.cuando)                                          AS ultimo_hecho
    FROM hechos h
    GROUP BY h.uid
  ),
  ultima_bitacora AS (
    SELECT b.usuario_id AS uid, max(b.created_at) AS ultima
      FROM public.bitacora_acciones b
     WHERE b.project_id = p_project_id
       AND b.usuario_id IS NOT NULL
       AND b.created_at >= v_desde AND b.created_at < v_hasta
     GROUP BY b.usuario_id
  )
  SELECT
    a.uid,
    COALESCE(NULLIF(au.full_name, ''), 'Usuario ' || left(a.uid::text, 8)),
    COALESCE(au.role, '—'),
    a.lecturas, a.lecturas_m3, a.limpiezas, a.checklists,
    a.rondas_iniciadas, a.puntos_marcados, a.visitas_registradas,
    a.paquetes, a.solicitudes_creadas, a.tareas_cerradas, a.total,
    GREATEST(a.ultimo_hecho, ub.ultima)
  FROM agregado a
  LEFT JOIN public.app_users au ON au.id = a.uid
  LEFT JOIN ultima_bitacora ub  ON ub.uid = a.uid
  ORDER BY a.total DESC, 2 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) TO authenticated;

-- ── 9) Bitácora: la correspondencia sigue siendo su propio módulo ───────────
-- El trigger recibe el módulo como argumento fijo, uno por tabla. Con dos
-- clases en la misma tabla eso ya no alcanza: sin esto, registrar una carta
-- aparecería en la bitácora bajo "Paquetes" y el módulo "Correspondencia"
-- desaparecería de la línea de tiempo.
--
-- Se añaden dos argumentos OPCIONALES a registrar_bitacora():
--   TG_ARGV[4]  columna discriminante de la fila (ej. 'clase')
--   TG_ARGV[5]  JSON valor→módulo (ej. '{"correspondencia":"Correspondencia"}')
-- Los ~40 triggers existentes pasan 4 argumentos; en plpgsql un índice fuera de
-- rango de TG_ARGV es NULL, así que siguen funcionando sin tocarlos.
-- Cuerpo idéntico al de 20260731000100 salvo el bloque marcado y las dos
-- variables nuevas del DECLARE.
CREATE OR REPLACE FUNCTION public.registrar_bitacora()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_modulo   text := TG_ARGV[0];
  v_cols     text[] := string_to_array(COALESCE(TG_ARGV[1], ''), ',');
  v_padre    text := NULLIF(TG_ARGV[2], '');
  v_col_fk   text := NULLIF(TG_ARGV[3], '');
  -- NUEVOS (opcionales): módulo por fila para tablas multi-clase.
  v_col_mod  text := NULLIF(TG_ARGV[4], '');
  v_map_mod  jsonb := CASE WHEN NULLIF(TG_ARGV[5], '') IS NULL
                           THEN NULL ELSE TG_ARGV[5]::jsonb END;
  v_uid      uuid := auth.uid();
  v_row      jsonb;
  v_before   jsonb;
  v_accion   text;
  v_estado   text;
  v_desc     text;
  v_col      text;
  v_company  uuid;
  v_project  uuid;
  v_nombre   text;
  v_usuario  uuid;
  v_detalles jsonb;
  v_fk       uuid;
  v_cambios  jsonb := '{}'::jsonb;
  v_k        text;
BEGIN
  -- Solo acciones de usuario (ver cabecera de 20260731000100).
  IF v_uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row    := to_jsonb(COALESCE(NEW, OLD));
  v_before := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;

  -- ── NUEVO: módulo por fila ───────────────────────────────────────────────
  -- Una tabla puede albergar más de una clase de registro (paquetes_recibidos
  -- guarda paquetería y correspondencia desde 20260829000000). Sin esto, el
  -- módulo fijo del trigger mandaría ambas al mismo cajón de la bitácora.
  IF v_col_mod IS NOT NULL AND v_map_mod IS NOT NULL
     AND v_map_mod ? COALESCE(v_row->>v_col_mod, '') THEN
    v_modulo := v_map_mod->>(v_row->>v_col_mod);
  END IF;

  -- ── acción ───────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    v_accion := 'crear';
  ELSIF TG_OP = 'DELETE' THEN
    v_accion := 'eliminar';
  ELSE
    -- Soft delete: el UPDATE que marca deleted_at es, para el usuario, un borrado.
    IF v_before ? 'deleted_at'
       AND v_before->>'deleted_at' IS NULL
       AND v_row->>'deleted_at' IS NOT NULL THEN
      v_accion := 'eliminar';
    ELSE
      v_estado := lower(COALESCE(v_row->>'estado', ''));
      IF v_row->>'estado' IS DISTINCT FROM v_before->>'estado' THEN
        v_accion := CASE
          WHEN v_estado IN ('pagado', 'pagada')                                    THEN 'pagar'
          WHEN v_estado IN ('aprobado', 'aprobada', 'autorizado', 'autorizada')    THEN 'aprobar'
          WHEN v_estado IN ('rechazado', 'rechazada', 'denegado', 'denegada')      THEN 'rechazar'
          WHEN v_estado IN ('cerrado', 'cerrada', 'completado', 'completada',
                            'finalizado', 'finalizada', 'resuelto', 'resuelta')    THEN 'cerrar'
          ELSE 'editar'
        END;
      ELSE
        v_accion := 'editar';
      END IF;
    END IF;
  END IF;

  -- ── scope (company_id es NOT NULL en la tabla: sin él no se registra) ────
  v_company := NULLIF(v_row->>'company_id', '')::uuid;
  v_project := NULLIF(v_row->>'project_id', '')::uuid;

  IF (v_company IS NULL OR v_project IS NULL) AND v_padre IS NOT NULL AND v_col_fk IS NOT NULL THEN
    v_fk := NULLIF(v_row->>v_col_fk, '')::uuid;
    IF v_fk IS NOT NULL THEN
      EXECUTE format(
        'SELECT company_id, project_id FROM public.%I WHERE id = $1', v_padre)
        INTO v_company, v_project USING v_fk;
    END IF;
  END IF;

  IF v_company IS NULL AND v_project IS NOT NULL THEN
    SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = v_project;
  END IF;

  IF v_company IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ── quién ────────────────────────────────────────────────────────────────
  SELECT au.id, au.full_name INTO v_usuario, v_nombre
    FROM public.app_users au WHERE au.id = v_uid;
  v_nombre := COALESCE(NULLIF(v_nombre, ''), 'Usuario ' || left(v_uid::text, 8));

  -- ── descripción legible del registro ─────────────────────────────────────
  FOREACH v_col IN ARRAY v_cols LOOP
    v_col := btrim(v_col);
    IF v_col <> '' AND v_row ? v_col AND NULLIF(v_row->>v_col, '') IS NOT NULL THEN
      v_desc := left(v_row->>v_col, 180);
      EXIT;
    END IF;
  END LOOP;

  -- ── detalles: solo las columnas que CAMBIARON ────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    FOR v_k IN SELECT jsonb_object_keys(v_row) LOOP
      IF v_row->v_k IS DISTINCT FROM v_before->v_k THEN
        v_cambios := v_cambios || jsonb_build_object(
          v_k, jsonb_build_object('antes', v_before->v_k, 'despues', v_row->v_k));
      END IF;
    END LOOP;
    v_detalles := CASE WHEN v_cambios = '{}'::jsonb THEN NULL ELSE v_cambios END;
  END IF;

  INSERT INTO public.bitacora_acciones (
    company_id, project_id, usuario_id, usuario_nombre,
    accion, modulo, entidad_id, entidad_desc, detalles
  ) VALUES (
    v_company, v_project, v_usuario, v_nombre,
    v_accion, v_modulo, NULLIF(v_row->>'id', '')::uuid, v_desc, v_detalles
  );

  RETURN COALESCE(NEW, OLD);

EXCEPTION WHEN OTHERS THEN
  -- Un fallo de bitácora JAMÁS puede tumbar la operación del usuario.
  RAISE WARNING 'registrar_bitacora(% / %) falló: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_bitacora() FROM PUBLIC, anon, authenticated;

-- Re-registro del trigger de paquetes_recibidos con los dos argumentos nuevos.
-- El nombre `trg_bitacora` es el que usa el catálogo de 20260731000100.
DROP TRIGGER IF EXISTS trg_bitacora ON public.paquetes_recibidos;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.paquetes_recibidos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora(
    'Paquetes', 'descripcion,remitente', '', '',
    'clase', '{"correspondencia":"Correspondencia"}');
