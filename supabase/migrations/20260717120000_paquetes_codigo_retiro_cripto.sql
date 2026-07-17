-- ============================================================================
-- Código de retiro de paquetes CRIPTOGRÁFICO (B5, auditoría 2026-07-16 S3)
-- ============================================================================
-- paquete_autorizar_salida generaba el código con
--   upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))
-- random() NO es criptográfico (PRNG con semilla observable) y 6 hex ≈ 24 bits:
-- un código que autoriza a un TERCERO a llevarse un paquete debe ser
-- imprededecible. Ahora: gen_random_bytes (pgcrypto, CSPRNG) sobre el mismo
-- alfabeto sin ambiguos del frontend (lib/tokens: sin 0/O/1/I/L), 8 chars ≈ 40
-- bits. El sesgo de módulo (256 % 31) es < 0.2% por carácter — irrelevante.
--
-- Solo cambia la línea de generación del código: el resto del cuerpo es
-- idéntico a 20260523000005 (paridad línea a línea).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.paquete_autorizar_salida(
  p_unidad_id            uuid,
  p_tipo                 text,
  p_descripcion          text,
  p_autorizado_nombre    text,
  p_autorizado_documento text DEFAULT NULL,
  p_autorizado_telefono  text DEFAULT NULL,
  p_fotos                text[] DEFAULT NULL,
  p_notas                text DEFAULT NULL
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unidad   public.unidades;
  v_row      public.paquetes_recibidos;
  v_codigo   text;
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- espejo de lib/tokens
BEGIN
  SELECT * INTO v_unidad
    FROM public.unidades
   WHERE id = p_unidad_id
     AND activo = true
     AND cliente_id = (SELECT cliente_id FROM public.app_users WHERE id = (SELECT auth.uid()));
  IF v_unidad.id IS NULL THEN
    RAISE EXCEPTION 'No autorizado para esta unidad';
  END IF;
  IF coalesce(btrim(p_descripcion), '') = '' THEN
    RAISE EXCEPTION 'La descripción es obligatoria';
  END IF;
  IF coalesce(btrim(p_autorizado_nombre), '') = '' THEN
    RAISE EXCEPTION 'Debe indicar a quién autoriza el retiro';
  END IF;

  -- B5: CSPRNG (pgcrypto) + alfabeto no ambiguo, 8 chars ≈ 40 bits.
  SELECT string_agg(
           substr(v_alfabeto, (get_byte(gen_random_bytes(1), 0) % length(v_alfabeto)) + 1, 1),
           ''
         )
    INTO v_codigo
    FROM generate_series(1, 8);

  INSERT INTO public.paquetes_recibidos (
    company_id, project_id, unidad_id, direccion, tipo, descripcion,
    autorizado_nombre, autorizado_documento, autorizado_telefono,
    fotos, notas, estado, codigo_retiro
  ) VALUES (
    v_unidad.company_id, v_unidad.project_id, v_unidad.id, 'saliente_tercero',
    coalesce(nullif(btrim(p_tipo), ''), 'paquete'), btrim(p_descripcion),
    btrim(p_autorizado_nombre), nullif(btrim(p_autorizado_documento), ''), nullif(btrim(p_autorizado_telefono), ''),
    p_fotos, nullif(btrim(p_notas), ''), 'pendiente', v_codigo
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) FROM anon;
GRANT EXECUTE ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) TO authenticated;

COMMENT ON FUNCTION public.paquete_autorizar_salida(uuid,text,text,text,text,text,text[],text) IS
  'El residente autoriza la salida de un paquete para retiro por un tercero; genera el código de retiro con CSPRNG (gen_random_bytes) sobre alfabeto no ambiguo — B5, auditoría 2026-07-16 S3.';
