-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE C · RESPALDOS DE RECEPCIÓN (evidencia de entrega y conformidad)
--
-- QUÉ YA EXISTÍA
--   · `recepciones.respaldo_path` (texto) y `compras_recepcion_crear` lo guarda y lo mete
--     en la huella del contenido; el seguimiento muestra `tiene_respaldo`.
--   · El patrón del bucket PRIVADO por empresa/proyecto/fila: `contratos-respaldo`.
--   NO existía bucket, ni quién puede subir/ver, ni límites, ni historial: el campo se
--   quedaba siempre vacío y nada impedía cambiarlo con la recepción ya contabilizada.
--
-- QUÉ HACE
--   1. Bucket PRIVADO `recepciones-respaldo` (10 MB; PDF, JPG, PNG, WEBP). Ruta
--      <empresa>/<proyecto|empresa>/<recepción>/<archivo>. El acceso se decide desde la
--      FILA de la recepción (empresa, proyecto, permiso), no por el nombre del archivo.
--   2. `recepcion_respaldos`: un registro por archivo, con TRAZABILIDAD (quién, cuándo,
--      tipo entrega | conformidad | otro, nombre, tipo MIME, tamaño y SHA-256). Es
--      SOLO-AÑADIR: no se edita ni se borra una evidencia de una recepción ya registrada.
--      Mientras la recepción es borrador se puede retirar un archivo subido por error.
--   3. `compras_recepcion_adjuntar(...)`: valida ruta, límites y que el objeto exista en el
--      bucket; es idempotente por (recepción, ruta). SECURITY INVOKER: rigen las RLS.
--   4. `recepciones.respaldo_path` (el respaldo PRINCIPAL) se fija con el primer archivo
--      mientras la recepción es borrador y queda CONGELADO en cuanto sale de borrador:
--      cambiar un adjunto no altera una recepción contabilizada. Agregar más evidencia
--      después (otro archivo) sí se puede: añade filas aquí y no toca la recepción.
--
-- NO CAMBIA: los asientos, el inventario ni la huella de `compras_recepcion_crear`.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.compras_recepcion_adjuntar(uuid, text, text, text, bigint, text, text, text);
--   DROP TABLE public.recepcion_respaldos;
--   DROP TRIGGER trg_compras_recepcion_respaldo_congelado ON public.recepciones;
--   DROP FUNCTION public.compras_tg_recepcion_respaldo_congelado();
--   DROP POLICY "recepciones_respaldo_*" ON storage.objects;  DELETE FROM storage.buckets WHERE id = 'recepciones-respaldo' (vacío);
-- IMPACTO EN DATOS: ninguno; la tabla y el bucket nacen vacíos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Bucket privado ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recepciones-respaldo', 'recepciones-respaldo', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Quién ve la evidencia de entrega: el que ve las órdenes de compra de Operaciones o
-- Contabilidad. Quién la sube: además, el que puede capturar.
CREATE OR REPLACE FUNCTION public.compras_respaldo_puede_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_super_admin()
      OR public.user_has_permission('condominios.tab.ordenes_compra')
      OR public.prov_puede_ver_papeleria();
$$;
REVOKE EXECUTE ON FUNCTION public.compras_respaldo_puede_ver() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_respaldo_puede_ver() TO authenticated;

