-- ════════════════════════════════════════════════════════════════════════════
-- Evidencias de recepción en bucket propio + acuse de entrega atómico
-- ════════════════════════════════════════════════════════════════════════════
-- Dos hallazgos de la revisión del motor único (PR #776), ambos sobre lo mismo:
-- la prueba de entrega de una notificación legal se estaba guardando con las
-- garantías de una foto de amenidad.
--
-- ── HALLAZGO 1 · las evidencias vivían en `condominios-media` ───────────────
-- Las fotos del sobre y la FIRMA del acuse se subían a `condominios-media`,
-- cuyas cuatro policies (20260603220000, repuntadas en 20260822020000)
-- autorizan por PROYECTO y nada más:
--
--     (storage.foldername(name))[1] in (select x::text from mis_proyectos_ids() x)
--
-- Para SELECT, INSERT, UPDATE y DELETE. Es decir: cualquier residente del
-- proyecto podía LISTAR, LEER, SUSTITUIR y BORRAR la firma de acuse de la
-- citación judicial de su vecino — y la de la correspondencia dirigida a la
-- administración. No hay grado de aislamiento que rescate ese bucket sin
-- romper los otros doce flujos que lo usan, así que las evidencias de
-- recepción se mudan a un bucket PRIVADO propio con su propio modelo:
--
--   Ruta:  <project_id>/<pieza_id>/<archivo>
--
--   SELECT  · personal: misma empresa + proyecto accesible + PERMISO DE LA
--             CLASE de la pieza (correspondencia ≠ paquetería).
--           · residente: SOLO piezas dirigidas a UNA DE SUS unidades. La
--             correspondencia a la administración (unidad_id NULL,
--             destinatario_tipo='administracion') no la ve NINGÚN residente.
--   INSERT  · solo personal con el permiso, y solo dentro de un proyecto de su
--             empresa. Un residente no sube evidencias: recibir es un acto de
--             recepción.
--   UPDATE  · NADIE. No hay policy, a propósito: sustituir el archivo de una
--             firma es falsificar una prueba. Se sube con upsert:false.
--   DELETE  · mientras la pieza NO existe (fotos de un formulario a medio
--             llenar) puede retirarlas QUIEN LAS SUBIÓ. En cuanto la pieza
--             existe, la evidencia es prueba: la borra quien podría borrar la
--             pieza — correspondencia solo company_owner, paquetería también
--             admin (mismo reparto que paquetes_recibidos_delete).
--
-- Por qué las funciones auxiliares son SECURITY DEFINER: dentro de una policy,
-- un `EXISTS (SELECT … FROM paquetes_recibidos)` se evalúa CON la RLS de esa
-- tabla, así que una pieza ajena "no existe" y la comprobación de estorbo
-- (¿este id ya es de otra empresa?) daría siempre permisiva. Las dos funciones
-- de abajo miran la tabla sin RLS para responder eso, y solo eso: devuelven
-- booleanos, nunca filas.
--
-- ── HALLAZGO 2 · el acuse aceptaba quedar vacío ─────────────────────────────
-- "Atender" hacía `UPDATE … SET estado='atendido'` sin `entregado_a_nombre`, y
-- la entrega firmada aceptaba el nombre en blanco. El PR entero existe para
-- responder "quién entregó, cuándo y a quién": sin nombre, la respuesta es
-- "nadie sabe". Aquí se cierra en la base, no en la pantalla:
--
--   · `correspondencia_registrar_acuse()` — transición atómica que valida
--     clase, estado anterior, empresa/proyecto, permiso, nombre y hora, y
--     sella el empleado. La firma es opcional; el NOMBRE no.
--   · `paquetes_correspondencia_acuse_chk` — una correspondencia no puede
--     quedar en 'atendido' sin nombre de quien recibió ni hora de entrega,
--     venga el UPDATE de donde venga.
--
-- La constraint se añade VALIDADA tras rellenar las filas históricas: son las
-- que migró 20260829000000 desde `correspondencia_condominio`, donde "atender"
-- nunca guardó un acuse. Se marcan como lo que son —un acuse anterior a este
-- cambio— en vez de inventarles un receptor.
--
-- MIGRACIÓN NUEVA, NO EDICIÓN. 20260829000000 ya está aplicada en el preview
-- branch y el bot solo empuja archivos nuevos; además 20260822020000 es
-- historia fusionada y no se toca.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Bucket privado dedicado ──────────────────────────────────────────────
-- 10 MiB e imágenes: fotos del sobre y PNG de firma. Nada de PDFs ni binarios.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recepcion-evidencias', 'recepcion-evidencias', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2) Helpers sin RLS para las policies de storage ─────────────────────────
-- Devuelven booleanos sobre la EXISTENCIA y la PERTENENCIA de la pieza, que es
-- justo lo que la RLS de paquetes_recibidos no puede contestar desde dentro de
-- una policy (ver cabecera).

CREATE OR REPLACE FUNCTION public.recepcion_pieza_existe(p_pieza text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.paquetes_recibidos p WHERE p.id::text = p_pieza
  )
$$;

COMMENT ON FUNCTION public.recepcion_pieza_existe(text) IS
  'true si existe una pieza de recepción con ese id (sin RLS). Para distinguir en las policies de storage una evidencia en borrador de una ya ligada a una pieza.';

CREATE OR REPLACE FUNCTION public.recepcion_pieza_es_ajena(p_pieza text, p_project text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.paquetes_recibidos p
    WHERE p.id::text = p_pieza
      AND (
        p.company_id IS DISTINCT FROM public.get_my_company_id()
        OR p.project_id::text IS DISTINCT FROM p_project
      )
  )
$$;

COMMENT ON FUNCTION public.recepcion_pieza_es_ajena(text, text) IS
  'true si la pieza existe y NO pertenece a la empresa del usuario o a ese proyecto (sin RLS). Impide colgar evidencias del id de una pieza de otro tenant.';

REVOKE ALL ON FUNCTION public.recepcion_pieza_existe(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_pieza_existe(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_pieza_existe(text) TO authenticated;

REVOKE ALL ON FUNCTION public.recepcion_pieza_es_ajena(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recepcion_pieza_es_ajena(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.recepcion_pieza_es_ajena(text, text) TO authenticated;

-- ── 3) Policies del bucket ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "recepcion_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_update" ON storage.objects;
DROP POLICY IF EXISTS "recepcion_evidencias_delete" ON storage.objects;

-- SELECT — dos ramas, ninguna por proyecto a secas.
--
-- El EXISTS corre CON la RLS de paquetes_recibidos, así que ya filtra por
-- empresa/clase/unidad; las condiciones de dentro son la MISMA regla escrita
-- explícitamente. Es redundancia a propósito: si alguien afloja aquella
-- policy, esta sigue diciendo quién puede ver una prueba de entrega.
CREATE POLICY "recepcion_evidencias_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      -- Borrador propio: lo que acabo de subir y todavía no cuelga de ninguna
      -- pieza. Sin esta rama el operador no podría ni ver la miniatura de la
      -- foto que acaba de adjuntar al formulario (la vista previa firma la URL,
      -- y firmar exige poder leer el objeto).
      OR (
        owner = (SELECT auth.uid())
        AND NOT public.recepcion_pieza_existe((storage.foldername(name))[2])
        AND public.user_has_permission('condominios.tab.correspondencia')
      )
      OR EXISTS (
        SELECT 1
        FROM public.paquetes_recibidos p
        WHERE p.id::text = (storage.foldername(name))[2]
          AND (
            -- Personal: empresa + proyecto + permiso DE LA CLASE de la pieza.
            (
              p.company_id = public.get_my_company_id()
              AND public.can_access_project(p.project_id)
              AND public.user_has_permission(
                    CASE p.clase
                      WHEN 'correspondencia' THEN 'condominios.tab.correspondencia'
                      ELSE 'condominios.tab.paqueteria'
                    END)
            )
            -- Residente: solo lo dirigido a UNA DE SUS unidades. Lo que va a
            -- la administración no tiene unidad y aquí no entra.
            OR (
              p.destinatario_tipo = 'unidad'
              AND p.unidad_id IS NOT NULL
              AND p.unidad_id IN (SELECT public.mis_unidades_ids())
            )
          )
      )
    )
  );

-- INSERT — la pieza puede no existir todavía (las fotos se suben mientras se
-- llena el formulario), así que se ancla al PROYECTO; y si el id de pieza ya
-- está tomado por otro tenant, se rechaza.
CREATE POLICY "recepcion_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      OR (
        -- Ruta exacta <project>/<pieza>/<archivo>: sin las tres partes no hay
        -- forma de decidir quién puede leer el objeto después.
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
-- upsert:false y se corrige borrando (ver abajo) y volviendo a subir.

-- DELETE — borrador propio mientras la pieza no existe; después, solo quien
-- puede borrar la pieza misma.
CREATE POLICY "recepcion_evidencias_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recepcion-evidencias'
    AND (
      public.is_super_admin()
      OR (
        owner = (SELECT auth.uid())
        AND NOT public.recepcion_pieza_existe((storage.foldername(name))[2])
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

-- ── 4) Acuse: las filas históricas primero ──────────────────────────────────
-- Correspondencia ya cerrada por el "Atender" viejo: no hay a quién nombrar
-- porque nunca se preguntó. Se deja constancia de eso mismo — inventarle un
-- receptor sería peor que admitir que el dato no se tomó.
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

-- Validada (no NOT VALID): el UPDATE de arriba deja el terreno limpio, y una
-- constraint sin validar no protegería de un UPDATE sobre una fila vieja.
-- `entregado_por` NO entra: las filas históricas no lo tienen y no se puede
-- reconstruir. La RPC de abajo sí lo sella siempre.
ALTER TABLE public.paquetes_recibidos
  ADD CONSTRAINT paquetes_correspondencia_acuse_chk CHECK (
    clase <> 'correspondencia'
    OR estado <> 'atendido'
    OR (entregado_a_nombre IS NOT NULL
        AND btrim(entregado_a_nombre) <> ''
        AND hora_entrega IS NOT NULL)
  );

COMMENT ON CONSTRAINT paquetes_correspondencia_acuse_chk ON public.paquetes_recibidos IS
  'Una correspondencia no queda entregada sin acuse: nombre de quien recibió y hora. Ver correspondencia_registrar_acuse().';

-- ── 5) Transición atómica de entrega ────────────────────────────────────────
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
  v_pieza public.paquetes_recibidos;
  v_row   public.paquetes_recibidos;
  v_nombre text := btrim(COALESCE(p_nombre, ''));
BEGIN
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'El nombre de quien recibe es obligatorio'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Mismo vocabulario que el CHECK de entregado_via (20260828000000).
  IF p_via IS NULL OR p_via NOT IN ('porteria', 'portal') THEN
    RAISE EXCEPTION 'Vía de entrega inválida: %', p_via
      USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE: dos operadores pulsando "Entregar" a la vez se serializan aquí.
  -- El segundo encuentra la pieza ya en 'atendido' y sale por el estado, no por
  -- una carrera. SECURITY DEFINER ⇒ este SELECT no pasa por la RLS, así que la
  -- autorización se comprueba a mano justo debajo.
  SELECT * INTO v_pieza
    FROM public.paquetes_recibidos
   WHERE id = p_pieza_id
   FOR UPDATE;

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

  UPDATE public.paquetes_recibidos
     SET estado             = 'atendido',
         entregado_a_nombre = v_nombre,
         entregado_por      = auth.uid(),
         entregado_via      = p_via,
         hora_entrega       = now(),
         firma_path         = COALESCE(NULLIF(btrim(p_firma_path), ''), firma_path)
   WHERE id = p_pieza_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) IS
  'Cierra la custodia de una correspondencia dejando el acuse completo: valida clase, estado pendiente, empresa/proyecto, permiso y nombre; sella empleado y hora. La firma es opcional, el nombre no. Reejecutar sobre una pieza ya entregada falla.';

REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.correspondencia_registrar_acuse(uuid, text, text, text) TO authenticated;
