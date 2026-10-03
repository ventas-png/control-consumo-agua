-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · CORRECCIÓN DEL BLOQUE C · RESPALDOS DE RECEPCIÓN: VALIDACIÓN EN SERVIDOR Y RETIRO
--
-- DEFECTOS (20261022000200, ya aplicada: NO se edita)
--   1. La existencia del objeto en el bucket solo se comprobaba DENTRO de la RPC
--      `compras_recepcion_adjuntar`. Un INSERT directo en `public.recepcion_respaldos` (la tabla
--      tiene GRANT INSERT y policy de alta) registraba evidencia de un archivo que no existe, o de
--      otra recepción, o con nombre/tamaño/tipo inventados.
--   2. `recepciones.respaldo_path` aceptaba cualquier texto al crear la recepción (RPC
--      `compras_recepcion_crear`) o al actualizar el borrador: una referencia a un archivo que no
--      existe ni está registrado.
--   3. Al retirar el respaldo PRINCIPAL de una recepción en borrador, `respaldo_path` seguía
--      apuntando al archivo retirado.
--
-- CORRECCIÓN
--   · El trigger de alta de `recepcion_respaldos` (que corre para el INSERT directo Y para la RPC)
--     valida en el SERVIDOR: forma de la ruta (<empresa>/<proyecto|empresa>/<recepción>/<archivo>),
--     que la ruta sea de ESTA recepción, que el OBJETO exista en el bucket `recepciones-respaldo`,
--     que el tipo de evidencia corresponda a la recepción (conformidad = servicio; entrega = bienes)
--     y CONTRASTA los metadatos que Storage guarda del objeto (tamaño y tipo MIME) con los
--     declarados. El alcance (empresa, proyecto, permiso) sigue siendo de las RLS, que se evalúan
--     sobre la fila ya normalizada por el trigger. Limitación: el SHA-256 lo declara el cliente;
--     Storage no guarda un hash propio comparable (su ETag es MD5), así que no se puede contrastar
--     en servidor: queda como huella de trazabilidad, no como prueba.
--   · `recepciones.respaldo_path` solo puede apuntar a un archivo YA registrado de ESA recepción:
--     al INSERTAR una recepción no puede venir con respaldo (se adjunta después), y al actualizar el
--     borrador debe existir la fila del respaldo. El trigger interno que fija el principal queda
--     exento (es quien lo fija con el primer archivo).
--   · Al RETIRAR un respaldo de una recepción en BORRADOR, si era el principal se sustituye por el
--     siguiente archivo registrado (el más antiguo) o queda NULL. Una recepción registrada o anulada
--     no admite retiro (la policy de DELETE ya exige borrador) ni cambio de la referencia (trigger
--     de congelación existente).
--   · `compras_recepcion_adjuntar` pasa a INSERT … ON CONFLICT: dos sesiones que registran el mismo archivo a la
--     vez ya no chocan con un error de unicidad; la segunda recibe el registro creado (idempotencia real).
--   · El retiro y el registro de la recepción se SERIALIZAN con un candado FOR SHARE (trigger
--     BEFORE DELETE): no se puede destruir evidencia con la recepción registrándose a la vez.
--
-- NO CAMBIA: RLS, grants, la RPC `compras_recepcion_adjuntar`, asientos ni inventario.
-- CÓMO REVERTIR: restaurar `compras_tg_recepcion_respaldo_alta` de 20261022000200 y
--   DROP TRIGGER trg_compras_recepcion_respaldo_ref ON public.recepciones;
--   DROP TRIGGER trg_compras_recepcion_respaldo_retiro ON public.recepcion_respaldos;
--   DROP TRIGGER trg_compras_recepcion_respaldo_retiro_estado ON public.recepcion_respaldos;
--   DROP FUNCTION public.compras_tg_recepcion_respaldo_ref(); DROP FUNCTION public.compras_tg_recepcion_respaldo_retiro();
--   DROP FUNCTION public.compras_tg_recepcion_respaldo_retiro_estado();
-- IMPACTO EN DATOS: ninguno por sí misma. Solo valida filas NUEVAS. No corrige nada existente:
--   el diagnóstico de datos previos es de solo lectura (ver docs/COMPRAS_BLOQUE_C_CORRECCIONES.md).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_alta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_r    record;
  v_meta jsonb;
  v_found boolean;
