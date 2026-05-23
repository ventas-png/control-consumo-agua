-- ============================================================
-- Paquetería: salida para retiro por un tercero
-- ============================================================
-- El residente deja un paquete en recepción para que una persona que él define
-- lo recoja, validado con un código de retiro de un solo uso.
--
-- Se reutiliza paquetes_recibidos con una columna `direccion`:
--   'entrante'         = paquete recibido para el residente (flujo existente)
--   'saliente_tercero' = paquete dejado por el residente para que un tercero retire
-- y columnas del autorizado + código de retiro. Los estados se reutilizan
-- (pendiente = en custodia/por retirar, entregado = retirado, devuelto = devuelto
-- al residente). recibido_por NULL en una salida = autorizada pero aún no depositada.

ALTER TABLE public.paquetes_recibidos
  ADD COLUMN IF NOT EXISTS direccion            text NOT NULL DEFAULT 'entrante',
  ADD COLUMN IF NOT EXISTS autorizado_nombre    text,
  ADD COLUMN IF NOT EXISTS autorizado_documento text,
  ADD COLUMN IF NOT EXISTS autorizado_telefono  text,
  ADD COLUMN IF NOT EXISTS codigo_retiro        text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_direccion_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_direccion_chk CHECK (direccion IN ('entrante','saliente_tercero'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_paquetes_direccion ON public.paquetes_recibidos(project_id, direccion);
CREATE INDEX IF NOT EXISTS idx_paquetes_codigo_retiro ON public.paquetes_recibidos(codigo_retiro) WHERE codigo_retiro IS NOT NULL;

-- ── RPC: el residente autoriza una salida desde su portal ───────────────────────
-- SECURITY DEFINER: el residente no tiene INSERT directo; esta función valida que
-- sea el residente activo de la unidad y crea la fila con un código generado.
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
  v_unidad public.unidades;
  v_row    public.paquetes_recibidos;
  v_codigo text;
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

  v_codigo := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

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

-- ── Trigger: avisar al residente cuando un tercero retira su paquete ────────────
CREATE OR REPLACE FUNCTION public.paquete_salida_notificar_retiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente uuid;
BEGIN
  IF NEW.direccion = 'saliente_tercero'
     AND NEW.estado = 'entregado'
     AND OLD.estado IS DISTINCT FROM 'entregado' THEN
    SELECT cliente_id INTO v_cliente FROM public.unidades WHERE id = NEW.unidad_id;
    IF v_cliente IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, company_id, tipo, titulo, cuerpo, seccion, paquete_id)
      SELECT au.id, NEW.company_id, 'paquete_retirado',
             'Tu paquete fue retirado',
             coalesce(NEW.entregado_a_nombre, 'Una persona autorizada') || ' retiró: ' || NEW.descripcion,
             'paquetes', NEW.id
        FROM public.app_users au
       WHERE au.cliente_id = v_cliente AND au.activo = true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- La función de trigger no debe ser invocable como RPC (se ejecuta en contexto de
-- trigger). Se revoca EXECUTE para no exponerla en la API.
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM anon;
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM authenticated;

DROP TRIGGER IF EXISTS trg_paquete_salida_retiro ON public.paquetes_recibidos;
CREATE TRIGGER trg_paquete_salida_retiro
  AFTER UPDATE ON public.paquetes_recibidos
  FOR EACH ROW
  EXECUTE FUNCTION public.paquete_salida_notificar_retiro();
