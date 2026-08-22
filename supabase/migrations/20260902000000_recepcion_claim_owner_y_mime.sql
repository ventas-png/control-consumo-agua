-- ════════════════════════════════════════════════════════════════════════════
-- Recepción — propiedad del claim de aviso y MIME estricto de la firma
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ UNA MIGRACIÓN NUEVA Y NO UNA EDICIÓN.
-- Las cinco migraciones anteriores del motor de recepción (20260828000300,
-- 20260829000600, 20260830000000, 20260831000000 y 20260901000000) YA SE
-- APLICARON al Supabase Preview. Las dos primeras se aplicaron allí con sus
-- números originales (20260828000000 y 20260829000000); se renumeraron después,
-- sin tocar su SQL, porque #779 (Renta) ocupó esos dos números en `main`.
-- Preview. Las ramas de preview sólo empujan archivos NUEVOS: editar uno
-- existente no lo vuelve a ejecutar, así que una corrección hecha ahí quedaría
-- en el repositorio y no en la base. Todo lo que sigue va aquí, y se escribe de
-- forma IDEMPOTENTE para que aplicarla dos veces no cambie el resultado.
--
-- QUÉ CIERRA
--
--   1. EL CLAIM DEL AVISO NO TENÍA DUEÑO.
--      `paquete_reclamar_aviso` marcaba `notificacion_claim_at = now()` y
--      `paquete_finalizar_aviso` liberaba la fila POR SU ID, sin comprobar
--      quién la tenía. Con eso, el lease no era exclusión mutua sino una
--      sugerencia:
--
--        · A reclama (claim_at = T).
--        · A se queda colgada contra el proveedor SMTP más allá del lease.
--        · B reclama legítimamente (claim_at = T+130) y empieza a enviar.
--        · A despierta y llama a finalizar → como sólo filtraba por id, BORRABA
--          el claim de B y, si A creía haber entregado, SELLABA notificado_at.
--          B sigue enviando sobre una pieza ya sellada y su propio finalizar
--          no encuentra nada que decir.
--
--      El lease acotaba el daño en el tiempo pero no impedía que una ejecución
--      zombi pisara a la viva. Ahora cada ejecución genera un UUID
--      IMPREDECIBLE, el claim lo guarda, y finalizar exige
--      `notificacion_claim_id = p_claim_id`: un token obsoleto obtiene false y
--      no toca el claim vigente.
--
--   2. LA FIRMA ACEPTABA CUALQUIER COSA SIN `mimetype`.
--      La comprobación era
--
--        COALESCE(o.metadata->>'mimetype', 'image/png') LIKE 'image/%'
--
--      y ese COALESCE es el fallo: un objeto SIN metadata —o con metadata que
--      no trae `mimetype`— se daba por PNG y pasaba. Como la evidencia de una
--      notificación legal es lo que sostiene la entrega ante un tercero, la
--      ausencia de dato no puede leerse como el dato favorable. Y `LIKE
--      'image/%'` admitía además `image/svg+xml`, que no es una imagen inerte:
--      es un documento con scripts, servido desde el mismo origen que la app.
--      Pasa a lista blanca explícita: image/jpeg, image/png, image/webp.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Dueño del claim ──────────────────────────────────────────────────────
ALTER TABLE public.paquetes_recibidos
  ADD COLUMN IF NOT EXISTS notificacion_claim_id uuid;

COMMENT ON COLUMN public.paquetes_recibidos.notificacion_claim_id IS
  'Token de la ejecución de notify-package que tiene el aviso reclamado. Lo genera el llamante (impredecible) y sólo esa ejecución puede finalizar el aviso: un token caducado no puede pisar al claim vigente. NULL = nadie lo tiene.';

-- Las firmas viejas se ELIMINAN, no se dejan conviviendo. Mientras exista la
-- de dos argumentos, quien la llame sigue pudiendo liberar un claim ajeno: una
-- puerta cerrada al lado de otra abierta no cierra nada.
DROP FUNCTION IF EXISTS public.paquete_reclamar_aviso(uuid, integer);
DROP FUNCTION IF EXISTS public.paquete_finalizar_aviso(uuid, boolean);

/**
 * Reclama en exclusiva el envío del aviso de una pieza.
 *
 * `p_claim_id` lo genera la ejecución que llama (crypto.randomUUID()), y tiene
 * que ser IMPREDECIBLE: es la prueba de posesión que después exige
 * `paquete_finalizar_aviso`. Un contador o el id de la pieza servirían para
 * identificar, pero no para acreditar.
 *
 * @returns true  → el claim es tuyo, enviá.
 *          false → ya se notificó, o hay otra ejecución dentro de su lease.
 */
CREATE OR REPLACE FUNCTION public.paquete_reclamar_aviso(
  p_pieza_id       uuid,
  p_claim_id       uuid,
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
       SET notificacion_claim_at = now(),
           notificacion_claim_id = p_claim_id
     WHERE id = p_pieza_id
       AND notificado_at IS NULL
       AND p_claim_id IS NOT NULL
       AND (notificacion_claim_at IS NULL
            OR notificacion_claim_at < now() - make_interval(secs => GREATEST(p_lease_segundos, 1)))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ganado)
$$;

