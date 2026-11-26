-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · TODO DOCUMENTO SIN PÓLIZA QUEDA A LA VISTA Y SE REPROCESA
--
-- QUÉ FALLABA
-- conta_generar_asiento() resuelve las cuentas ANTES de asentar. Si a un evento le
-- falta su cuenta (mapeo sin asignar, cuenta de otra contabilidad) o algo falla,
-- deja un WARNING en el log de PostgreSQL y devuelve NULL: «la contabilidad nunca
-- rompe la operación de negocio». Correcto para la operación, pero el documento
-- quedaba SIN póliza y SIN rastro:
--   · recibos de agua, cuotas sin clasificar, cobros por el camino general,
--     gastos sin factura, órdenes de pago, recepciones de compra, ajustes de
--     banco… no aparecían en «Pendientes» ni tenían cómo reprocesarse;
--   · sólo facturas de proveedor y cargos a unidades tenían bandeja
--     (conta_intentos_contabilizacion).
-- El hueco se descubría al cuadrar, semanas después, y había que rehacer el
-- asiento a mano.
--
-- QUÉ CAMBIA
--   1. Tabla conta_asientos_omitidos: UNA fila por (empresa, documento, evento)
--      que no se pudo asentar, con el motivo y con la LLAMADA COMPLETA al
--      generador (fecha, concepto, tipo, moneda, líneas). Reprocesar es repetir
--      esa llamada, así que sirve para cualquier documento sin lógica por tabla.
--   2. conta_generar_asiento() pasa a ser una ENVOLTURA del generador de
--      siempre, renombrado a conta_generar_asiento_nucleo() SIN tocar su cuerpo:
--        · asentó              → borra la omisión de esa clave, si la había;
--        · ledger sin catálogo → nada (esa contabilidad aún no opera);
--        · ya estaba asentado  → nada (idempotencia) y borra la omisión;
--        · factura de proveedor → nada (tiene su propia bandeja);
--        · cualquier otro NULL → registra la omisión con su motivo.
--      El registro va en su propio bloque con EXCEPTION: si falla, sólo deja un
--      WARNING. La envoltura NUNCA cambia el resultado ni rompe la operación.
--   3. conta_reversar_automatico() se envuelve igual: cuando el documento se
--      anula o se borra, su omisión desaparece (no hay nada que asentar). Así
--      una omisión viva es siempre de un documento vigente.
--   4. conta_omitidos_pendientes(proyecto): la bandeja, por contabilidad. No
--      repite lo que ya está en la bandeja de cargos (documentos con intentos).
--   5. conta_omitido_reprocesar(id): repite la llamada guardada. Exige crear Y
--      cambiar estado, como los otros reprocesos.
--
-- LÍMITE DECLARADO: la omisión guarda las líneas del momento del evento. Si el
-- documento cambió de importe después sin generar otro evento, el reproceso
-- asienta el importe original; se corrige con el flujo normal del documento.
--
-- SI UNA MIGRACIÓN POSTERIOR hace CREATE OR REPLACE de conta_generar_asiento con
-- el cuerpo completo, pisa la envoltura: la generación sigue funcionando pero el
-- registro de omisiones se pierde. supabase/tests/conta_asientos_omitidos corre
-- sobre TODA la cadena (también las posteriores) para que eso falle en CI.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_omitido_reprocesar(uuid);
--   DROP FUNCTION public.conta_omitidos_pendientes(uuid);
--   DROP FUNCTION public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb);
--   ALTER FUNCTION public.conta_generar_asiento_nucleo(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)
--     RENAME TO conta_generar_asiento;
--   DROP FUNCTION public.conta_reversar_automatico(uuid,text,uuid,text,text);
--   ALTER FUNCTION public.conta_reversar_automatico_nucleo(uuid,text,uuid,text,text)
--     RENAME TO conta_reversar_automatico;
--   DROP TABLE public.conta_asientos_omitidos;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La tabla ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conta_asientos_omitidos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  origen_tabla    text NOT NULL,
  origen_id       uuid NOT NULL,
  evento          text NOT NULL,
  -- La llamada al generador, tal cual (para repetirla al reprocesar).
  fecha           date,
  concepto        text NOT NULL,
  tipo            text NOT NULL,
  moneda_doc      text,
  lineas          jsonb NOT NULL,
  importe         numeric(14,2) NOT NULL DEFAULT 0,
  -- Por qué no se asentó.
  codigo          text NOT NULL,
  motivo          text NOT NULL,
  eventos_faltan  text[] NOT NULL DEFAULT '{}',
  intentos        integer NOT NULL DEFAULT 1,
  primer_intento  timestamptz NOT NULL DEFAULT now(),
  ultimo_intento  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_omitidos_codigo_valido CHECK (codigo IN ('sin_mapeo', 'cuenta_invalida', 'error')),
  CONSTRAINT conta_omitidos_clave UNIQUE (company_id, origen_tabla, origen_id, evento)
);
CREATE INDEX IF NOT EXISTS idx_conta_omitidos_ledger
  ON public.conta_asientos_omitidos (company_id, project_id, ultimo_intento DESC);
