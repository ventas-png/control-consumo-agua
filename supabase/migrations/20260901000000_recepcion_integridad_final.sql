-- ════════════════════════════════════════════════════════════════════════════
-- Recepción: integridad final del motor (FK, acuse cerrado, avisos con RBAC)
-- ════════════════════════════════════════════════════════════════════════════
-- Cierra cinco hallazgos de la tercera revisión de #776. Cuatro son agujeros
-- reales; uno es una contradicción que rompe una operación cotidiana.
--
-- POR QUÉ ES UNA MIGRACIÓN NUEVA Y POR QUÉ RE-DECLARA COSAS YA ESCRITAS.
-- El preview branch de Supabase tiene aplicadas las versiones ANTERIORES de
-- 20260829000000 y 20260831000000: el bot solo empuja archivos nuevos, así que
-- editar aquellos no cambiaría nada allí. Este archivo declara el ESTADO FINAL
-- —policies incluidas— y es idempotente: sirve igual sobre un preview a medio
-- camino que sobre una producción que aún no ha visto ninguna de las cuatro.
--
-- ── 1 · El FK decía SET NULL y dos CHECK lo prohibían ───────────────────────
-- `paquetes_recibidos_unidad_id_fkey` era ON DELETE SET NULL, pero
-- `paquetes_unidad_por_clase_chk` exige unidad_id NOT NULL para clase='paquete'
-- y `paquetes_destinatario_unidad_chk` lo exige para destinatario_tipo='unidad'.
-- Borrar una unidad con historial no dejaba huérfana la fila: abortaba con un
-- 23514 incomprensible, y la administradora se quedaba sin poder retirar la
-- unidad ni entender por qué.
--
-- La contradicción se resuelve en favor del historial, no de los CHECK: pasa a
-- **RESTRICT**. La unidad con recepción registrada NO se borra — se DESACTIVA
-- (`unidades.activo = false`), que es la operación que el módulo ya tiene y la
-- única que conserva la constancia de entrega. El error pasa a ser un 23503,
-- que la UI traduce a "esta unidad tiene historial: desactívala".
--
-- ── 2 · La RPC del acuse no era la única puerta ─────────────────────────────
-- `paquetes_recibidos_update` deja al cliente hacer UPDATE de cualquier
-- columna, así que un `estado='atendido'` con nombre y hora inventados pasaba
-- por encima de `correspondencia_registrar_acuse()` y de todas sus
-- validaciones. Y una pieza ya entregada se podía reabrir o reescribir.
--
-- Lo cierra un trigger, no un GUC. La diferencia importa: un `set_config` es un
-- dato que el llamante controla, y PostgREST ejecuta lo que le pidan en la
-- misma sesión. Lo que el cliente NO puede falsificar es su ROL: PostgREST
-- hace `SET LOCAL ROLE authenticated` a partir del JWT y no hay forma de salir
-- de ahí; sólo una función SECURITY DEFINER cuyo dueño es privilegiado cambia
-- `current_user`. El trigger mira eso — y por eso es SECURITY INVOKER, porque
-- un trigger DEFINER vería siempre a su propio dueño.
--
-- ── 3 · La firma no se verificaba ───────────────────────────────────────────
-- `p_firma_path` era un texto libre: cualquier ruta valía, incluida la firma de
-- otra pieza, de otro proyecto o subida por otro. Ahora la RPC comprueba contra
-- `storage.objects` que el objeto existe, está en el bucket de evidencias, su
-- ruta es exactamente proyecto/pieza/archivo con los ids de ESTA pieza, lo subió
-- quien está registrando el acuse, y es una imagen.
--
-- ── 4 · notify-package solo miraba la empresa ───────────────────────────────
-- (Se corrige en la edge function; aquí van las piezas de base que necesita.)
--
-- ── 5 · La carrera de notificado_at ─────────────────────────────────────────
-- Dos invocaciones simultáneas leían `notificado_at IS NULL` a la vez y ambas
-- enviaban. Se añade un CLAIM con lease: un UPDATE condicional que solo una
-- transacción puede ganar, con caducidad para que una ejecución muerta no deje
-- la pieza bloqueada para siempre.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) El historial manda: la unidad con recepción no se borra ──────────────
ALTER TABLE public.paquetes_recibidos
  DROP CONSTRAINT IF EXISTS paquetes_recibidos_unidad_id_fkey;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_recibidos_unidad_id_fkey
  FOREIGN KEY (unidad_id) REFERENCES public.unidades(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT paquetes_recibidos_unidad_id_fkey ON public.paquetes_recibidos IS
  'RESTRICT, no SET NULL: los CHECK de clase y destinatario exigen unidad_id, así que anularlo abortaba el borrado con un 23514 ilegible. Una unidad con historial de recepción se DESACTIVA (unidades.activo=false), no se borra.';

-- Los dos CHECK que hacían imposible el SET NULL se quedan EXACTAMENTE como
-- están: relajarlos permitiría crear paquetes sin unidad, que es peor problema
-- que el que veníamos a resolver. Se re-declaran aquí sólo para que un despliegue
-- limpio y el preview converjan al mismo estado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_unidad_por_clase_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_unidad_por_clase_chk
      CHECK (clase <> 'paquete' OR unidad_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_destinatario_unidad_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_destinatario_unidad_chk
      CHECK (destinatario_tipo <> 'unidad' OR unidad_id IS NOT NULL);
  END IF;
END $$;

-- Estado final del vocabulario de estados (20260829000000 + 20260830000000).
ALTER TABLE public.paquetes_recibidos DROP CONSTRAINT IF EXISTS paquetes_estado_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_estado_chk CHECK (
    CASE clase
      WHEN 'paquete'        THEN estado IN ('pendiente','entregado','devuelto')
      WHEN 'correspondencia' THEN estado IN ('pendiente','atendido','archivado','devuelto')
      ELSE false
    END
  ) NOT VALID;

-- ── 2) Policies de la tabla: estado final ───────────────────────────────────
-- Idénticas a la versión corregida de 20260829000000. Se re-emiten porque el
-- preview conserva la anterior, en la que el DELETE se resolvía con
-- `user_has_permission` — un helper que dice true a cualquier clave para
-- super_admin/company_owner/admin (20260518000008) y que, colocado detrás de un
-- filtro de rol, no filtra nada.
DROP POLICY IF EXISTS paquetes_recibidos_select ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_select ON public.paquetes_recibidos
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

DROP POLICY IF EXISTS paquetes_recibidos_insert ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_insert ON public.paquetes_recibidos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  );

