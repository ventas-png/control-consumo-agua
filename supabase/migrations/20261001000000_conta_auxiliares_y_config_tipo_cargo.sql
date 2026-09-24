-- ============================================================================
-- AUXILIARES DE CLIENTES Y UNIDADES · CONFIGURACIÓN POR TIPO DE CARGO
-- (primera entrega del bloque «auxiliares con imputación por tipo de cargo»)
--
-- QUÉ SE SEPARA. Hasta hoy la contabilidad sólo conocía la CUENTA. Cobrar a
-- cien condóminos obligaba a elegir entre una cuenta por cobrar por cliente
-- —que infla el catálogo y ata la nomenclatura del cliente al código
-- contable— o una sola cuenta donde los movimientos de todos se mezclan. Esta
-- migración separa cuatro conceptos que el modelo confundía:
--
--   · CUENTA       la clasificación del catálogo (conta_cuentas). Muchos
--                  clientes comparten la misma cuenta por cobrar.
--   · AUXILIAR     el cliente o tercero al que pertenece el movimiento. Se
--                  referencia SIEMPRE por `clientes.id`; su nomenclatura
--                  (conta_auxiliares.codigo) es independiente del catálogo.
--   · UNIDAD       el apartamento, local o casa relacionado (unidades.id).
--   · TIPO DE CARGO mantenimiento, cuota extraordinaria, agua, recargo… Un
--                  catálogo DECLARADO (conta_tipos_cargo) con claves estables.
--
-- QUÉ HACE ESTA ENTREGA (y qué NO):
--   1. Catálogo declarado de tipos de cargo. Sin depósitos ni anticipos: no
--      tienen flujo definido y no son ingreso por defecto.
--   2. Nomenclatura de auxiliares por empresa (conta_auxiliares).
--   3. Pagador designado por unidad (unidad_residentes.responsable_pago).
--      Propietario, residente y responsable de pago NO se suponen la misma
--      persona.
--   4. Responsable HISTÓRICO de cada cargo: se fija al emitir y no cambia al
--      cambiar el titular de la unidad. Las deudas anteriores no se
--      transfieren.
--   5. Tipo explícito en cuotas y plantillas (mantenimiento | extraordinaria).
--      Las cuotas existentes quedan sin clasificar: no se adivina por texto.
--   6. Configuración por (contabilidad, tipo de cargo): cuenta por cobrar,
--      cuenta de ingreso y —sólo para el tipo que ya calcula impuesto, agua—
--      cuenta de impuesto. Validada en servidor.
--   7. Dimensiones auxiliar / unidad / tipo de cargo en las líneas de asiento,
--      con validación de empresa y proyecto.
--
--   NO contabiliza nada nuevo, no cambia ningún trigger contable existente y
--   no rellena datos históricos. Contabilizar cargos con esta configuración es
--   la segunda entrega; el estado de cuenta, la tercera.
--
-- PRECEDENCIA CON conta_reglas_cargo (20260926000000). Esa tabla asigna UNA
-- cuenta por cliente/unidad/categoría y hoy NO tiene consumidor: el único
-- llamador del resolutor (facturas de proveedor) le pasa cliente, unidad y
-- categoría en NULL, así que su escalón 3 nunca se alcanza. Esta migración NO
-- la conecta con la configuración por tipo de cargo ni le da prioridad sobre
-- ella, ni al revés: no existe precedencia implícita entre las dos. Cómo se
-- combinan se decide —explícitamente y con pruebas— en la entrega que
-- contabilice cargos.
--
-- SEGURIDAD. Todas las funciones SECURITY DEFINER fijan search_path, revocan
-- EXECUTE a PUBLIC/anon y, salvo las de lectura para la UI, también a
-- authenticated. La escritura de configuración y nomenclatura exige
-- conta_puede_escribir(…) (rol legacy o permiso platform.contabilidad.*),
-- igual que conta_mapeo_cuentas.
--
-- CÓMO SE REVIERTE (en este orden):
--   DROP FUNCTION public.conta_config_tipos_cargo_estado(uuid);
--   DROP TABLE public.conta_config_tipo_cargo;
--   DROP TRIGGER trg_conta_linea_dimensiones ON public.conta_asiento_lineas;
--   ALTER TABLE public.conta_asiento_lineas
--     DROP COLUMN auxiliar_cliente_id, DROP COLUMN unidad_id, DROP COLUMN tipo_cargo;
--   DROP TRIGGER trg_responsable_cargo_ins ON public.cuotas_condominio;
--   DROP TRIGGER trg_responsable_cargo_upd ON public.cuotas_condominio;
--   DROP TRIGGER trg_responsable_cargo_ins ON public.cargos_adicionales_unidad;
--   DROP TRIGGER trg_responsable_cargo_upd ON public.cargos_adicionales_unidad;
--   ALTER TABLE public.cuotas_condominio DROP COLUMN responsable_cliente_id,
--     DROP COLUMN responsable_origen, DROP COLUMN tipo_cargo;
--   ALTER TABLE public.cargos_adicionales_unidad DROP COLUMN responsable_cliente_id,
--     DROP COLUMN responsable_origen;
--   ALTER TABLE public.plantillas_cuota DROP COLUMN tipo_cargo;
--   DROP TRIGGER audit_unidad_residentes ON public.unidad_residentes;
--   ALTER TABLE public.unidad_residentes DROP COLUMN responsable_pago;
--   DROP TABLE public.conta_auxiliares;
--   y DROP de las funciones conta_tipos_cargo, conta_tg_auxiliar,
--   conta_tg_config_tipo_cargo, conta_tg_linea_dimensiones,
--   responsable_resolver_de_unidad, responsable_valido_para_unidad,
--   tg_responsable_cargo_ins, tg_responsable_cargo_upd.
--   Ninguna columna existente cambia de tipo ni de contenido: revertir
--   devuelve el sistema al estado previo exacto.
-- ============================================================================