BEGIN
  SELECT r.company_id, r.project_id, r.estado, r.tipo INTO v_r
    FROM public.recepciones r WHERE r.id = NEW.recepcion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: la recepción no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_r.estado = 'anulada' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: la recepción está anulada y no admite más evidencia.' USING ERRCODE = 'check_violation';
  END IF;

  -- La empresa y el proyecto salen SIEMPRE de la recepción; quién y cuándo, del servidor.
  NEW.company_id := v_r.company_id;
  NEW.project_id := v_r.project_id;
  NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
  NEW.created_at := now();

  IF NEW.ruta !~ '^[0-9a-f-]{36}/(empresa|[0-9a-f-]{36})/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'
     OR NEW.ruta LIKE '%..%' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RUTA: ruta de archivo inválida; usa <empresa>/<proyecto>/<recepción>/<archivo> con un nombre simple.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF split_part(NEW.ruta, '/', 1) <> v_r.company_id::text
     OR split_part(NEW.ruta, '/', 2) <> COALESCE(v_r.project_id::text, 'empresa')
     OR split_part(NEW.ruta, '/', 3) <> NEW.recepcion_id::text THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RUTA: la ruta del archivo no corresponde a esta recepción (<empresa>/<proyecto>/<recepción>/<archivo>).'
      USING ERRCODE = 'check_violation';
  END IF;

  -- El tipo de evidencia corresponde a la recepción (antes solo lo validaba la RPC).
  IF NEW.tipo = 'conformidad' AND v_r.tipo <> 'servicio' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TIPO: la «conformidad» es la evidencia de una recepción de SERVICIO; para bienes usa «entrega».'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tipo = 'entrega' AND v_r.tipo = 'servicio' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_TIPO: la evidencia de un servicio es la «conformidad» (acta o soporte); «entrega» es para bienes.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- El OBJETO tiene que existir de verdad en el bucket correcto (lectura con privilegios del
  -- trigger: la visibilidad de quien llama la deciden las RLS sobre la fila, no esta lectura).
  SELECT true, o.metadata INTO v_found, v_meta
    FROM storage.objects o
   WHERE o.bucket_id = 'recepciones-respaldo' AND o.name = NEW.ruta;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_OBJETO: el archivo no está en el almacenamiento (bucket recepciones-respaldo); súbelo primero.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Metadatos que Storage guarda del objeto: si están, deben coincidir con lo declarado.
  IF v_meta IS NOT NULL THEN
    IF (v_meta->>'size') ~ '^[0-9]+$' AND (v_meta->>'size')::bigint <> NEW.bytes THEN
      RAISE EXCEPTION 'COMPRAS_RESPALDO_METADATOS: el tamaño declarado (% bytes) no coincide con el del archivo almacenado (% bytes).',
        NEW.bytes, (v_meta->>'size')::bigint USING ERRCODE = 'check_violation';
    END IF;
    IF NULLIF(v_meta->>'mimetype', '') IS NOT NULL AND lower(v_meta->>'mimetype') <> NEW.mime THEN
      RAISE EXCEPTION 'COMPRAS_RESPALDO_METADATOS: el tipo declarado (%) no coincide con el del archivo almacenado (%).',
        NEW.mime, v_meta->>'mimetype' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_alta() FROM PUBLIC, anon, authenticated;

-- ── La referencia principal solo apunta a un archivo registrado de ESA recepción ───────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_ref()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.respaldo_path IS NULL THEN
    RETURN NEW;
  END IF;
  -- El trigger que fija el principal con el primer archivo registrado trabaja con este permiso.
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.respaldo_path IS NOT DISTINCT FROM OLD.respaldo_path THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NOT EXISTS (SELECT 1 FROM public.recepcion_respaldos x
                                      WHERE x.recepcion_id = NEW.id AND x.ruta = NEW.respaldo_path) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_REFERENCIA: el respaldo de una recepción debe ser un archivo ya registrado de esa recepción; crea la recepción y adjúntalo con compras_recepcion_adjuntar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_ref() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_ref ON public.recepciones;