DROP POLICY IF EXISTS paquetes_recibidos_update ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_update ON public.paquetes_recibidos
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission(
        CASE clase WHEN 'correspondencia'
          THEN 'condominios.tab.correspondencia'
          ELSE 'condominios.tab.paqueteria' END)
    )
  );

DROP POLICY IF EXISTS paquetes_recibidos_delete ON public.paquetes_recibidos;
CREATE POLICY paquetes_recibidos_delete ON public.paquetes_recibidos
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND CASE clase
            WHEN 'correspondencia' THEN public.current_user_role() = 'company_owner'
            ELSE public.current_user_role() = ANY(ARRAY['company_owner','admin'])
          END
    )
  );

-- ── 3) Quién está hablando: el rol, que no se puede falsificar ──────────────
CREATE OR REPLACE FUNCTION public.recepcion_llamada_de_cliente()
RETURNS boolean
LANGUAGE sql STABLE                                   -- NO SECURITY DEFINER: ver cabecera
AS $$
  SELECT current_user IN ('authenticated', 'anon')
$$;

COMMENT ON FUNCTION public.recepcion_llamada_de_cliente() IS
  'true si la sentencia la ejecuta el rol del navegador. PostgREST fija ese rol desde el JWT y no hay forma de salir de él; solo una SECURITY DEFINER de dueño privilegiado cambia current_user. Es infalsificable desde el cliente, a diferencia de un GUC.';

REVOKE ALL ON FUNCTION public.recepcion_llamada_de_cliente() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_llamada_de_cliente() FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_llamada_de_cliente() TO authenticated;