-- ── 1. Catálogo declarado de tipos de cargo ─────────────────────────────────
-- Igual que conta_destinos_imputacion(): una lista en código, visible en el
-- diff, con claves estables. `documentos` dice de qué tabla sale cada tipo;
-- `admite_impuesto` es true SOLO donde el sistema ya calcula un impuesto
-- (registros.iva_monto). Habilitar impuesto en otro tipo exige primero un
-- tratamiento definido, no una casilla.
CREATE OR REPLACE FUNCTION public.conta_tipos_cargo()
RETURNS TABLE (
  tipo_cargo      text,
  etiqueta        text,
  documentos      text[],
  admite_impuesto boolean,
  descripcion     text
)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('mantenimiento',           'Mantenimiento',
       ARRAY['cuotas_condominio'],          false,
       'Cuota ordinaria de mantenimiento o administración'),
    ('cuota_extraordinaria',    'Cuota extraordinaria',
       ARRAY['cuotas_condominio'],          false,
       'Cuota aprobada para obras, mejoras o gastos no recurrentes'),
    ('recargo_mora',            'Recargo por mora',
       ARRAY['cuotas_condominio','registros'], false,
       'Mora aplicada sobre una cuota o un cobro de agua vencido'),
    ('agua',                    'Servicio de agua',
       ARRAY['registros'],                  true,
       'Lectura facturada. Único tipo con impuesto calculado hoy (IVA)'),
    ('adicional_reparacion',    'Cargo adicional · reparación',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Reparación imputada a la unidad'),
    ('adicional_exceso_consumo','Cargo adicional · exceso de consumo',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Consumo por encima de lo incluido'),
    ('adicional_dano',          'Cargo adicional · daño',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Daño a áreas o bienes comunes'),
    ('adicional_servicio',      'Cargo adicional · servicio',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Servicio prestado a la unidad'),
    ('adicional_multa',         'Cargo adicional · multa',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Multa por incumplimiento del reglamento'),
    ('adicional_otro',          'Cargo adicional · otro',
       ARRAY['cargos_adicionales_unidad'],  false,
       'Cargo adicional sin categoría específica')
  ) AS t(tipo_cargo, etiqueta, documentos, admite_impuesto, descripcion)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tipos_cargo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_tipos_cargo() TO authenticated;

COMMENT ON FUNCTION public.conta_tipos_cargo() IS
  'Catálogo declarado de tipos de cargo con claves estables. Sin depósitos ni anticipos. admite_impuesto sólo donde ya existe un impuesto calculado (agua).';

-- ── 2. Nomenclatura de auxiliares por empresa ───────────────────────────────
-- Tabla propia y NO una columna de company_clientes: la policy UPDATE de
-- company_clientes deja editar la fila a cualquier usuario de la empresa, y la
-- nomenclatura contable tiene que quedar bajo el permiso de contabilidad.
--
-- La FK compuesta a company_clientes(company_id, cliente_id) es la que impide
-- dar nomenclatura en la empresa A a un cliente que sólo pertenece a B.
-- ON DELETE RESTRICT: desvincular de la empresa a un cliente que ya tiene
-- nomenclatura contable exige primero decidir qué pasa con ella.
CREATE TABLE public.conta_auxiliares (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id  uuid        NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  codigo      text        NOT NULL,
  activo      boolean     NOT NULL DEFAULT true,
  notas       text,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_auxiliares_cliente_de_la_empresa
    FOREIGN KEY (company_id, cliente_id)
    REFERENCES public.company_clientes(company_id, cliente_id) ON DELETE RESTRICT,
  CONSTRAINT conta_auxiliares_codigo_formato
    CHECK (codigo = btrim(codigo) AND char_length(codigo) BETWEEN 1 AND 40)
);

-- Un cliente tiene UNA nomenclatura por empresa, y un código identifica a UN
-- cliente dentro de la empresa. Sin distinguir mayúsculas: «AUX-1» y «aux-1»
-- en la misma empresa serían dos auxiliares que nadie distingue a la vista.
CREATE UNIQUE INDEX uq_conta_auxiliares_cliente
  ON public.conta_auxiliares(company_id, cliente_id);
CREATE UNIQUE INDEX uq_conta_auxiliares_codigo
  ON public.conta_auxiliares(company_id, lower(codigo));
CREATE INDEX idx_conta_auxiliares_cliente
  ON public.conta_auxiliares(cliente_id);

COMMENT ON TABLE public.conta_auxiliares IS
  'Nomenclatura contable del auxiliar (cliente) dentro de una empresa. Independiente del catálogo de cuentas; las relaciones usan cliente_id, nunca el código.';

-- Código automático si no se da uno, e inmutabilidad de la identidad. El
-- código SÍ se puede cambiar (es nomenclatura); a quién y de qué empresa, no.
CREATE OR REPLACE FUNCTION public.conta_tg_auxiliar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id <> OLD.company_id OR NEW.cliente_id <> OLD.cliente_id THEN
      RAISE EXCEPTION 'AUXILIAR_IDENTIDAD_INMUTABLE: la empresa y el cliente de un auxiliar no cambian; crea otro.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.codigo := NULLIF(btrim(COALESCE(NEW.codigo, '')), '');
  IF NEW.codigo IS NULL THEN
    -- Serializa la numeración por empresa: dos altas simultáneas no pueden
    -- proponer el mismo número.
    PERFORM pg_advisory_xact_lock(hashtext('conta_auxiliares:' || NEW.company_id::text));
    SELECT COALESCE(max((substring(codigo FROM '^AUX-([0-9]{1,9})$'))::int), 0) + 1
      INTO v_n
      FROM public.conta_auxiliares
     WHERE company_id = NEW.company_id;
    NEW.codigo := 'AUX-' || lpad(v_n::text, 5, '0');
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_auxiliar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_auxiliar
  BEFORE INSERT OR UPDATE ON public.conta_auxiliares
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_auxiliar();

-- ── 3. Pagador designado por unidad ─────────────────────────────────────────
-- Un residente activo por unidad puede marcarse como responsable de pago. Es
-- a quien se le cargan las cuotas que no dicen otro rol. El CHECK impide que
-- un residente dado de baja siga siendo el pagador; el índice parcial, que
-- haya dos.
ALTER TABLE public.unidad_residentes
  ADD COLUMN responsable_pago boolean NOT NULL DEFAULT false;

ALTER TABLE public.unidad_residentes
  ADD CONSTRAINT unidad_residentes_responsable_activo
  CHECK (NOT responsable_pago OR activo);

CREATE UNIQUE INDEX uq_unidad_residentes_responsable_pago
  ON public.unidad_residentes(unidad_id)
  WHERE responsable_pago;

COMMENT ON COLUMN public.unidad_residentes.responsable_pago IS
  'Pagador designado de la unidad (uno como máximo, y activo). Se usa al EMITIR un cargo sin rol responsable; cambiarlo no afecta cargos ya emitidos.';

-- Cambiar quién paga es un hecho con consecuencias de cobranza: se audita.
CREATE TRIGGER audit_unidad_residentes
  AFTER INSERT OR UPDATE OR DELETE ON public.unidad_residentes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ── 4. Tipo explícito en cuotas y plantillas ────────────────────────────────
-- Sólo los dos tipos que una cuota puede ser. NULL = sin clasificar, que es lo
-- que quedan TODAS las cuotas existentes: no se infiere del concepto.
ALTER TABLE public.plantillas_cuota
  ADD COLUMN tipo_cargo text;
ALTER TABLE public.plantillas_cuota
  ADD CONSTRAINT plantillas_cuota_tipo_cargo_check
  CHECK (tipo_cargo IS NULL OR tipo_cargo IN ('mantenimiento','cuota_extraordinaria'));

ALTER TABLE public.cuotas_condominio
  ADD COLUMN tipo_cargo text;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_tipo_cargo_check
  CHECK (tipo_cargo IS NULL OR tipo_cargo IN ('mantenimiento','cuota_extraordinaria'));

COMMENT ON COLUMN public.plantillas_cuota.tipo_cargo IS
  'Tipo de cargo que la generación estampa en cada cuota: mantenimiento | cuota_extraordinaria. NULL = sin clasificar.';
COMMENT ON COLUMN public.cuotas_condominio.tipo_cargo IS
  'mantenimiento | cuota_extraordinaria. NULL = sin clasificar (todas las cuotas previas a 20261001000000). No se infiere del concepto.';

-- ── 5. Responsable histórico de cada cargo ──────────────────────────────────
-- `responsable_cliente_id` es QUIÉN respondía por el cargo cuando se emitió.
-- Se fija en el INSERT y, una vez fijado, no cambia: cambiar el titular o el
-- pagador de la unidad después NO transfiere deudas anteriores.
-- `responsable_origen` dice cómo se determinó:
--   designado     el pagador designado de la unidad (cargo sin rol);
--   rol           el único residente activo con el rol del cargo (o, si hay
--                 varios con ese rol, el que es pagador designado);
--   explicito     elegido por quien emitió o corrigió el cargo;
--   sin_candidato no había candidato único: el cargo queda sin responsable y
--                 se reporta, en vez de adivinar.
-- NULL en ambas columnas = cargo anterior a esta migración o sin unidad. No
-- hay backfill: rellenar con el titular ACTUAL atribuiría deudas viejas a
-- quien quizá no las tenía.
ALTER TABLE public.cuotas_condominio
  ADD COLUMN responsable_cliente_id uuid REFERENCES public.clientes(id) ON DELETE RESTRICT,
  ADD COLUMN responsable_origen     text;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_responsable_origen_check
  CHECK (responsable_origen IS NULL
         OR responsable_origen IN ('designado','rol','explicito','sin_candidato')),
  ADD CONSTRAINT cuotas_condominio_responsable_coherente
  CHECK ((responsable_origen IS NULL AND responsable_cliente_id IS NULL)
         OR (responsable_origen = 'sin_candidato' AND responsable_cliente_id IS NULL)
         OR (responsable_origen <> 'sin_candidato' AND responsable_cliente_id IS NOT NULL));

ALTER TABLE public.cargos_adicionales_unidad
  ADD COLUMN responsable_cliente_id uuid REFERENCES public.clientes(id) ON DELETE RESTRICT,
  ADD COLUMN responsable_origen     text;
ALTER TABLE public.cargos_adicionales_unidad
  ADD CONSTRAINT cargos_adicionales_responsable_origen_check
  CHECK (responsable_origen IS NULL
         OR responsable_origen IN ('designado','explicito','sin_candidato')),
  ADD CONSTRAINT cargos_adicionales_responsable_coherente
  CHECK ((responsable_origen IS NULL AND responsable_cliente_id IS NULL)
         OR (responsable_origen = 'sin_candidato' AND responsable_cliente_id IS NULL)
         OR (responsable_origen <> 'sin_candidato' AND responsable_cliente_id IS NOT NULL));

CREATE INDEX idx_cuotas_condominio_responsable
  ON public.cuotas_condominio(responsable_cliente_id)
  WHERE responsable_cliente_id IS NOT NULL;
CREATE INDEX idx_cargos_adicionales_responsable
  ON public.cargos_adicionales_unidad(responsable_cliente_id)
  WHERE responsable_cliente_id IS NOT NULL;

COMMENT ON COLUMN public.cuotas_condominio.responsable_cliente_id IS
  'Responsable histórico: quién respondía por la cuota al emitirse. Inmutable una vez fijado. NULL = previa a 20261001000000, sin unidad o sin candidato.';
COMMENT ON COLUMN public.cargos_adicionales_unidad.responsable_cliente_id IS
  'Responsable histórico: quién respondía por el cargo al emitirse. Inmutable una vez fijado.';

-- Un cliente sirve como responsable de un cargo de la unidad si pertenece a la
-- empresa del cargo Y está relacionado con esa unidad: es o fue residente
-- registrado, o es su titular. No se exige que esté activo: corregir el
-- responsable de un cargo viejo puede nombrar a quien ya se fue.
CREATE OR REPLACE FUNCTION public.responsable_valido_para_unidad(
  p_company_id uuid,
  p_unidad_id  uuid,
  p_cliente_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.company_clientes cc
            WHERE cc.company_id = p_company_id AND cc.cliente_id = p_cliente_id)
     AND (
           EXISTS (SELECT 1 FROM public.unidad_residentes ur
                    WHERE ur.unidad_id = p_unidad_id
                      AND ur.company_id = p_company_id
                      AND ur.cliente_id = p_cliente_id)
        OR EXISTS (SELECT 1 FROM public.unidades u
                    WHERE u.id = p_unidad_id
                      AND u.company_id = p_company_id
                      AND u.cliente_id = p_cliente_id)
         )
$$;

REVOKE EXECUTE ON FUNCTION public.responsable_valido_para_unidad(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Quién responde HOY por un cargo nuevo de la unidad. Nunca adivina: sin
-- candidato único devuelve 'sin_candidato'.
CREATE OR REPLACE FUNCTION public.responsable_resolver_de_unidad(
  p_unidad_id uuid,
  p_rol       text,
  OUT cliente_id uuid,
  OUT origen     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  cliente_id := NULL;
  origen     := 'sin_candidato';

  IF p_rol IS NOT NULL THEN
    SELECT count(*) INTO v_n
      FROM public.unidad_residentes ur
     WHERE ur.unidad_id = p_unidad_id AND ur.activo AND ur.tipo = p_rol;
    IF v_n = 1 THEN
      SELECT ur.cliente_id INTO cliente_id
        FROM public.unidad_residentes ur
       WHERE ur.unidad_id = p_unidad_id AND ur.activo AND ur.tipo = p_rol;
      origen := 'rol';
    ELSIF v_n > 1 THEN
      -- Varios con ese rol: sólo desempata el pagador designado, si es uno de
      -- ellos. Si no, no se elige a nadie.
      SELECT ur.cliente_id INTO cliente_id
        FROM public.unidad_residentes ur
       WHERE ur.unidad_id = p_unidad_id AND ur.activo AND ur.tipo = p_rol
         AND ur.responsable_pago;
      IF cliente_id IS NOT NULL THEN
        origen := 'rol';
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT ur.cliente_id INTO cliente_id
    FROM public.unidad_residentes ur
   WHERE ur.unidad_id = p_unidad_id AND ur.responsable_pago;
  IF cliente_id IS NOT NULL THEN
    origen := 'designado';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.responsable_resolver_de_unidad(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- INSERT: fija el responsable. Si el emisor lo dio, se valida; si no, se
-- resuelve. Un cargo sin unidad no tiene a quién atribuirse por unidad.
CREATE OR REPLACE FUNCTION public.tg_responsable_cargo_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  r     record;
BEGIN
  IF NEW.unidad_id IS NULL THEN
    IF NEW.responsable_cliente_id IS NOT NULL THEN
      RAISE EXCEPTION 'RESPONSABLE_SIN_UNIDAD: un cargo sin unidad no admite responsable por unidad.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.responsable_origen := NULL;
    RETURN NEW;
  END IF;

  IF NEW.responsable_cliente_id IS NOT NULL THEN
    IF NOT public.responsable_valido_para_unidad(NEW.company_id, NEW.unidad_id, NEW.responsable_cliente_id) THEN
      RAISE EXCEPTION 'RESPONSABLE_AJENO: el responsable no pertenece a la empresa o no está relacionado con la unidad.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.responsable_origen := 'explicito';
    RETURN NEW;
  END IF;

  -- Sólo las cuotas llevan rol responsable; los cargos adicionales van al
  -- pagador designado.
  IF TG_TABLE_NAME = 'cuotas_condominio' THEN
    v_rol := to_jsonb(NEW)->>'rol_responsable';
  END IF;

  SELECT * INTO r FROM public.responsable_resolver_de_unidad(NEW.unidad_id, v_rol);
  NEW.responsable_cliente_id := r.cliente_id;
  NEW.responsable_origen     := r.origen;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_responsable_cargo_ins() FROM PUBLIC, anon, authenticated;

-- UPDATE: una vez fijado, no cambia. Si quedó sin responsable, se puede
-- asignar UNA vez, explícitamente y con la misma validación.
CREATE OR REPLACE FUNCTION public.tg_responsable_cargo_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.responsable_cliente_id IS NOT DISTINCT FROM OLD.responsable_cliente_id
     AND NEW.responsable_origen IS NOT DISTINCT FROM OLD.responsable_origen THEN
    RETURN NEW;
  END IF;

  IF OLD.responsable_cliente_id IS NOT NULL THEN
    RAISE EXCEPTION 'RESPONSABLE_INMUTABLE: el responsable histórico de un cargo no se cambia.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.responsable_cliente_id IS NULL THEN
    -- Nadie asignado: el origen tampoco se reescribe a mano.
    NEW.responsable_origen := OLD.responsable_origen;
    RETURN NEW;
  END IF;

  IF NEW.unidad_id IS NULL
     OR NOT public.responsable_valido_para_unidad(NEW.company_id, NEW.unidad_id, NEW.responsable_cliente_id) THEN
    RAISE EXCEPTION 'RESPONSABLE_AJENO: el responsable no pertenece a la empresa o no está relacionado con la unidad.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.responsable_origen := 'explicito';
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_responsable_cargo_upd() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_responsable_cargo_ins
  BEFORE INSERT ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.tg_responsable_cargo_ins();
CREATE TRIGGER trg_responsable_cargo_upd
  BEFORE UPDATE OF responsable_cliente_id, responsable_origen ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.tg_responsable_cargo_upd();

CREATE TRIGGER trg_responsable_cargo_ins
  BEFORE INSERT ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.tg_responsable_cargo_ins();
CREATE TRIGGER trg_responsable_cargo_upd
  BEFORE UPDATE OF responsable_cliente_id, responsable_origen ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.tg_responsable_cargo_upd();

-- ── 6. Configuración por tipo de cargo ──────────────────────────────────────
-- Una fila por (contabilidad, tipo de cargo). La contabilidad es el ledger:
-- `project_id` NULL = ledger de EMPRESA; con valor = el del proyecto. Sin
-- herencia entre ellos, igual que conta_mapeo_cuentas.
CREATE TABLE public.conta_config_tipo_cargo (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  tipo_cargo         text        NOT NULL,
  cuenta_cxc_id      uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  cuenta_ingreso_id  uuid        NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  cuenta_impuesto_id uuid        REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  activa             boolean     NOT NULL DEFAULT true,
  notas              text,
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conta_config_tipo_cargo_cuentas_distintas
    CHECK (cuenta_cxc_id <> cuenta_ingreso_id
           AND (cuenta_impuesto_id IS NULL
                OR (cuenta_impuesto_id <> cuenta_cxc_id AND cuenta_impuesto_id <> cuenta_ingreso_id)))
);

CREATE UNIQUE INDEX uq_conta_config_tipo_cargo_ledger
  ON public.conta_config_tipo_cargo(
    company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    tipo_cargo);

CREATE INDEX idx_conta_config_tipo_cargo_cxc      ON public.conta_config_tipo_cargo(cuenta_cxc_id);
CREATE INDEX idx_conta_config_tipo_cargo_ingreso  ON public.conta_config_tipo_cargo(cuenta_ingreso_id);
CREATE INDEX idx_conta_config_tipo_cargo_impuesto ON public.conta_config_tipo_cargo(cuenta_impuesto_id)
  WHERE cuenta_impuesto_id IS NOT NULL;

COMMENT ON TABLE public.conta_config_tipo_cargo IS
  'Cuenta por cobrar, de ingreso y (sólo agua) de impuesto por tipo de cargo, dentro de UNA contabilidad. Sin códigos fijos ni elección por nombre. Sin precedencia implícita con conta_reglas_cargo.';

-- Todo lo que hace servible una configuración se comprueba en el servidor,
-- con un código de error por causa para que la UI diga QUÉ arreglar.
CREATE OR REPLACE FUNCTION public.conta_tg_config_tipo_cargo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admite boolean;
  v_rol    text;
  v_id     uuid;
  v_tipo   text;
  c        record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.company_id <> OLD.company_id
          OR NEW.project_id IS DISTINCT FROM OLD.project_id
          OR NEW.tipo_cargo <> OLD.tipo_cargo) THEN
    RAISE EXCEPTION 'CONFIG_IDENTIDAD_INMUTABLE: la contabilidad y el tipo de cargo de una configuración no cambian.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.admite_impuesto INTO v_admite
    FROM public.conta_tipos_cargo() t WHERE t.tipo_cargo = NEW.tipo_cargo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_TIPO_DESCONOCIDO: «%» no es un tipo de cargo del catálogo.', NEW.tipo_cargo
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'CONFIG_PROYECTO_AJENO: el proyecto no pertenece a la empresa de la configuración.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.cuenta_impuesto_id IS NOT NULL AND NOT v_admite THEN
    RAISE EXCEPTION 'CONFIG_IMPUESTO_NO_SOPORTADO: el tipo «%» no tiene tratamiento de impuesto definido.', NEW.tipo_cargo
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_rol, v_id, v_tipo IN
    SELECT * FROM (VALUES
      ('cuenta por cobrar',   NEW.cuenta_cxc_id,      'activo'),
      ('cuenta de ingreso',   NEW.cuenta_ingreso_id,  'ingreso'),
      ('cuenta de impuesto',  NEW.cuenta_impuesto_id, 'pasivo')
    ) AS x(rol, id, tipo)
    WHERE x.id IS NOT NULL
  LOOP
    SELECT company_id, project_id, es_detalle, activa, tipo, codigo INTO c
      FROM public.conta_cuentas WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONFIG_CUENTA_INEXISTENTE: la % no existe.', v_rol
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF c.company_id <> NEW.company_id OR c.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'CONFIG_LEDGER: la % pertenece a otra contabilidad (empresa/proyecto).', v_rol
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT c.es_detalle THEN
      RAISE EXCEPTION 'CONFIG_CUENTA_AGRUPADORA: la % (%) es agrupadora; sólo las de detalle reciben movimientos.', v_rol, c.codigo
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT c.activa THEN
      RAISE EXCEPTION 'CONFIG_CUENTA_INACTIVA: la % (%) está desactivada.', v_rol, c.codigo
        USING ERRCODE = 'check_violation';
    END IF;
    IF c.tipo <> v_tipo THEN
      RAISE EXCEPTION 'CONFIG_TIPO_CUENTA: la % (%) es de tipo «%» y debe ser «%».', v_rol, c.codigo, c.tipo, v_tipo
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_config_tipo_cargo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_config_tipo_cargo
  BEFORE INSERT OR UPDATE ON public.conta_config_tipo_cargo
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_config_tipo_cargo();

-- Estado de la configuración para la UI: cada tipo del catálogo con su fila
-- (si existe) y si SIGUE siendo servible. Una cuenta válida al configurar
-- puede desactivarse después; eso tiene que verse aquí, no al contabilizar.
-- SECURITY INVOKER: lee con la RLS de quien pregunta.
CREATE OR REPLACE FUNCTION public.conta_config_tipos_cargo_estado(p_project_id uuid)
RETURNS TABLE (
  tipo_cargo         text,
  etiqueta           text,
  admite_impuesto    boolean,
  config_id          uuid,
  cuenta_cxc_id      uuid,
  cuenta_ingreso_id  uuid,
  cuenta_impuesto_id uuid,
  activa             boolean,
  estado             text,
  motivo             text
)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT k.* FROM public.conta_config_tipo_cargo k
     WHERE k.company_id = v_company
       AND k.project_id IS NOT DISTINCT FROM p_project_id
  ),
  malas AS (
    SELECT cfg.id,
           string_agg(format('%s (%s): %s', x.rol, cc.codigo,
             CASE WHEN NOT cc.activa THEN 'inactiva'
                  WHEN NOT cc.es_detalle THEN 'agrupadora'
                  ELSE 'tipo incompatible' END), '; ' ORDER BY x.orden) AS motivo
      FROM cfg
      CROSS JOIN LATERAL (VALUES
        (1, 'cuenta por cobrar',  cfg.cuenta_cxc_id,      'activo'),
        (2, 'cuenta de ingreso',  cfg.cuenta_ingreso_id,  'ingreso'),
        (3, 'cuenta de impuesto', cfg.cuenta_impuesto_id, 'pasivo')
      ) AS x(orden, rol, id, tipo)
      JOIN public.conta_cuentas cc ON cc.id = x.id
     WHERE NOT (cc.activa AND cc.es_detalle AND cc.tipo = x.tipo)
     GROUP BY cfg.id
  )
  SELECT t.tipo_cargo, t.etiqueta, t.admite_impuesto,
         cfg.id, cfg.cuenta_cxc_id, cfg.cuenta_ingreso_id, cfg.cuenta_impuesto_id,
         cfg.activa,
         CASE WHEN cfg.id IS NULL THEN 'sin_configurar'
              WHEN malas.id IS NOT NULL THEN 'cuenta_invalida'
              WHEN NOT cfg.activa THEN 'inactiva'
              ELSE 'ok' END,
         malas.motivo
    FROM public.conta_tipos_cargo() t
    LEFT JOIN cfg   ON cfg.tipo_cargo = t.tipo_cargo
    LEFT JOIN malas ON malas.id = cfg.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_config_tipos_cargo_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_config_tipos_cargo_estado(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_config_tipos_cargo_estado(uuid) IS
  'Cada tipo de cargo del catálogo con su configuración en el ledger indicado (NULL = empresa) y si sigue siendo servible: ok | sin_configurar | cuenta_invalida | inactiva.';

-- ── 7. Dimensiones de las líneas de asiento ─────────────────────────────────
-- Opcionales: una línea de banco o de gasto no tiene auxiliar. Cuando existen,
-- son las que separan los movimientos de dos clientes que comparten la misma
-- cuenta por cobrar.
ALTER TABLE public.conta_asiento_lineas
  ADD COLUMN auxiliar_cliente_id uuid REFERENCES public.clientes(id) ON DELETE RESTRICT,
  ADD COLUMN unidad_id           uuid REFERENCES public.unidades(id) ON DELETE RESTRICT,
  ADD COLUMN tipo_cargo          text;

-- SIN índices nuevos en esta entrega, a propósito: los índices de
-- conta_asiento_lineas ya difieren entre producción y el repositorio (drift
-- declarado, inventario en #826) y tocarlos aquí volvería ambiguo al auditor.
-- Ninguna consulta de esta entrega filtra por estas columnas; el índice por
-- (cuenta, auxiliar) llega con el estado de cuenta, que es quien lo usa, una
-- vez reconciliados los índices contra producción.

COMMENT ON COLUMN public.conta_asiento_lineas.auxiliar_cliente_id IS
  'Auxiliar (cliente) del movimiento. Por id estable; la nomenclatura vive en conta_auxiliares.';
COMMENT ON COLUMN public.conta_asiento_lineas.unidad_id IS
  'Unidad relacionada con el movimiento, si la hay.';
COMMENT ON COLUMN public.conta_asiento_lineas.tipo_cargo IS
  'Tipo de cargo (conta_tipos_cargo) que originó el movimiento, si lo hay.';

-- Impide la referencia cruzada: el auxiliar tiene que ser cliente de la
-- empresa de la póliza, y la unidad, de su empresa y —en un ledger de
-- proyecto— de ese proyecto. La empresa se lee de la CABECERA: esta función
-- puede correr antes que conta_tg_linea_mismo_ledger, que es la que la copia.
CREATE OR REPLACE FUNCTION public.conta_tg_linea_dimensiones()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  IF NEW.auxiliar_cliente_id IS NULL AND NEW.unidad_id IS NULL AND NEW.tipo_cargo IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id, project_id INTO v_company, v_project
    FROM public.conta_asientos WHERE id = NEW.asiento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTA_LEDGER: la póliza de la línea no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.auxiliar_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_clientes cc
     WHERE cc.company_id = v_company AND cc.cliente_id = NEW.auxiliar_cliente_id
  ) THEN
    RAISE EXCEPTION 'CONTA_AUXILIAR_AJENO: el auxiliar no es cliente de la empresa de la póliza.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.unidad_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.unidades u
     WHERE u.id = NEW.unidad_id
       AND u.company_id = v_company
       AND (v_project IS NULL OR u.project_id = v_project)
  ) THEN
    RAISE EXCEPTION 'CONTA_UNIDAD_AJENA: la unidad no pertenece a la empresa o al proyecto de la póliza.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tipo_cargo IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conta_tipos_cargo() t WHERE t.tipo_cargo = NEW.tipo_cargo
  ) THEN
    RAISE EXCEPTION 'CONTA_TIPO_CARGO_DESCONOCIDO: «%» no es un tipo de cargo del catálogo.', NEW.tipo_cargo
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_linea_dimensiones() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_linea_dimensiones
  BEFORE INSERT OR UPDATE OF auxiliar_cliente_id, unidad_id, tipo_cargo, asiento_id
  ON public.conta_asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_linea_dimensiones();

-- ── 8. RLS de las tablas nuevas ─────────────────────────────────────────────
-- Mismo molde que conta_mapeo_cuentas tras 20260818000000: lectura para la
-- empresa activa; escritura para el rol legacy o el permiso
-- platform.contabilidad.<acción>, siempre dentro de la empresa activa.
ALTER TABLE public.conta_auxiliares        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_config_tipo_cargo ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conta_auxiliares', 'conta_config_tipo_cargo'] LOOP
    EXECUTE format($p$
      CREATE POLICY %1$I ON public.%2$I FOR SELECT TO authenticated
        USING (company_id = (SELECT public.get_my_company_id()) OR (SELECT public.is_super_admin()))
    $p$, t || '_select', t);
    EXECUTE format($p$
      CREATE POLICY %1$I ON public.%2$I FOR INSERT TO authenticated
        WITH CHECK ((SELECT public.is_super_admin())
                    OR (company_id = (SELECT public.get_my_company_id())
                        AND (SELECT public.conta_puede_escribir('create'))))
    $p$, t || '_insert', t);
    EXECUTE format($p$
      CREATE POLICY %1$I ON public.%2$I FOR UPDATE TO authenticated
        USING ((SELECT public.is_super_admin())
               OR (company_id = (SELECT public.get_my_company_id())
                   AND (SELECT public.conta_puede_escribir('edit'))))
        WITH CHECK ((SELECT public.is_super_admin())
                    OR (company_id = (SELECT public.get_my_company_id())
                        AND (SELECT public.conta_puede_escribir('edit'))))
    $p$, t || '_update', t);
    EXECUTE format($p$
      CREATE POLICY %1$I ON public.%2$I FOR DELETE TO authenticated
        USING ((SELECT public.is_super_admin())
               OR (company_id = (SELECT public.get_my_company_id())
                   AND (SELECT public.conta_puede_escribir('delete'))))
    $p$, t || '_delete', t);
  END LOOP;
END $$;

-- Auditoría de cambios de configuración y nomenclatura.
CREATE TRIGGER audit_conta_auxiliares
  AFTER INSERT OR UPDATE OR DELETE ON public.conta_auxiliares
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_conta_config_tipo_cargo
  AFTER INSERT OR UPDATE OR DELETE ON public.conta_config_tipo_cargo
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Privilegios de tabla explícitos, sin depender de DEFAULT PRIVILEGES: anon
-- no entra; authenticated opera bajo RLS.
REVOKE ALL ON public.conta_auxiliares, public.conta_config_tipo_cargo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.conta_auxiliares, public.conta_config_tipo_cargo TO authenticated;
