-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas: propiedades en renta, reservas, contratos e inventario
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- Las rentas de corto plazo (STR) sólo existen dentro de un condominio
-- (`reservas_str.project_id` es NOT NULL): la empresa que además administra
-- propiedades sueltas —una casa, un local, una bodega— no tiene dónde
-- registrarlas, ni una vista de TODA su cartera, ni dónde llevar lo que hay
-- dentro de cada propiedad (muebles, electrodomésticos, blancos, menaje).
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `companies.servicio_rentas` (default false): servicio APARTE de Agua y
--      de Condominios. Lo enciende la plataforma por empresa; apagado, la RLS
--      de las cuatro tablas no deja leer ni escribir (`rentas_servicio_activo`).
--   2. `rentas_propiedades`: el catálogo a nivel EMPRESA. Una propiedad es
--      independiente (project_id / unidad_id NULL) o está ENLAZADA a una unidad
--      de un proyecto. Cuatro tipos: corto_plazo, largo_plazo, local_comercial,
--      otro (con `tipo_detalle`: bodega, parqueo, salón…).
--   3. `rentas_reservas`: estancias por noche de las propiedades INDEPENDIENTES.
--      Las de una propiedad enlazada siguen en `reservas_str` (check-in,
--      huéspedes, housekeeping y portal viven ahí): una sola fuente por
--      propiedad, la hace cumplir el trigger (RENTAS_RESERVA_ENLAZADA).
--   4. `rentas_contratos`: renta mensual (largo plazo, locales, otros). Un solo
--      contrato VIGENTE por propiedad.
--   5. `rentas_inventario`: los artículos de cada propiedad, con cantidad,
--      estado y valor.
--   6. Claves RBAC `rentas.<módulo>.<view|create|edit|delete>` (16).
--
-- AISLAMIENTO. Las tres tablas hijas van por FK COMPUESTA
-- (propiedad_id, company_id) → rentas_propiedades (id, company_id): una fila
-- hija no puede colgar de la propiedad de otra empresa. Quien está acotado a
-- proyectos sólo ve las propiedades enlazadas a los suyos y las independientes.
--
-- LO QUE **NO** HACE: no toca `reservas_str` ni sus policies; no cobra (los
-- montos son informativos); no sube fotos.
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA: scripts/reversion-rentas-modulo.sql (A: apagar el servicio; C: completa)
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El servicio, por empresa
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS servicio_rentas boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.companies.servicio_rentas IS
  'Servicio «Manejo de Rentas» contratado. Apagado, la RLS de rentas_* no deja leer ni escribir.';

-- SECURITY DEFINER: `companies` no se deja leer entera a cualquier perfil y la
-- respuesta es un booleano de la empresa propia. Sin perfil → false.
CREATE OR REPLACE FUNCTION public.rentas_servicio_activo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT c.servicio_rentas FROM public.companies c WHERE c.id = (SELECT public.get_my_company_id())),
    false)
$$;
COMMENT ON FUNCTION public.rentas_servicio_activo() IS
  'true si la empresa de quien llama tiene contratado Manejo de Rentas. Sin perfil o sin empresa → false.';
REVOKE EXECUTE ON FUNCTION public.rentas_servicio_activo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rentas_servicio_activo() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Claves RBAC
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, category, label, description)
SELECT 'rentas.' || m.mkey || '.' || a.akey,
       'rentas',
       a.alabel || ' — ' || m.mlabel,
       a.alabel || ' en ' || m.mlabel || ' (Manejo de Rentas)'
FROM (VALUES
  ('propiedades', 'Propiedades en renta'),
  ('reservas',    'Reservas de corto plazo'),
  ('contratos',   'Contratos de renta'),
  ('inventario',  'Inventario de propiedades')
) AS m(mkey, mlabel)
CROSS JOIN (VALUES
  ('view',   'Ver'),
  ('create', 'Crear'),
  ('edit',   'Editar'),
  ('delete', 'Eliminar')
) AS a(akey, alabel)
ON CONFLICT (key) DO NOTHING;

-- Administrador General (id fijo de 20260518000006): acceso completo, explícito.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT r.id, p.key, 'allow'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.id = '00000000-0000-0000-0000-000000000001'::uuid
  AND p.key LIKE 'rentas.%'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_claves int;