CREATE OR REPLACE FUNCTION public.recepcion_respaldo_autoriza(p_name text, p_escribir boolean DEFAULT false, p_solo_borrador boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_super_admin()
      OR (
        array_length(storage.foldername(p_name), 1) = 3
        AND public.compras_respaldo_puede_ver()
        AND (NOT p_escribir OR public.compras_import_puede_capturar())
        AND EXISTS (
          SELECT 1 FROM public.recepciones r
           WHERE r.id::text                                   = (storage.foldername(p_name))[3]
             AND COALESCE(r.project_id::text, 'empresa')      = (storage.foldername(p_name))[2]
             AND r.company_id::text                           = (storage.foldername(p_name))[1]
             AND r.company_id = public.get_my_company_id()
             AND (r.project_id IS NULL OR public.can_access_project(r.project_id))
             AND (NOT p_escribir OR r.estado <> 'anulada')
             AND (NOT p_solo_borrador OR r.estado = 'borrador')
        )
      );
$$;
REVOKE EXECUTE ON FUNCTION public.recepcion_respaldo_autoriza(text, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recepcion_respaldo_autoriza(text, boolean, boolean) TO authenticated;

DROP POLICY IF EXISTS "recepciones_respaldo_select" ON storage.objects;
DROP POLICY IF EXISTS "recepciones_respaldo_insert" ON storage.objects;
DROP POLICY IF EXISTS "recepciones_respaldo_delete" ON storage.objects;

CREATE POLICY "recepciones_respaldo_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'recepciones-respaldo' AND public.recepcion_respaldo_autoriza(name));
-- Se AÑADEN archivos; no se sustituyen (sin policy de UPDATE).
CREATE POLICY "recepciones_respaldo_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'recepciones-respaldo' AND public.recepcion_respaldo_autoriza(name, true));
-- Borrar evidencia de una recepción que ya salió de borrador es destruirla: solo en borrador.
CREATE POLICY "recepciones_respaldo_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'recepciones-respaldo' AND public.recepcion_respaldo_autoriza(name, true, true));

-- ── 2. Registro trazable de cada archivo ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recepcion_respaldos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  recepcion_id  uuid        NOT NULL REFERENCES public.recepciones(id) ON DELETE RESTRICT,
  ruta          text        NOT NULL,
  nombre        text        NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 200),
  tipo          text        NOT NULL DEFAULT 'entrega' CHECK (tipo IN ('entrega', 'conformidad', 'otro')),
  mime          text        NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  bytes         bigint      NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  sha256        text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  notas         text        CHECK (notas IS NULL OR length(notas) <= 500),
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_recepcion_respaldo_ruta UNIQUE (recepcion_id, ruta)
);
CREATE INDEX IF NOT EXISTS idx_recepcion_respaldos_rec ON public.recepcion_respaldos (recepcion_id, created_at);

COMMENT ON TABLE public.recepcion_respaldos IS
  'Evidencia (entrega o conformidad de servicio) de una recepción: ruta en el bucket privado recepciones-respaldo, tipo, MIME, tamaño, SHA-256, quién y cuándo. Solo-añadir.';

ALTER TABLE public.recepcion_respaldos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recepcion_respaldos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.recepcion_respaldos TO authenticated;

DROP POLICY IF EXISTS recepcion_respaldos_select ON public.recepcion_respaldos;
CREATE POLICY recepcion_respaldos_select ON public.recepcion_respaldos FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
         AND (project_id IS NULL OR public.can_access_project(project_id))
         AND (SELECT public.compras_respaldo_puede_ver())));
DROP POLICY IF EXISTS recepcion_respaldos_insert ON public.recepcion_respaldos;
CREATE POLICY recepcion_respaldos_insert ON public.recepcion_respaldos FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (project_id IS NULL OR public.can_access_project(project_id))
              AND (SELECT public.compras_respaldo_puede_ver()) AND (SELECT public.compras_import_puede_capturar()));
-- Retirar un archivo subido por error: solo con la recepción en borrador.
DROP POLICY IF EXISTS recepcion_respaldos_delete ON public.recepcion_respaldos;
CREATE POLICY recepcion_respaldos_delete ON public.recepcion_respaldos FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.compras_import_puede_capturar())
         AND EXISTS (SELECT 1 FROM public.recepciones r WHERE r.id = recepcion_id AND r.estado = 'borrador'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    DROP POLICY IF EXISTS mfa_gate_aal2 ON public.recepcion_respaldos;
    CREATE POLICY mfa_gate_aal2 ON public.recepcion_respaldos AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met());
  END IF;
END $$;

-- Solo-añadir: ni UPDATE (no hay policy ni privilegio) ni DELETE tras salir de borrador.
-- Quién y cuándo los pone el servidor; la empresa y el proyecto salen de la recepción.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_alta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_r   record;
BEGIN
  SELECT r.company_id, r.project_id, r.estado, r.respaldo_path INTO v_r
    FROM public.recepciones r WHERE r.id = NEW.recepcion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: la recepción no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_r.estado = 'anulada' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: la recepción está anulada y no admite más evidencia.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.company_id := v_r.company_id;
  NEW.project_id := v_r.project_id;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();
  IF NEW.ruta NOT LIKE v_r.company_id::text || '/' || COALESCE(v_r.project_id::text, 'empresa') || '/' || NEW.recepcion_id::text || '/%' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RUTA: la ruta del archivo no corresponde a esta recepción (<empresa>/<proyecto>/<recepción>/<archivo>).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_alta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_alta ON public.recepcion_respaldos;
