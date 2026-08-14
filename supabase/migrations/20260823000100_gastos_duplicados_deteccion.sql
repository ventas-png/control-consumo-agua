-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7 · parte B: DETECCIÓN DE DUPLICADOS ENTRE GASTOS Y FACTURAS
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 7). Depende de la parte A.
--
-- POR QUÉ EXISTE
-- La parte A impide que un gasto ENLAZADO se contabilice dos veces, pero nadie
-- enlaza lo que no sabe que está duplicado. Los duplicados que ya están en los
-- libros —y los que se capturen mañana— hay que encontrarlos.
--
-- QUÉ HACE
--   1. `conta_gastos_duplicados()`: cruza gastos contra facturas del mismo
--      ledger y devuelve los pares sospechosos CON SUS RAZONES, no con un
--      número opaco. Que el reporte diga «mismo comprobante, mismo monto, 2
--      días de diferencia» es lo que permite decidir en dos segundos.
--   2. `conta_gasto_duplicado_probable()`: la misma lógica acotada a un gasto
--      que se está capturando, para avisar ANTES de crearlo.
--   3. `conta_duplicados_descartados`: memoria de lo ya revisado.
--
-- POR QUÉ HACE FALTA RECORDAR LOS DESCARTES
-- Dos pagos iguales al mismo proveedor el mismo día ocurren de verdad
-- (dos facturas de combustible, dos anticipos). Sin memoria, ese par legítimo
-- reaparece en el reporte todos los meses, el contador aprende a ignorarlo, y
-- el día que aparezca un duplicado real también lo va a ignorar. Un reporte de
-- excepciones que no se puede vaciar deja de ser un reporte.
--
-- LO QUE NO HACE: nada automático. No anula, no enlaza, no corrige. Solo
-- muestra. Qué es duplicado y qué no lo decide una persona.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_gastos_duplicados(uuid, uuid, date, date, int);
--   DROP FUNCTION public.conta_gasto_duplicado_probable(uuid, uuid, uuid, numeric, date, text, uuid);
--   DROP FUNCTION public.conta_normalizar_nombre(text);
--   DROP TABLE public.conta_duplicados_descartados;
--
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno. Solo lectura y una tabla nueva vacía.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Normalización de nombres para el histórico ───────────────────────────
-- `proveedor_id` está poblado desde la parte A, pero el cruce por NOMBRE sigue
-- haciendo falta: dos filas pueden apuntar a proveedores distintos del catálogo
-- que en realidad son el mismo («Ferretería El Tornillo» vs «FERRETERIA EL
-- TORNILLO» quedaron como dos altas separadas antes de que existiera el
-- selector). Se usa `translate` en vez de la extensión `unaccent` para no
-- depender de que esté instalada en el proyecto.
CREATE OR REPLACE FUNCTION public.conta_normalizar_nombre(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(
    regexp_replace(
      translate(lower(btrim(coalesce(p_nombre, ''))),
                'áàäâãéèëêíìïîóòöôõúùüûñç',
                'aaaaaeeeeiiiiooooouuuunc'),
      '[^a-z0-9]+', '', 'g'),
    '')
$$;

COMMENT ON FUNCTION public.conta_normalizar_nombre(text) IS
  'Nombre en minúsculas, sin acentos ni signos, para comparar proveedores capturados como texto libre. NULL si queda vacío.';

REVOKE EXECUTE ON FUNCTION public.conta_normalizar_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_normalizar_nombre(text) TO authenticated;

-- ── 2. Memoria de lo revisado ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_duplicados_descartados (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  gasto_id     uuid        NOT NULL REFERENCES public.gastos_condominio(id) ON DELETE CASCADE,
  factura_id   uuid        NOT NULL REFERENCES public.facturas_proveedor(id) ON DELETE CASCADE,
  motivo       text        NOT NULL,
  revisado_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_duplicado_descartado_unico UNIQUE (gasto_id, factura_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicados_descartados_company
  ON public.conta_duplicados_descartados(company_id);

COMMENT ON TABLE public.conta_duplicados_descartados IS
  'Pares (gasto, factura) que alguien revisó y declaró NO duplicados. Sin esta memoria el mismo par legítimo reaparece cada mes y el reporte se vuelve ruido.';

ALTER TABLE public.conta_duplicados_descartados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conta_duplicados_descartados_select" ON public.conta_duplicados_descartados;
CREATE POLICY "conta_duplicados_descartados_select" ON public.conta_duplicados_descartados
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

DROP POLICY IF EXISTS "conta_duplicados_descartados_insert" ON public.conta_duplicados_descartados;
CREATE POLICY "conta_duplicados_descartados_insert" ON public.conta_duplicados_descartados
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));

DROP POLICY IF EXISTS "conta_duplicados_descartados_update" ON public.conta_duplicados_descartados;
CREATE POLICY "conta_duplicados_descartados_update" ON public.conta_duplicados_descartados
  FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));