-- ── 4) El acuse: una sola puerta, y una vez ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.correspondencia_acuse_guard()
RETURNS trigger
LANGUAGE plpgsql                                      -- SECURITY INVOKER a propósito
SET search_path = public
AS $$
BEGIN
  -- Paquetería no pasa por aquí: su flujo (marcar entregado, firmar desde el
  -- portal) es otro y no se toca.
  IF COALESCE(NEW.clase, OLD.clase) <> 'correspondencia' THEN
    RETURN NEW;
  END IF;

  -- (a) Entregada es entregada. El acuse es la prueba de un acto: ni se
  --     reabre, ni se le cambia el nombre, la firma, el actor o la hora.
  --     Aplica a TODOS, RPC incluida — la RPC solo actúa sobre 'pendiente'.
  IF OLD.estado = 'atendido' THEN
    IF NEW.estado             IS DISTINCT FROM OLD.estado
       OR NEW.entregado_a_nombre IS DISTINCT FROM OLD.entregado_a_nombre
       OR NEW.entregado_por      IS DISTINCT FROM OLD.entregado_por
       OR NEW.entregado_via      IS DISTINCT FROM OLD.entregado_via
       OR NEW.hora_entrega       IS DISTINCT FROM OLD.hora_entrega
       OR NEW.firma_path         IS DISTINCT FROM OLD.firma_path
    THEN
      RAISE EXCEPTION
        'El acuse de una correspondencia entregada es inmutable: ni se reabre ni se reescribe'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- (b) Cerrar la custodia solo por la RPC. Un UPDATE directo, por completo que
  --     venga, no ha validado la firma, ni el permiso, ni la concurrencia.
  IF NEW.estado = 'atendido' AND public.recepcion_llamada_de_cliente() THEN
    RAISE EXCEPTION
      'La entrega se registra con correspondencia_registrar_acuse(); un UPDATE directo no deja acuse verificable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) Y los dos campos exclusivos del acuse tampoco se rellenan a mano
  --     mientras la pieza sigue abierta. `hora_entrega`, `entregado_por` y
  --     `entregado_via` NO entran aquí: la devolución al remitente también los
  --     sella, y ese flujo sigue siendo un UPDATE normal.
  IF public.recepcion_llamada_de_cliente() AND (
       NEW.entregado_a_nombre IS DISTINCT FROM OLD.entregado_a_nombre
       OR NEW.firma_path      IS DISTINCT FROM OLD.firma_path
     ) THEN
    RAISE EXCEPTION
      'El nombre de quien recibe y la firma solo los escribe correspondencia_registrar_acuse()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.correspondencia_acuse_guard() IS
  'Hace de correspondencia_registrar_acuse() la ÚNICA transición pendiente→atendido, y sella el acuse una vez cerrado. No usa GUC: distingue al cliente por su ROL, que PostgREST fija desde el JWT.';

DROP TRIGGER IF EXISTS correspondencia_acuse_guard_trg ON public.paquetes_recibidos;
CREATE TRIGGER correspondencia_acuse_guard_trg
  BEFORE UPDATE ON public.paquetes_recibidos
  FOR EACH ROW EXECUTE FUNCTION public.correspondencia_acuse_guard();

-- ── 5) Evidencias: bucket, helpers y policies (estado final) ────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recepcion-evidencias', 'recepcion-evidencias', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.recepcion_pieza_existe(p_pieza text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.paquetes_recibidos p WHERE p.id::text = p_pieza)
$$;

CREATE OR REPLACE FUNCTION public.recepcion_pieza_es_ajena(p_pieza text, p_project text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.paquetes_recibidos p
    WHERE p.id::text = p_pieza
      AND (p.company_id IS DISTINCT FROM public.get_my_company_id()
           OR p.project_id::text IS DISTINCT FROM p_project)
  )
$$;

/**
 * ¿Este objeto ya es prueba de algo?
 *
 * Una evidencia queda protegida en cuanto una pieza la referencia — como firma
 * de acuse o como foto. Mientras nadie la referencia es un descarte: la foto de
 * un formulario que se abandonó, o la firma de un acuse cuya RPC falló después
 * de la subida. Esas SÍ las puede retirar quien las subió, y conviene que pueda:
 * si no, cada intento fallido dejaría un huérfano imborrable en el bucket.
 */