CREATE INDEX IF NOT EXISTS idx_conta_omitidos_project
  ON public.conta_asientos_omitidos (project_id) WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.conta_asientos_omitidos IS
  'Documentos vigentes cuyo asiento automático no se pudo generar (falta de configuración o error), con la llamada completa a conta_generar_asiento para reprocesarla. La escribe sólo la envoltura del generador.';

ALTER TABLE public.conta_asientos_omitidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conta_asientos_omitidos_select" ON public.conta_asientos_omitidos;
CREATE POLICY "conta_asientos_omitidos_select" ON public.conta_asientos_omitidos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.conta_puede_leer())
        AND (project_id IS NULL OR public.can_access_project(project_id)))
  );
DROP POLICY IF EXISTS mfa_gate_aal2 ON public.conta_asientos_omitidos;
CREATE POLICY mfa_gate_aal2 ON public.conta_asientos_omitidos
  AS RESTRICTIVE TO authenticated
  USING (public.mfa_requirement_met())
  WITH CHECK (public.mfa_requirement_met());

-- Sólo lectura para la API: escribe el generador (SECURITY DEFINER).
REVOKE ALL ON public.conta_asientos_omitidos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_asientos_omitidos TO authenticated;
GRANT SELECT ON public.conta_asientos_omitidos TO service_role;