DROP POLICY IF EXISTS "conta_duplicados_descartados_delete" ON public.conta_duplicados_descartados;
CREATE POLICY "conta_duplicados_descartados_delete" ON public.conta_duplicados_descartados
  FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('delete')));

-- ── 3. El reporte ───────────────────────────────────────────────────────────
-- Devuelve las RAZONES, no solo un puntaje. El puntaje sirve para ordenar; las
-- razones son las que se leen.
--
-- Para ser candidato hacen falta las tres cosas:
--   · mismo ledger (empresa + proyecto)
--   · monto dentro de la tolerancia de compras_config
--   · fecha dentro de la ventana
--   · y ADEMÁS mismo comprobante o mismo proveedor — sin al menos uno de esos
--     dos, «mismo monto en la misma semana» describe media contabilidad.
CREATE OR REPLACE FUNCTION public.conta_gastos_duplicados(
  p_company_id uuid,
  p_project_id uuid,
  p_desde      date DEFAULT NULL,
  p_hasta      date DEFAULT NULL,
  p_dias       int  DEFAULT 15
)
RETURNS TABLE (
  gasto_id          uuid,
  gasto_concepto    text,
  gasto_fecha       date,
  gasto_monto       numeric,
  gasto_estado      text,
  gasto_contabilizado boolean,
  factura_id        uuid,
  factura_numero    text,
  factura_fecha     date,
  factura_monto     numeric,
  proveedor         text,
  mismo_comprobante boolean,
  mismo_proveedor   boolean,
  diferencia_monto  numeric,
  dias_diferencia   int,
  puntaje           int,
  razones           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tol AS (
    SELECT public.compras_tolerancia(p_company_id, 'precio') AS pct
  ), pares AS (
    SELECT
      g.id AS g_id, g.concepto AS g_concepto, g.fecha AS g_fecha, g.monto AS g_monto,
      g.estado AS g_estado,
      f.id AS f_id, f.numero_factura AS f_numero, f.fecha_emision AS f_fecha,
      f.monto_total AS f_monto,
      COALESCE(p.nombre, g.proveedor_nombre) AS prov,
      (   public.conta_normalizar_nombre(g.comprobante_num) IS NOT NULL
      AND public.conta_normalizar_nombre(g.comprobante_num)
          = public.conta_normalizar_nombre(f.numero_factura)) AS m_comprobante,
      (   (g.proveedor_id IS NOT NULL AND g.proveedor_id = f.proveedor_id)
       OR (public.conta_normalizar_nombre(g.proveedor_nombre) IS NOT NULL
           AND public.conta_normalizar_nombre(g.proveedor_nombre)
               = public.conta_normalizar_nombre(p.nombre))) AS m_proveedor,
      round(abs(g.monto - f.monto_total), 2) AS dif_monto,
      abs(g.fecha - f.fecha_emision) AS dias
    FROM public.gastos_condominio g
    JOIN public.facturas_proveedor f
      ON f.company_id = g.company_id
     AND f.project_id IS NOT DISTINCT FROM g.project_id
    LEFT JOIN public.proveedores p ON p.id = f.proveedor_id
    CROSS JOIN tol
    WHERE g.company_id = p_company_id
      AND g.project_id IS NOT DISTINCT FROM p_project_id
      -- Guard de tenant: el id que manda el cliente solo vale si es SU empresa.
      -- Se FILTRA (sin filas) en vez de reventar, como el resto de RPCs de
      -- reporte del módulo.
      AND (public.is_super_admin() OR g.company_id = public.get_my_company_id())
      -- Ya resueltos: enlazados, anulados de ambos lados, y los descartados.
      AND g.factura_id IS NULL
      AND g.estado <> 'anulado'
      AND f.estado <> 'anulada'
      AND (p_desde IS NULL OR g.fecha >= p_desde)
      AND (p_hasta IS NULL OR g.fecha <= p_hasta)
      AND abs(g.fecha - f.fecha_emision) <= p_dias
      AND abs(g.monto - f.monto_total) <= GREATEST(1.00, f.monto_total * tol.pct / 100)
      AND NOT EXISTS (
        SELECT 1 FROM public.conta_duplicados_descartados d
        WHERE d.gasto_id = g.id AND d.factura_id = f.id
      )
  )
  SELECT
    g_id, g_concepto, g_fecha, g_monto, g_estado,
    public.gasto_tiene_asiento(g_id),
    f_id, f_numero, f_fecha, f_monto, prov,
    m_comprobante, m_proveedor, dif_monto, dias,
    (CASE WHEN m_comprobante THEN 50 ELSE 0 END
     + CASE WHEN m_proveedor THEN 25 ELSE 0 END
     + CASE WHEN dif_monto = 0 THEN 20 ELSE 10 END
     + GREATEST(0, 5 - dias))::int AS puntaje,
    concat_ws(' · ',
      CASE WHEN m_comprobante THEN 'mismo comprobante' END,
      CASE WHEN m_proveedor   THEN 'mismo proveedor' END,
      CASE WHEN dif_monto = 0 THEN 'mismo monto' ELSE 'monto casi igual' END,
      CASE WHEN dias = 0 THEN 'misma fecha' ELSE dias || ' día(s) de diferencia' END
    ) AS razones
  FROM pares
  WHERE m_comprobante OR m_proveedor
  ORDER BY 16 DESC, 3 DESC
$$;

COMMENT ON FUNCTION public.conta_gastos_duplicados(uuid, uuid, date, date, int) IS
  'Pares (gasto, factura) del mismo ledger que probablemente sean el mismo desembolso, con las razones de la sospecha. No corrige nada: la decisión es de una persona.';

GRANT EXECUTE ON FUNCTION public.conta_gastos_duplicados(uuid, uuid, date, date, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_gastos_duplicados(uuid, uuid, date, date, int) FROM PUBLIC, anon;

-- ── 4. El aviso al capturar ─────────────────────────────────────────────────
-- Misma regla, aplicada a un gasto que todavía no existe. Se le pasan los datos
-- del formulario; devuelve las facturas que calzan, para poder ofrecer el
-- enlace antes de crear el duplicado.
CREATE OR REPLACE FUNCTION public.conta_gasto_duplicado_probable(
  p_company_id   uuid,
  p_project_id   uuid,
  p_proveedor_id uuid,
  p_monto        numeric,
  p_fecha        date,
  p_comprobante  text DEFAULT NULL,
  p_dias         int  DEFAULT 15
)
RETURNS TABLE (
  factura_id     uuid,
  factura_numero text,
  factura_fecha  date,
  factura_monto  numeric,
  saldo          numeric,
  proveedor      text,
  razones        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    f.id, f.numero_factura, f.fecha_emision, f.monto_total,
    round(f.monto_total - f.monto_pagado, 2),
    p.nombre,
    concat_ws(' · ',
      CASE WHEN public.conta_normalizar_nombre(p_comprobante) IS NOT NULL
            AND public.conta_normalizar_nombre(p_comprobante)
                = public.conta_normalizar_nombre(f.numero_factura)
           THEN 'mismo comprobante' END,
      CASE WHEN abs(p_monto - f.monto_total) = 0 THEN 'mismo monto' ELSE 'monto casi igual' END,
      CASE WHEN abs(p_fecha - f.fecha_emision) = 0 THEN 'misma fecha'
           ELSE abs(p_fecha - f.fecha_emision) || ' día(s) de diferencia' END
    )
  FROM public.facturas_proveedor f
  JOIN public.proveedores p ON p.id = f.proveedor_id
  WHERE f.company_id = p_company_id
    AND f.project_id IS NOT DISTINCT FROM p_project_id
    AND (public.is_super_admin() OR f.company_id = public.get_my_company_id())
    AND f.proveedor_id = p_proveedor_id
    AND f.estado <> 'anulada'
    AND abs(p_fecha - f.fecha_emision) <= p_dias
    AND abs(p_monto - f.monto_total)
        <= GREATEST(1.00, f.monto_total * public.compras_tolerancia(p_company_id, 'precio') / 100)
  ORDER BY abs(p_fecha - f.fecha_emision), abs(p_monto - f.monto_total)
  LIMIT 5
$$;

COMMENT ON FUNCTION public.conta_gasto_duplicado_probable(uuid, uuid, uuid, numeric, date, text, int) IS
  'Facturas del mismo proveedor y ledger que calzan con el gasto que se está capturando. Alimenta el aviso «esto ya está como factura X»; no bloquea.';

GRANT EXECUTE ON FUNCTION public.conta_gasto_duplicado_probable(uuid, uuid, uuid, numeric, date, text, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_gasto_duplicado_probable(uuid, uuid, uuid, numeric, date, text, int) FROM PUBLIC, anon;
