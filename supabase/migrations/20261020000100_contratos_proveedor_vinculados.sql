-- ════════════════════════════════════════════════════════════════════════════
-- CONTRATOS DE PROVEEDOR · VÍNCULO AL CATÁLOGO, FOTOGRAFÍA, CICLO DE VIDA,
-- HISTORIAL Y RESPALDO PRIVADO (PR A, entrega 2 de 4)
--
-- POR QUÉ EXISTE
-- `contratos_proveedores` (20260420000003) nació como una lista de Operaciones:
--   · `proveedor_nombre/contacto/telefono/email` en TEXTO LIBRE, sin FK: el
--     contrato no sabe con qué proveedor del catálogo se firmó, así que desde
--     el proveedor no se llega a sus contratos;
--   · un solo importe (`monto_mensual`): un contrato de compra por demanda, o
--     de pago trimestral, no cabe;
--   · se BORRA físicamente desde el navegador (`DELETE` abierto a owner/admin)
--     aunque tenga evaluaciones, órdenes o un respaldo;
--   · su RLS es por empresa y permiso de pestaña, SIN alcance por proyecto: un
--     usuario del proyecto B lee los contratos del A mientras compartan empresa;
--   · el respaldo se sube a `condominios-media`, cuyo acceso se autoriza por
--     proyecto (lo lee cualquier residente con acceso al proyecto);
--   · `evaluaciones_proveedor.proveedor_id` apunta a ESTA tabla, no a
--     `proveedores`: el nombre engaña a quien lo lee.
--
-- QUÉ HACE
--   1. `proveedor_id` (FK al catálogo, verificada empresa/proyecto), contacto
--      reutilizado y contacto propio del contrato, `referencia` (clave
--      estable), modalidad (recurrente / por demanda), periodicidad, moneda,
--      importes, alcance, responsable y `respaldo_path`.
--   2. FOTOGRAFÍA: al crear con proveedor se copian nombre y datos fiscales a
--      `proveedor_nombre` y `proveedor_snapshot`; después no se reescriben y
--      las condiciones económicas se congelan al activar.
--   3. CICLO: borrador → activo → suspendido/vencido → terminado/cancelado,
--      con motivo obligatorio donde corresponde. Estado del CONTRATO y
--      autorización del PROVEEDOR son cosas distintas: suspender al proveedor
--      no toca el contrato, solo impide NUEVOS compromisos (crear, activar,
--      reanudar, prorrogar).
--   4. `contrato_proveedor_eventos`: historial append-only.
--   5. DELETE solo de un borrador sin nada relacionado; lo demás se termina o
--      cancela con motivo.
--   6. RLS con alcance por proyecto; bucket privado `contratos-respaldo`.
--   7. `ordenes_compra.contrato_id`: relación preparada (coherente en empresa,
--      proveedor y proyecto). NO genera órdenes, facturas, pagos ni asientos.
--   8. Vista `evaluaciones_por_proveedor` que resuelve el proveedor compartido.
--
-- LO QUE NO HACE: activar un contrato no inserta nada en facturas, pagos,
-- órdenes ni asientos (hay una prueba que lo exige).
--
-- COMPATIBILIDAD
--   · Los contratos históricos NO se tocan: `proveedor_id` NULL, texto intacto.
--   · Los contratos NUEVOS exigen `proveedor_id`; un alta sin él se rechaza
--     (salvo escritura de sistema).
--   · `monto_mensual` se conserva y, en contratos nuevos mensuales, se proyecta
--     desde `importe_periodico` para que lo siga leyendo GestorAlertasTab.
--   · El DEFAULT de `estado` pasa a 'borrador': activar es un acto explícito.
--
-- CÓMO REVERTIR (en este orden)
--   DROP VIEW public.evaluaciones_por_proveedor;
--   DROP TRIGGER trg_compras_oc_contrato ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_contrato();
--   ALTER TABLE public.ordenes_compra DROP COLUMN contrato_id;
--   DROP POLICY (las 3 de storage.objects "contratos_respaldo_*");
--   DELETE FROM storage.buckets WHERE id = 'contratos-respaldo' (vacío);
--   DROP FUNCTION public.contrato_respaldo_autoriza(text, boolean);
--   DROP TRIGGER trg_contratos_proveedores_{bi,au,ad} ON public.contratos_proveedores;
--   DROP FUNCTION public.contratos_proveedores_tg(), …_eventos_tg(), …_borrado_tg();
--   DROP TABLE public.contrato_proveedor_eventos;
--   restaurar las 4 policies de 20260518000010 sobre contratos_proveedores;
--   ALTER TABLE public.contratos_proveedores DROP COLUMN … (las de la sección 1);
--   ALTER TABLE public.contratos_proveedores ALTER COLUMN estado SET DEFAULT 'activo';
--
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno sobre filas existentes (solo columnas
-- nuevas NULL y un CHECK NOT VALID de estado). Las policies nuevas restringen
-- la LECTURA por proyecto: quien hoy lee contratos de proyectos que no tiene
-- asignados dejará de verlos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.contratos_proveedores
  ADD COLUMN IF NOT EXISTS proveedor_id       uuid REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contacto_id        uuid REFERENCES public.proveedor_contactos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referencia         text,
  ADD COLUMN IF NOT EXISTS modalidad          text,
  ADD COLUMN IF NOT EXISTS periodicidad       text,
  ADD COLUMN IF NOT EXISTS moneda             text,
  ADD COLUMN IF NOT EXISTS importe_periodico  numeric(14,2),
  ADD COLUMN IF NOT EXISTS monto_maximo       numeric(14,2),
  ADD COLUMN IF NOT EXISTS alcance            text,
  ADD COLUMN IF NOT EXISTS responsable_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS respaldo_path      text,
  ADD COLUMN IF NOT EXISTS proveedor_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS motivo_estado      text,
  ADD COLUMN IF NOT EXISTS activado_at        timestamptz,
  ADD COLUMN IF NOT EXISTS activado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS terminado_at       timestamptz,
  ADD COLUMN IF NOT EXISTS terminado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.contratos_proveedores
  ADD CONSTRAINT contratos_prov_modalidad_valida
    CHECK (modalidad IS NULL OR modalidad IN ('recurrente', 'por_demanda')),
  ADD CONSTRAINT contratos_prov_periodicidad_valida
    CHECK (periodicidad IS NULL OR periodicidad IN
           ('semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'unica')),
  ADD CONSTRAINT contratos_prov_moneda_formato
    CHECK (moneda IS NULL OR moneda ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT contratos_prov_importes_no_negativos
    CHECK ((importe_periodico IS NULL OR importe_periodico >= 0)
       AND (monto_maximo      IS NULL OR monto_maximo      >= 0)),
  -- NOT VALID: lo histórico solo usó activo/vencido/terminado (la UI no
  -- ofrecía más) y no se quiere que una fila legada rara bloquee la migración;
  -- toda fila NUEVA o ACTUALIZADA sí se valida.
  ADD CONSTRAINT contratos_prov_estado_valido
    CHECK (estado IN ('borrador', 'activo', 'suspendido', 'vencido', 'terminado', 'cancelado')) NOT VALID;

-- fecha_fin >= fecha_inicio también es NOT VALID por la misma razón: un
-- contrato histórico con las fechas invertidas no puede impedir terminarlo.
ALTER TABLE public.contratos_proveedores
  ADD CONSTRAINT contratos_prov_vigencia
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio) NOT VALID;

ALTER TABLE public.contratos_proveedores ALTER COLUMN estado SET DEFAULT 'borrador';

CREATE UNIQUE INDEX uq_contratos_prov_referencia
  ON public.contratos_proveedores (company_id, project_id, lower(referencia))
  WHERE referencia IS NOT NULL;
CREATE INDEX idx_contratos_prov_proveedor
  ON public.contratos_proveedores (proveedor_id) WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.contratos_proveedores.proveedor_id IS
  'Proveedor del catálogo compartido. NULL = contrato histórico con proveedor en texto libre. Una vez fijado no cambia: para cambiar de proveedor se termina este contrato y se crea otro.';
COMMENT ON COLUMN public.contratos_proveedores.proveedor_snapshot IS
  'Fotografía del proveedor al crear el contrato (nombre, código, identificación fiscal, país, dirección). No se reescribe cuando el proveedor cambia.';
COMMENT ON COLUMN public.contratos_proveedores.modalidad IS
  'recurrente = servicio con periodicidad e importe periódico; por_demanda = compras a demanda (sin importe periódico, con tope opcional).';
COMMENT ON COLUMN public.contratos_proveedores.respaldo_path IS
  'Ruta en el bucket PRIVADO contratos-respaldo: <empresa>/<proyecto>/<contrato>/<archivo>. Sustituye a documento_url (bucket de acceso por proyecto) en contratos nuevos.';
COMMENT ON COLUMN public.contratos_proveedores.monto_mensual IS
  'Legado. En contratos nuevos se proyecta desde importe_periodico solo si periodicidad = mensual; no es obligatorio.';

-- ── 2. Historial append-only ─────────────────────────────────────────────────
CREATE TABLE public.contrato_proveedor_eventos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contrato_id      uuid        NOT NULL REFERENCES public.contratos_proveedores(id) ON DELETE CASCADE,
  tipo             text        NOT NULL
                   CHECK (tipo IN ('alta', 'estado', 'vinculo_proveedor', 'vinculo_revertido', 'prorroga')),
  estado_anterior  text,
  estado_nuevo     text,
  motivo           text,
  detalle          jsonb,
  lote_vinculacion uuid,
  actor_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contrato_eventos_contrato ON public.contrato_proveedor_eventos (contrato_id, created_at);
CREATE INDEX idx_contrato_eventos_lote
  ON public.contrato_proveedor_eventos (lote_vinculacion) WHERE lote_vinculacion IS NOT NULL;

COMMENT ON TABLE public.contrato_proveedor_eventos IS
  'Historial del contrato: alta, cambios de estado con motivo, vínculos al proveedor y prórrogas. Solo lo escriben los triggers; nadie lo edita ni lo borra.';

-- ── 3. Guarda del contrato ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_proveedores_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
    IF v_activando
       OR (NEW.fecha_fin IS DISTINCT FROM OLD.fecha_fin AND OLD.estado <> 'borrador'
           AND NEW.fecha_fin IS NOT NULL AND (OLD.fecha_fin IS NULL OR NEW.fecha_fin > OLD.fecha_fin)) THEN
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

CREATE TRIGGER trg_contratos_proveedores_bi
  BEFORE INSERT OR UPDATE ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.contratos_proveedores_tg();

-- ── 4. Historial (lo escribe el trigger; nadie más) ─────────────────────────
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
            jsonb_build_object('fecha_fin_anterior', OLD.fecha_fin, 'fecha_fin_nueva', NEW.fecha_fin), auth.uid());
  END IF;

  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_proveedores_eventos_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_contratos_proveedores_au
  AFTER INSERT OR UPDATE ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.contratos_proveedores_eventos_tg();

-- ── 5. No se borra lo que tiene historia ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contratos_proveedores_borrado_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_relacion text;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  SELECT CASE
           WHEN OLD.estado <> 'borrador' THEN 'ya salió de borrador (estado ' || OLD.estado || ')'
           WHEN EXISTS (SELECT 1 FROM public.evaluaciones_proveedor e WHERE e.proveedor_id = OLD.id)
                THEN 'tiene evaluaciones'
           WHEN EXISTS (SELECT 1 FROM public.ordenes_compra o WHERE o.contrato_id = OLD.id)
                THEN 'tiene órdenes de compra'
           WHEN OLD.respaldo_path IS NOT NULL OR OLD.documento_url IS NOT NULL
                THEN 'tiene un documento de respaldo'
           WHEN EXISTS (SELECT 1 FROM public.contrato_proveedor_eventos ev
                         WHERE ev.contrato_id = OLD.id AND ev.tipo <> 'alta')
                THEN 'tiene historial'
         END INTO v_relacion;

  IF v_relacion IS NOT NULL THEN
    RAISE EXCEPTION 'CONTRATO_NO_ELIMINABLE: el contrato % . Termínalo o cancélalo con su motivo: el historial se conserva.', v_relacion
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.contratos_proveedores_borrado_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_contratos_proveedores_ad
  BEFORE DELETE ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.contratos_proveedores_borrado_tg();

-- ── 6. RLS con alcance por proyecto ──────────────────────────────────────────
-- Hasta hoy: empresa + permiso de pestaña, sin proyecto. Se añade
-- `can_access_project(project_id)` (project_id es NOT NULL, así que el «NULL =
-- ambiguo = permitido» de esa función no entra en juego).
DROP POLICY IF EXISTS "contratos_proveedores_select" ON public.contratos_proveedores;
DROP POLICY IF EXISTS "contratos_proveedores_insert" ON public.contratos_proveedores;
DROP POLICY IF EXISTS "contratos_proveedores_update" ON public.contratos_proveedores;
DROP POLICY IF EXISTS "contratos_proveedores_delete" ON public.contratos_proveedores;

CREATE POLICY "contratos_proveedores_select" ON public.contratos_proveedores
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT public.user_has_permission('condominios.tab.proveedores'))));
CREATE POLICY "contratos_proveedores_insert" ON public.contratos_proveedores
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND public.can_access_project(project_id)
                  AND (SELECT public.user_has_permission('condominios.tab.proveedores'))));