-- ── 2. El generador de siempre pasa a ser el NÚCLEO (mismo cuerpo, misma ACL) ──
DO $$
BEGIN
  IF to_regprocedure('public.conta_generar_asiento_nucleo(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)
      RENAME TO conta_generar_asiento_nucleo;
  END IF;
  IF to_regprocedure('public.conta_reversar_automatico_nucleo(uuid,text,uuid,text,text)') IS NULL THEN
    ALTER FUNCTION public.conta_reversar_automatico(uuid,text,uuid,text,text)
      RENAME TO conta_reversar_automatico_nucleo;
  END IF;
END $$;

-- ── 3. La envoltura del generador ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_generar_asiento(
  p_company_id uuid, p_project_id uuid, p_origen_tabla text, p_origen_id uuid, p_evento text,
  p_fecha date, p_concepto text, p_tipo text, p_moneda_doc text, p_lineas jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_asiento  uuid;
  v_faltan   text[];
  v_invalida int;
  v_codigo   text;
  v_motivo   text;
BEGIN
  v_asiento := public.conta_generar_asiento_nucleo(
    p_company_id, p_project_id, p_origen_tabla, p_origen_id, p_evento,
    p_fecha, p_concepto, p_tipo, p_moneda_doc, p_lineas);

  -- El rastro va aparte: pase lo que pase aquí, el resultado del generador no cambia.
  BEGIN
    IF v_asiento IS NOT NULL THEN
      DELETE FROM public.conta_asientos_omitidos
       WHERE company_id = p_company_id AND origen_tabla = p_origen_tabla
         AND origen_id = p_origen_id AND evento = p_evento;
      RETURN v_asiento;
    END IF;

    IF p_company_id IS NULL OR p_origen_tabla IS NULL OR p_origen_id IS NULL OR p_evento IS NULL THEN
      RETURN NULL;
    END IF;
    -- Contabilidad sin catálogo: aún no opera; no se acumula nada.
    IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas
                    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id) THEN
      RETURN NULL;
    END IF;
    -- Ya asentado (idempotencia): no es una omisión.
    IF EXISTS (SELECT 1 FROM public.conta_asientos
                WHERE company_id = p_company_id AND origen = 'automatico' AND estado <> 'anulado'
                  AND origen_tabla = p_origen_tabla AND origen_id = p_origen_id AND origen_evento = p_evento) THEN
      DELETE FROM public.conta_asientos_omitidos
       WHERE company_id = p_company_id AND origen_tabla = p_origen_tabla
         AND origen_id = p_origen_id AND evento = p_evento;
      RETURN NULL;
    END IF;
    -- Las facturas de proveedor llevan su propia bandeja e intentos.
    IF p_origen_tabla = 'facturas_proveedor' THEN
      RETURN NULL;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT l ->> 'evento' ORDER BY l ->> 'evento'), '{}') INTO v_faltan
      FROM jsonb_array_elements(p_lineas) l
     WHERE NOT (l ? 'cuenta_id')
       AND public.conta_cuenta_para(p_company_id, p_project_id, l ->> 'evento') IS NULL;
    SELECT count(*) INTO v_invalida
      FROM jsonb_array_elements(p_lineas) l
     WHERE l ? 'cuenta_id'
       AND NOT EXISTS (SELECT 1 FROM public.conta_cuentas c
                        WHERE c.id = (l ->> 'cuenta_id')::uuid AND c.company_id = p_company_id
                          AND c.project_id IS NOT DISTINCT FROM p_project_id AND c.es_detalle);

    IF cardinality(v_faltan) > 0 THEN
      v_codigo := 'sin_mapeo';
      v_motivo := 'Falta asignar cuenta a ' || cardinality(v_faltan) || ' evento(s) en Contabilidad › Configuración.';
    ELSIF v_invalida > 0 THEN
      v_codigo := 'cuenta_invalida';
      v_motivo := 'El documento apunta a ' || v_invalida || ' cuenta(s) que no son de detalle o no pertenecen a esta contabilidad.';
    ELSE
      v_codigo := 'error';
      v_motivo := 'El asiento no se pudo generar. Revisa el catálogo y la configuración y reprocesa.';
    END IF;

    INSERT INTO public.conta_asientos_omitidos AS o (
      company_id, project_id, origen_tabla, origen_id, evento, fecha, concepto, tipo, moneda_doc, lineas,
      importe, codigo, motivo, eventos_faltan
    ) VALUES (
      p_company_id, p_project_id, p_origen_tabla, p_origen_id, p_evento, p_fecha,
      COALESCE(p_concepto, ''), COALESCE(p_tipo, 'diario'), p_moneda_doc, p_lineas,
      COALESCE((SELECT round(sum(COALESCE((l ->> 'debe')::numeric, 0)), 2) FROM jsonb_array_elements(p_lineas) l), 0),
      v_codigo, v_motivo, v_faltan
    )
    ON CONFLICT (company_id, origen_tabla, origen_id, evento) DO UPDATE
      SET project_id = EXCLUDED.project_id, fecha = EXCLUDED.fecha, concepto = EXCLUDED.concepto,
          tipo = EXCLUDED.tipo, moneda_doc = EXCLUDED.moneda_doc, lineas = EXCLUDED.lineas,
          importe = EXCLUDED.importe, codigo = EXCLUDED.codigo, motivo = EXCLUDED.motivo,
          eventos_faltan = EXCLUDED.eventos_faltan,
          intentos = o.intentos + 1, ultimo_intento = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_generar_asiento: no se pudo registrar la omisión de %/%/%: %',
      p_origen_tabla, p_origen_id, p_evento, SQLERRM;
  END;
  RETURN v_asiento;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_generar_asiento(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.conta_generar_asiento_nucleo(uuid,uuid,text,uuid,text,date,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── 4. La envoltura del reverso: documento anulado → su omisión ya no aplica ──
CREATE OR REPLACE FUNCTION public.conta_reversar_automatico(
  p_company_id uuid, p_origen_tabla text, p_origen_id uuid, p_evento_original text, p_concepto text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reverso uuid;
BEGIN
  v_reverso := public.conta_reversar_automatico_nucleo(
    p_company_id, p_origen_tabla, p_origen_id, p_evento_original, p_concepto);
  BEGIN
    DELETE FROM public.conta_asientos_omitidos
     WHERE company_id = p_company_id AND origen_tabla = p_origen_tabla
       AND origen_id = p_origen_id AND evento = p_evento_original;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_reversar_automatico: no se pudo retirar la omisión de %/%/%: %',
      p_origen_tabla, p_origen_id, p_evento_original, SQLERRM;
  END;
  RETURN v_reverso;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_reversar_automatico(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_reversar_automatico(uuid,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.conta_reversar_automatico_nucleo(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;

-- ── 5. La bandeja ───────────────────────────────────────────────────────────
-- SECURITY INVOKER: decide la RLS de la tabla. Ledger EXACTO (NULL = empresa).
CREATE OR REPLACE FUNCTION public.conta_omitidos_pendientes(p_project_id uuid)
RETURNS TABLE (
  id uuid, origen_tabla text, origen_id uuid, evento text, fecha date, concepto text,
  importe numeric, moneda_doc text, codigo text, motivo text, eventos_faltan text[],
  intentos integer, primer_intento timestamptz, ultimo_intento timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT o.id, o.origen_tabla, o.origen_id, o.evento, o.fecha, o.concepto,
         o.importe, o.moneda_doc, o.codigo, o.motivo, o.eventos_faltan,
         o.intentos, o.primer_intento, o.ultimo_intento
    FROM public.conta_asientos_omitidos o
   WHERE o.company_id = public.get_my_company_id()
     AND o.project_id IS NOT DISTINCT FROM p_project_id
     -- Lo que ya vive en la bandeja de cargos (con sus intentos) no se repite aquí.
     AND NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = o.origen_tabla AND i.origen_id = o.origen_id)
   ORDER BY o.fecha NULLS LAST, o.primer_intento
   LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.conta_omitidos_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_omitidos_pendientes(uuid) TO authenticated;

-- ── 6. Reprocesar: repetir la llamada guardada ──────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_omitido_reprocesar(p_id uuid)
RETURNS TABLE (resultado text, codigo text, motivo text, asiento_id uuid, asiento_numero bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_o       public.conta_asientos_omitidos;
  v_asiento uuid;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR public.sesion_api_sin_empresa() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF NOT public.mfa_requirement_met() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Genera y publica un asiento: exige crear Y cambiar estado, como los otros reprocesos.
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para contabilizar documentos.' USING ERRCODE = '42501';
  END IF;

  -- Otra empresa, un proyecto sin alcance o un id inexistente responden igual.
  SELECT * INTO v_o FROM public.conta_asientos_omitidos
   WHERE id = p_id AND company_id = v_company
     AND (project_id IS NULL OR public.can_access_project(project_id))
     FOR UPDATE;
  IF NOT FOUND THEN
    -- Pudo resolverse sola (el documento se asentó o se anuló) entre la lista y el clic.
    resultado := 'ya_resuelto'; codigo := NULL; motivo := 'El documento ya no está pendiente.';
    asiento_id := NULL; asiento_numero := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_asiento := public.conta_generar_asiento(
    v_o.company_id, v_o.project_id, v_o.origen_tabla, v_o.origen_id, v_o.evento,
    v_o.fecha, v_o.concepto, v_o.tipo, v_o.moneda_doc, v_o.lineas);

  IF v_asiento IS NOT NULL THEN
    resultado := 'contabilizado'; codigo := NULL; motivo := NULL; asiento_id := v_asiento;
    SELECT a.numero INTO asiento_numero FROM public.conta_asientos a WHERE a.id = v_asiento;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_o FROM public.conta_asientos_omitidos WHERE id = p_id;
  IF NOT FOUND THEN
    resultado := 'ya_resuelto'; codigo := NULL; motivo := 'El documento ya estaba contabilizado.';
  ELSE
    resultado := 'pendiente'; codigo := v_o.codigo; motivo := v_o.motivo;
  END IF;
  asiento_id := NULL; asiento_numero := NULL;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.conta_omitido_reprocesar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_omitido_reprocesar(uuid) TO authenticated;