CREATE OR REPLACE FUNCTION public.recepcion_evidencia_referenciada(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.paquetes_recibidos p
    WHERE p.firma_path = p_name
       OR p_name = ANY(COALESCE(p.fotos, ARRAY[]::text[]))
  )
$$;

REVOKE ALL ON FUNCTION public.recepcion_pieza_existe(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_pieza_existe(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_pieza_existe(text) TO authenticated;

REVOKE ALL ON FUNCTION public.recepcion_pieza_es_ajena(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_pieza_es_ajena(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_pieza_es_ajena(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.recepcion_evidencia_referenciada(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_evidencia_referenciada(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_evidencia_referenciada(text) TO authenticated;

DROP POLICY IF EXISTS "recepcion_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_update" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_delete" ON storage.objects;

CREATE POLICY "recepcion_evidencias_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      -- Lo que subí y aún no cuelga de ninguna pieza es mío: sin esta rama no
      -- se podría ni ver la miniatura recién adjuntada al formulario.
      OR (
        owner = (SELECT auth.uid())
        AND NOT public.recepcion_evidencia_referenciada(name)
        AND public.user_has_permission('condominios.tab.correspondencia')
      )
      OR EXISTS (
        SELECT 1
        FROM public.paquetes_recibidos p
        WHERE p.id::text = (storage.foldername(name))[2]
          AND (
            (
              p.company_id = public.get_my_company_id()
              AND public.can_access_project(p.project_id)
              AND public.user_has_permission(
                    CASE p.clase
                      WHEN 'correspondencia' THEN 'condominios.tab.correspondencia'
                      ELSE 'condominios.tab.paqueteria'
                    END)
            )
            OR (
              p.destinatario_tipo = 'unidad'
              AND p.unidad_id IS NOT NULL
              AND p.unidad_id IN (SELECT public.mis_unidades_ids())
            )
          )
      )
    )
  );

CREATE POLICY "recepcion_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      OR (
        array_length(storage.foldername(name), 1) = 2
        AND (storage.foldername(name))[2] <> ''
        AND public.user_has_permission('condominios.tab.correspondencia')
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id::text = (storage.foldername(name))[1]
            AND pr.company_id = public.get_my_company_id()
            AND public.can_access_project(pr.id)
        )
        AND NOT public.recepcion_pieza_es_ajena(
              (storage.foldername(name))[2], (storage.foldername(name))[1])
      )
    )
  );

-- UPDATE — deliberadamente SIN policy. Sustituir el archivo de una firma es
-- falsificar la prueba, y no hay flujo que lo necesite: se sube con
-- upsert:false y se corrige borrando el huérfano y volviendo a subir.

CREATE POLICY "recepcion_evidencias_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      -- Huérfano propio: descarte de un formulario, o firma cuya RPC falló
      -- después de subirla. En cuanto una pieza la referencia, deja de serlo.
      OR (
        owner = (SELECT auth.uid())
        AND NOT public.recepcion_evidencia_referenciada(name)
        AND public.user_has_permission('condominios.tab.correspondencia')
      )
      OR EXISTS (
        SELECT 1
        FROM public.paquetes_recibidos p
        WHERE p.id::text = (storage.foldername(name))[2]
          AND p.company_id = public.get_my_company_id()
          AND public.can_access_project(p.project_id)
          AND CASE p.clase
                WHEN 'correspondencia' THEN public.current_user_role() = 'company_owner'
                ELSE public.current_user_role() = ANY(ARRAY['company_owner','admin'])
              END
      )
    )
  );

-- ── 6) Constraint del acuse (estado final, con backfill idempotente) ────────
UPDATE public.paquetes_recibidos
   SET entregado_a_nombre = COALESCE(
         NULLIF(btrim(entregado_a_nombre), ''),
         'No registrado (acuse anterior a 2026-08-31)'),
       hora_entrega = COALESCE(hora_entrega, hora_recepcion)
 WHERE clase = 'correspondencia'
   AND estado = 'atendido'
   AND (entregado_a_nombre IS NULL OR btrim(entregado_a_nombre) = '' OR hora_entrega IS NULL);

