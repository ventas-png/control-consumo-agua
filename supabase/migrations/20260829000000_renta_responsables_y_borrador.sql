-- Solicitud de renta: responsables de servicios, estado `borrador` y validación
-- de completitud en la BASE, no solo en React.
--
-- POR QUÉ
--
--   • RESPONSABLES. El contrato no decía quién paga mantenimiento, agua, luz,
--     basura, telefonía e internet — el conflicto más común entre propietario e
--     inquilino. Se capturan en la solicitud y se copian al contrato, de modo
--     que cada plazo conserva SUS responsables (el histórico se lee por
--     contrato, no por unidad).
--
--   • BORRADOR. Para que las policies de `renta-docs` puedan validar el path
--     {unidad_id}/{solicitud_id}/ y congelar los archivos al enviarse, la fila
--     debe existir ANTES de subir. El portal reserva un borrador
--     (portal_reservar_solicitud_renta, 20260829000200), sube ahí, y al enviar
--     pasa a 'pendiente'. El índice único parcial garantiza uno por unidad, así
--     que reservar es idempotente y los borradores no se acumulan.
--
--   • VALIDACIÓN. Hasta ahora nombre/monto/fecha solo se exigían en la UI.
--     Va en TRIGGER y no en CHECK porque la regla es condicional al estado
--     (un borrador puede estar a medias) y debe dejar pasar las filas
--     históricas, que nacieron sin ninguno de estos campos.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, DO-blocks sobre pg_constraint,
-- CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

-- ── 1) Estado 'borrador' ─────────────────────────────────────────────────────
-- Se dropea el CHECK por DEFINICIÓN (no por nombre) por si el autogenerado
-- difiere en prod — mismo criterio que 20260827000000.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'solicitud_renta_unidad'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE public.solicitud_renta_unidad DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.solicitud_renta_unidad
  ADD CONSTRAINT solicitud_renta_unidad_estado_check
  CHECK (estado IN ('borrador', 'pendiente', 'aprobada', 'rechazada', 'baja'));

-- Un borrador por unidad. `idx_solicitud_renta_unidad_activa` (20260513000001)
-- solo cuenta pendiente|aprobada, así que ambos índices conviven.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitud_renta_borrador_unidad
  ON public.solicitud_renta_unidad (unidad_id)
  WHERE estado = 'borrador';

-- ── 2) Responsables de servicios ─────────────────────────────────────────────
-- Columnas individuales y no un jsonb: seis valores fijos y cerrados se
-- validan, copian y renderizan mejor como columnas, y no admiten claves con
-- typo. `text` + CHECK y no un DOMAIN/ENUM: no hay ninguno en el repo, y un
-- CHECK se amplía (p. ej. 'compartido') sin reescribir el tipo.
ALTER TABLE public.solicitud_renta_unidad
  ADD COLUMN IF NOT EXISTS resp_mantenimiento text,
  ADD COLUMN IF NOT EXISTS resp_agua          text,
  ADD COLUMN IF NOT EXISTS resp_electricidad  text,
  ADD COLUMN IF NOT EXISTS resp_basura        text,
  ADD COLUMN IF NOT EXISTS resp_telefonia     text,
  ADD COLUMN IF NOT EXISTS resp_internet      text;

ALTER TABLE public.contratos_arrendamiento
  ADD COLUMN IF NOT EXISTS resp_mantenimiento text,
  ADD COLUMN IF NOT EXISTS resp_agua          text,
  ADD COLUMN IF NOT EXISTS resp_electricidad  text,
  ADD COLUMN IF NOT EXISTS resp_basura        text,
  ADD COLUMN IF NOT EXISTS resp_telefonia     text,
  ADD COLUMN IF NOT EXISTS resp_internet      text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['solicitud_renta_unidad', 'contratos_arrendamiento'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_responsables_check') THEN
      EXECUTE format($f$
        ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
              (resp_mantenimiento IS NULL OR resp_mantenimiento IN ('propietario','inquilino'))
          AND (resp_agua          IS NULL OR resp_agua          IN ('propietario','inquilino'))
          AND (resp_electricidad  IS NULL OR resp_electricidad  IN ('propietario','inquilino'))
          AND (resp_basura        IS NULL OR resp_basura        IN ('propietario','inquilino'))
          AND (resp_telefonia     IS NULL OR resp_telefonia     IN ('propietario','inquilino'))
          AND (resp_internet      IS NULL OR resp_internet      IN ('propietario','inquilino'))
        )$f$, t, t || '_responsables_check');
    END IF;
  END LOOP;