CREATE POLICY "contratos_proveedores_update" ON public.contratos_proveedores
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT public.user_has_permission('condominios.tab.proveedores'))))
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND public.can_access_project(project_id)
                  AND (SELECT public.user_has_permission('condominios.tab.proveedores'))));
CREATE POLICY "contratos_proveedores_delete" ON public.contratos_proveedores
  FOR DELETE TO authenticated
  USING ((SELECT public.is_super_admin())
         OR ((SELECT public.current_user_role()) = ANY (ARRAY['company_owner', 'admin'])
             AND company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)));

-- Historial: se lee con el mismo alcance; no hay policy de escritura a
-- propósito (lo escriben los triggers SECURITY DEFINER).
ALTER TABLE public.contrato_proveedor_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contrato_proveedor_eventos_select" ON public.contrato_proveedor_eventos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT public.user_has_permission('condominios.tab.proveedores'))));
REVOKE ALL ON public.contrato_proveedor_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_proveedor_eventos TO authenticated;
GRANT SELECT, INSERT ON public.contrato_proveedor_eventos TO service_role;

-- ── 7. Respaldo PRIVADO ──────────────────────────────────────────────────────
-- Ruta <empresa>/<proyecto>/<contrato>/<archivo>. El acceso se resuelve desde
-- la FILA del contrato (empresa, proyecto, permiso), no desde el proyecto a
-- secas: así un residente con acceso al proyecto no lee el contrato.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contratos-respaldo', 'contratos-respaldo', false, 20971520,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.contrato_respaldo_autoriza(p_name text, p_solo_borrador boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_super_admin()
      OR (
        array_length(storage.foldername(p_name), 1) = 3
        AND EXISTS (
          SELECT 1 FROM public.contratos_proveedores c
           WHERE c.id::text         = (storage.foldername(p_name))[3]
             AND c.project_id::text = (storage.foldername(p_name))[2]
             AND c.company_id::text = (storage.foldername(p_name))[1]
             AND c.company_id = public.get_my_company_id()
             AND public.can_access_project(c.project_id)
             AND public.user_has_permission('condominios.tab.proveedores')
             AND (NOT p_solo_borrador OR c.estado = 'borrador')
        )
      )
