-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · Finanzas: el desglose de cobro de cada reserva, los
-- conceptos configurables, los gastos por propiedad y lo que hace falta para el
-- estado mensual del propietario.
--
-- POR QUÉ. Las administradoras llevan hoy cada apartamento en una hoja de
-- Excel: por reserva, lo que la plataforma le cobró al huésped (tarifa,
-- limpieza, servicio, impuesto) y lo que recibió el anfitrión (tarifa,
-- limpieza, descuentos, comisión de la plataforma, impuesto, adicionales); y
-- por mes, ocupación, ingresos y lo acreditado. `rentas_reservas` sólo guardaba
-- un monto por noche y un total.
--
-- QUÉ AGREGA
--   1. Claves RBAC `rentas.finanzas.<view|create|edit|delete>` (20 en total).
--   2. `rentas_reservas.politica_cancelacion` y `.num_mascotas` (las de
--      `reservas_str` ya los traen como `politica_cancelacion` y `mascotas`).
--   3. `rentas_conceptos`: las COLUMNAS del desglose, por empresa. Cada concepto
--      es de un bloque («huesped» = lo que pagó el huésped; «anfitrion» = lo que
--      recibió el anfitrión), suma o resta, y entra o no en la base de la
--      comisión de administración. Se siembran los del Excel de Airbnb al
--      contratar el servicio; la empresa agrega, renombra, reordena o desactiva.
--      No se borran: una reserva vieja seguiría apuntando a ellos.
--   4. `rentas_liquidaciones`: el desglose de UNA reserva (`importes`: concepto
--      → monto). Sirve a las dos fuentes de reservas: `rentas_reservas`
--      (propiedad independiente) y `reservas_str` (propiedad enlazada a una
--      unidad de un condominio), sin tocar esta última. Los totales NO se
--      guardan: se calculan con los conceptos vigentes, para que cambiar el
--      signo de un concepto no deje totales viejos.
--   5. `rentas_gastos`: gastos por propiedad y fecha, a cargo del propietario
--      (se le descuentan en su estado mensual) o de la administradora.
--
-- El estado mensual (acreditado − comisión − gastos del propietario) se calcula
-- al mostrarlo; no hay tabla de cierres.
--
-- LO QUE **NO** HACE: no toca `reservas_str` ni sus policies; no cobra ni paga;
-- no cambia el plan ni el conteo de unidades.
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA: scripts/reversion-rentas-finanzas.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Claves RBAC
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, category, label, description)
SELECT 'rentas.finanzas.' || a.akey,
       'rentas',
       a.alabel || ' — Finanzas de rentas',
       a.alabel || ' en Finanzas de rentas: desglose de cobros, conceptos, gastos y estado mensual (Manejo de Rentas)'
FROM (VALUES
  ('view',   'Ver'),
  ('create', 'Crear'),
  ('edit',   'Editar'),
  ('delete', 'Eliminar')
) AS a(akey, alabel)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT r.id, p.key, 'allow'
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.id = '00000000-0000-0000-0000-000000000001'::uuid
  AND p.key LIKE 'rentas.finanzas.%'
ON CONFLICT DO NOTHING;