ALTER TABLE public.paquetes_recibidos
  DROP CONSTRAINT IF EXISTS paquetes_correspondencia_acuse_chk;
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_correspondencia_acuse_chk CHECK (
    clase <> 'correspondencia'
    OR estado <> 'atendido'
    OR (entregado_a_nombre IS NOT NULL
        AND btrim(entregado_a_nombre) <> ''
        AND hora_entrega IS NOT NULL)
  );

-- ── 7) La RPC del acuse, con la firma verificada ────────────────────────────
CREATE OR REPLACE FUNCTION public.correspondencia_registrar_acuse(
  p_pieza_id   uuid,
  p_nombre     text,
  p_firma_path text DEFAULT NULL,
  p_via        text DEFAULT 'porteria'
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pieza  public.paquetes_recibidos;
  v_row    public.paquetes_recibidos;
  v_nombre text := btrim(COALESCE(p_nombre, ''));
  v_firma  text := NULLIF(btrim(COALESCE(p_firma_path, '')), '');
  v_partes text[];
BEGIN
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'El nombre de quien recibe es obligatorio'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La correspondencia NO se entrega desde el portal: se retira en
  -- administración, con identificación de por medio. El parámetro se conserva
  -- por compatibilidad de firma, pero la única vía válida es la presencial.
  IF p_via IS DISTINCT FROM 'porteria' THEN
    RAISE EXCEPTION 'La correspondencia solo se entrega presencialmente (via=porteria), no por %', p_via
      USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE: dos operadores pulsando "Entregar" a la vez se serializan aquí.
  -- El segundo encuentra la pieza en 'atendido' y sale por el estado, no por una
  -- carrera. SECURITY DEFINER ⇒ este SELECT no pasa por la RLS, así que la
  -- autorización se comprueba a mano justo debajo.
  SELECT * INTO v_pieza FROM public.paquetes_recibidos WHERE id = p_pieza_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe';
  END IF;
  IF v_pieza.clase <> 'correspondencia' THEN
    RAISE EXCEPTION 'Esta pieza no es correspondencia';
  END IF;
  IF v_pieza.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La pieza ya no está pendiente (estado: %)', v_pieza.estado;
  END IF;

  IF NOT public.is_super_admin() THEN
    IF v_pieza.company_id IS DISTINCT FROM public.get_my_company_id()
       OR NOT public.can_access_project(v_pieza.project_id)
       OR NOT public.user_has_permission('condominios.tab.correspondencia') THEN
      RAISE EXCEPTION 'No autorizado para entregar esta correspondencia';
    END IF;
  END IF;

  -- ── La firma, si viene, tiene que ser LA firma ──
  -- Antes era texto libre: valía la ruta de otra pieza, de otro proyecto o de
  -- un objeto que nunca existió, y quedaba guardada como prueba de entrega.
  IF v_firma IS NOT NULL THEN
    v_partes := string_to_array(v_firma, '/');
    IF array_length(v_partes, 1) IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION 'Ruta de firma inválida: se espera proyecto/pieza/archivo'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_partes[1] IS DISTINCT FROM v_pieza.project_id::text
       OR v_partes[2] IS DISTINCT FROM p_pieza_id::text THEN
      RAISE EXCEPTION 'La firma no pertenece a esta pieza ni a su proyecto'
        USING ERRCODE = 'check_violation';
    END IF;
    IF lower(v_partes[3]) !~ '\.(png|jpg|jpeg|webp)$' THEN
      RAISE EXCEPTION 'La firma tiene que ser una imagen (png, jpg o webp)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'recepcion-evidencias'
        AND o.name = v_firma
        -- La subió quien está firmando el acuse: si no, cualquiera podría
        -- adjuntar el objeto de otro como prueba de su propia entrega.
        AND o.owner = auth.uid()
        AND COALESCE(o.metadata->>'mimetype', 'image/png') LIKE 'image/%'
    ) THEN
      RAISE EXCEPTION 'La firma no existe en el bucket de evidencias, no la subiste tú, o no es una imagen'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.paquetes_recibidos
     SET estado             = 'atendido',
         entregado_a_nombre = v_nombre,
         entregado_por      = auth.uid(),
         entregado_via      = 'porteria',
         hora_entrega       = now(),
         firma_path         = COALESCE(v_firma, firma_path)
   WHERE id = p_pieza_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) IS
  'Única transición pendiente→atendido de una correspondencia (la impone correspondencia_acuse_guard). Valida clase, estado, empresa/proyecto, permiso, nombre y —si viene— que la firma sea un objeto real del bucket de evidencias, en la ruta de ESTA pieza y subido por quien firma. La vía siempre es presencial.';

REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) TO authenticated;

-- ── 8) Aviso al residente: claim con lease ──────────────────────────────────
-- El patrón anterior era `if (!notificado_at) { enviar; set notificado_at }`.
-- Entre la lectura y la escritura caben dos invocaciones enteras, y el
-- residente recibía el mismo correo dos veces. Aquí sólo una transacción puede
-- reclamar la pieza; el lease evita que una ejecución que murió a mitad la deje
-- bloqueada para siempre.
ALTER TABLE public.paquetes_recibidos
  ADD COLUMN IF NOT EXISTS notificacion_claim_at timestamptz;

COMMENT ON COLUMN public.paquetes_recibidos.notificacion_claim_at IS
  'Instante en que una ejecución de notify-package reclamó el envío. Se libera al terminar; si la ejecución muere, caduca por lease y otra puede reintentar.';

CREATE OR REPLACE FUNCTION public.paquete_reclamar_aviso(
  p_pieza_id       uuid,
  p_lease_segundos integer DEFAULT 120
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- El UPDATE toma el row lock: dos llamadas simultáneas se serializan y la
  -- segunda re-evalúa el WHERE contra la fila ya reclamada, así que no casa.
  WITH ganado AS (
    UPDATE public.paquetes_recibidos
       SET notificacion_claim_at = now()
     WHERE id = p_pieza_id
       AND notificado_at IS NULL
       AND (notificacion_claim_at IS NULL
            OR notificacion_claim_at < now() - make_interval(secs => GREATEST(p_lease_segundos, 1)))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ganado)
$$;

COMMENT ON FUNCTION public.paquete_reclamar_aviso(uuid, integer) IS
  'Reclama en exclusiva el envío del aviso de una pieza. true = te toca enviar; false = ya se notificó o hay otra ejecución dentro del lease.';

/**
 * Cierra el ciclo del aviso. `p_entregado` dice si ALGÚN canal entregó:
 *   · true  → sella notificado_at (la pieza no se vuelve a avisar).
 *   · false → solo libera el claim, para que un reintento explícito pueda
 *             volver a intentarlo. No se sella nada: convertir un fallo
 *             transitorio en "ya notificado" pierde el aviso para siempre.
 * Devuelve false si la fila desapareció, para que el llamante no dé por hecho
 * que la marca quedó puesta.
 */
CREATE OR REPLACE FUNCTION public.paquete_finalizar_aviso(
  p_pieza_id  uuid,
  p_entregado boolean
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hecho AS (
    UPDATE public.paquetes_recibidos
       SET notificado_at = CASE WHEN p_entregado THEN COALESCE(notificado_at, now())
                                ELSE notificado_at END,
           notificacion_claim_at = NULL
     WHERE id = p_pieza_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM hecho)
$$;

-- Solo las edge functions (service_role) reclaman y liberan: el navegador pide
-- el aviso a través de notify-package, que es quien decide.
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.paquete_reclamar_aviso(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.paquete_finalizar_aviso(uuid, boolean) TO service_role;

-- Índice para el barrido de claims caducados (soporte/diagnóstico).
CREATE INDEX IF NOT EXISTS idx_paquetes_claim_pendiente
  ON public.paquetes_recibidos (notificacion_claim_at)
  WHERE notificado_at IS NULL AND notificacion_claim_at IS NOT NULL;
