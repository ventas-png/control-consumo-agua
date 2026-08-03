-- ════════════════════════════════════════════════════════════════════════════
-- Anuncios del condominio: aviso al residente y acuse de lectura.
--
-- POR QUÉ AQUÍ Y NO "DIFUSIÓN EN CONDOMINIOS"
-- El tab Difusión está oculto para condominios (`showDifusion` en
-- ComunicacionSection) y el portal del residente no tiene pantalla para
-- comunicados de difusión: faltan las dos mitades. Pero el condominio YA tiene
-- su canal al residente —el tablón (`anuncios_comunidad`), que 20260801000300
-- acaba de desbloquear— y comunicados por unidad. Lo único que Difusión sumaba
-- sobre eso era ENTREGA (email) y ACUSE DE LECTURA. Se le añaden esas dos cosas
-- al canal existente en vez de levantar un tercero en paralelo.
--
-- QUÉ HACE
--   1. `anuncio_lecturas`: quién leyó qué (el equivalente de
--      broadcast_recipients.read_at, sin el fan-out de filas por destinatario).
--   2. Trigger AFTER INSERT en `anuncios_comunidad`: encola en
--      notifications_outbox un in_app por residente del proyecto y un email a
--      los que tengan correo.
--
-- El fan-out va en un TRIGGER, no en el cliente ni en una edge nueva, porque
-- hay DOS caminos que publican un anuncio —ComunidadTab ("Publicar anuncio") y
-- ComunicadosTab ("📢 Publicar en portal")— y ambos son un INSERT plano vía
-- createCondominioRow. Un trigger los cubre a la vez y no se puede saltar.
--
-- CANALES: in_app + email. `push` NO se encola: el dispatcher lo tiene como
-- follow-up explícito (notifications-dispatcher/index.ts:493, "push (follow-up)
-- y canales desconocidos: failed no-retriable"), así que encolarlo hoy sólo
-- generaría filas fallidas. El in_app aterriza en la campanita que el portal
-- del residente ya monta (CondominiosClientPortal:329); el email lo entrega el
-- dispatcher respetando notification_channel_enabled gracias al `user_id` que
-- el payload lleva.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Acuse de lectura
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.anuncio_lecturas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anuncio_id uuid NOT NULL REFERENCES public.anuncios_comunidad(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anuncio_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_anuncio_lecturas_anuncio ON public.anuncio_lecturas(anuncio_id);
CREATE INDEX IF NOT EXISTS idx_anuncio_lecturas_company ON public.anuncio_lecturas(company_id);

ALTER TABLE public.anuncio_lecturas ENABLE ROW LEVEL SECURITY;

-- Staff: los de su empresa, con el mismo permiso que gobierna los anuncios.
DROP POLICY IF EXISTS "anuncio_lecturas_select" ON public.anuncio_lecturas;
CREATE POLICY "anuncio_lecturas_select" ON public.anuncio_lecturas
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR ((company_id = public.get_my_company_id())
        AND public.user_has_permission('condominios.tab.comunicados'))
    OR (cliente_id = (SELECT public.get_my_cliente_id()))
  );

-- Residente: sólo puede sellar SU propia lectura.
DROP POLICY IF EXISTS "anuncio_lecturas_insert" ON public.anuncio_lecturas;
CREATE POLICY "anuncio_lecturas_insert" ON public.anuncio_lecturas
  FOR INSERT TO authenticated
  WITH CHECK (cliente_id = (SELECT public.get_my_cliente_id()));

COMMENT ON TABLE public.anuncio_lecturas IS
  'Acuse de lectura de los anuncios del tablón (una fila por residente que lo abrió). El residente sólo escribe la suya; el staff ve las de su empresa para el contador "X de Y leyeron".';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fan-out al publicar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notificar_anuncio_comunidad()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa text;
BEGIN
  -- Un anuncio inactivo es un borrador: no se avisa a nadie.
  IF NEW.activo IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT nombre INTO v_empresa FROM public.companies WHERE id = NEW.company_id;

  -- Residentes del proyecto = clientes con unidad activa ahí (titular o
  -- residente asignado), con su cuenta de portal. DISTINCT porque un cliente
  -- puede tener varias unidades en el mismo proyecto.
  WITH residentes AS (
    SELECT DISTINCT au.id AS user_id, c.id AS cliente_id, c.nombre, c.email
    FROM public.unidades u
    JOIN public.clientes  c  ON c.id = u.cliente_id
    JOIN public.app_users au ON au.cliente_id = c.id AND au.activo = true
    WHERE u.project_id = NEW.project_id AND u.activo = true
    UNION
    SELECT DISTINCT au.id, c.id, c.nombre, c.email
    FROM public.unidad_residentes ur
    JOIN public.unidades  u  ON u.id = ur.unidad_id
    JOIN public.clientes  c  ON c.id = ur.cliente_id
    JOIN public.app_users au ON au.cliente_id = c.id AND au.activo = true
    WHERE u.project_id = NEW.project_id AND u.activo = true AND ur.activo = true
  )
  INSERT INTO public.notifications_outbox (company_id, channel, template_key, payload, recipient)
  SELECT
    NEW.company_id,
    canal.channel,
    'anuncio_condominio',
    jsonb_build_object(
      'user_id',        r.user_id,          -- lo usa el dispatcher para notification_channel_enabled
      'cliente_id',     r.cliente_id,
      'anuncio_id',     NEW.id,
      'tipo',           'anuncio',
      'seccion',        'anuncios',
      'titulo',         NEW.titulo,
      'cuerpo',         NEW.contenido,
      'subject',        NEW.titulo,
      'message',        NEW.contenido,
      'to_name',        coalesce(r.nombre, ''),
      'empresa_nombre', coalesce(v_empresa, 'AdministraTodo')
    ),
    CASE canal.channel WHEN 'in_app' THEN r.user_id::text ELSE r.email END
  FROM residentes r
  CROSS JOIN (VALUES ('in_app'), ('email')) AS canal(channel)
  -- El email sólo si hay dirección; el in_app siempre.
  WHERE canal.channel = 'in_app' OR (r.email IS NOT NULL AND r.email <> '');

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notificar_anuncio_comunidad() FROM public, anon;

DROP TRIGGER IF EXISTS trg_notificar_anuncio_comunidad ON public.anuncios_comunidad;
CREATE TRIGGER trg_notificar_anuncio_comunidad
  AFTER INSERT ON public.anuncios_comunidad
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_anuncio_comunidad();

COMMENT ON FUNCTION public.fn_notificar_anuncio_comunidad() IS
  'Al publicar un anuncio activo, encola in_app + email para los residentes del proyecto. Vive en un trigger porque publican DOS caminos distintos (ComunidadTab y "Publicar en portal" de ComunicadosTab) y ambos son un INSERT plano.';
