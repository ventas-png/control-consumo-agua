-- ════════════════════════════════════════════════════════════════════════════
-- CONTRATOS · RENOVACIÓN CON HISTORIAL Y AMPLIACIONES DOCUMENTADAS
--
-- QUÉ FALTABA
--   · Renovar un contrato era «terminarlo y crear otro» a mano: nada ligaba al nuevo con el
--     anterior, así que el historial, el respaldo y las órdenes del primero quedaban sueltos.
--   · Ampliar la vigencia (prórroga) quedaba en el historial SIN el motivo, y un contrato
--     activo no podía ampliar su monto máximo sin editar una condición congelada.
--
-- QUÉ HACE
--   1. `contrato_renovar()` (RPC, SECURITY INVOKER: RLS y triggers de contratos rigen igual)
--      crea un contrato NUEVO en BORRADOR, con los mismos proveedor y condiciones (salvo lo que
--      se indique), ligado al anterior por `renovado_de`. El anterior NO cambia: conserva
--      condiciones, estado, respaldo, órdenes e historial. Activar el nuevo sigue siendo un
--      acto explícito. Renovar no genera órdenes, facturas, pagos ni asientos. Reintentar la
--      misma renovación (mismo contrato y fecha de inicio) devuelve la ya creada.
--      Cada contrato guarda en su historial el evento (`renovacion` / `renovado_por`) con su motivo.
--   2. `contrato_prorrogar()` (RPC): única vía para AMPLIAR la vigencia; exige motivo, que queda
--      en el evento `prorroga`. Un UPDATE directo que amplía sin motivo se rechaza
--      (`CONTRATO_AMPLIACION_MOTIVO`); reducir sigue siendo libre.
--   3. `contrato_ampliaciones` (append-only) y `contrato_ampliar_monto()` (RPC): subir el monto
--      máximo de un contrato ACTIVO sin sobrescribir la condición original: el máximo vigente es
--      el original más las ampliaciones documentadas (quién, cuándo, cuánto, por qué). Solo si el
--      contrato YA tiene monto máximo: un contrato sin límite total no recibe uno inventado.
--      Idempotente por clave: un reintento no duplica la ampliación.
--
-- Se reemplazan `contratos_proveedores_tg()` y `…_eventos_tg()` (copia de 20261020000600 con el
-- control del motivo y el motivo en el evento) y `contrato_monto_maximo_vigente()`.
--
-- CÓMO REVERTIR
--   restaurar ambas funciones desde 20261020000600; DROP FUNCTION contrato_renovar(...),
--   contrato_prorrogar(...), contrato_ampliar_monto(...); DROP TABLE contrato_ampliaciones;
--   DROP TRIGGER trg_contratos_renovacion / trg_contratos_renovacion_ev ON contratos_proveedores;
--   DROP INDEX uq_contratos_renovacion; ALTER TABLE contratos_proveedores DROP COLUMN renovado_de;
--   restaurar el CHECK de contrato_proveedor_eventos.tipo desde 20261020000100.
-- IMPACTO EN DATOS: ninguno sobre filas existentes (columna nueva NULL).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.contratos_proveedores
  ADD COLUMN IF NOT EXISTS renovado_de uuid REFERENCES public.contratos_proveedores(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_renovacion
  ON public.contratos_proveedores (renovado_de, fecha_inicio) WHERE renovado_de IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_renovado_de
  ON public.contratos_proveedores (renovado_de) WHERE renovado_de IS NOT NULL;

COMMENT ON COLUMN public.contratos_proveedores.renovado_de IS
  'Contrato al que renueva este (cadena de renovaciones). Lo fija solo contrato_renovar(); el anterior conserva todo.';

ALTER TABLE public.contrato_proveedor_eventos DROP CONSTRAINT IF EXISTS contrato_proveedor_eventos_tipo_check;
ALTER TABLE public.contrato_proveedor_eventos
  ADD CONSTRAINT contrato_proveedor_eventos_tipo_check
  CHECK (tipo IN ('alta', 'estado', 'vinculo_proveedor', 'vinculo_revertido', 'prorroga',
                  'renovacion', 'renovado_por', 'ampliacion_monto'));

-- ── Guarda del contrato y su historial (con el motivo de la ampliación) ─────
CREATE OR REPLACE FUNCTION public.contratos_proveedores_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amplia boolean;
  v_sistema    boolean := COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on';
  v_vinculando boolean := COALESCE(current_setting('proveedores.vinculando_contrato', true), 'off') = 'on';
  v_prov       record;
  v_cto        record;
  v_estado_cambia boolean;
  v_activando  boolean;
  v_transicion_ok boolean;
  v_prefijo    text;
BEGIN
  -- Coherencia empresa/proyecto: el contrato vive en UN proyecto de SU empresa.
  IF NOT EXISTS (
    SELECT 1 FROM public.projects pr
     WHERE pr.id = NEW.project_id AND pr.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'CONTRATO_PROYECTO_AJENO: el proyecto no pertenece a la empresa del contrato.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.project_id <> OLD.project_id) THEN
    RAISE EXCEPTION 'CONTRATO_INMUTABLE: un contrato no cambia de empresa ni de proyecto.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.referencia := NULLIF(btrim(NEW.referencia), '');
  NEW.updated_at := now();

  -- ── Alta ───────────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());

    IF NOT v_sistema THEN
      IF NEW.proveedor_id IS NULL THEN
        RAISE EXCEPTION 'CONTRATO_PROVEEDOR_REQUERIDO: los contratos nuevos se vinculan a un proveedor del catálogo.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.estado <> 'borrador' THEN
        RAISE EXCEPTION 'CONTRATO_ALTA_BORRADOR: los contratos nuevos nacen en borrador; actívalos explícitamente.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.modalidad IS NULL THEN
        RAISE EXCEPTION 'CONTRATO_MODALIDAD_REQUERIDA: indica si es un servicio recurrente o una compra por demanda.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.proveedor_id IS NOT NULL THEN
      SELECT p.id, p.company_id, p.codigo, p.nombre, p.nit, p.rfc, p.pais, p.direccion, p.estado
        INTO v_prov FROM public.proveedores p WHERE p.id = NEW.proveedor_id;

      IF NOT FOUND OR v_prov.company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'CONTRATO_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa del contrato.'
          USING ERRCODE = 'check_violation';
      END IF;

      -- Un proveedor suspendido o vetado no recibe compromisos NUEVOS. Uno en
      -- borrador/revisión sí admite el contrato en borrador (se prepara
      -- mientras se completa su papelería), pero no se activa (más abajo).
      IF v_prov.estado IN ('suspendido', 'vetado') THEN
        RAISE EXCEPTION 'CONTRATO_PROVEEDOR_NO_AUTORIZADO: "%" está en estado "%"; no se le crean contratos nuevos.',
          v_prov.nombre, v_prov.estado USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.proveedor_proyectos pp
                  WHERE pp.proveedor_id = NEW.proveedor_id AND pp.project_id = NEW.project_id
                    AND pp.estado IN ('suspendido', 'retirado')) THEN
        RAISE EXCEPTION 'CONTRATO_PROVEEDOR_PROYECTO_NO_HABILITADO: el proveedor está suspendido o retirado en este proyecto.'
          USING ERRCODE = 'check_violation';
      END IF;

      -- La FOTOGRAFÍA: lo firmado queda con los datos de hoy del proveedor.
      NEW.proveedor_nombre := v_prov.nombre;
      NEW.proveedor_snapshot := jsonb_build_object(
        'proveedor_id', v_prov.id, 'codigo', v_prov.codigo, 'nombre', v_prov.nombre,
        'nit', v_prov.nit, 'rfc', v_prov.rfc, 'pais', v_prov.pais,
        'direccion', v_prov.direccion, 'tomada_el', now());

      IF NEW.contacto_id IS NOT NULL THEN
        SELECT c.nombre, c.email, c.telefono INTO v_cto
          FROM public.proveedor_contactos c
         WHERE c.id = NEW.contacto_id AND c.proveedor_id = NEW.proveedor_id
           AND c.company_id = NEW.company_id AND c.activo;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'CONTRATO_CONTACTO_AJENO: el contacto no es un contacto activo de ese proveedor.'
            USING ERRCODE = 'check_violation';
        END IF;
        -- El contacto del contrato es SU fotografía: se copia salvo que se haya
        -- escrito uno específico.
        NEW.proveedor_contacto  := COALESCE(NULLIF(btrim(NEW.proveedor_contacto), ''),  v_cto.nombre);
        NEW.proveedor_email     := COALESCE(NULLIF(btrim(NEW.proveedor_email), ''),     v_cto.email);
        NEW.proveedor_telefono  := COALESCE(NULLIF(btrim(NEW.proveedor_telefono), ''),  v_cto.telefono);
      END IF;
    END IF;

    -- Modalidad: lo recurrente tiene periodicidad; lo demandado no tiene
    -- importe periódico (puede tener tope).
    IF NEW.modalidad = 'recurrente' AND NEW.periodicidad IS NULL AND NOT v_sistema THEN
      RAISE EXCEPTION 'CONTRATO_PERIODICIDAD_REQUERIDA: un servicio recurrente necesita su periodicidad.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.modalidad = 'por_demanda' AND NEW.importe_periodico IS NOT NULL THEN
      RAISE EXCEPTION 'CONTRATO_IMPORTE_PERIODICO: una compra por demanda no lleva importe periódico; usa el monto máximo si hay tope.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.proveedor_id IS NOT NULL THEN
      NEW.monto_mensual := CASE WHEN NEW.periodicidad = 'mensual' THEN NEW.importe_periodico END;
    END IF;

    RETURN NEW;
  END IF;

  -- ── Actualización ──────────────────────────────────────────────────────────
  -- El proveedor, una vez fijado, no cambia; y sin él no se asigna a mano
  -- (solo la RPC de vínculo histórico, que enciende el GUC).
  IF OLD.proveedor_id IS NOT NULL AND NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id AND NOT v_vinculando THEN
    RAISE EXCEPTION 'CONTRATO_PROVEEDOR_INMUTABLE: el proveedor de un contrato no cambia. Termina este contrato y crea uno nuevo con el otro proveedor.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.proveedor_id IS NULL AND NEW.proveedor_id IS NOT NULL AND NOT v_vinculando THEN
    RAISE EXCEPTION 'CONTRATO_VINCULO_POR_RPC: un contrato histórico se vincula con contrato_vincular_proveedor(), que deja constancia.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_vinculando AND NEW.proveedor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.proveedores p
                      WHERE p.id = NEW.proveedor_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CONTRATO_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa del contrato.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La fotografía no se reescribe.
  IF OLD.proveedor_id IS NOT NULL AND NOT v_sistema
     AND (NEW.proveedor_nombre IS DISTINCT FROM OLD.proveedor_nombre
          OR NEW.proveedor_snapshot IS DISTINCT FROM OLD.proveedor_snapshot) THEN
    RAISE EXCEPTION 'CONTRATO_FOTOGRAFIA_INMUTABLE: los datos del proveedor tal como se firmó el contrato no se modifican.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_estado_cambia := NEW.estado IS DISTINCT FROM OLD.estado;

  -- Cada cambio de estado trae SU motivo: el de la transición anterior que
  -- quedó en la fila no vale (si valiera, terminar un contrato que se suspendió
  -- antes pasaría «con motivo» sin que nadie lo escribiera).
  IF v_estado_cambia AND NEW.motivo_estado IS NOT DISTINCT FROM OLD.motivo_estado THEN
    NEW.motivo_estado := NULL;
  END IF;

  IF v_estado_cambia AND NOT v_sistema THEN
    -- (variable aparte: plpgsql corta la condición del IF en el primer THEN, y
    -- el del CASE la rompería)
    v_transicion_ok := CASE OLD.estado
         WHEN 'borrador'   THEN NEW.estado IN ('activo', 'cancelado')
         WHEN 'activo'     THEN NEW.estado IN ('suspendido', 'vencido', 'terminado', 'cancelado')
         WHEN 'suspendido' THEN NEW.estado IN ('activo', 'terminado', 'cancelado')
         WHEN 'vencido'    THEN NEW.estado IN ('activo', 'terminado', 'cancelado')
         ELSE false          -- terminado / cancelado: finales
       END;
    IF NOT v_transicion_ok THEN
      RAISE EXCEPTION 'CONTRATO_TRANSICION_INVALIDA: de "%" a "%" no es un cambio de estado permitido.',
        OLD.estado, NEW.estado USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.estado IN ('suspendido', 'terminado', 'cancelado')
       AND btrim(COALESCE(NEW.motivo_estado, '')) = '' THEN
      RAISE EXCEPTION 'CONTRATO_MOTIVO_REQUERIDO: pasar a "%" exige indicar el motivo.', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_activando := v_estado_cambia AND NEW.estado = 'activo';

  -- Condiciones económicas: se editan en borrador; activo en adelante, no.
  -- (Aplica a contratos nuevos; el histórico conserva su comportamiento.)
  IF OLD.proveedor_id IS NOT NULL AND OLD.estado <> 'borrador' AND NOT v_sistema
     AND (NEW.modalidad          IS DISTINCT FROM OLD.modalidad
          OR NEW.periodicidad    IS DISTINCT FROM OLD.periodicidad
          OR NEW.moneda          IS DISTINCT FROM OLD.moneda
          OR NEW.importe_periodico IS DISTINCT FROM OLD.importe_periodico
          OR NEW.monto_maximo    IS DISTINCT FROM OLD.monto_maximo
          OR NEW.monto_mensual   IS DISTINCT FROM OLD.monto_mensual
          OR NEW.fecha_inicio    IS DISTINCT FROM OLD.fecha_inicio
          OR NEW.alcance         IS DISTINCT FROM OLD.alcance
          OR NEW.servicio        IS DISTINCT FROM OLD.servicio) THEN
    RAISE EXCEPTION 'CONTRATO_CONDICIONES_CONGELADAS: las condiciones de un contrato ya activado no se editan. Termínalo o cancélalo y crea uno nuevo.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.proveedor_id IS NOT NULL AND NOT v_sistema THEN
    -- Activar, reanudar y prorrogar son compromisos NUEVOS: exigen proveedor
    -- habilitado hoy en este proyecto. Terminar, cancelar, suspender o marcar
    -- vencido NO: son las vías para resolver lo anterior.
    -- «Ampliar la vigencia» incluye pasar a INDEFINIDO (fecha_fin → NULL): es
    -- el compromiso más largo posible. Pasar de indefinido a una fecha, o a una
    -- fecha anterior, es REDUCIR el plazo y no exige nada (es la salida).
    v_amplia := OLD.estado <> 'borrador'
      AND OLD.fecha_fin IS NOT NULL
      AND NEW.fecha_fin IS DISTINCT FROM OLD.fecha_fin
      AND (NEW.fecha_fin IS NULL OR NEW.fecha_fin > OLD.fecha_fin);
    -- Ampliar la vigencia (más fecha, o indefinido) es un compromiso nuevo y debe quedar
    -- DOCUMENTADO: se hace con contrato_prorrogar(), que declara el motivo. Un UPDATE directo
    -- que amplía sin motivo se rechaza.
    IF v_amplia AND btrim(COALESCE(current_setting('proveedores.motivo_ampliacion', true), '')) = '' THEN
      RAISE EXCEPTION 'CONTRATO_AMPLIACION_MOTIVO: ampliar la vigencia de un contrato exige documentar el motivo (usa contrato_prorrogar).'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_activando OR v_amplia THEN
      IF NOT public.proveedor_habilitado_en(NEW.proveedor_id, NEW.project_id) THEN
        RAISE EXCEPTION 'CONTRATO_PROVEEDOR_NO_HABILITADO: el proveedor no está autorizado/habilitado hoy para este proyecto; no se puede activar, reanudar ni prorrogar el contrato. Sí se puede suspender, terminar o cancelar.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF v_activando THEN
      IF NEW.modalidad IS NULL OR NEW.moneda IS NULL THEN
        RAISE EXCEPTION 'CONTRATO_DATOS_INCOMPLETOS: para activar el contrato indica modalidad y moneda.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.modalidad = 'recurrente' AND (NEW.periodicidad IS NULL OR NEW.importe_periodico IS NULL) THEN
        RAISE EXCEPTION 'CONTRATO_DATOS_INCOMPLETOS: un servicio recurrente necesita periodicidad e importe periódico para activarse.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.responsable_id IS NULL THEN
        RAISE EXCEPTION 'CONTRATO_DATOS_INCOMPLETOS: para activar el contrato asigna un responsable.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.modalidad = 'por_demanda' AND NEW.importe_periodico IS NOT NULL THEN
      RAISE EXCEPTION 'CONTRATO_IMPORTE_PERIODICO: una compra por demanda no lleva importe periódico.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.estado = 'borrador' THEN
      NEW.monto_mensual := CASE WHEN NEW.periodicidad = 'mensual' THEN NEW.importe_periodico END;
    END IF;
  END IF;

  IF NEW.contacto_id IS DISTINCT FROM OLD.contacto_id AND NEW.contacto_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.proveedor_contactos c
                      WHERE c.id = NEW.contacto_id AND c.proveedor_id = NEW.proveedor_id
                        AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CONTRATO_CONTACTO_AJENO: el contacto no es de ese proveedor.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- El respaldo tiene que vivir bajo SU ruta: es lo que hace que la policy del
  -- bucket autorice por el contrato y no por un nombre cualquiera.
  IF NEW.respaldo_path IS NOT NULL AND NEW.respaldo_path IS DISTINCT FROM OLD.respaldo_path THEN
    v_prefijo := NEW.company_id::text || '/' || NEW.project_id::text || '/' || NEW.id::text || '/';
    IF left(NEW.respaldo_path, length(v_prefijo)) <> v_prefijo THEN
      RAISE EXCEPTION 'CONTRATO_RESPALDO_RUTA: el respaldo debe estar bajo %', v_prefijo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_activando THEN
    NEW.activado_at  := COALESCE(NEW.activado_at, now());
    NEW.activado_por := COALESCE(NEW.activado_por, auth.uid());
  END IF;
  IF v_estado_cambia AND NEW.estado IN ('terminado', 'cancelado') THEN
    NEW.terminado_at  := now();
    NEW.terminado_por := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_proveedores_tg() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contratos_proveedores_eventos_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote uuid := NULLIF(current_setting('proveedores.lote_vinculacion', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contrato_proveedor_eventos
      (company_id, project_id, contrato_id, tipo, estado_nuevo, detalle, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'alta', NEW.estado,
            jsonb_build_object('proveedor_id', NEW.proveedor_id, 'modalidad', NEW.modalidad), auth.uid());
    RETURN NULL;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.contrato_proveedor_eventos
      (company_id, project_id, contrato_id, tipo, estado_anterior, estado_nuevo, motivo, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'estado', OLD.estado, NEW.estado,
            NULLIF(btrim(NEW.motivo_estado), ''), auth.uid());
  END IF;

  IF OLD.proveedor_id IS NULL AND NEW.proveedor_id IS NOT NULL THEN
    INSERT INTO public.contrato_proveedor_eventos
      (company_id, project_id, contrato_id, tipo, detalle, lote_vinculacion, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'vinculo_proveedor',
            jsonb_build_object('proveedor_id', NEW.proveedor_id, 'proveedor_nombre_texto', NEW.proveedor_nombre),
            v_lote, auth.uid());
  ELSIF OLD.proveedor_id IS NOT NULL AND NEW.proveedor_id IS NULL THEN
    INSERT INTO public.contrato_proveedor_eventos
      (company_id, project_id, contrato_id, tipo, detalle, lote_vinculacion, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'vinculo_revertido',
            jsonb_build_object('proveedor_id_anterior', OLD.proveedor_id), v_lote, auth.uid());
  END IF;

  IF NEW.fecha_fin IS DISTINCT FROM OLD.fecha_fin THEN
    INSERT INTO public.contrato_proveedor_eventos
      (company_id, project_id, contrato_id, tipo, detalle, actor_id)
    VALUES (NEW.company_id, NEW.project_id, NEW.id, 'prorroga',
            jsonb_build_object(
              'fecha_fin_anterior', OLD.fecha_fin, 'fecha_fin_nueva', NEW.fecha_fin,
              -- NULL = indefinido = el plazo más largo posible.
              'sentido', CASE
                WHEN OLD.fecha_fin IS NULL THEN 'reduccion'
                WHEN NEW.fecha_fin IS NULL OR NEW.fecha_fin > OLD.fecha_fin THEN 'ampliacion'
                ELSE 'reduccion' END,
              'motivo', NULLIF(btrim(COALESCE(current_setting('proveedores.motivo_ampliacion', true), '')), '')),
            auth.uid());
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_proveedores_eventos_tg() FROM PUBLIC, anon, authenticated;

-- ── Renovación: coherencia y evento ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_tg_renovacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema boolean := COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on';
  v_o       record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.renovado_de IS DISTINCT FROM OLD.renovado_de AND NOT v_sistema THEN
      RAISE EXCEPTION 'CONTRATO_RENOVACION_INMUTABLE: la relación de renovación no se cambia.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.renovado_de IS NULL OR v_sistema THEN
    RETURN NEW;
  END IF;

  IF btrim(COALESCE(current_setting('proveedores.motivo_renovacion', true), '')) = '' THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_POR_RPC: un contrato se renueva con contrato_renovar(), que deja el motivo en el historial.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.company_id, c.project_id, c.proveedor_id, c.estado, c.fecha_inicio INTO v_o
    FROM public.contratos_proveedores c WHERE c.id = NEW.renovado_de;
  IF NOT FOUND OR v_o.company_id <> NEW.company_id OR v_o.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_AJENA: el contrato a renovar no es de esta empresa y proyecto.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_o.proveedor_id IS NULL OR v_o.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_PROVEEDOR: la renovación es del mismo proveedor del contrato original.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_o.estado NOT IN ('activo', 'suspendido', 'vencido', 'terminado') THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_ESTADO: un contrato en «%» no se renueva (solo activo, suspendido, vencido o terminado).', v_o.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.fecha_inicio <= v_o.fecha_inicio THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_FECHA: la renovación empieza después del inicio del contrato original.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_tg_renovacion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contratos_renovacion ON public.contratos_proveedores;
CREATE TRIGGER trg_contratos_renovacion
  BEFORE INSERT OR UPDATE OF renovado_de ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.contratos_tg_renovacion();

CREATE OR REPLACE FUNCTION public.contratos_tg_renovacion_ev()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text := NULLIF(btrim(COALESCE(current_setting('proveedores.motivo_renovacion', true), '')), '');
BEGIN
  IF NEW.renovado_de IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.contrato_proveedor_eventos
    (company_id, project_id, contrato_id, tipo, motivo, detalle, actor_id)
  VALUES (NEW.company_id, NEW.project_id, NEW.id, 'renovacion', v_motivo,
          jsonb_build_object('renovado_de', NEW.renovado_de, 'fecha_inicio', NEW.fecha_inicio, 'fecha_fin', NEW.fecha_fin),
          auth.uid()),
         (NEW.company_id, NEW.project_id, NEW.renovado_de, 'renovado_por', v_motivo,
          jsonb_build_object('renovacion_id', NEW.id, 'fecha_inicio', NEW.fecha_inicio, 'fecha_fin', NEW.fecha_fin),
          auth.uid());
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_tg_renovacion_ev() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contratos_renovacion_ev ON public.contratos_proveedores;
CREATE TRIGGER trg_contratos_renovacion_ev
  AFTER INSERT ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.contratos_tg_renovacion_ev();

-- ── contrato_renovar ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contrato_renovar(
  p_contrato_id        uuid,
  p_fecha_inicio       date,
  p_fecha_fin          date,
  p_motivo             text,
  p_referencia         text    DEFAULT NULL,
  p_importe_periodico  numeric DEFAULT NULL,
  p_monto_maximo       numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_o     public.contratos_proveedores%ROWTYPE;
  v_new   uuid;
  v_n     integer;
  v_ref   text;
BEGIN
  IF char_length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_MOTIVO: la renovación exige indicar el motivo.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_fecha_inicio IS NULL THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_FECHA: indica la fecha de inicio de la renovación.' USING ERRCODE = 'check_violation';
  END IF;

  -- Serializa renovaciones del mismo contrato (referencia correlativa y reintentos).
  PERFORM pg_advisory_xact_lock(hashtextextended('contrato-renovar:' || p_contrato_id::text, 0));

  SELECT * INTO v_o FROM public.contratos_proveedores WHERE id = p_contrato_id;   -- RLS: solo el que ves
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRATO_RENOVACION_AJENA: el contrato no existe en tu empresa o proyecto.' USING ERRCODE = '42501';
  END IF;

  -- Reintento: la misma renovación (contrato + inicio) devuelve la ya creada.
  SELECT c.id INTO v_new FROM public.contratos_proveedores c
   WHERE c.renovado_de = v_o.id AND c.fecha_inicio = p_fecha_inicio;
  IF FOUND THEN
    RETURN v_new;
  END IF;

  SELECT count(*) + 1 INTO v_n FROM public.contratos_proveedores c WHERE c.renovado_de = v_o.id;
  v_ref := COALESCE(NULLIF(btrim(p_referencia), ''),
                    CASE WHEN v_o.referencia IS NOT NULL THEN v_o.referencia || '-R' || v_n END);

  PERFORM set_config('proveedores.motivo_renovacion', btrim(p_motivo), true);

  INSERT INTO public.contratos_proveedores
    (company_id, project_id, proveedor_id, proveedor_nombre, contacto_id, referencia, servicio, descripcion,
     modalidad, periodicidad, moneda, importe_periodico, monto_maximo, alcance, responsable_id, notas,
     fecha_inicio, fecha_fin, estado, renovado_de)
  VALUES (v_o.company_id, v_o.project_id, v_o.proveedor_id, v_o.proveedor_nombre, v_o.contacto_id, v_ref,
          v_o.servicio, v_o.descripcion, v_o.modalidad, v_o.periodicidad, v_o.moneda,
          COALESCE(p_importe_periodico, v_o.importe_periodico), COALESCE(p_monto_maximo, v_o.monto_maximo),
          v_o.alcance, v_o.responsable_id, v_o.notas,
          p_fecha_inicio, p_fecha_fin, 'borrador', v_o.id)
  RETURNING id INTO v_new;

  PERFORM set_config('proveedores.motivo_renovacion', '', true);
  RETURN v_new;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_renovar(uuid, date, date, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_renovar(uuid, date, date, text, text, numeric, numeric) TO authenticated;

COMMENT ON FUNCTION public.contrato_renovar(uuid, date, date, text, text, numeric, numeric) IS
  'Crea el contrato de renovación en BORRADOR, ligado al anterior (renovado_de). El anterior no cambia. No genera órdenes, facturas, pagos ni asientos. Idempotente por (contrato, fecha de inicio).';

-- ── contrato_prorrogar ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contrato_prorrogar(p_contrato_id uuid, p_fecha_fin date, p_motivo text)
RETURNS date
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF char_length(btrim(COALESCE(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_MOTIVO: la prórroga exige indicar el motivo.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('proveedores.motivo_ampliacion', btrim(p_motivo), true);
  UPDATE public.contratos_proveedores SET fecha_fin = p_fecha_fin WHERE id = p_contrato_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('proveedores.motivo_ampliacion', '', true);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CONTRATO_PRORROGA_AJENA: el contrato no existe en tu empresa o proyecto.' USING ERRCODE = '42501';
  END IF;
  RETURN p_fecha_fin;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_prorrogar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_prorrogar(uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.contrato_prorrogar(uuid, date, text) IS
  'Cambia la fecha fin del contrato (NULL = indefinido) dejando el motivo en el evento de prórroga. Ampliar sin motivo se rechaza; los candados de proveedor habilitado siguen rigiendo.';

-- ── Ampliaciones de monto (append-only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contrato_ampliaciones (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contrato_id          uuid          NOT NULL REFERENCES public.contratos_proveedores(id) ON DELETE RESTRICT,
  clave_idempotencia   text          NOT NULL CHECK (char_length(clave_idempotencia) >= 8),
  monto_anterior       numeric(14,2) NOT NULL,
  incremento           numeric(14,2) NOT NULL CHECK (incremento > 0),
  monto_nuevo          numeric(14,2) NOT NULL,
  moneda               text,
  motivo               text          NOT NULL CHECK (char_length(btrim(motivo)) >= 10),
  referencia_documento text,
  autorizado_por       uuid          NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, clave_idempotencia)
);
CREATE INDEX IF NOT EXISTS idx_contrato_ampliaciones_contrato ON public.contrato_ampliaciones (contrato_id, created_at);

ALTER TABLE public.contrato_ampliaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contrato_ampliaciones_select" ON public.contrato_ampliaciones;
CREATE POLICY "contrato_ampliaciones_select" ON public.contrato_ampliaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND ((SELECT public.user_has_permission('condominios.tab.proveedores'))
                  OR (SELECT public.prov_puede_ver_papeleria()))));
REVOKE ALL ON public.contrato_ampliaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_ampliaciones TO authenticated;
GRANT SELECT, INSERT ON public.contrato_ampliaciones TO service_role;

COMMENT ON TABLE public.contrato_ampliaciones IS
  'Ampliaciones del monto máximo de un contrato activo. Append-only; la escribe solo contrato_ampliar_monto(). El monto máximo vigente = el original + estas ampliaciones.';

CREATE OR REPLACE FUNCTION public.contrato_tg_ampliaciones_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'CONTRATO_AMPLIACION_INMUTABLE: una ampliación documentada no se edita.' USING ERRCODE = 'check_violation';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_tg_ampliaciones_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contrato_ampliaciones_inmutable ON public.contrato_ampliaciones;
CREATE TRIGGER trg_contrato_ampliaciones_inmutable
  BEFORE UPDATE ON public.contrato_ampliaciones
  FOR EACH ROW EXECUTE FUNCTION public.contrato_tg_ampliaciones_inmutable();

CREATE OR REPLACE FUNCTION public.contrato_monto_maximo_vigente(p_contrato_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN c.monto_maximo IS NULL THEN NULL
              ELSE c.monto_maximo + COALESCE((SELECT sum(a.incremento) FROM public.contrato_ampliaciones a
                                               WHERE a.contrato_id = c.id), 0) END
    FROM public.contratos_proveedores c WHERE c.id = p_contrato_id
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_monto_maximo_vigente(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contrato_ampliar_monto(
  p_contrato_id uuid, p_incremento numeric, p_motivo text, p_clave text, p_documento text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_c    public.contratos_proveedores%ROWTYPE;
  v_ant  numeric;
  v_id   uuid;
  v_ex   public.contrato_ampliaciones%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_SESION: se necesita una sesión.' USING ERRCODE = '42501';
  END IF;
  IF p_incremento IS NULL OR p_incremento <= 0 THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_MONTO: el incremento debe ser mayor que cero.' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_MOTIVO: la ampliación exige un motivo de al menos 10 caracteres.' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(COALESCE(p_clave, '')) < 8 THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_CLAVE: falta la clave de idempotencia (≥ 8 caracteres).' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_c FROM public.contratos_proveedores WHERE id = p_contrato_id FOR UPDATE;
  IF NOT FOUND
     OR NOT (public.is_super_admin()
             OR (v_c.company_id = public.get_my_company_id()
                 AND public.can_access_project(v_c.project_id)
                 AND public.user_has_permission('condominios.tab.proveedores'))) THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_AJENA: el contrato no existe en tu empresa o proyecto.' USING ERRCODE = '42501';
  END IF;

  -- Reintento con la misma clave: devuelve la ampliación ya registrada (si es la misma).
  SELECT * INTO v_ex FROM public.contrato_ampliaciones WHERE contrato_id = v_c.id AND clave_idempotencia = p_clave;
  IF FOUND THEN
    IF v_ex.incremento <> p_incremento OR v_ex.motivo <> btrim(p_motivo) THEN
      RAISE EXCEPTION 'CONTRATO_AMPLIACION_CLAVE: esa clave ya registró otra ampliación distinta.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_ex.id;
  END IF;

  IF v_c.proveedor_id IS NULL OR v_c.estado <> 'activo' THEN
    RAISE EXCEPTION 'CONTRATO_AMPLIACION_ESTADO: solo se amplía el monto de un contrato activo vinculado a un proveedor (estado: %).', v_c.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.monto_maximo IS NULL THEN
    RAISE EXCEPTION 'CONTRATO_SIN_LIMITE: este contrato no tiene monto máximo (no hay límite total): no hay nada que ampliar.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.proveedor_habilitado_en(v_c.proveedor_id, v_c.project_id) THEN
    RAISE EXCEPTION 'CONTRATO_PROVEEDOR_NO_HABILITADO: el proveedor no está autorizado/habilitado hoy para este proyecto; no se amplía el monto del contrato.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_ant := public.contrato_monto_maximo_vigente(v_c.id);
  INSERT INTO public.contrato_ampliaciones
    (company_id, project_id, contrato_id, clave_idempotencia, monto_anterior, incremento, monto_nuevo,
     moneda, motivo, referencia_documento, autorizado_por)
  VALUES (v_c.company_id, v_c.project_id, v_c.id, p_clave, v_ant, p_incremento, v_ant + p_incremento,
          v_c.moneda, btrim(p_motivo), NULLIF(btrim(COALESCE(p_documento, '')), ''), v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.contrato_proveedor_eventos
    (company_id, project_id, contrato_id, tipo, motivo, detalle, actor_id)
  VALUES (v_c.company_id, v_c.project_id, v_c.id, 'ampliacion_monto', btrim(p_motivo),
          jsonb_build_object('monto_anterior', v_ant, 'incremento', p_incremento, 'monto_nuevo', v_ant + p_incremento,
                             'moneda', v_c.moneda, 'ampliacion_id', v_id), v_uid);
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contrato_ampliar_monto(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_ampliar_monto(uuid, numeric, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.contrato_ampliar_monto(uuid, numeric, text, text, text) IS
  'Amplía (documentando quién, cuánto y por qué) el monto máximo de un contrato ACTIVO que ya lo tiene. No sobrescribe la condición original. Idempotente por clave.';