BEGIN
  SELECT count(*) INTO v_claves FROM public.permissions WHERE key LIKE 'rentas.%';
  IF v_claves <> 16 THEN
    RAISE EXCEPTION 'rentas: se esperaban 16 claves en el catálogo RBAC (4 módulos × 4 acciones), hay %', v_claves;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Propiedades
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_propiedades (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Enlace opcional a una unidad de un proyecto. Si el proyecto o la unidad se
  -- eliminan, la propiedad queda como independiente (no se pierde su inventario).
  project_id           uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  unidad_id            uuid          REFERENCES public.unidades(id) ON DELETE SET NULL,
  nombre               text          NOT NULL,
  codigo               text,
  tipo_renta           text          NOT NULL DEFAULT 'corto_plazo',
  -- Para tipo «otro»: bodega, parqueo, salón…
  tipo_detalle         text,
  -- Estado OPERATIVO. «Ocupada» no se guarda: sale de la reserva en curso o
  -- del contrato vigente, para que no quede desfasada.
  estado               text          NOT NULL DEFAULT 'activa',
  direccion            text,
  ciudad               text,
  propietario_nombre   text,
  propietario_telefono text,
  propietario_email    text,
  habitaciones         integer,
  banos                numeric(4,1),
  capacidad            integer,
  area_m2              numeric(10,2),
  -- Por noche en corto plazo; por mes en el resto.
  tarifa_base          numeric(12,2),
  -- Lo que la empresa cobra al propietario por administrar.
  comision_pct         numeric(5,2),
  notas                text,
  creado_por           uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT rentas_propiedades_tipo_check
    CHECK (tipo_renta IN ('corto_plazo', 'largo_plazo', 'local_comercial', 'otro')),
  CONSTRAINT rentas_propiedades_estado_check
    CHECK (estado IN ('activa', 'mantenimiento', 'inactiva')),
  CONSTRAINT rentas_propiedades_nombre_check CHECK (btrim(nombre) <> ''),
  -- Una unidad siempre viene con su proyecto.
  CONSTRAINT rentas_propiedades_enlace_check CHECK (unidad_id IS NULL OR project_id IS NOT NULL),
  CONSTRAINT rentas_propiedades_numeros_check
    CHECK ((habitaciones IS NULL OR habitaciones >= 0)
       AND (banos        IS NULL OR banos >= 0)
       AND (capacidad    IS NULL OR capacidad >= 0)
       AND (area_m2      IS NULL OR area_m2 >= 0)
       AND (tarifa_base  IS NULL OR tarifa_base >= 0)
       AND (comision_pct IS NULL OR (comision_pct >= 0 AND comision_pct <= 100))),
  -- Ancla por tenant para las FK compuestas de las tablas hijas.
  CONSTRAINT rentas_propiedades_id_tenant_uq UNIQUE (id, company_id)
);

-- Una unidad es UNA propiedad en renta, no dos.
CREATE UNIQUE INDEX IF NOT EXISTS rentas_propiedades_unidad_uq
  ON public.rentas_propiedades (unidad_id) WHERE unidad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rentas_propiedades_company
  ON public.rentas_propiedades (company_id, tipo_renta);
CREATE INDEX IF NOT EXISTS idx_rentas_propiedades_project
  ON public.rentas_propiedades (project_id) WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.rentas_propiedades IS
  'Manejo de Rentas: catálogo de propiedades en renta de la empresa. Independiente (sin proyecto) o enlazada a una unidad de un proyecto.';
COMMENT ON COLUMN public.rentas_propiedades.unidad_id IS
  'Unidad del proyecto a la que está enlazada. Las reservas de corto plazo de una propiedad enlazada viven en reservas_str.';

-- Coherencia del enlace. SECURITY DEFINER porque lee projects y unidades, que
-- quien escribe puede no tener a la vista por su propia RLS.
CREATE OR REPLACE FUNCTION public.rentas_propiedad_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'RENTAS_EMPRESA_INMUTABLE: una propiedad no cambia de empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.nombre       := btrim(NEW.nombre);
  NEW.codigo       := NULLIF(btrim(NEW.codigo), '');
  NEW.tipo_detalle := NULLIF(btrim(NEW.tipo_detalle), '');
  IF NEW.project_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    SELECT pr.company_id INTO v_company FROM public.projects pr WHERE pr.id = NEW.project_id;
    IF v_company IS NULL OR v_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'RENTAS_PROYECTO_AJENO: el proyecto no es de esta empresa'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.unidad_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.unidad_id IS DISTINCT FROM OLD.unidad_id
          OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    SELECT u.company_id, u.project_id INTO v_company, v_project
      FROM public.unidades u WHERE u.id = NEW.unidad_id;
    IF v_company IS NULL OR v_company IS DISTINCT FROM NEW.company_id
       OR v_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'RENTAS_UNIDAD_AJENA: la unidad no es de ese proyecto'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_propiedad_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rentas_propiedades_coherente ON public.rentas_propiedades;
