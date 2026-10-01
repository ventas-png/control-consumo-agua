-- ════════════════════════════════════════════════════════════════════════════
-- PRÓRROGAS DE CONTRATOS: «INDEFINIDO» TAMBIÉN AMPLÍA LA VIGENCIA (PR A)
--
-- EL HUECO
-- El candado de `contratos_proveedores_tg` exigía proveedor habilitado para
-- «prorrogar» solo cuando la nueva fecha final era NO nula y mayor. Pasar de una
-- fecha definida a NULL (contrato indefinido) —la ampliación máxima— no se
-- comprobaba, y un proveedor suspendido o retirado del proyecto podía quedar
-- con un contrato sin fin. Al revés, pasar de indefinido a una fecha se trataba
-- como ampliación y se bloqueaba, cuando es una REDUCCIÓN del plazo.
--
-- LA CORRECCIÓN
--   fecha_fin anterior → nueva                          clasificación
--   fecha definida     → fecha posterior                ampliación (exige habilitado)
--   fecha definida     → NULL (indefinido)              ampliación (exige habilitado)
--   fecha definida     → fecha anterior                 reducción  (libre)
--   NULL (indefinido)  → fecha                          reducción  (libre)
--   en borrador                                         libre (aún no es compromiso)
-- «Habilitado» = `proveedor_habilitado_en(proveedor, proyecto)`: autorización
-- general vigente Y habilitación en el proyecto (o alcance empresa sin veto).
-- Reducir, suspender, terminar y cancelar siguen libres: son las vías para
-- resolver lo anterior.
--
-- El historial (`contrato_proveedor_eventos`, tipo `prorroga`) registra ahora el
-- `sentido` (ampliacion | reduccion) en el detalle.
--
-- Solo se reemplazan las dos funciones; los triggers existentes no cambian.
-- CÓMO REVERTIR: restaurar ambas funciones desde
-- 20261020000100_contratos_proveedor_vinculados.sql. IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

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
                ELSE 'reduccion' END),
            auth.uid());
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_proveedores_eventos_tg() FROM PUBLIC, anon, authenticated;