-- Quien lleva sólo Finanzas también necesita leer el catálogo de propiedades.
DROP POLICY IF EXISTS rentas_propiedades_select ON public.rentas_propiedades;
CREATE POLICY rentas_propiedades_select ON public.rentas_propiedades FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND public.can_access_project(project_id)
             AND ((SELECT COALESCE(public.user_has_permission('rentas.propiedades.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.contratos.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.inventario.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false)))));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Lo que le faltaba a la reserva independiente
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rentas_reservas
  ADD COLUMN IF NOT EXISTS politica_cancelacion text,
  ADD COLUMN IF NOT EXISTS num_mascotas integer NOT NULL DEFAULT 0;
ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_mascotas_check;
ALTER TABLE public.rentas_reservas
  ADD CONSTRAINT rentas_reservas_mascotas_check CHECK (num_mascotas >= 0);
-- El mismo catálogo que usa la pestaña STR de Condominios (reservas_str).
ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_politica_check;
ALTER TABLE public.rentas_reservas
  ADD CONSTRAINT rentas_reservas_politica_check
  CHECK (politica_cancelacion IS NULL
      OR politica_cancelacion IN ('flexible', 'moderada', 'estricta', 'no_reembolsable', 'na', 'otra'));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Conceptos del desglose, por empresa
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_conceptos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Identificador estable dentro del bloque (los sembrados: tarifa_habitacion…).
  codigo       text        NOT NULL,
  nombre       text        NOT NULL,
  -- huesped = lo que la plataforma le cobró al huésped; anfitrion = lo recibido.
  bloque       text        NOT NULL,
  -- +1 suma al total del bloque, −1 resta (descuentos, comisión de la plataforma).
  signo        smallint    NOT NULL DEFAULT 1,
  -- Sólo bloque anfitrión: ¿entra en la base de la comisión de administración?
  comisionable boolean     NOT NULL DEFAULT true,
  orden        integer     NOT NULL DEFAULT 0,
  activo       boolean     NOT NULL DEFAULT true,
  creado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentas_conceptos_bloque_check CHECK (bloque IN ('huesped', 'anfitrion')),
  CONSTRAINT rentas_conceptos_signo_check CHECK (signo IN (1, -1)),
  CONSTRAINT rentas_conceptos_nombre_check CHECK (btrim(nombre) <> ''),
  CONSTRAINT rentas_conceptos_codigo_check CHECK (codigo ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT rentas_conceptos_codigo_uq UNIQUE (company_id, bloque, codigo)
);
CREATE INDEX IF NOT EXISTS idx_rentas_conceptos_company
  ON public.rentas_conceptos (company_id, bloque, orden);

COMMENT ON TABLE public.rentas_conceptos IS
  'Manejo de Rentas: columnas del desglose de cobro de una reserva, por empresa. No se borran (se desactivan): las liquidaciones los referencian por id.';

CREATE OR REPLACE FUNCTION public.rentas_concepto_coherente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.company_id IS DISTINCT FROM OLD.company_id
          OR NEW.bloque IS DISTINCT FROM OLD.bloque
          OR NEW.codigo IS DISTINCT FROM OLD.codigo) THEN
    RAISE EXCEPTION 'RENTAS_CONCEPTO_INMUTABLE: un concepto no cambia de empresa, de bloque ni de código'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.nombre := btrim(NEW.nombre);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_concepto_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rentas_conceptos_coherente ON public.rentas_conceptos;
CREATE TRIGGER trg_rentas_conceptos_coherente
  BEFORE INSERT OR UPDATE ON public.rentas_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.rentas_concepto_coherente();
DROP TRIGGER IF EXISTS trg_rentas_conceptos_sello ON public.rentas_conceptos;
CREATE TRIGGER trg_rentas_conceptos_sello
  BEFORE INSERT OR UPDATE ON public.rentas_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rentas_conceptos_updated_at ON public.rentas_conceptos;
CREATE TRIGGER trg_rentas_conceptos_updated_at
  BEFORE UPDATE ON public.rentas_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Los conceptos de partida: las columnas de la hoja que las administradoras
-- llevan para Airbnb. Sólo agrega los que falten (por código): no pisa nombres
-- ni signos que la empresa ya haya cambiado.
CREATE OR REPLACE FUNCTION public.rentas_sembrar_conceptos(p_company uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.rentas_conceptos (company_id, bloque, codigo, nombre, signo, comisionable, orden)
  SELECT p_company, v.bloque, v.codigo, v.nombre, v.signo, v.comisionable, v.orden
  FROM (VALUES
    ('huesped',   'tarifa_habitacion', 'Tarifa de la habitación',                 1::smallint, false, 10),
    ('huesped',   'tarifa_mascota',    'Tarifa por mascota',                      1::smallint, false, 20),
    ('huesped',   'tarifa_limpieza',   'Tarifa de limpieza',                      1::smallint, false, 30),
    ('huesped',   'servicio_huesped',  'Tarifa por servicio al huésped',          1::smallint, false, 40),
    ('huesped',   'impuesto',          'Impuesto sobre el uso de la propiedad',   1::smallint, false, 50),
    ('anfitrion', 'tarifa_habitacion', 'Tarifa de la habitación',                 1::smallint, true,  10),
    ('anfitrion', 'tarifa_limpieza',   'Tarifa de limpieza',                      1::smallint, true,  20),
    ('anfitrion', 'descuentos',        'Descuentos aplicados',                    (-1)::smallint, true, 30),
    ('anfitrion', 'servicio_anfitrion','Tarifa de servicio para anfitriones',     (-1)::smallint, true, 40),
    ('anfitrion', 'tarifa_mascota',    'Tarifa por mascotas',                     1::smallint, true,  50),
    ('anfitrion', 'coanfitrion',       'Comisión del coanfitrión',                (-1)::smallint, true, 60),
    ('anfitrion', 'impuesto',          'Impuesto sobre el uso de la propiedad',   1::smallint, true,  70),
    ('anfitrion', 'adicionales',       'Adicionales cobrados',                    1::smallint, true,  80)
  ) AS v(bloque, codigo, nombre, signo, comisionable, orden)
  ON CONFLICT (company_id, bloque, codigo) DO NOTHING
$$;
COMMENT ON FUNCTION public.rentas_sembrar_conceptos(uuid) IS
  'Siembra en la empresa los conceptos de partida del desglose de reservas (los que falten). La llama el trigger de companies al contratar Manejo de Rentas.';
REVOKE EXECUTE ON FUNCTION public.rentas_sembrar_conceptos(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.companies_rentas_conceptos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.servicio_rentas THEN
    PERFORM public.rentas_sembrar_conceptos(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.companies_rentas_conceptos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_rentas_conceptos ON public.companies;
CREATE TRIGGER trg_companies_rentas_conceptos
  AFTER INSERT OR UPDATE OF servicio_rentas ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_rentas_conceptos();

-- Las empresas que ya tienen el servicio.
SELECT public.rentas_sembrar_conceptos(c.id) FROM public.companies c WHERE c.servicio_rentas;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Liquidación: el desglose de una reserva
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_liquidaciones (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id   uuid        NOT NULL,
  -- Exactamente una de las dos: la reserva de una propiedad independiente o la
  -- de la pestaña STR del condominio de una propiedad enlazada.
  reserva_id     uuid        REFERENCES public.rentas_reservas(id) ON DELETE CASCADE,
  reserva_str_id uuid        REFERENCES public.reservas_str(id) ON DELETE CASCADE,
  -- { "<id de rentas_conceptos>": monto ≥ 0 }. El signo lo pone el concepto.
  importes       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  creado_por     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentas_liquidaciones_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_liquidaciones_una_reserva_check CHECK (num_nonnulls(reserva_id, reserva_str_id) = 1),
  CONSTRAINT rentas_liquidaciones_importes_check CHECK (jsonb_typeof(importes) = 'object'),
  -- Una liquidación por reserva (los NULL no chocan entre sí).
  CONSTRAINT rentas_liquidaciones_reserva_uq UNIQUE (reserva_id),
  CONSTRAINT rentas_liquidaciones_reserva_str_uq UNIQUE (reserva_str_id)
);
CREATE INDEX IF NOT EXISTS idx_rentas_liquidaciones_propiedad
  ON public.rentas_liquidaciones (propiedad_id);
CREATE INDEX IF NOT EXISTS idx_rentas_liquidaciones_company
  ON public.rentas_liquidaciones (company_id);

COMMENT ON TABLE public.rentas_liquidaciones IS
  'Manejo de Rentas: desglose de cobro de una reserva (concepto → monto), venga de rentas_reservas o de reservas_str. Los totales se calculan con rentas_conceptos.';

-- SECURITY DEFINER: lee reservas_str y rentas_reservas, que quien escribe puede
-- no tener a la vista por su propia RLS (p. ej. sin la pestaña STR de Condominios).
CREATE OR REPLACE FUNCTION public.rentas_liquidacion_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prop  public.rentas_propiedades;
  v_clave text;
  v_valor jsonb;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.company_id     IS DISTINCT FROM OLD.company_id
          OR NEW.propiedad_id   IS DISTINCT FROM OLD.propiedad_id
          OR NEW.reserva_id     IS DISTINCT FROM OLD.reserva_id
          OR NEW.reserva_str_id IS DISTINCT FROM OLD.reserva_str_id) THEN
    RAISE EXCEPTION 'RENTAS_LIQUIDACION_INMUTABLE: una liquidación no cambia de reserva ni de propiedad'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_prop FROM public.rentas_propiedades p WHERE p.id = NEW.propiedad_id;
    IF NOT FOUND OR v_prop.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'RENTAS_PROPIEDAD_AJENA: la propiedad no es de esta empresa'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reserva_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.rentas_reservas r
                      WHERE r.id = NEW.reserva_id AND r.propiedad_id = NEW.propiedad_id) THEN
        RAISE EXCEPTION 'RENTAS_LIQUIDACION_RESERVA: la reserva no es de esa propiedad'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.reserva_str_id IS NOT NULL THEN
      IF v_prop.unidad_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM public.reservas_str s
                         WHERE s.id = NEW.reserva_str_id AND s.company_id = NEW.company_id
                           AND s.unidad_id = v_prop.unidad_id) THEN
        RAISE EXCEPTION 'RENTAS_LIQUIDACION_RESERVA: la reserva no es de esa propiedad'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF jsonb_typeof(NEW.importes) = 'object' THEN
    FOR v_clave, v_valor IN SELECT * FROM jsonb_each(NEW.importes) LOOP
      IF jsonb_typeof(v_valor) <> 'number' OR (v_valor #>> '{}')::numeric < 0
         OR (v_valor #>> '{}')::numeric > 9999999999.99 THEN
        RAISE EXCEPTION 'RENTAS_IMPORTE_INVALIDO: cada monto del desglose debe ser un número mayor o igual a cero'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.rentas_conceptos c
                      WHERE c.id::text = v_clave AND c.company_id = NEW.company_id) THEN
        RAISE EXCEPTION 'RENTAS_CONCEPTO_AJENO: el desglose usa un concepto que no es de esta empresa'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_liquidacion_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rentas_liquidaciones_coherente ON public.rentas_liquidaciones;
CREATE TRIGGER trg_rentas_liquidaciones_coherente
  BEFORE INSERT OR UPDATE ON public.rentas_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION public.rentas_liquidacion_coherente();
DROP TRIGGER IF EXISTS trg_rentas_liquidaciones_sello ON public.rentas_liquidaciones;
CREATE TRIGGER trg_rentas_liquidaciones_sello
  BEFORE INSERT OR UPDATE ON public.rentas_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rentas_liquidaciones_updated_at ON public.rentas_liquidaciones;
CREATE TRIGGER trg_rentas_liquidaciones_updated_at
  BEFORE UPDATE ON public.rentas_liquidaciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Gastos por propiedad
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_gastos (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id uuid          NOT NULL,
  fecha        date          NOT NULL,
  categoria    text          NOT NULL DEFAULT 'otro',
  descripcion  text          NOT NULL,
  proveedor    text,
  monto        numeric(12,2) NOT NULL,
  -- propietario: se le descuenta en su estado mensual; administradora: lo absorbe la empresa.
  a_cargo_de   text          NOT NULL DEFAULT 'propietario',
  notas        text,
  creado_por   uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT rentas_gastos_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_gastos_categoria_check
    CHECK (categoria IN ('limpieza', 'mantenimiento', 'servicios', 'suministros', 'impuestos', 'otro')),
  CONSTRAINT rentas_gastos_cargo_check CHECK (a_cargo_de IN ('propietario', 'administradora')),
  CONSTRAINT rentas_gastos_descripcion_check CHECK (btrim(descripcion) <> ''),
  CONSTRAINT rentas_gastos_monto_check CHECK (monto > 0)
);
CREATE INDEX IF NOT EXISTS idx_rentas_gastos_propiedad
  ON public.rentas_gastos (propiedad_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_rentas_gastos_company
  ON public.rentas_gastos (company_id, fecha DESC);

COMMENT ON TABLE public.rentas_gastos IS
  'Manejo de Rentas: gastos de cada propiedad (limpieza, mantenimiento, servicios…), a cargo del propietario o de la administradora.';

DROP TRIGGER IF EXISTS trg_rentas_gastos_coherente ON public.rentas_gastos;
CREATE TRIGGER trg_rentas_gastos_coherente
  BEFORE INSERT OR UPDATE ON public.rentas_gastos
  FOR EACH ROW EXECUTE FUNCTION public.rentas_hija_coherente();
DROP TRIGGER IF EXISTS trg_rentas_gastos_sello ON public.rentas_gastos;
CREATE TRIGGER trg_rentas_gastos_sello
  BEFORE INSERT OR UPDATE ON public.rentas_gastos
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rentas_gastos_updated_at ON public.rentas_gastos;
CREATE TRIGGER trg_rentas_gastos_updated_at
  BEFORE UPDATE ON public.rentas_gastos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rentas_conceptos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentas_liquidaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentas_gastos        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rentas_conceptos, public.rentas_liquidaciones, public.rentas_gastos
  FROM PUBLIC, anon, authenticated;
-- Los conceptos no se borran: se desactivan.
GRANT SELECT, INSERT, UPDATE ON public.rentas_conceptos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentas_liquidaciones, public.rentas_gastos TO authenticated;

-- 6.1 Conceptos: los lee quien captura reservas o ve finanzas; los configura Finanzas.
DROP POLICY IF EXISTS rentas_conceptos_select ON public.rentas_conceptos;
CREATE POLICY rentas_conceptos_select ON public.rentas_conceptos FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND ((SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false)))));
DROP POLICY IF EXISTS rentas_conceptos_insert ON public.rentas_conceptos;
CREATE POLICY rentas_conceptos_insert ON public.rentas_conceptos FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.rentas_servicio_activo())
              AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))
              AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.edit'), false)));
