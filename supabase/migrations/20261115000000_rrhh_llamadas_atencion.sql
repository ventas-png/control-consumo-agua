-- ════════════════════════════════════════════════════════════════════════════
-- RRHH: llamadas de atención y sanciones al personal, con acuse firmado
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- Una llamada de atención, una amonestación escrita o una suspensión se
-- entregan hoy en papel o por chat: no hay dónde registrarlas, no queda
-- constancia de quién la emitió ni de que el empleado la recibió, y cuando
-- hace falta el historial disciplinario de una persona no existe.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `llamadas_atencion_personal`: una carta por fila. El empleado va por FK
--      COMPUESTA (personal_id, company_id, project_id) → personal_condominio,
--      ON DELETE SET NULL (personal_id): dar de baja la ficha no borra la
--      carta; queda con el nombre y el cargo que se copiaron al emitirla.
--      La carta es INMUTABLE una vez emitida (la firma del emisor la cubre):
--      sólo cambian el estado y los campos del acuse / la anulación, y sólo
--      por las RPCs de abajo.
--   2. Quién firma de recibido. Dos caminos, uno por RPC `rrhh_llamada_acusar`:
--        · 'usuario'    — el propio empleado, desde su cuenta (la carta se le
--                         notifica en la campana y la firma en Mi perfil);
--        · 'presencial' — el personal operativo normalmente NO tiene cuenta
--                         (personal_condominio.user_id es NULL): firma en el
--                         dispositivo de quien tiene `.edit` sobre el tab.
--      En los dos casos se guardan nombre, hora de servidor y la firma.
--   3. El empleado lee SU carta sin el permiso del tab. `condominios.tab.
--      llamadas_atencion` abre TODAS las cartas del condominio, que es lo que
--      necesita RRHH y exactamente lo que un guardia no debe ver de sus
--      compañeros. La rama propia de la RLS va por `rrhh_llamada_es_mia`,
--      SECURITY DEFINER porque personal_condominio no se deja leer al propio
--      empleado (20260908000000 resolvió lo mismo para el marcaje).
--   4. Firmas en el bucket PRIVADO `rrhh-llamadas-atencion`, ruta
--      `<project_id>/<llamada_id>/<archivo>`. No van a `condominios-media`
--      (autoriza por proyecto: cualquier residente vería la firma y la carta
--      de un trabajador). Lee el empleado dueño y quien ve el tab; sube quien
--      emite (`.create`/`.edit`) y el empleado sobre su propia carta; nadie
--      sustituye (sin UPDATE); borra la administración de la empresa.
--   5. Al emitir, el empleado con cuenta recibe aviso in-app (y correo si lo
--      tiene) vía la cola de notificaciones; al firmar, lo recibe quien emitió.
--   6. Claves RBAC del tab nuevo (`recursos_humanos`), heredadas de `personal`
--      como en 20261031000300.
--
-- LO QUE **NO** HACE: no toca `personal_condominio` ni sus policies; no
-- genera el PDF (lo arma el cliente con la fila y las dos firmas).
--
-- REVERSA:
--   DROP POLICY IF EXISTS "rrhh_llamadas_select" ON storage.objects;
--   DROP POLICY IF EXISTS "rrhh_llamadas_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "rrhh_llamadas_delete" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'rrhh-llamadas-atencion';
--   DROP FUNCTION IF EXISTS public.rrhh_llamada_anular(uuid, text);
--   DROP FUNCTION IF EXISTS public.rrhh_llamada_acusar(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.rrhh_llamadas_mias();
--   DROP TABLE IF EXISTS public.llamadas_atencion_personal;  -- arrastra triggers
--   DROP FUNCTION IF EXISTS public.rrhh_llamada_es_mia(text);
--   DROP FUNCTION IF EXISTS public.rrhh_llamada_notificar();
--   DROP FUNCTION IF EXISTS public.rrhh_llamada_coherente();
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.llamadas\_atencion%';
--   DELETE FROM public.permissions WHERE key LIKE 'condominios.tab.llamadas\_atencion%';
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Claves RBAC del tab (mismo patrón que rrhh_config, 20261031000300)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.llamadas_atencion', 'recursos_humanos', 'Llamadas de atención',
   'Llamadas de atención, amonestaciones y suspensiones al personal, con acuse de recibido firmado (llamadas_atencion_personal). Ver abre todas las cartas del condominio.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key = 'condominios.tab.llamadas_atencion'
ON CONFLICT (key) DO NOTHING;

-- Herencia: quien administra el expediente (ALLOW sobre la clave homónima de
-- `personal`) recibe la misma acción aquí. Sólo se copian filas 'allow'.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT DISTINCT rp.role_id,
       'condominios.tab.llamadas_atencion' || substr(rp.permission_key, length('condominios.tab.personal') + 1),
       'allow'
FROM public.role_permissions rp
WHERE rp.effect = 'allow'
  AND (rp.permission_key = 'condominios.tab.personal'
       OR rp.permission_key LIKE 'condominios.tab.personal.%')
  AND substr(rp.permission_key, length('condominios.tab.personal') + 1)
      IN ('', '.create', '.edit', '.change_status', '.approve', '.delete')
ON CONFLICT DO NOTHING;

-- Administrador General (id fijo de 20260518000006): acceso completo, explícito.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key = 'condominios.tab.llamadas_atencion'
   OR p.key LIKE 'condominios.tab.llamadas\_atencion.%'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_claves int;
BEGIN
  SELECT count(*) INTO v_claves
  FROM public.permissions
  WHERE key = 'condominios.tab.llamadas_atencion'
     OR key LIKE 'condominios.tab.llamadas\_atencion.%';
  IF v_claves <> 6 THEN
    RAISE EXCEPTION 'llamadas_atencion: se esperaban 6 claves en el catálogo RBAC (base + 5 acciones), hay %', v_claves;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. La tabla
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.llamadas_atencion_personal (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  -- Empleado. Nullable sólo para el SET NULL de la baja; el trigger exige
  -- valor al emitir.
  personal_id        uuid,
  -- Snapshot al emitir: la carta dice a quién se le entregó aunque la ficha
  -- cambie de nombre o de cargo, o desaparezca.
  empleado_nombre    text        NOT NULL,
  empleado_cargo     text,
  tipo               text        NOT NULL,
  fecha_hechos       date        NOT NULL DEFAULT CURRENT_DATE,
  motivo             text        NOT NULL,
  descripcion        text        NOT NULL,
  -- Artículo del reglamento interno / del Código de Trabajo que se invoca.
  fundamento         text,
  dias_suspension    integer,
  estado             text        NOT NULL DEFAULT 'pendiente',
  -- Quién emite y su firma. Se sellan en el trigger: el cliente no los manda.
  emitido_por        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  emitido_por_nombre text        NOT NULL DEFAULT '',
  emitido_en         timestamptz NOT NULL DEFAULT now(),
  firma_emisor_path  text        NOT NULL,
  notificado_en      timestamptz,
  -- Acuse de recibido (rrhh_llamada_acusar).
  acuse_en           timestamptz,
  acuse_por          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  acuse_nombre       text,
  acuse_modo         text,
  firma_acuse_path   text,
  -- Anulación (rrhh_llamada_anular): la carta no se borra, se deja sin efecto.
  anulada_en         timestamptz,
  anulada_por        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo_anulacion   text,
  creado_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llamadas_atencion_tipo_check
    CHECK (tipo IN ('llamada_atencion', 'amonestacion', 'suspension', 'otra')),
  CONSTRAINT llamadas_atencion_estado_check
    CHECK (estado IN ('pendiente', 'acusada', 'anulada')),
  CONSTRAINT llamadas_atencion_acuse_modo_check
    CHECK (acuse_modo IS NULL OR acuse_modo IN ('usuario', 'presencial')),
  CONSTRAINT llamadas_atencion_texto_check
    CHECK (btrim(motivo) <> '' AND btrim(descripcion) <> '' AND btrim(firma_emisor_path) <> ''),
  CONSTRAINT llamadas_atencion_dias_check
    CHECK (dias_suspension IS NULL OR dias_suspension > 0),
  -- Una suspensión sin días no es una suspensión.
  CONSTRAINT llamadas_atencion_suspension_check
    CHECK (tipo <> 'suspension' OR dias_suspension IS NOT NULL),
  -- Acusada ⇒ acuse completo (hora, nombre, firma, modo). Anulada ⇒ hora y motivo.
  CONSTRAINT llamadas_atencion_acuse_completo_check
    CHECK (estado <> 'acusada'
           OR (acuse_en IS NOT NULL AND acuse_nombre IS NOT NULL AND btrim(acuse_nombre) <> ''
               AND firma_acuse_path IS NOT NULL AND acuse_modo IS NOT NULL)),
  CONSTRAINT llamadas_atencion_anulacion_completa_check
    CHECK (estado <> 'anulada'
           OR (anulada_en IS NOT NULL AND motivo_anulacion IS NOT NULL AND btrim(motivo_anulacion) <> '')),
  -- Ancla por tenant, por si algo cuelga de la carta más adelante.
  CONSTRAINT llamadas_atencion_id_tenant_uq UNIQUE (id, company_id, project_id)
);

-- FK compuesta contra el ancla personal_condominio_id_tenant_uq (20260916171325):
-- el empleado de la carta tiene que ser de ESTE condominio y de ESTA empresa.
-- ON DELETE SET NULL (personal_id): sin la lista de columnas Postgres pondría
-- NULL también en company_id y project_id, que son NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_condominio_id_tenant_uq') THEN
    RAISE EXCEPTION 'llamadas_atencion: falta el ancla personal_condominio_id_tenant_uq (¿se aplicó 20260916171325?)';
  END IF;
END;
$$;
ALTER TABLE public.llamadas_atencion_personal
  ADD CONSTRAINT llamadas_atencion_personal_fk
  FOREIGN KEY (personal_id, company_id, project_id)
  REFERENCES public.personal_condominio (id, company_id, project_id)
  ON DELETE SET NULL (personal_id);

CREATE INDEX idx_llamadas_atencion_proyecto
  ON public.llamadas_atencion_personal (project_id, emitido_en DESC);
CREATE INDEX idx_llamadas_atencion_personal
  ON public.llamadas_atencion_personal (personal_id)
  WHERE personal_id IS NOT NULL;

COMMENT ON TABLE public.llamadas_atencion_personal IS
  'Llamadas de atención, amonestaciones y suspensiones al personal del condominio. Inmutable tras emitirse; el estado y el acuse cambian sólo por rrhh_llamada_acusar / rrhh_llamada_anular.';
COMMENT ON COLUMN public.llamadas_atencion_personal.personal_id IS
  'Empleado (personal_condominio). NULL sólo si la ficha se dio de baja después de emitir; empleado_nombre conserva a quién se entregó.';
COMMENT ON COLUMN public.llamadas_atencion_personal.acuse_modo IS
  'usuario = firmó desde su propia cuenta; presencial = firmó en el dispositivo de quien tiene .edit sobre el tab (personal sin cuenta).';
COMMENT ON COLUMN public.llamadas_atencion_personal.firma_emisor_path IS
  'Firma manuscrita de quien emite, en el bucket rrhh-llamadas-atencion bajo <project_id>/<id>/.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger de coherencia: lo que se sella al emitir y lo que no se toca después
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER porque lee personal_condominio (RLS del tab Personal, que
-- quien emite puede no tener), projects y app_users.
CREATE OR REPLACE FUNCTION public.rrhh_llamada_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ficha    public.personal_condominio;
  v_company  uuid;
  v_nombre   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.personal_id IS NULL THEN
      RAISE EXCEPTION 'LLAMADA_SIN_EMPLEADO: la carta necesita un empleado'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_ficha FROM public.personal_condominio WHERE id = NEW.personal_id;
    IF NOT FOUND OR v_ficha.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'LLAMADA_EMPLEADO_AJENO: el empleado no es de este condominio'
        USING ERRCODE = 'check_violation';
    END IF;
    -- company_id sale del proyecto, no del cliente (mismo criterio que rrhh_cargos).
    SELECT pr.company_id INTO v_company FROM public.projects pr WHERE pr.id = NEW.project_id;
    IF v_company IS NULL THEN
      RAISE EXCEPTION 'LLAMADA_PROYECTO_INVALIDO: el condominio no existe'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.company_id      := v_company;
    NEW.empleado_nombre := btrim(v_ficha.nombre);
    -- El cliente manda la etiqueta del catálogo (p. ej. «Guardia»); si no, el código.
    NEW.empleado_cargo  := COALESCE(NULLIF(btrim(NEW.empleado_cargo), ''), v_ficha.cargo);
    SELECT a.full_name INTO v_nombre FROM public.app_users a WHERE a.id = auth.uid();
    NEW.emitido_por        := auth.uid();
    NEW.emitido_por_nombre := COALESCE(NULLIF(btrim(v_nombre), ''), '');
    NEW.emitido_en         := now();
    -- Nace pendiente y sin acuse ni anulación, diga lo que diga el INSERT.
    NEW.estado           := 'pendiente';
    NEW.notificado_en    := NULL;
    NEW.acuse_en         := NULL;  NEW.acuse_por := NULL;  NEW.acuse_nombre := NULL;
    NEW.acuse_modo       := NULL;  NEW.firma_acuse_path := NULL;
    NEW.anulada_en       := NULL;  NEW.anulada_por := NULL; NEW.motivo_anulacion := NULL;
    NEW.motivo           := btrim(NEW.motivo);
    NEW.descripcion      := btrim(NEW.descripcion);
    NEW.fundamento       := NULLIF(btrim(NEW.fundamento), '');
    IF NEW.tipo <> 'suspension' THEN NEW.dias_suspension := NULL; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: la carta emitida no se reescribe. personal_id sólo puede pasar a
  -- NULL (es lo que hace el ON DELETE SET NULL de la FK).
  IF NEW.company_id        IS DISTINCT FROM OLD.company_id
     OR NEW.project_id        IS DISTINCT FROM OLD.project_id
     OR (NEW.personal_id      IS DISTINCT FROM OLD.personal_id AND NEW.personal_id IS NOT NULL)
     OR NEW.empleado_nombre   IS DISTINCT FROM OLD.empleado_nombre
     OR NEW.empleado_cargo    IS DISTINCT FROM OLD.empleado_cargo
     OR NEW.tipo              IS DISTINCT FROM OLD.tipo
     OR NEW.fecha_hechos      IS DISTINCT FROM OLD.fecha_hechos
     OR NEW.motivo            IS DISTINCT FROM OLD.motivo
     OR NEW.descripcion       IS DISTINCT FROM OLD.descripcion
     OR NEW.fundamento        IS DISTINCT FROM OLD.fundamento
     OR NEW.dias_suspension   IS DISTINCT FROM OLD.dias_suspension
     OR NEW.emitido_por       IS DISTINCT FROM OLD.emitido_por
     OR NEW.emitido_por_nombre IS DISTINCT FROM OLD.emitido_por_nombre
     OR NEW.emitido_en        IS DISTINCT FROM OLD.emitido_en
     OR NEW.firma_emisor_path IS DISTINCT FROM OLD.firma_emisor_path THEN
    RAISE EXCEPTION 'LLAMADA_INMUTABLE: una carta emitida no se edita; anulala y emití otra'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Transiciones: pendiente → acusada, pendiente|acusada → anulada. Nada vuelve.
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT ((OLD.estado = 'pendiente' AND NEW.estado IN ('acusada', 'anulada'))
            OR (OLD.estado = 'acusada' AND NEW.estado = 'anulada')) THEN
      RAISE EXCEPTION 'LLAMADA_TRANSICION: de % no se pasa a %', OLD.estado, NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Un acuse registrado no se reescribe (ni al anular).
  IF OLD.estado <> 'pendiente'
     AND (NEW.acuse_en IS DISTINCT FROM OLD.acuse_en
          OR NEW.acuse_por IS DISTINCT FROM OLD.acuse_por
          OR NEW.acuse_nombre IS DISTINCT FROM OLD.acuse_nombre
          OR NEW.acuse_modo IS DISTINCT FROM OLD.acuse_modo
          OR NEW.firma_acuse_path IS DISTINCT FROM OLD.firma_acuse_path) THEN
    RAISE EXCEPTION 'LLAMADA_ACUSE_INMUTABLE: el acuse de recibido no se modifica'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_llamada_coherente() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_llamadas_atencion_coherente
  BEFORE INSERT OR UPDATE ON public.llamadas_atencion_personal
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_llamada_coherente();
CREATE TRIGGER trg_llamadas_atencion_sello
  BEFORE INSERT OR UPDATE ON public.llamadas_atencion_personal
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
CREATE TRIGGER trg_llamadas_atencion_updated_at
  BEFORE UPDATE ON public.llamadas_atencion_personal
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_llamadas_atencion_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.llamadas_atencion_personal
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora('Recursos Humanos', 'motivo,tipo', '', '');

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Avisar al empleado al emitir (si tiene cuenta)
-- ────────────────────────────────────────────────────────────────────────────
-- AFTER INSERT y envuelto en EXCEPTION: un aviso que no sale no impide emitir
-- la carta. `seccion` = 'perfil' porque ahí (Mi perfil) es donde el empleado la
-- lee y la firma; la campana navega a ese destino (SECTION_TO_PATH).
CREATE OR REPLACE FUNCTION public.rrhh_llamada_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user    uuid;
  v_email   text;
  v_titulo  text;
  v_cuerpo  text;
  v_etiq    text;
BEGIN
  BEGIN
    SELECT pc.user_id INTO v_user
      FROM public.personal_condominio pc WHERE pc.id = NEW.personal_id;
    IF v_user IS NULL THEN
      RETURN NEW;
    END IF;
    v_etiq := CASE NEW.tipo
                WHEN 'llamada_atencion' THEN 'Llamada de atención'
                WHEN 'amonestacion'     THEN 'Amonestación escrita'
                WHEN 'suspension'       THEN 'Suspensión'
                ELSE 'Sanción' END;
    v_titulo := v_etiq || ' por firmar de recibido';
    v_cuerpo := concat_ws(' · ', NEW.motivo,
                  'Emitida por ' || COALESCE(NULLIF(NEW.emitido_por_nombre, ''), 'la administración'),
                  'Abrí Mi perfil para leerla y firmar de recibido');
    PERFORM public.notif_encolar_in_app(
      NEW.company_id, ARRAY[v_user], 'rrhh_llamada_atencion', v_titulo, v_cuerpo, 'perfil',
      jsonb_build_object('llamada_id', NEW.id, 'project_id', NEW.project_id, 'tipo', NEW.tipo));
    SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_user;
    IF v_email IS NOT NULL AND v_email <> '' THEN
      PERFORM public.enqueue_notification(
        'email', v_email,
        jsonb_build_object(
          'to_email', v_email,
          'user_id',  v_user,          -- activa el opt-out por canal
          'tipo',     'rrhh_llamada_atencion',
          'subject',  v_titulo,
          'body',     '<p>' || public.hk_html(v_cuerpo) || '</p>'),
        NEW.company_id);
    END IF;
    UPDATE public.llamadas_atencion_personal SET notificado_en = now() WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rrhh_llamada_notificar(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_llamada_notificar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_llamadas_atencion_notificar
  AFTER INSERT ON public.llamadas_atencion_personal
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_llamada_notificar();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ¿Es mía esta carta? (para la RLS de la tabla y las policies de storage)
-- ────────────────────────────────────────────────────────────────────────────
-- En text porque en storage los segmentos del path son text y un cast
-- inválido dentro de un WITH CHECK aborta la petición en vez de denegarla.
CREATE OR REPLACE FUNCTION public.rrhh_llamada_es_mia(p_llamada text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := p_llamada::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1
    FROM public.llamadas_atencion_personal l
    JOIN public.personal_condominio pc ON pc.id = l.personal_id
    WHERE l.id = v_id
      AND pc.user_id = (SELECT auth.uid())
  );
END;
$$;
COMMENT ON FUNCTION public.rrhh_llamada_es_mia(text) IS
  'true si la carta <llamada_id> está dirigida al expediente de quien llama. SECURITY DEFINER porque personal_condominio no se deja leer al propio empleado. Un uuid mal formado devuelve false.';
REVOKE EXECUTE ON FUNCTION public.rrhh_llamada_es_mia(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_llamada_es_mia(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Lectura: el tab (todas las cartas del condominio) o la propia. Alta: `.create`.
-- Sin UPDATE para authenticated: el acuse y la anulación entran por las RPCs
-- SECURITY DEFINER de §7, que comprueban a mano quién llama. Borrar: `.delete`.
ALTER TABLE public.llamadas_atencion_personal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.llamadas_atencion_personal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.llamadas_atencion_personal TO authenticated;

CREATE POLICY llamadas_atencion_select ON public.llamadas_atencion_personal FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT COALESCE(public.user_has_permission('condominios.tab.llamadas_atencion'), false)))
         OR public.rrhh_llamada_es_mia(id::text));
CREATE POLICY llamadas_atencion_insert ON public.llamadas_atencion_personal FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.can_access_project(project_id)
              AND (SELECT COALESCE(public.user_has_permission('condominios.tab.llamadas_atencion.create'), false)));