$$;

REVOKE EXECUTE ON FUNCTION public.contrato_respaldo_autoriza(text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.contrato_respaldo_autoriza(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.contrato_respaldo_autoriza(text, boolean) IS
  'Autoriza el acceso a un objeto del bucket contratos-respaldo desde la fila del contrato: empresa, proyecto y permiso de la pestaña. p_solo_borrador exige que el contrato aún sea borrador (borrado de respaldos).';

DROP POLICY IF EXISTS "contratos_respaldo_select" ON storage.objects;
DROP POLICY IF EXISTS "contratos_respaldo_insert" ON storage.objects;
DROP POLICY IF EXISTS "contratos_respaldo_delete" ON storage.objects;

CREATE POLICY "contratos_respaldo_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contratos-respaldo' AND public.contrato_respaldo_autoriza(name));

-- Se AÑADEN archivos mientras el contrato vive; no se sustituyen (sin policy de
-- UPDATE): corregir un respaldo es subir otro y apuntar `respaldo_path` a él.
CREATE POLICY "contratos_respaldo_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contratos-respaldo' AND public.contrato_respaldo_autoriza(name));

-- Borrar el respaldo de un contrato que ya salió de borrador es destruir
-- evidencia: solo mientras sea borrador.
CREATE POLICY "contratos_respaldo_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'contratos-respaldo' AND public.contrato_respaldo_autoriza(name, true));

-- ── 8. Orden de compra ↔ contrato (relación preparada, sin automatismos) ─────
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.contratos_proveedores(id) ON DELETE RESTRICT;

CREATE INDEX idx_ordenes_compra_contrato
  ON public.ordenes_compra (contrato_id) WHERE contrato_id IS NOT NULL;

COMMENT ON COLUMN public.ordenes_compra.contrato_id IS
  'Contrato al amparo del cual se emite la orden. Debe ser del mismo proveedor y proyecto y estar activo al vincularse. Vincular NO genera órdenes ni documentos; las órdenes recurrentes desde contratos son del PR C.';

CREATE OR REPLACE FUNCTION public.compras_tg_oc_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c record;
BEGIN
  IF NEW.contrato_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.contrato_id IS NOT DISTINCT FROM OLD.contrato_id) THEN
    RETURN NEW;
  END IF;

  SELECT c.company_id, c.project_id, c.proveedor_id, c.estado INTO v_c
    FROM public.contratos_proveedores c WHERE c.id = NEW.contrato_id;

  IF NOT FOUND OR v_c.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_AJENO: el contrato no pertenece a la empresa de la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.proveedor_id IS NULL OR v_c.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROVEEDOR: el contrato no es del mismo proveedor de la orden (o es un contrato histórico sin proveedor vinculado).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_PROYECTO: el contrato es de otro proyecto que la orden.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.estado <> 'activo' THEN
    RAISE EXCEPTION 'COMPRAS_CONTRATO_NO_ACTIVO: solo se vinculan órdenes a contratos activos (estado actual: %).', v_c.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_contrato() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_compras_oc_contrato
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_contrato();

-- ── 9. Evaluaciones: llegar al proveedor compartido ──────────────────────────
COMMENT ON COLUMN public.evaluaciones_proveedor.proveedor_id IS
  'OJO: es el id de un CONTRATO (contratos_proveedores.id), no de proveedores. Para llegar al proveedor del catálogo usa la vista evaluaciones_por_proveedor.';

CREATE VIEW public.evaluaciones_por_proveedor
WITH (security_invoker = true) AS
SELECT e.id,
       e.company_id,
       e.project_id,
       e.proveedor_id        AS contrato_id,
       c.proveedor_id        AS proveedor_catalogo_id,
       e.nombre_proveedor,
       e.calificacion,
       e.puntualidad,
       e.calidad,
       e.precio,
       e.comentarios,
       e.evaluado_por,
       e.fecha,
       e.created_at
  FROM public.evaluaciones_proveedor e
  LEFT JOIN public.contratos_proveedores c ON c.id = e.proveedor_id;

REVOKE ALL ON public.evaluaciones_por_proveedor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evaluaciones_por_proveedor TO authenticated, service_role;

COMMENT ON VIEW public.evaluaciones_por_proveedor IS
  'Evaluaciones con el proveedor del catálogo resuelto vía el contrato. security_invoker: aplica la RLS de quien consulta (evaluaciones y contratos).';

-- Historial de cambios del contrato en la bitácora general.
CREATE TRIGGER audit_contratos_proveedores
  AFTER INSERT OR UPDATE OR DELETE ON public.contratos_proveedores
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