COMMENT ON FUNCTION public.paquete_reclamar_aviso(uuid, uuid, integer) IS
  'Reclama en exclusiva el envío del aviso de una pieza y guarda el token de quien lo reclamó. true = te toca enviar; false = ya se notificó o hay otra ejecución dentro del lease.';

/**
 * Cierra el ciclo del aviso — SÓLO si el claim sigue siendo tuyo.
 *
 * `p_entregado` dice si ALGÚN canal entregó:
 *   · true  → sella notificado_at (la pieza no se vuelve a avisar).
 *   · false → sólo libera el claim, para que un reintento explícito pueda
 *             volver a intentarlo. No se sella nada: convertir un fallo
 *             transitorio en "ya notificado" pierde el aviso para siempre.
 *
 * @returns true  → eras el dueño y la fila quedó actualizada.
 *          false → el claim ya no es tuyo (caducó y lo tomó otra ejecución) o
 *                  la fila desapareció. En ninguno de los dos casos se toca
 *                  nada: el llamante NO debe dar por hecho que la marca quedó
 *                  puesta, y la ejecución vigente sigue siendo la dueña.
 */
CREATE OR REPLACE FUNCTION public.paquete_finalizar_aviso(
  p_pieza_id  uuid,
  p_claim_id  uuid,
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
           notificacion_claim_at = NULL,
           notificacion_claim_id = NULL
     WHERE id = p_pieza_id
       AND p_claim_id IS NOT NULL
       -- La cláusula que lo cambia todo: sin ella, una ejecución zombi liberaba
       -- el claim de la que sí estaba enviando.
       AND notificacion_claim_id = p_claim_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM hecho)
$$;

COMMENT ON FUNCTION public.paquete_finalizar_aviso(uuid, uuid, boolean) IS
  'Sella o libera el aviso de una pieza, exigiendo que el claim siga siendo del llamante. false = perdiste el claim (o la fila no está) y no se modificó nada.';

-- Sólo las edge functions (service_role) reclaman y liberan: el navegador pide
-- el aviso a través de notify-package, que es quien decide.
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.paquete_reclamar_aviso(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.paquete_reclamar_aviso(uuid, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.paquete_finalizar_aviso(uuid, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.paquete_finalizar_aviso(uuid, uuid, boolean) TO service_role;

-- El barrido de claims caducados mira las dos columnas juntas.
DROP INDEX IF EXISTS public.idx_paquetes_claim_pendiente;
CREATE INDEX IF NOT EXISTS idx_paquetes_claim_pendiente
  ON public.paquetes_recibidos (notificacion_claim_at, notificacion_claim_id)
  WHERE notificado_at IS NULL AND notificacion_claim_at IS NOT NULL;

-- ── 2) MIME estricto de la firma ────────────────────────────────────────────
-- Se reemplaza la función ENTERA (misma firma) porque no hay forma de parchear
-- una condición dentro de un cuerpo PL/pgSQL. Lo único que cambia respecto de
-- 20260901000000 es el predicado del `mimetype`; el resto se transcribe igual
-- para que este archivo declare por sí solo el estado final.
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
  v_pieza  public.paquetes_recibidos%ROWTYPE;
  v_row    public.paquetes_recibidos%ROWTYPE;
  v_nombre text := NULLIF(btrim(p_nombre), '');
  v_firma  text := NULLIF(btrim(p_firma_path), '');
  v_partes text[];
BEGIN
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Falta el nombre de quien recibe: el acuse no vale sin él'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La entrega por portería es presencial. Aceptar otra vía por parámetro
  -- dejaría cerrar una notificación legal declarando un canal que nadie
  -- verificó, y el guard de inmutabilidad la sella justo después.
  IF p_via IS DISTINCT FROM 'porteria' THEN
    RAISE EXCEPTION 'La vía del acuse sólo puede ser presencial (porteria)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_pieza
    FROM public.paquetes_recibidos
   WHERE id = p_pieza_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_pieza.clase IS DISTINCT FROM 'correspondencia' THEN
    RAISE EXCEPTION 'Esta RPC sólo entrega correspondencia'
      USING ERRCODE = 'check_violation';
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
        -- LISTA BLANCA, sin COALESCE. Un objeto sin `metadata`, o con metadata
        -- que no trae `mimetype`, produce NULL aquí y el EXISTS no lo devuelve:
        -- la ausencia de dato NO se lee como el dato favorable. La extensión del
        -- archivo tampoco basta — la elige quien sube. Fuera queda además
        -- `image/svg+xml`, que no es una imagen inerte sino un documento con
        -- scripts servido desde el origen de la app.
        AND o.metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
    ) THEN
      RAISE EXCEPTION 'La firma no existe en el bucket de evidencias, no la subiste tú, o no es una imagen jpeg/png/webp'
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
  'Única transición pendiente→atendido de una correspondencia (la impone correspondencia_acuse_guard). Valida clase, estado, empresa/proyecto, permiso, nombre y —si viene— que la firma sea un objeto real del bucket de evidencias, en la ruta de ESTA pieza, subido por quien firma y con mimetype en la lista blanca image/jpeg|png|webp. La vía siempre es presencial.';

REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) TO authenticated;

-- El bucket declara la misma lista blanca. No sustituye a la comprobación de la
-- RPC —`allowed_mime_types` lo aplica la API de Storage, y la RPC valida lo que
-- de verdad quedó en la tabla— pero rechaza el archivo antes de subirlo.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'recepcion-evidencias';