CREATE POLICY llamadas_atencion_delete ON public.llamadas_atencion_personal FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('condominios.tab.llamadas_atencion.delete'), false)));

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPCs
-- ────────────────────────────────────────────────────────────────────────────
-- 7.1 Mis cartas: lo que Mi perfil muestra al empleado, en todos los
-- condominios donde su cuenta tiene ficha. Filtra por auth.uid(): no recibe
-- ningún id del cliente.
CREATE OR REPLACE FUNCTION public.rrhh_llamadas_mias()
RETURNS TABLE (
  id                 uuid,
  project_id         uuid,
  proyecto_nombre    text,
  personal_id        uuid,
  empleado_nombre    text,
  empleado_cargo     text,
  tipo               text,
  fecha_hechos       date,
  motivo             text,
  descripcion        text,
  fundamento         text,
  dias_suspension    integer,
  estado             text,
  emitido_por_nombre text,
  emitido_en         timestamptz,
  firma_emisor_path  text,
  acuse_en           timestamptz,
  acuse_nombre       text,
  acuse_modo         text,
  firma_acuse_path   text,
  anulada_en         timestamptz,
  motivo_anulacion   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.id, l.project_id, pr.nombre, l.personal_id, l.empleado_nombre, l.empleado_cargo,
         l.tipo, l.fecha_hechos, l.motivo, l.descripcion, l.fundamento, l.dias_suspension,
         l.estado, l.emitido_por_nombre, l.emitido_en, l.firma_emisor_path,
         l.acuse_en, l.acuse_nombre, l.acuse_modo, l.firma_acuse_path,
         l.anulada_en, l.motivo_anulacion
  FROM public.llamadas_atencion_personal l
  JOIN public.personal_condominio pc ON pc.id = l.personal_id
  LEFT JOIN public.projects pr ON pr.id = l.project_id
  WHERE pc.user_id = (SELECT auth.uid())
    AND l.company_id = (SELECT public.get_my_company_id())
  ORDER BY (l.estado = 'pendiente') DESC, l.emitido_en DESC
$$;
COMMENT ON FUNCTION public.rrhh_llamadas_mias() IS
  'Las cartas dirigidas al expediente de la cuenta que llama (en cualquier condominio de su empresa), pendientes primero. Para Mi perfil.';
REVOKE EXECUTE ON FUNCTION public.rrhh_llamadas_mias() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_llamadas_mias() TO authenticated;

-- 7.2 Firmar de recibido.
CREATE OR REPLACE FUNCTION public.rrhh_llamada_acusar(
  p_id         uuid,
  p_nombre     text,
  p_firma_path text
) RETURNS public.llamadas_atencion_personal
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row     public.llamadas_atencion_personal;
  v_nombre  text := btrim(COALESCE(p_nombre, ''));
  v_firma   text := btrim(COALESCE(p_firma_path, ''));
  v_modo    text;
  v_uid     uuid := auth.uid();
  v_firmante text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'El nombre de quien recibe es obligatorio' USING ERRCODE = 'check_violation';
  END IF;
  IF v_firma = '' THEN
    RAISE EXCEPTION 'La firma de recibido es obligatoria' USING ERRCODE = 'check_violation';
  END IF;

  -- FOR UPDATE: dos acuses a la vez se serializan; el segundo sale por el estado.
  SELECT * INTO v_row FROM public.llamadas_atencion_personal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La carta no existe';
  END IF;
  IF v_row.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La carta ya no está pendiente (estado: %)', v_row.estado;
  END IF;

  -- ¿Quién firma? El propio empleado, o la administración por él (presencial).
  IF public.rrhh_llamada_es_mia(p_id::text) THEN
    v_modo := 'usuario';
  ELSIF public.is_super_admin()
        OR (v_row.company_id = public.get_my_company_id()
            AND public.can_access_project(v_row.project_id)
            AND COALESCE(public.user_has_permission('condominios.tab.llamadas_atencion.edit'), false)) THEN
    v_modo := 'presencial';
  ELSE
    RAISE EXCEPTION 'No autorizado para registrar el acuse de esta carta' USING ERRCODE = '42501';
  END IF;

  -- La firma tiene que estar bajo la carpeta de ESTA carta y ya subida.
  IF v_firma <> v_row.project_id::text || '/' || v_row.id::text || '/' || split_part(v_firma, '/', 3)
     OR array_length(string_to_array(v_firma, '/'), 1) <> 3
     OR split_part(v_firma, '/', 3) = '' THEN
    RAISE EXCEPTION 'La firma no corresponde a esta carta' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'rrhh-llamadas-atencion' AND o.name = v_firma) THEN
    RAISE EXCEPTION 'La firma no llegó a subirse. Intentá de nuevo.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.llamadas_atencion_personal
     SET estado           = 'acusada',
         acuse_en         = now(),
         acuse_por        = v_uid,
         acuse_nombre     = v_nombre,
         acuse_modo       = v_modo,
         firma_acuse_path = v_firma
   WHERE id = p_id
  RETURNING * INTO v_row;

  -- Quien emitió se entera de que la carta ya está firmada.
  IF v_row.emitido_por IS NOT NULL AND v_row.emitido_por <> v_uid THEN
    BEGIN
      SELECT a.full_name INTO v_firmante FROM public.app_users a WHERE a.id = v_uid;
      PERFORM public.notif_encolar_in_app(
        v_row.company_id, ARRAY[v_row.emitido_por], 'rrhh_llamada_acusada',
        v_row.empleado_nombre || ' firmó de recibido',
        concat_ws(' · ', v_row.motivo,
                  CASE WHEN v_modo = 'usuario' THEN 'Desde su cuenta'
                       ELSE 'En persona, registrado por ' || COALESCE(NULLIF(v_firmante, ''), 'la administración') END),
        'condominios',
        jsonb_build_object('llamada_id', v_row.id, 'project_id', v_row.project_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rrhh_llamada_acusar aviso(%): %', p_id, SQLERRM;
    END;
  END IF;

  RETURN v_row;
END;
$$;
COMMENT ON FUNCTION public.rrhh_llamada_acusar(uuid, text, text) IS
  'Firma de recibido: el propio empleado (modo usuario) o quien tiene .edit sobre el tab, con el empleado delante (modo presencial). Exige nombre y firma ya subida bajo <project>/<carta>/; sella hora de servidor y quién registró.';
REVOKE EXECUTE ON FUNCTION public.rrhh_llamada_acusar(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_llamada_acusar(uuid, text, text) TO authenticated;

-- 7.3 Dejar sin efecto. `.change_status` del tab. La carta y su acuse quedan.
CREATE OR REPLACE FUNCTION public.rrhh_llamada_anular(
  p_id     uuid,
  p_motivo text
) RETURNS public.llamadas_atencion_personal
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row    public.llamadas_atencion_personal;
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_uid    uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'El motivo de la anulación es obligatorio' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_row FROM public.llamadas_atencion_personal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La carta no existe';
  END IF;
  IF v_row.estado = 'anulada' THEN
    RAISE EXCEPTION 'La carta ya está anulada';
  END IF;
  IF NOT public.is_super_admin() THEN
    IF v_row.company_id IS DISTINCT FROM public.get_my_company_id()
       OR NOT public.can_access_project(v_row.project_id)
       OR NOT COALESCE(public.user_has_permission('condominios.tab.llamadas_atencion.change_status'), false) THEN
      RAISE EXCEPTION 'No autorizado para anular esta carta' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE public.llamadas_atencion_personal
     SET estado           = 'anulada',
         anulada_en       = now(),
         anulada_por      = v_uid,
         motivo_anulacion = v_motivo
   WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
COMMENT ON FUNCTION public.rrhh_llamada_anular(uuid, text) IS
  'Deja sin efecto una carta (pendiente o acusada) con motivo; exige .change_status sobre el tab. No borra: el historial conserva la carta y su acuse.';
REVOKE EXECUTE ON FUNCTION public.rrhh_llamada_anular(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_llamada_anular(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. El bucket de las firmas
-- ────────────────────────────────────────────────────────────────────────────
-- 1 MiB: son PNG de un trazo sobre fondo blanco, no fotos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rrhh-llamadas-atencion', 'rrhh-llamadas-atencion', false, 1048576, ARRAY['image/png']::text[])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "rrhh_llamadas_select" ON storage.objects;
DROP POLICY IF EXISTS "rrhh_llamadas_insert" ON storage.objects;
DROP POLICY IF EXISTS "rrhh_llamadas_update" ON storage.objects;
DROP POLICY IF EXISTS "rrhh_llamadas_delete" ON storage.objects;

-- SELECT: el empleado ve las firmas de SU carta; quien ve el tab, las de todas.
CREATE POLICY "rrhh_llamadas_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'rrhh-llamadas-atencion'
    AND (
      (SELECT public.is_super_admin())
      OR public.rrhh_llamada_es_mia((storage.foldername(name))[2])
      OR (
        (SELECT public.user_has_permission('condominios.tab.llamadas_atencion'))
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id::text = (storage.foldername(name))[1]
            AND pr.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(pr.id)
        )
      )
    )
  );

-- INSERT: ruta exacta <project>/<carta>/<archivo>. La firma del emisor se sube
-- ANTES de insertar la fila (el id lo genera el cliente), así que esa rama no
-- puede mirar la carta: mira el permiso (`.create` emite, `.edit` registra el
-- acuse presencial) y el proyecto. El empleado sube sólo bajo su propia carta.
CREATE POLICY "rrhh_llamadas_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'rrhh-llamadas-atencion'
    AND (
      (SELECT public.is_super_admin())
      OR (
        array_length(storage.foldername(name), 1) = 2
        AND (storage.foldername(name))[2] <> ''
        AND (
          public.rrhh_llamada_es_mia((storage.foldername(name))[2])
          OR (
            ((SELECT public.user_has_permission('condominios.tab.llamadas_atencion.create'))
             OR (SELECT public.user_has_permission('condominios.tab.llamadas_atencion.edit')))
            AND EXISTS (
              SELECT 1 FROM public.projects pr
              WHERE pr.id::text = (storage.foldername(name))[1]
                AND pr.company_id = (SELECT public.get_my_company_id())
                AND public.can_access_project(pr.id)
            )
          )
        )
      )
    )
  );

-- UPDATE — sin policy: una firma no se sustituye (se sube con upsert:false).

-- DELETE — sólo la administración de la empresa (retención), como en presencia.
CREATE POLICY "rrhh_llamadas_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'rrhh-llamadas-atencion'
    AND (
      (SELECT public.is_super_admin())
      OR (
        (SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.id::text = (storage.foldername(name))[1]
            AND pr.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(pr.id)
        )
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_del     char;
  v_cols    int;
  v_setcols int;
  v_pol     int;
BEGIN
  SELECT confdeltype, array_length(conkey, 1), array_length(confdelsetcols, 1)
    INTO v_del, v_cols, v_setcols
  FROM pg_constraint
  WHERE conrelid  = 'public.llamadas_atencion_personal'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.personal_condominio'::regclass;
  IF v_del IS DISTINCT FROM 'n' OR v_cols IS DISTINCT FROM 3 OR v_setcols IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'llamadas_atencion_personal.personal_id: se esperaba FK compuesta a personal_condominio con ON DELETE SET NULL (personal_id), hay confdeltype=%, columnas=%, set null sobre=%',
      coalesce(v_del, 'sin FK'), coalesce(v_cols, 0), coalesce(v_setcols, 0);
  END IF;
  -- Sin policy de UPDATE: el acuse y la anulación entran sólo por las RPCs.
  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'llamadas_atencion_personal';
  IF v_pol <> 3 OR EXISTS (SELECT 1 FROM pg_policies
                           WHERE schemaname = 'public' AND tablename = 'llamadas_atencion_personal'
                             AND cmd = 'UPDATE') THEN
    RAISE EXCEPTION 'llamadas_atencion_personal: se esperaban 3 policies (SELECT, INSERT, DELETE) y ninguna de UPDATE';
  END IF;
END;
$$;
