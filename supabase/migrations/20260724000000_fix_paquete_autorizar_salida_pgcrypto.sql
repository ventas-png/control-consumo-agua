-- ============================================================================
-- FIX: paquete_autorizar_salida falla con
--      "function gen_random_bytes(integer) does not exist"
-- ============================================================================
-- POR QUÉ
--
-- 20260318000001_fix_function_search_path_and_move_extensions.sql movió
-- pgcrypto del schema `public` al schema `extensions` (hardening: los objetos
-- de extensiones no deben vivir en public). Desde entonces `gen_random_bytes`
-- solo es resoluble como `extensions.gen_random_bytes` o con `extensions` en
-- el search_path.
--
-- 20260717120000_paquetes_codigo_retiro_cripto.sql (B5) reescribió la
-- generación del código de retiro para usar CSPRNG, pero llamó a
-- `gen_random_bytes(1)` SIN calificar el schema mientras la función conserva
-- `SET search_path = public`. Resultado: el RPC revienta en tiempo de
-- ejecución — no al aplicar la migración, porque plpgsql resuelve los nombres
-- en la primera ejecución, no al crear la función. Por eso el error apareció
-- "de la nada" en el portal del residente (Paquetería → Dejar un paquete en
-- recepción → Autorizar y generar código) y no en el deploy.
--
-- El resto del repo ya calificaba correctamente: `extensions.gen_random_bytes`
-- en 20260606130000_company_sso_domains.sql y `extensions.crypt` /
-- `extensions.gen_salt` en 20260320000002 / 20260320000004. Esta migración
-- alinea paquete_autorizar_salida con esa convención.
--
-- Se califica el schema en vez de agregar `extensions` al search_path: en una
-- función SECURITY DEFINER, cada schema extra en el path es una superficie más
-- donde un nombre puede ser sombreado.
--
-- IMPACTO EN DATOS
--
-- Ninguno. Solo se reemplaza el cuerpo de la función; no toca tablas ni filas.
-- Ningún paquete llegó a insertarse por esta vía mientras el bug estuvo activo
-- (la excepción abortaba la transacción antes del INSERT), así que no hay
-- registros a medias que reparar.
--
-- CÓMO REVERTIR
--
-- Reaplicar el cuerpo de 20260717120000_paquetes_codigo_retiro_cripto.sql
-- (queda con el bug) o el de 20260523000005_paqueteria_salida.sql (vuelve al
-- código con random(), NO criptográfico — solo como último recurso).
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
  -- pgcrypto vive en `extensions` (ver 20260318000001): calificar el schema es
  -- obligatorio con `search_path = public`.
  SELECT string_agg(
           substr(v_alfabeto, (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alfabeto)) + 1, 1),
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
  'El residente autoriza la salida de un paquete para retiro por un tercero; genera el código de retiro con CSPRNG (extensions.gen_random_bytes) sobre alfabeto no ambiguo — B5, auditoría 2026-07-16 S3; schema de pgcrypto calificado en el fix del 2026-07-24.';