END $$;

-- ── 3) Auditoría de la resolución ────────────────────────────────────────────
-- `aprobado_por` es texto que hoy manda el CLIENTE: sirve para mostrar, no para
-- auditar. La identidad confiable es el uuid que el RPC toma de auth.uid().
ALTER TABLE public.solicitud_renta_unidad
  ADD COLUMN IF NOT EXISTS aprobado_por_user_id uuid
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_sin_contrato text;

COMMENT ON COLUMN public.solicitud_renta_unidad.aprobado_por_user_id IS
  'Quién resolvió, tomado de auth.uid() en el RPC. `aprobado_por` es solo el nombre para mostrar.';
COMMENT ON COLUMN public.solicitud_renta_unidad.motivo_sin_contrato IS
  'Justificación obligatoria cuando se aprueba un arrendamiento SIN crear el contrato.';

-- ── 4) Completitud exigida por la base ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validar_solicitud_renta_completa()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- Un borrador puede estar a medias; lo que se envía o se aprueba, no.
  IF NEW.estado NOT IN ('pendiente', 'aprobada') THEN
    RETURN NEW;
  END IF;
  -- Con STR los datos del contrato no aplican: cada reserva trae los suyos.
  IF NEW.tipo_renta NOT IN ('arrendamiento', 'ambas') THEN
    RETURN NEW;
  END IF;
  -- Escape para las solicitudes HEREDADAS: las que ya estaban pendientes antes
  -- de esta feature no traen datos ni responsables y quedarían imposibles de
  -- resolver. Se pueden aprobar sin contrato, pero solo dejando por escrito el
  -- porqué (motivo_sin_contrato) — que es justamente el rastro de auditoría.
  IF NEW.estado = 'aprobada' AND nullif(btrim(coalesce(NEW.motivo_sin_contrato, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.arrendatario_nombre IS NULL OR btrim(NEW.arrendatario_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre del arrendatario es obligatorio para una solicitud de arrendamiento.';
  END IF;
  IF NEW.monto_renta IS NULL OR NEW.monto_renta < 0 THEN
    RAISE EXCEPTION 'El monto de renta es obligatorio y no puede ser negativo.';
  END IF;
  IF NEW.fecha_inicio IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio es obligatoria para una solicitud de arrendamiento.';
  END IF;
  IF NEW.resp_mantenimiento IS NULL OR NEW.resp_agua IS NULL
     OR NEW.resp_electricidad IS NULL OR NEW.resp_basura IS NULL
     OR NEW.resp_telefonia IS NULL OR NEW.resp_internet IS NULL THEN
    RAISE EXCEPTION 'Debe indicarse el responsable de los seis servicios (mantenimiento, agua, electricidad, basura, telefonía, internet).';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validar_solicitud_renta ON public.solicitud_renta_unidad;
CREATE TRIGGER trg_validar_solicitud_renta
  BEFORE INSERT OR UPDATE ON public.solicitud_renta_unidad
  FOR EACH ROW EXECUTE FUNCTION public.fn_validar_solicitud_renta_completa();

-- ── 5) La notificación se dispara al ENVIAR, no al reservar ──────────────────
-- `trg_notif_solicitud_renta` (20260819000000) era AFTER INSERT: con el
-- borrador avisaría al staff de una solicitud que nadie mandó todavía. La
-- función solo lee NEW, así que sirve igual en UPDATE.
-- Dos triggers y no uno con OR: en la cláusula WHEN de un trigger de INSERT no
-- se puede referenciar OLD (ni TG_OP), así que la condición "pasó a pendiente"
-- se expresa por separado en cada operación.
DROP TRIGGER IF EXISTS trg_notif_solicitud_renta ON public.solicitud_renta_unidad;
CREATE TRIGGER trg_notif_solicitud_renta
  AFTER INSERT ON public.solicitud_renta_unidad
  FOR EACH ROW
  WHEN (NEW.estado = 'pendiente')
  EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('renta', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_renta_envio ON public.solicitud_renta_unidad;
CREATE TRIGGER trg_notif_solicitud_renta_envio
  AFTER UPDATE ON public.solicitud_renta_unidad
  FOR EACH ROW
  WHEN (NEW.estado = 'pendiente' AND OLD.estado IS DISTINCT FROM 'pendiente')
  EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('renta', 'condominios');