DROP POLICY IF EXISTS rentas_conceptos_update ON public.rentas_conceptos;
CREATE POLICY rentas_conceptos_update ON public.rentas_conceptos FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

-- 6.2 Liquidaciones: son parte de la reserva. Las lee Reservas o Finanzas; las
-- escribe quien puede crear o editar reservas.
DROP POLICY IF EXISTS rentas_liquidaciones_select ON public.rentas_liquidaciones;
CREATE POLICY rentas_liquidaciones_select ON public.rentas_liquidaciones FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND public.rentas_propiedad_accesible(propiedad_id)
             AND ((SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
               OR (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false)))));
DROP POLICY IF EXISTS rentas_liquidaciones_insert ON public.rentas_liquidaciones;
CREATE POLICY rentas_liquidaciones_insert ON public.rentas_liquidaciones FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.rentas_servicio_activo())
              AND public.rentas_propiedad_accesible(propiedad_id)
              AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
              AND ((SELECT COALESCE(public.user_has_permission('rentas.reservas.create'), false))
                OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false))));
DROP POLICY IF EXISTS rentas_liquidaciones_update ON public.rentas_liquidaciones;
CREATE POLICY rentas_liquidaciones_update ON public.rentas_liquidaciones FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.rentas_propiedad_accesible(propiedad_id));
DROP POLICY IF EXISTS rentas_liquidaciones_delete ON public.rentas_liquidaciones;
CREATE POLICY rentas_liquidaciones_delete ON public.rentas_liquidaciones FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false)));