CREATE TRIGGER trg_rentas_propiedades_coherente
  BEFORE INSERT OR UPDATE ON public.rentas_propiedades
  FOR EACH ROW EXECUTE FUNCTION public.rentas_propiedad_coherente();
DROP TRIGGER IF EXISTS trg_rentas_propiedades_sello ON public.rentas_propiedades;
CREATE TRIGGER trg_rentas_propiedades_sello
  BEFORE INSERT OR UPDATE ON public.rentas_propiedades
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rentas_propiedades_updated_at ON public.rentas_propiedades;
CREATE TRIGGER trg_rentas_propiedades_updated_at
  BEFORE UPDATE ON public.rentas_propiedades
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ¿Puedo ver esta propiedad? Para la RLS de las tablas hijas: misma empresa y,
-- si está enlazada, un proyecto al que tengo acceso. SECURITY DEFINER para no
-- depender del permiso `rentas.propiedades.view` de quien sólo lleva inventario.
CREATE OR REPLACE FUNCTION public.rentas_propiedad_accesible(p_propiedad uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentas_propiedades p
    WHERE p.id = p_propiedad
      AND p.company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(p.project_id))
$$;
COMMENT ON FUNCTION public.rentas_propiedad_accesible(uuid) IS
  'true si la propiedad es de la empresa de quien llama y, de estar enlazada a un proyecto, tiene acceso a ese proyecto.';
