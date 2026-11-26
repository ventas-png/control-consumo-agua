-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · PÓLIZA MANUAL: GUARDAR (Y PUBLICAR) EN UNA SOLA TRANSACCIÓN,
-- Y EDITAR UN BORRADOR
--
-- QUÉ FALLABA
-- La pantalla armaba una póliza manual con TRES peticiones sueltas: INSERT de la
-- cabecera, INSERT de las líneas y, si se pidió, conta_publicar_asiento().
--   · «Guardar y publicar» con la publicación rechazada (mes o ejercicio cerrado,
--     cuenta inválida, tasa sin motivo, sin «Cambiar estado») dejaba el borrador
--     guardado; el formulario seguía abierto y cada reintento creaba OTRO.
--   · Si fallaba el INSERT de las líneas quedaba una cabecera sin líneas.
--   · Lo mismo en «Saldos iniciales»: un rechazo al publicar dejaba un borrador
--     de apertura huérfano.
--   · Un borrador no se podía corregir (no había UPDATE): uno guardado con tasa
--     distinta de la mensual y sin motivo era impublicable; sólo quedaba anularlo
--     y recapturarlo.
--
-- QUÉ CAMBIA
-- public.conta_poliza_manual_guardar(...) hace cabecera + líneas (+ publicación)
-- en UNA transacción: si cualquier paso falla no queda nada. Con p_asiento_id
-- REEMPLAZA un borrador manual existente (cabecera y líneas) en vez de crear otro.
--
-- AUTORIZACIÓN (la función es SECURITY DEFINER: valida explícito, y es la MISMA
-- que ya exigían la RLS y las RPC; no abre nada):
--   · empresa = get_my_company_id() (assert_company_scope) y MFA cumplido, como
--     la política restrictiva mfa_gate_aal2 de las tablas;
--   · el proyecto, si lo hay, es de la empresa y la persona lo alcanza
--     (can_access_project), como la política de lectura de conta_asientos;
--   · crear   → platform.contabilidad.create  (RLS de INSERT);
--   · editar  → platform.contabilidad.edit    (RLS de UPDATE). Reemplazar las
--     líneas de un borrador es editar el borrador: no pide «Eliminar»;
--   · publicar → la decide conta_publicar_asiento() (change_status), sin tocar.
-- Sólo pólizas MANUALES en borrador, de tipo diario / ingreso / egreso / apertura.
-- Los disparadores de siempre (mismo ledger, dimensiones, inmutabilidad, tipo de
-- cambio al publicar) siguen decidiendo: aquí no se apaga ninguno.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_poliza_manual_guardar(uuid, uuid, date, text, text, text, jsonb, boolean);
-- (la pantalla anterior, de tres peticiones, sigue funcionando contra las tablas).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_poliza_manual_guardar(
  p_asiento_id         uuid,
  p_project_id         uuid,
  p_fecha              date,
  p_tipo               text,
  p_concepto           text,
  p_tipo_cambio_motivo text,
  p_lineas             jsonb,
  p_publicar           boolean DEFAULT false
) RETURNS public.conta_asientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company  uuid := public.get_my_company_id();
  v_asiento  public.conta_asientos;
  v_concepto text := btrim(COALESCE(p_concepto, ''));
  v_motivo   text := NULLIF(btrim(COALESCE(p_tipo_cambio_motivo, '')), '');
  v_n        int;
BEGIN
  -- ── Quién ────────────────────────────────────────────────────────────────
  IF v_company IS NULL OR public.sesion_api_sin_empresa() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF NOT public.mfa_requirement_met() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND NOT (
       EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company)
       AND public.can_access_project(p_project_id)
     ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  -- ── Qué ──────────────────────────────────────────────────────────────────
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La póliza necesita una fecha.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_tipo IS NULL OR p_tipo <> ALL (ARRAY['diario', 'ingreso', 'egreso', 'apertura']) THEN
    RAISE EXCEPTION 'Tipo de póliza manual no válido: %.', COALESCE(p_tipo, '(vacío)') USING ERRCODE = 'check_violation';
  END IF;
  IF v_concepto = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 2 THEN
    RAISE EXCEPTION 'Una póliza lleva al menos 2 líneas.' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lineas) > 1000 THEN
    RAISE EXCEPTION 'Una póliza admite hasta 1000 líneas.' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Cabecera ─────────────────────────────────────────────────────────────
  IF p_asiento_id IS NULL THEN
    IF NOT public.conta_puede_escribir('create') THEN
      RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.conta_asientos (
      company_id, project_id, fecha, tipo, concepto, estado, origen, moneda_base, tipo_cambio_motivo, created_by
    ) VALUES (
      v_company, p_project_id, p_fecha, p_tipo, v_concepto, 'borrador', 'manual',
      public.conta_moneda_base(v_company, p_project_id), v_motivo, auth.uid()
    ) RETURNING * INTO v_asiento;
  ELSE
    IF NOT public.conta_puede_escribir('edit') THEN
      RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_asiento FROM public.conta_asientos
     WHERE id = p_asiento_id AND company_id = v_company
       FOR UPDATE;
    -- Mismo mensaje exista o no en otra empresa: no se distingue «ajeno» de «no existe».
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Asiento no encontrado.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_asiento.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'POLIZA_OTRO_LEDGER: el borrador es de otra contabilidad (empresa/proyecto); ábrelo desde la suya.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_asiento.origen <> 'manual' THEN
      RAISE EXCEPTION 'POLIZA_NO_EDITABLE: una póliza automática no se edita; se corrige su documento de origen.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_asiento.estado <> 'borrador' THEN
      RAISE EXCEPTION 'POLIZA_NO_EDITABLE: sólo un borrador se edita (estado actual: %).', v_asiento.estado
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.conta_asientos
       SET fecha = p_fecha, tipo = p_tipo, concepto = v_concepto,
           tipo_cambio_motivo = v_motivo, updated_at = now()
     WHERE id = v_asiento.id
    RETURNING * INTO v_asiento;
    DELETE FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id;
  END IF;

  -- ── Líneas ───────────────────────────────────────────────────────────────
  INSERT INTO public.conta_asiento_lineas (
    asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber, moneda_origen, monto_origen, tipo_cambio
  )
  SELECT v_asiento.id, v_company,
         (l.linea ->> 'cuenta_id')::uuid,
         l.orden::int,
         NULLIF(btrim(COALESCE(l.linea ->> 'descripcion', '')), ''),
         COALESCE((l.linea ->> 'debe')::numeric, 0),
         COALESCE((l.linea ->> 'haber')::numeric, 0),
         NULLIF(l.linea ->> 'moneda_origen', ''),
         (l.linea ->> 'monto_origen')::numeric,
         (l.linea ->> 'tipo_cambio')::numeric
    FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS l(linea, orden);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'Una póliza lleva al menos 2 líneas.' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Publicación, en la MISMA transacción: si se rechaza, no queda el borrador ──
  IF COALESCE(p_publicar, false) THEN
    v_asiento := public.conta_publicar_asiento(v_asiento.id);
  END IF;
  RETURN v_asiento;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_poliza_manual_guardar(uuid, uuid, date, text, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_poliza_manual_guardar(uuid, uuid, date, text, text, text, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.conta_poliza_manual_guardar(uuid, uuid, date, text, text, text, jsonb, boolean) IS
  'Póliza manual: crea (p_asiento_id NULL) o reemplaza un borrador, con sus líneas y, si p_publicar, la publica; todo en una transacción.';