-- 6.3 Gastos: módulo Finanzas.
DROP POLICY IF EXISTS rentas_gastos_select ON public.rentas_gastos;
CREATE POLICY rentas_gastos_select ON public.rentas_gastos FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND public.rentas_propiedad_accesible(propiedad_id)
             AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))));
DROP POLICY IF EXISTS rentas_gastos_insert ON public.rentas_gastos;
CREATE POLICY rentas_gastos_insert ON public.rentas_gastos FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.rentas_servicio_activo())
              AND public.rentas_propiedad_accesible(propiedad_id)
              AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))
              AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.create'), false)));
DROP POLICY IF EXISTS rentas_gastos_update ON public.rentas_gastos;
CREATE POLICY rentas_gastos_update ON public.rentas_gastos FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.rentas_propiedad_accesible(propiedad_id));
DROP POLICY IF EXISTS rentas_gastos_delete ON public.rentas_gastos;
CREATE POLICY rentas_gastos_delete ON public.rentas_gastos FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.finanzas.delete'), false)));

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Guarda: lo que tiene que existir al terminar
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_claves   int;
  v_policies int;
  v_sin_rls  int;
BEGIN
  SELECT count(*) INTO v_claves FROM public.permissions WHERE key LIKE 'rentas.finanzas.%';
  IF v_claves <> 4 THEN
    RAISE EXCEPTION 'rentas finanzas: se esperaban 4 claves rentas.finanzas.*, hay %', v_claves;
  END IF;
  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('rentas_conceptos', 'rentas_liquidaciones', 'rentas_gastos');
  IF v_policies <> 11 THEN
    RAISE EXCEPTION 'rentas finanzas: se esperaban 11 policies (3 + 4 + 4), hay %', v_policies;
  END IF;
  SELECT count(*) INTO v_sin_rls FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('rentas_conceptos', 'rentas_liquidaciones', 'rentas_gastos')
     AND NOT c.relrowsecurity;
  IF v_sin_rls <> 0 THEN
    RAISE EXCEPTION 'rentas finanzas: % tabla(s) sin RLS', v_sin_rls;
  END IF;
END;
$$;