REVOKE EXECUTE ON FUNCTION public.rentas_propiedad_accesible(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rentas_propiedad_accesible(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Reservas de corto plazo (propiedades independientes)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_reservas (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id        uuid          NOT NULL,
  huesped_nombre      text          NOT NULL,
  huesped_email       text,
  huesped_telefono    text,
  fecha_entrada       date          NOT NULL,
  fecha_salida        date          NOT NULL,
  num_huespedes       integer       NOT NULL DEFAULT 1,
  plataforma          text          NOT NULL DEFAULT 'directo',
  codigo_confirmacion text,
  monto_noche         numeric(12,2),
  monto_total         numeric(12,2),
  estado              text          NOT NULL DEFAULT 'confirmada',
  notas               text,
  creado_por          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT rentas_reservas_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_reservas_fechas_check CHECK (fecha_salida > fecha_entrada),
  CONSTRAINT rentas_reservas_huesped_check CHECK (btrim(huesped_nombre) <> ''),
  CONSTRAINT rentas_reservas_huespedes_check CHECK (num_huespedes >= 1),
  CONSTRAINT rentas_reservas_plataforma_check
    CHECK (plataforma IN ('airbnb', 'booking', 'vrbo', 'directo', 'otro')),
  CONSTRAINT rentas_reservas_estado_check
    CHECK (estado IN ('confirmada', 'en_curso', 'completada', 'cancelada')),
  CONSTRAINT rentas_reservas_montos_check
    CHECK ((monto_noche IS NULL OR monto_noche >= 0) AND (monto_total IS NULL OR monto_total >= 0))
);
CREATE INDEX IF NOT EXISTS idx_rentas_reservas_propiedad
  ON public.rentas_reservas (propiedad_id, fecha_entrada DESC);
CREATE INDEX IF NOT EXISTS idx_rentas_reservas_company
  ON public.rentas_reservas (company_id, fecha_entrada DESC);

COMMENT ON TABLE public.rentas_reservas IS
  'Manejo de Rentas: estancias por noche de propiedades INDEPENDIENTES. Las de una propiedad enlazada a una unidad viven en reservas_str.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Contratos de renta mensual
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_contratos (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id             uuid          NOT NULL,
  inquilino_nombre         text          NOT NULL,
  inquilino_identificacion text,
  inquilino_telefono       text,
  inquilino_email          text,
  fecha_inicio             date          NOT NULL,
  -- NULL = plazo indefinido.
  fecha_fin                date,
  renta_mensual            numeric(12,2) NOT NULL,
  deposito                 numeric(12,2),
  dia_pago                 integer,
  estado                   text          NOT NULL DEFAULT 'vigente',
  notas                    text,
  creado_por               uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT rentas_contratos_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_contratos_inquilino_check CHECK (btrim(inquilino_nombre) <> ''),
  CONSTRAINT rentas_contratos_fechas_check CHECK (fecha_fin IS NULL OR fecha_fin > fecha_inicio),
  CONSTRAINT rentas_contratos_montos_check
    CHECK (renta_mensual >= 0 AND (deposito IS NULL OR deposito >= 0)),
  CONSTRAINT rentas_contratos_dia_pago_check CHECK (dia_pago IS NULL OR dia_pago BETWEEN 1 AND 31),
  CONSTRAINT rentas_contratos_estado_check CHECK (estado IN ('vigente', 'finalizado', 'cancelado'))
);
-- Una propiedad no tiene dos inquilinos vigentes a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS rentas_contratos_vigente_uq
  ON public.rentas_contratos (propiedad_id) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS idx_rentas_contratos_company
  ON public.rentas_contratos (company_id, estado);

COMMENT ON TABLE public.rentas_contratos IS
  'Manejo de Rentas: contratos de renta mensual (largo plazo, locales comerciales, otros). Un solo contrato vigente por propiedad.';

-- Qué puede colgar de qué tipo de propiedad. Se comprueba al crear y al cambiar
-- de propiedad; cambiar después el tipo de la propiedad no invalida el historial.
CREATE OR REPLACE FUNCTION public.rentas_hija_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prop public.rentas_propiedades;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.propiedad_id IS NOT DISTINCT FROM OLD.propiedad_id
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_prop FROM public.rentas_propiedades p WHERE p.id = NEW.propiedad_id;
  IF NOT FOUND OR v_prop.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'RENTAS_PROPIEDAD_AJENA: la propiedad no es de esta empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'rentas_reservas' THEN
    IF v_prop.tipo_renta <> 'corto_plazo' THEN
      RAISE EXCEPTION 'RENTAS_RESERVA_TIPO: sólo las propiedades de corto plazo llevan reservas por noche'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_prop.unidad_id IS NOT NULL THEN
      RAISE EXCEPTION 'RENTAS_RESERVA_ENLAZADA: las reservas de una propiedad enlazada a un condominio se registran en su pestaña STR'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'rentas_contratos' THEN
    IF v_prop.tipo_renta = 'corto_plazo' THEN
      RAISE EXCEPTION 'RENTAS_CONTRATO_TIPO: una propiedad de corto plazo lleva reservas, no contrato mensual'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_hija_coherente() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Inventario por propiedad
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_inventario (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id   uuid          NOT NULL,
  nombre         text          NOT NULL,
  categoria      text          NOT NULL DEFAULT 'mobiliario',
  -- Sala, cocina, habitación 1…
  ambiente       text,
  cantidad       integer       NOT NULL DEFAULT 1,
  estado         text          NOT NULL DEFAULT 'bueno',
  valor_unitario numeric(12,2),
  numero_serie   text,
  fecha_revision date,
  notas          text,
  creado_por     uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT rentas_inventario_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_inventario_nombre_check CHECK (btrim(nombre) <> ''),
  CONSTRAINT rentas_inventario_categoria_check
    CHECK (categoria IN ('mobiliario', 'electrodomestico', 'electronica', 'blancos', 'menaje', 'decoracion', 'otro')),
  CONSTRAINT rentas_inventario_estado_check
    CHECK (estado IN ('bueno', 'regular', 'danado', 'faltante')),
  CONSTRAINT rentas_inventario_numeros_check
    CHECK (cantidad >= 0 AND (valor_unitario IS NULL OR valor_unitario >= 0))
);
CREATE INDEX IF NOT EXISTS idx_rentas_inventario_propiedad
  ON public.rentas_inventario (propiedad_id, categoria);
CREATE INDEX IF NOT EXISTS idx_rentas_inventario_company
  ON public.rentas_inventario (company_id);

COMMENT ON TABLE public.rentas_inventario IS
  'Manejo de Rentas: artículos de cada propiedad en renta (muebles, electrodomésticos, blancos, menaje), con cantidad, estado y valor.';

-- Triggers de las tres tablas hijas.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rentas_reservas', 'rentas_contratos', 'rentas_inventario'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_coherente ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_coherente BEFORE INSERT OR UPDATE ON public.%1$I
                      FOR EACH ROW EXECUTE FUNCTION public.rentas_hija_coherente()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_sello ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_sello BEFORE INSERT OR UPDATE ON public.%1$I
                      FOR EACH ROW EXECUTE FUNCTION public.sellar_actor(''creado_por'', ''forzar'')', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
                      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Las cuatro tablas: mi empresa + servicio contratado + la acción del módulo.
-- La plataforma (super_admin) sólo LEE. Escribir exige además `.view`: quien no
-- puede ver el módulo no escribe en él a ciegas.
ALTER TABLE public.rentas_propiedades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentas_reservas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentas_contratos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentas_inventario  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rentas_propiedades, public.rentas_reservas,
              public.rentas_contratos, public.rentas_inventario
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.rentas_propiedades, public.rentas_reservas,
     public.rentas_contratos, public.rentas_inventario
  TO authenticated;

-- 7.1 Propiedades
DROP POLICY IF EXISTS rentas_propiedades_select ON public.rentas_propiedades;
CREATE POLICY rentas_propiedades_select ON public.rentas_propiedades FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND public.can_access_project(project_id)
             -- Quien lleva sólo reservas, contratos o inventario necesita leer el
             -- catálogo para saber de qué propiedad es cada fila.
             AND ((SELECT COALESCE(public.user_has_permission('rentas.propiedades.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.contratos.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.inventario.view'), false)))));