CREATE TRIGGER trg_compras_recepcion_respaldo_ref BEFORE INSERT OR UPDATE OF respaldo_path ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_ref();

-- ── Retirar el principal en borrador: se sustituye por el siguiente o queda vacío ──────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_retiro()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.recepciones r
     SET respaldo_path = (SELECT x.ruta FROM public.recepcion_respaldos x
                           WHERE x.recepcion_id = r.id AND x.id <> OLD.id
                           ORDER BY x.created_at, x.id LIMIT 1)
   WHERE r.id = OLD.recepcion_id AND r.estado = 'borrador' AND r.respaldo_path = OLD.ruta;
  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_retiro() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_retiro ON public.recepcion_respaldos;
CREATE TRIGGER trg_compras_recepcion_respaldo_retiro AFTER DELETE ON public.recepcion_respaldos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_retiro();

-- ── El retiro y el registro de la recepción se SERIALIZAN ───────────────────────────────────────
-- La policy de DELETE comprueba «borrador» con la foto del inicio de la sentencia: si otra sesión
-- registra la recepción justo en ese instante, el borrado podía llegar a destruir evidencia de una
-- recepción ya registrada. Este trigger toma un candado FOR SHARE de la fila de la recepción: espera a
-- que termine quien la registra y vuelve a leer el estado ya confirmado.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_respaldo_retiro_estado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
BEGIN
  SELECT r.estado INTO v_estado FROM public.recepciones r WHERE r.id = OLD.recepcion_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_INMUTABLE: la recepción ya salió de borrador (%): su evidencia no se retira; añade otro archivo si falta algo.',
      COALESCE(v_estado, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_respaldo_retiro_estado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_recepcion_respaldo_retiro_estado ON public.recepcion_respaldos;
CREATE TRIGGER trg_compras_recepcion_respaldo_retiro_estado BEFORE DELETE ON public.recepcion_respaldos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_respaldo_retiro_estado();

-- ── Adjuntar: idempotente también ante sesiones SIMULTÁNEAS ─────────────────────────────────────
-- Mismo contrato y permisos que 20261022000200 (SECURITY INVOKER). Único cambio: INSERT … ON CONFLICT
-- en lugar de «leer y luego insertar», que dejaba una ventana de carrera. La existencia del objeto, los
-- metadatos y el resto de validaciones los hace el trigger de alta, también para el INSERT directo.
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

  -- Idempotente y SEGURO ANTE SESIONES SIMULTÁNEAS: si dos sesiones registran el mismo archivo a la
  -- vez, una inserta y la otra espera al índice único, no inserta nada y recibe el registro ya creado
  -- (antes la segunda fallaba con un error crudo de unicidad).
  INSERT INTO public.recepcion_respaldos (company_id, project_id, recepcion_id, ruta, nombre, tipo, mime, bytes, sha256, notas)
  VALUES (v_r.company_id, v_r.project_id, p_recepcion_id, p_ruta, left(btrim(p_nombre), 200), p_tipo, p_mime, p_bytes, lower(p_sha256), left(p_notas, 500))
  ON CONFLICT (recepcion_id, ruta) DO NOTHING
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN jsonb_build_object('respaldo', to_jsonb(v_row), 'reutilizado', false);
  END IF;

  SELECT * INTO v_row FROM public.recepcion_respaldos WHERE recepcion_id = p_recepcion_id AND ruta = p_ruta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_RECEPCION: no se pudo registrar el respaldo; vuelve a intentarlo.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.sha256 IS DISTINCT FROM lower(p_sha256) THEN
    RAISE EXCEPTION 'COMPRAS_RESPALDO_CONFLICTO: esa ruta ya tiene otro contenido registrado; sube el archivo con otro nombre.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN jsonb_build_object('respaldo', to_jsonb(v_row), 'reutilizado', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_recepcion_adjuntar(uuid, text, text, text, bigint, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_recepcion_adjuntar(uuid, text, text, text, bigint, text, text, text) TO authenticated;