CREATE TRIGGER trg_compras_recepcion_respaldo_alta BEFORE INSERT ON public.recepcion_respaldos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_alta();

-- El PRIMER archivo de una recepción en borrador pasa a ser su respaldo principal.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_principal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.recepciones SET respaldo_path = NEW.ruta
   WHERE id = NEW.recepcion_id AND estado = 'borrador' AND respaldo_path IS NULL;
  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_principal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_principal ON public.recepcion_respaldos;
CREATE TRIGGER trg_compras_recepcion_respaldo_principal AFTER INSERT ON public.recepcion_respaldos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_principal();

-- ── 3. El respaldo principal se congela al salir de borrador ────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_congelado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.respaldo_path IS DISTINCT FROM OLD.respaldo_path AND (OLD.estado <> 'borrador' OR NEW.estado <> 'borrador') THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_RESPALDO_CONGELADO: el respaldo de una recepción registrada no se cambia; añade otro archivo como evidencia adicional.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_congelado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_congelado ON public.recepciones;
CREATE TRIGGER trg_compras_recepcion_respaldo_congelado BEFORE UPDATE OF respaldo_path ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_congelado();

-- ── 4. Adjuntar (idempotente por recepción + ruta) ──────────────────────────
CREATE OR REPLACE FUNCTION public.compras_recepcion_adjuntar(
  p_recepcion_id uuid, p_ruta text, p_nombre text, p_mime text, p_bytes bigint, p_sha256 text,
  p_tipo text DEFAULT 'entrega', p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_r   public.recepciones%ROWTYPE;
  v_row public.recepcion_respaldos%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.recepciones WHERE id = p_recepcion_id;
  IF NOT FOUND OR v_r.company_id IS DISTINCT FROM public.get_my_company_id()
     OR (v_r.project_id IS NOT NULL AND NOT public.can_access_project(v_r.project_id)) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: la recepción no existe en tu empresa o proyecto.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.compras_respaldo_puede_ver() AND public.compras_import_puede_capturar()) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_PERMISO: no tienes permiso para adjuntar evidencia de recepciones.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_ruta !~ '^[0-9a-f-]{36}/(empresa|[0-9a-f-]{36})/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RUTA: ruta de archivo inválida; usa <empresa>/<proyecto>/<recepción>/<archivo> con un nombre simple.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TIPO: solo se aceptan PDF, JPG, PNG o WEBP.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_bytes IS NULL OR p_bytes <= 0 OR p_bytes > 10485760 THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TAMANO: el archivo debe pesar entre 1 byte y 10 MB.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_tipo = 'conformidad' AND v_r.tipo <> 'servicio' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TIPO: la «conformidad» es la evidencia de una recepción de SERVICIO; para bienes usa «entrega».' USING ERRCODE = 'check_violation';
  END IF;
  IF p_tipo = 'entrega' AND v_r.tipo = 'servicio' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TIPO: la evidencia de un servicio es la «conformidad» (acta o soporte); «entrega» es para bienes.' USING ERRCODE = 'check_violation';
  END IF;
  -- El objeto tiene que estar de verdad en el bucket (lo subió quien llama, con su acceso).
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'recepciones-respaldo' AND o.name = p_ruta) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_OBJETO: el archivo no está en el almacenamiento; súbelo primero.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM public.recepcion_respaldos WHERE recepcion_id = p_recepcion_id AND ruta = p_ruta;
  IF FOUND THEN
    IF v_row.sha256 IS DISTINCT FROM lower(p_sha256) THEN
      RAISE EXCEPTION 'COMPRAS_RESPALDO_CONFLICTO: esa ruta ya tiene otro contenido registrado; sube el archivo con otro nombre.' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('respaldo', to_jsonb(v_row), 'reutilizado', true);
  END IF;

  INSERT INTO public.recepcion_respaldos (company_id, project_id, recepcion_id, ruta, nombre, tipo, mime, bytes, sha256, notas)
  VALUES (v_r.company_id, v_r.project_id, p_recepcion_id, p_ruta, left(btrim(p_nombre), 200), p_tipo, p_mime, p_bytes, lower(p_sha256), left(p_notas, 500))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('respaldo', to_jsonb(v_row), 'reutilizado', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_recepcion_adjuntar(uuid, text, text, text, bigint, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_recepcion_adjuntar(uuid, text, text, text, bigint, text, text, text) TO authenticated;
