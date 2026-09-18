-- ════════════════════════════════════════════════════════════════════════════
-- conta_cuentas_especiales_estado · no filtrar metadatos de otra empresa
--
-- POR QUÉ
-- La versión de 20260918121413 clasificaba bien —una cuenta de otra
-- contabilidad salía como 'otro_ledger'— pero proyectaba `c.codigo` y
-- `c.nombre` SIN condición, y su `cuenta_id` sólo comprobaba el project_id:
--
--     CASE WHEN c.id IS NOT NULL AND c.es_detalle AND c.activa
--               AND c.project_id IS NOT DISTINCT FROM p_project_id
--          THEN c.id END,
--     c.codigo,
--     c.nombre,
--
-- Para un mapeo HEREDADO cross-company —una fila de `conta_mapeo_cuentas` de
-- MI empresa cuyo `cuenta_id` apunta al catálogo de OTRA— eso devolvía el
-- código y el nombre de la cuenta ajena. Y si esa cuenta ajena resultaba tener
-- el mismo project_id (dos empresas con proyectos distintos comparten el NULL
-- del ledger de empresa, así que basta con que el mapeo sea del ledger de
-- empresa), el `cuenta_id` de la otra empresa también salía.
--
-- El trigger `conta_tg_mapeo_mismo_ledger` impide ESCRIBIR una fila así, pero
-- no puede impedir que exista: las filas anteriores a ese trigger no se
-- revalidan, y esta función es SECURITY DEFINER —corre con los privilegios del
-- dueño, sin RLS—, así que es precisamente donde un dato heredado se convierte
-- en una fuga. Clasificar no es suficiente: hay que NO proyectar.
--
-- QUÉ CAMBIA
--   · `cuenta_id` exige ahora las CUATRO condiciones: misma empresa, mismo
--     project_id, de detalle y activa. Antes faltaba la empresa.
--   · `codigo` y `nombre` se devuelven sólo si la cuenta es de MI empresa. Con
--     otra empresa de por medio van NULL: la UI ya tiene el motivo en `estado`
--     y no necesita —ni debe— el código ajeno para pintarlo.
--   · `estado` NO cambia: una cuenta de otra empresa o de otro proyecto sigue
--     siendo 'otro_ledger'. Es el diagnóstico correcto y hay que conservarlo.
--
-- Mismo alcance de empresa/proyecto, misma RLS, mismo search_path explícito y
-- los mismos REVOKE/GRANT. Append-only: no se edita 20260918121413.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_cuentas_especiales_estado(p_project_id uuid)
RETURNS TABLE (
  evento      text,
  etiqueta    text,
  proceso     text,
  bloqueante  boolean,
  cuenta_id   uuid,
  codigo      text,
  nombre      text,
  estado      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
BEGIN
  -- Anclada al tenant de quien pregunta: el ledger es (empresa, proyecto) y la
  -- empresa NO se acepta por parámetro. Así esta RPC no puede usarse para
  -- inspeccionar la contabilidad de otra empresa.
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.evento,
    e.etiqueta,
    e.proceso,
    e.bloqueante,
    -- El id sólo sale cuando la cuenta es USABLE, y "usable" incluye ser de MI
    -- empresa: sin esa condición, un mapeo heredado cross-company entregaba el
    -- id de una cuenta ajena y la UI lo habría tratado como resuelto.
    CASE WHEN c.id IS NOT NULL
              AND c.company_id = v_company
              AND c.project_id IS NOT DISTINCT FROM p_project_id
              AND c.es_detalle AND c.activa
         THEN c.id END,
    -- Metadatos SÓLO de mi empresa. Con una cuenta ajena de por medio, el
    -- código y el nombre son datos de otro tenant: no se proyectan. `estado`
    -- ya dice lo que la UI necesita saber.
    CASE WHEN c.company_id = v_company THEN c.codigo END,
    CASE WHEN c.company_id = v_company THEN c.nombre END,
    CASE
      WHEN m.cuenta_id IS NULL                                     THEN 'sin_mapeo'
      WHEN c.id IS NULL                                            THEN 'sin_mapeo'
      WHEN c.company_id <> v_company
        OR c.project_id IS DISTINCT FROM p_project_id              THEN 'otro_ledger'
      WHEN NOT c.activa                                            THEN 'inactiva'
      WHEN NOT c.es_detalle                                        THEN 'agrupadora'
      ELSE 'ok'
    END
  FROM public.conta_eventos_especiales() e
  LEFT JOIN public.conta_mapeo_cuentas m
    ON m.company_id = v_company
   AND m.project_id IS NOT DISTINCT FROM p_project_id
   AND m.evento = e.evento
  LEFT JOIN public.conta_cuentas c ON c.id = m.cuenta_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuentas_especiales_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cuentas_especiales_estado(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cuentas_especiales_estado(uuid) IS
  'Estado de las cuentas especiales del ledger activo (empresa con NULL, o el proyecto): ok / sin_mapeo / inactiva / agrupadora / otro_ledger. Anclada a get_my_company_id(); de una cuenta de otra empresa NO proyecta id, código ni nombre.';