DROP POLICY IF EXISTS rentas_propiedades_insert ON public.rentas_propiedades;
CREATE POLICY rentas_propiedades_insert ON public.rentas_propiedades FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.rentas_servicio_activo())
              AND public.can_access_project(project_id)
              AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.view'), false))
              AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.create'), false)));
DROP POLICY IF EXISTS rentas_propiedades_update ON public.rentas_propiedades;
CREATE POLICY rentas_propiedades_update ON public.rentas_propiedades FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.can_access_project(project_id));
DROP POLICY IF EXISTS rentas_propiedades_delete ON public.rentas_propiedades;
CREATE POLICY rentas_propiedades_delete ON public.rentas_propiedades FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.propiedades.delete'), false)));

-- 7.2 Tablas hijas: mismo molde, cada una con la clave de su módulo.
DO $$
DECLARE
  par text[];
  t   text;
  m   text;
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[
    ARRAY['rentas_reservas',   'reservas'],
    ARRAY['rentas_contratos',  'contratos'],
    ARRAY['rentas_inventario', 'inventario']
  ] LOOP
    t := par[1];
    m := par[2];
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING ((SELECT public.is_super_admin())
               OR (company_id = (SELECT public.get_my_company_id())
                   AND (SELECT public.rentas_servicio_activo())
                   AND public.rentas_propiedad_accesible(propiedad_id)
                   AND (SELECT COALESCE(public.user_has_permission(%L), false))))
    $pol$, t || '_select', t, 'rentas.' || m || '.view');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
        WITH CHECK (company_id = (SELECT public.get_my_company_id())
                    AND (SELECT public.rentas_servicio_activo())
                    AND public.rentas_propiedad_accesible(propiedad_id)
                    AND (SELECT COALESCE(public.user_has_permission(%L), false))
                    AND (SELECT COALESCE(public.user_has_permission(%L), false)))
    $pol$, t || '_insert', t, 'rentas.' || m || '.view', 'rentas.' || m || '.create');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
        USING (company_id = (SELECT public.get_my_company_id())
               AND (SELECT public.rentas_servicio_activo())
               AND public.rentas_propiedad_accesible(propiedad_id)
               AND (SELECT COALESCE(public.user_has_permission(%L), false))
               AND (SELECT COALESCE(public.user_has_permission(%L), false)))
        WITH CHECK (company_id = (SELECT public.get_my_company_id())
                    AND public.rentas_propiedad_accesible(propiedad_id))
    $pol$, t || '_update', t, 'rentas.' || m || '.view', 'rentas.' || m || '.edit');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
        USING (company_id = (SELECT public.get_my_company_id())
               AND (SELECT public.rentas_servicio_activo())
               AND public.rentas_propiedad_accesible(propiedad_id)
               AND (SELECT COALESCE(public.user_has_permission(%L), false))
               AND (SELECT COALESCE(public.user_has_permission(%L), false)))
    $pol$, t || '_delete', t, 'rentas.' || m || '.view', 'rentas.' || m || '.delete');
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Guarda: lo que tiene que existir al terminar
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_policies int;
  v_sin_rls  int;
BEGIN
  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('rentas_propiedades', 'rentas_reservas', 'rentas_contratos', 'rentas_inventario')
     AND policyname LIKE 'rentas\_%';
  IF v_policies <> 16 THEN
    RAISE EXCEPTION 'rentas: se esperaban 16 policies (4 tablas × 4 comandos), hay %', v_policies;
  END IF;
  SELECT count(*) INTO v_sin_rls FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('rentas_propiedades', 'rentas_reservas', 'rentas_contratos', 'rentas_inventario')
     AND NOT c.relrowsecurity;
  IF v_sin_rls <> 0 THEN
    RAISE EXCEPTION 'rentas: % tabla(s) sin RLS', v_sin_rls;
  END IF;
END;
$$;
