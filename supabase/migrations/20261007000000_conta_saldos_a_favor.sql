-- ============================================================================
-- CONTABILIDAD (5): SALDOS A FAVOR, ANTICIPOS Y SU APLICACIÓN POSTERIOR
--
-- 20261002000000..20261006000000 ya están fusionadas: no se reescriben. Esta
-- migración EXTIENDE lo que hay —`pagos` (el cobro), `conta_asientos` (la
-- contabilidad), `conta_cobro_aplicaciones` (lo que cada cobro redujo de cada
-- documento) y `conta_intentos_contabilizacion` (pendientes y su motivo)— sin
-- una contabilidad paralela: el saldo a favor ES el saldo de una cuenta de
-- pasivo con las dimensiones del titular, y cada tabla nueva sólo registra
-- de qué asiento sale cada importe.
--
-- DECISIÓN CONFIRMADA POR EL NEGOCIO: el excedente de un cobro queda como
-- saldo a favor. Antes quedaba pendiente con `excede_saldo`.
--
-- 1. LA CUENTA. Evento de mapeo nuevo `anticipo_clientes` (conta_mapeo_cuentas,
--    como cualquier otro: por ledger, sin códigos fijos). Debe ser una cuenta
--    de DETALLE, ACTIVA y de tipo PASIVO del ledger: un saldo a favor es una
--    obligación con el cliente, no un ingreso ni una CxC. Si falta o no es
--    válida, el cobro se REGISTRA igual (la fila de `pagos` no se pierde) y su
--    contabilización queda PENDIENTE con el motivo; se reprocesa desde la
--    bandeja cuando se configura. Un excedente sin cuenta conserva el código
--    `excede_saldo` (los filtros y la bandeja existentes lo siguen mostrando)
--    con un motivo nuevo que dice qué configurar.
--
-- 2. EL TITULAR Y SU ÁMBITO. Un saldo a favor pertenece a UNA combinación
--      empresa · contabilidad (proyecto) · cliente (auxiliar) · unidad · moneda
--    y nunca pasa a otra de forma implícita:
--      · excedente de un cobro: el responsable HISTÓRICO del documento (la
--        dimensión de su devengo) y su unidad. Si el pagador del cobro NO es
--        ese responsable, el excedente no se le asigna a nadie: el cobro queda
--        pendiente (`excede_saldo`) con el motivo;
--      · anticipo sin deuda: el cliente y la unidad que se indican al
--        registrarlo; el cliente tiene que ser de la empresa y estar (o haber
--        estado) vinculado a esa unidad;
--      · moneda: la del asiento del cobro (la del documento: importe de
--        origen de la línea, o la base si no hubo conversión).
--    Aplicar un saldo exige que el documento destino tenga EXACTAMENTE ese
--    titular en su devengo (responsable, unidad, contabilidad) y esa moneda.
--
-- 3. COBRO MAYOR QUE LA DEUDA. El asiento del cobro distingue:
--      cargo al método  = monto RECIBIDO
--      abono a la CxC   = monto APLICADO (mora primero, luego principal, como
--                         ya decidió el negocio para las cuotas)
--      abono a anticipos = REMANENTE a favor, con cliente y unidad
--    `conta_cobro_aplicaciones` sigue registrando sólo lo aplicado a
--    documentos; el remanente queda en `conta_saldo_favor_origenes`. Un cobro
--    que no está verificado no se contabiliza, así que no genera saldo
--    disponible; uno cuyo asiento quedó en borrador (sin tipo de cambio)
--    tampoco, hasta que se publique.
--
-- 4. ANTICIPO SIN DEUDA. `conta_registrar_anticipo`: un cobro ya verificado
--    de back-office, sin documento, para un cliente y una unidad. Queda en
--    `pagos` y en `conta_anticipos` (qué titular). Se contabiliza cargo al
--    método contra anticipos. Nunca va a «ingreso_otros».
--
-- 5. APLICACIÓN EXPLÍCITA. `conta_aplicar_saldo_favor`: un usuario con
--    permiso de contabilizar (crear y cambiar estado, como el reproceso)
--    elige UN origen (el cobro que generó el saldo), UN documento posterior
--    (cuota o cargo adicional por tipo) y un importe. Total o parcial. No hay
--    regla automática de prioridad entre orígenes ni entre documentos. Dentro
--    de una cuota rige la regla que ya existe para sus cobros: mora primero.
--    El asiento: cargo a la cuenta de anticipos del ORIGEN (con su titular),
--    abono a la CxC y dimensiones del devengo del documento. No reconoce
--    ingreso otra vez ni duplica el abono: el remanente nunca estuvo en la CxC.
--
-- 6. SIN DOBLE USO. La aplicación es UNA transacción que bloquea, en el orden
--    único del bloque de cobros:
--       fila del documento → fila del cobro de origen → candado de cobros del
--       documento → candado del origen
--    y recién entonces relee el disponible del origen y el saldo del
--    documento. La clave de idempotencia (`p_aplicacion_id`, la genera la
--    pantalla) hace que un reintento o doble clic con los mismos datos
--    devuelva la MISMA aplicación; con datos distintos se rechaza
--    (SALDO_FAVOR_CLAVE_REUSADA). Si el asiento no se puede publicar (falta
--    tipo de cambio o cuenta), la aplicación entera se deshace: no existen
--    aplicaciones pendientes ni a medias.
--
-- 7. REVERSIÓN Y TRAZABILIDAD. `conta_revertir_aplicacion_saldo_favor`:
--    reversa su asiento (misma fecha si el período está abierto; hoy si está
--    cerrado) y sella en la fila la hora del servidor, el usuario de la sesión
--    y el motivo. La fila no se borra ni se edita de otra forma (trigger). La
--    cadena cobro → origen → aplicación → reverso se puede seguir entera.
--
-- 8. RECHAZO DE UN COBRO CUYO SALDO YA SE USÓ (tratamiento PROPUESTO, ver el
--    PR). Esta entrega implementa la parte que no requiere decisión: el
--    rechazo, la anulación o el borrado de un cobro con aplicaciones VIVAS de
--    su saldo a favor se RECHAZA (COBRO_SALDO_FAVOR_APLICADO) y no se escribe
--    nada. Así nunca queda una aplicación sin respaldo. Para rechazarlo, se
--    revierten primero sus aplicaciones (los documentos vuelven a deber) y
--    después se rechaza el cobro. La alternativa —revertir en cascada al
--    rechazar— queda para decisión del negocio.
--
-- 9. ESTADO DE CUENTA. El saldo del estado de cuenta sigue siendo el de las
--    CxC: el remanente no entra (no estaba en la CxC) y la aplicación entra
--    como UN abono al documento, con el componente y el documento que la
--    originan. Se agrega `saldo_a_favor`: saldo inicial, abonos (excedentes y
--    anticipos), aplicaciones, saldo final (disponible al corte) y sus
--    movimientos, sacados de los asientos PUBLICADOS de la cuenta de
--    anticipos con la dimensión del sujeto, y la conciliación contra los
--    orígenes y aplicaciones vivos al corte.
--
-- ALCANCE. Cuotas y cargos adicionales contabilizados por tipo (los que tienen
-- devengo por auxiliar). Agua y los cobros del camino histórico no cambian.
-- No se tocan constraints ni triggers de `pagos` (drift declarado, #826): las
-- garantías viven en `conta_tg_pagos`, como en 20261004000100.
--
-- CÓMO SE REVIERTE (en este orden, sólo si no hay aplicaciones ni orígenes,
-- que son historia contable):
--   restaurar desde sus migraciones anteriores conta_tg_pagos (20261005000000),
--   conta_contabilizar_cobro_interno (20261002000200),
--   conta_contabilizar_cobro_cargo_interno y conta_cargo_saldo_cobro
--   (20261004000200), conta_cargo_sincronizar_estado, conta_reprocesar_un_cobro,
--   conta_reprocesar_cargo, conta_cargos_pendientes, conta_estado_cuenta y
--   conta_estado_cuenta_conciliacion (20261004000000), conta_tg_cargo_cobros_guard
--   (20261004000100); DROP FUNCTION conta_cargo_cobros(uuid) y recrearla desde
--   20261004000000; DROP de las funciones nuevas (conta_saldos_favor,
--   conta_saldo_favor_documentos, conta_revertir_aplicacion_saldo_favor,
--   conta_aplicar_saldo_favor, conta_anular_anticipo, conta_registrar_anticipo,
--   conta_ec_saldo_favor, conta_contabilizar_anticipo_seguro,
--   conta_contabilizar_anticipo_interno, conta_sf_autorizar,
--   conta_cuota_saldo_cobro, conta_sf_registrar_origen, conta_sf_disponible,
--   conta_cuenta_anticipos); DROP TRIGGER trg_conta_asiento_sf_guard ON
--   conta_asientos y DROP FUNCTION conta_tg_asiento_sf_guard; DROP TABLE
--   conta_saldo_favor_aplicaciones (con su trigger y
--   conta_tg_sf_aplicacion_inmutable), conta_saldo_favor_origenes,
--   conta_anticipos; y al final DROP FUNCTION conta_sf_asiento_vivo.
-- ============================================================================

-- ── 1. La cuenta de anticipos (evento de mapeo `anticipo_clientes`) ─────────
-- Sin semilla: la elige cada contabilidad. INTERNA.
CREATE FUNCTION public.conta_cuenta_anticipos(p_company uuid, p_project uuid)
RETURNS TABLE (cuenta_id uuid, codigo text, motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_c  public.conta_cuentas;
BEGIN
  v_id := public.conta_cuenta_para(p_company, p_project, 'anticipo_clientes');
  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'sin_cuenta'::text,
      'Falta la cuenta de anticipos de clientes (evento «anticipo_clientes») en el mapeo de esta contabilidad. Configúrala en Contabilidad › Configuración › Mapeo y reprocesa el cobro.'::text;
    RETURN;
  END IF;
  SELECT * INTO v_c FROM public.conta_cuentas c WHERE c.id = v_id;
  IF v_c.id IS NULL OR NOT v_c.es_detalle OR NOT v_c.activa OR v_c.tipo <> 'pasivo'
     OR v_c.company_id <> p_company OR v_c.project_id IS DISTINCT FROM p_project THEN
    RETURN QUERY SELECT NULL::uuid, 'cuenta_invalida'::text,
      format('La cuenta de anticipos de clientes (%s) tiene que ser una cuenta de detalle, activa y de PASIVO de esta contabilidad. Corrige el mapeo «anticipo_clientes» y reprocesa el cobro.',
             COALESCE(v_c.codigo || ' ' || v_c.nombre, 'inexistente'));
    RETURN;
  END IF;
  RETURN QUERY SELECT v_id, NULL::text, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuenta_anticipos(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cuenta_anticipos(uuid, uuid) IS
  'INTERNA. Cuenta de anticipos de clientes del ledger (mapeo «anticipo_clientes»): de detalle, activa y de pasivo. Si falta o no es válida, devuelve el código (sin_cuenta | cuenta_invalida) y un motivo accionable.';

-- ── 2. Anticipos sin deuda: qué titular tiene cada uno ───────────────────────
-- El cobro vive en `pagos`; aquí sólo su titular. La RPC inserta primero esta
-- fila y después el pago, así el trigger de `pagos` ya sabe que es un anticipo
-- al contabilizarlo.
--
-- SIN FK a pagos, clientes, unidades ni documentos, en ésta y en las dos
-- tablas siguientes: es la convención del libro contable (los asientos
-- referencian su origen por origen_tabla/origen_id, sin FK dura). Una FK
-- RESTRICT haría fallar la purga programada de pagos y cuotas borrados
-- (retencion_bitacora borra por lotes en una sola sentencia) y una CASCADE
-- borraría la evidencia. Las RPC validan las referencias al escribir, y el
-- trigger de `pagos` impide rechazar o borrar un cobro con aplicaciones vivas.
CREATE TABLE public.conta_anticipos (
  pago_id     uuid        PRIMARY KEY,
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cliente_id  uuid        NOT NULL,
  unidad_id   uuid        NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conta_anticipos_ledger ON public.conta_anticipos(company_id, project_id);
CREATE INDEX idx_conta_anticipos_cliente ON public.conta_anticipos(cliente_id);
CREATE INDEX idx_conta_anticipos_unidad ON public.conta_anticipos(unidad_id);

COMMENT ON TABLE public.conta_anticipos IS
  'Cobros registrados como ANTICIPO sin documento (conta_registrar_anticipo): el titular (cliente y unidad) de cada uno. El cobro vive en pagos; su contabilización abona la cuenta de anticipos de clientes.';

-- ── 3. Orígenes de saldo a favor: de qué asiento sale cada saldo ─────────────
-- Una fila por cobro contabilizado que dejó remanente (excedente) o que es un
-- anticipo. Cuenta como saldo sólo mientras su asiento esté PUBLICADO y sin
-- reverso; no se borra al reversarse (es la evidencia).
CREATE TABLE public.conta_saldo_favor_origenes (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pago_id         uuid          NOT NULL,
  asiento_id      uuid          NOT NULL REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  tipo            text          NOT NULL,
  cliente_id      uuid          NOT NULL,
  unidad_id       uuid          NOT NULL,
  moneda          text          NOT NULL,
  monto           numeric(14,2) NOT NULL,
  cuenta_id       uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  -- El documento cuyo cobro dejó el excedente (NULL en un anticipo).
  documento_tabla text,
  documento_id    uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_sf_origenes_tipo_valido CHECK (tipo IN ('excedente','anticipo')),
  CONSTRAINT conta_sf_origenes_monto_positivo CHECK (monto > 0),
  CONSTRAINT conta_sf_origenes_documento CHECK (
    (tipo = 'anticipo' AND documento_tabla IS NULL AND documento_id IS NULL)
    OR (tipo = 'excedente' AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
        AND documento_id IS NOT NULL)),
  -- Un cobro tiene a lo sumo UN asiento de cobro en su vida (uno reversado no
  -- se recrea), así que a lo sumo un origen.
  CONSTRAINT conta_sf_origenes_pago_unico UNIQUE (pago_id),
  CONSTRAINT conta_sf_origenes_asiento_unico UNIQUE (asiento_id)
);

CREATE INDEX idx_conta_sf_origenes_titular
  ON public.conta_saldo_favor_origenes(company_id, project_id, cliente_id, unidad_id);
CREATE INDEX idx_conta_sf_origenes_unidad ON public.conta_saldo_favor_origenes(unidad_id);
CREATE INDEX idx_conta_sf_origenes_cliente ON public.conta_saldo_favor_origenes(cliente_id);
CREATE INDEX idx_conta_sf_origenes_cuenta ON public.conta_saldo_favor_origenes(cuenta_id);

COMMENT ON TABLE public.conta_saldo_favor_origenes IS
  'Saldo a favor generado por un cobro contabilizado: excedente sobre el saldo de su documento o anticipo sin deuda. Titular (cliente, unidad), contabilidad, moneda, importe, cuenta de anticipos y el asiento del cobro. Cuenta sólo si ese asiento está publicado y sin reverso. Sólo la escriben las funciones de contabilización.';

-- ── 4. Aplicaciones de saldo a favor a documentos posteriores ───────────────
-- `id` es la clave de idempotencia que manda la pantalla. Cuenta mientras su
-- asiento esté vivo; revertirla sella revertida_* y reversa el asiento.
CREATE TABLE public.conta_saldo_favor_aplicaciones (
  id                 uuid          PRIMARY KEY,
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  origen_id          uuid          NOT NULL REFERENCES public.conta_saldo_favor_origenes(id) ON DELETE RESTRICT,
  pago_id            uuid          NOT NULL,
  cliente_id         uuid          NOT NULL,
  unidad_id          uuid          NOT NULL,
  moneda             text          NOT NULL,
  cuota_id           uuid,
  cargo_adicional_id uuid,
  monto              numeric(14,2) NOT NULL,
  monto_mora         numeric(14,2) NOT NULL DEFAULT 0,
  monto_principal    numeric(14,2) NOT NULL DEFAULT 0,
  cuenta_anticipo_id uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  asiento_id         uuid          NOT NULL REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  notas              text,
  created_by         uuid          NOT NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  revertida_at       timestamptz,
  revertida_por      uuid,
  motivo_reverso     text,
  asiento_reverso_id uuid          REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  CONSTRAINT conta_sf_aplicaciones_un_documento CHECK ((cuota_id IS NULL) <> (cargo_adicional_id IS NULL)),
  CONSTRAINT conta_sf_aplicaciones_monto CHECK (
    monto > 0 AND monto_mora >= 0 AND monto_principal >= 0 AND monto = monto_mora + monto_principal),
  CONSTRAINT conta_sf_aplicaciones_mora_solo_cuota CHECK (cuota_id IS NOT NULL OR monto_mora = 0),
  CONSTRAINT conta_sf_aplicaciones_reverso_completo CHECK (
    (revertida_at IS NULL AND revertida_por IS NULL AND motivo_reverso IS NULL AND asiento_reverso_id IS NULL)
    OR (revertida_at IS NOT NULL AND revertida_por IS NOT NULL
        AND length(btrim(motivo_reverso)) >= 3 AND asiento_reverso_id IS NOT NULL)),
  CONSTRAINT conta_sf_aplicaciones_asiento_unico UNIQUE (asiento_id)
);

CREATE INDEX idx_conta_sf_aplicaciones_origen ON public.conta_saldo_favor_aplicaciones(origen_id);
CREATE INDEX idx_conta_sf_aplicaciones_pago ON public.conta_saldo_favor_aplicaciones(pago_id);
CREATE INDEX idx_conta_sf_aplicaciones_cuota ON public.conta_saldo_favor_aplicaciones(cuota_id)
  WHERE cuota_id IS NOT NULL;
CREATE INDEX idx_conta_sf_aplicaciones_cargo ON public.conta_saldo_favor_aplicaciones(cargo_adicional_id)
  WHERE cargo_adicional_id IS NOT NULL;
CREATE INDEX idx_conta_sf_aplicaciones_titular
  ON public.conta_saldo_favor_aplicaciones(company_id, project_id, cliente_id, unidad_id);

COMMENT ON TABLE public.conta_saldo_favor_aplicaciones IS
  'Aplicación explícita de un saldo a favor (origen) a una cuota o un cargo adicional por tipo: importe, reparto mora/principal, asiento y, si se revirtió, cuándo (hora del servidor), quién, por qué y su asiento de reverso. Nunca se borra; sólo la escriben conta_aplicar_saldo_favor y conta_revertir_aplicacion_saldo_favor.';

-- Nada se reescribe: sólo se sella el reverso, una vez.
CREATE FUNCTION public.conta_tg_sf_aplicacion_inmutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SALDO_FAVOR_INBORRABLE: una aplicación de saldo a favor es historia contable; se revierte, no se borra.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revertida_at IS NOT NULL
     OR (NEW.id, NEW.company_id, NEW.project_id, NEW.origen_id, NEW.pago_id, NEW.cliente_id, NEW.unidad_id,
         NEW.moneda, NEW.cuota_id, NEW.cargo_adicional_id, NEW.monto, NEW.monto_mora, NEW.monto_principal,
         NEW.cuenta_anticipo_id, NEW.asiento_id, NEW.notas, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.company_id, OLD.project_id, OLD.origen_id, OLD.pago_id, OLD.cliente_id, OLD.unidad_id,
         OLD.moneda, OLD.cuota_id, OLD.cargo_adicional_id, OLD.monto, OLD.monto_mora, OLD.monto_principal,
         OLD.cuenta_anticipo_id, OLD.asiento_id, OLD.notas, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'SALDO_FAVOR_INMUTABLE: una aplicación de saldo a favor no se modifica; sólo se revierte una vez.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_sf_aplicacion_inmutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_sf_aplicacion_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_saldo_favor_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_sf_aplicacion_inmutable();

-- ── 5. RLS: lectura por empresa y proyecto; escritura sólo por funciones ────
ALTER TABLE public.conta_anticipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_saldo_favor_origenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_saldo_favor_aplicaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_anticipos_select" ON public.conta_anticipos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "conta_saldo_favor_origenes_select" ON public.conta_saldo_favor_origenes
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

CREATE POLICY "conta_saldo_favor_aplicaciones_select" ON public.conta_saldo_favor_aplicaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

REVOKE ALL ON public.conta_anticipos, public.conta_saldo_favor_origenes, public.conta_saldo_favor_aplicaciones
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_anticipos, public.conta_saldo_favor_origenes, public.conta_saldo_favor_aplicaciones
  TO authenticated, service_role;

-- ── 6. Vigencia y disponible (INTERNAS) ─────────────────────────────────────
-- Un asiento cuenta si está publicado y no tiene reverso.
CREATE FUNCTION public.conta_sf_asiento_vivo(p_asiento uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.conta_asientos a
                  WHERE a.id = p_asiento AND a.estado = 'publicado' AND a.anulado_por_id IS NULL)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_sf_asiento_vivo(uuid) FROM PUBLIC, anon, authenticated;

-- Disponible de un origen: su importe si su asiento vive, menos lo aplicado
-- por aplicaciones vivas. Nunca negativo en datos consistentes; si lo fuera,
-- se devuelve tal cual para que la conciliación lo vea.
CREATE FUNCTION public.conta_sf_disponible(p_origen uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (CASE WHEN public.conta_sf_asiento_vivo(o.asiento_id) THEN o.monto ELSE 0 END
          - COALESCE((SELECT sum(x.monto) FROM public.conta_saldo_favor_aplicaciones x
                       WHERE x.origen_id = o.id AND public.conta_sf_asiento_vivo(x.asiento_id)), 0))::numeric(14,2)
    FROM public.conta_saldo_favor_origenes o WHERE o.id = p_origen
$$;

REVOKE EXECUTE ON FUNCTION public.conta_sf_disponible(uuid) FROM PUBLIC, anon, authenticated;

-- Registra el origen de un saldo a favor a partir de la línea de anticipos
-- del asiento recién generado: la moneda es la del asiento (importe de origen
-- si hubo conversión), no la que se supuso al armarlo.
CREATE FUNCTION public.conta_sf_registrar_origen(
  p_asiento   uuid,
  p_pago      uuid,
  p_tipo      text,
  p_cuenta    uuid,
  p_doc_tabla text,
  p_doc_id    uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_l  record;
  v_id uuid;
BEGIN
  SELECT a.company_id, a.project_id, l.auxiliar_cliente_id, l.unidad_id,
         COALESCE(l.monto_origen, l.haber)::numeric(14,2) AS monto,
         COALESCE(l.moneda_origen, a.moneda_base) AS moneda
    INTO v_l
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.cuenta_id = p_cuenta AND l.haber > 0
   WHERE a.id = p_asiento
   ORDER BY l.orden DESC LIMIT 1;
  IF v_l.monto IS NULL OR v_l.auxiliar_cliente_id IS NULL OR v_l.unidad_id IS NULL THEN
    RAISE EXCEPTION 'conta_sf_registrar_origen: el asiento % no tiene la línea de anticipos con su titular', p_asiento;
  END IF;
  INSERT INTO public.conta_saldo_favor_origenes
    (company_id, project_id, pago_id, asiento_id, tipo, cliente_id, unidad_id, moneda, monto, cuenta_id,
     documento_tabla, documento_id)
  VALUES
    (v_l.company_id, v_l.project_id, p_pago, p_asiento, p_tipo, v_l.auxiliar_cliente_id, v_l.unidad_id,
     v_l.moneda, v_l.monto, p_cuenta, p_doc_tabla, p_doc_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_sf_registrar_origen(uuid, uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ── 6b. El asiento de un cobro con saldo a favor APLICADO no se reversa ─────
-- Cubre todos los caminos, no sólo el trigger de `pagos`: el reverso manual
-- desde Pólizas (conta_anular_asiento) y cualquier reverso automático marcan
-- `anulado_por_id` en el original. Si ese original es el asiento que generó
-- un saldo a favor que tiene aplicaciones vivas, se rechaza: dejaría esas
-- aplicaciones sin respaldo.
CREATE FUNCTION public.conta_tg_asiento_sf_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ((OLD.anulado_por_id IS NULL AND NEW.anulado_por_id IS NOT NULL)
      OR (OLD.estado IS DISTINCT FROM 'anulado' AND NEW.estado = 'anulado'))
     AND EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o
                   JOIN public.conta_saldo_favor_aplicaciones x ON x.origen_id = o.id
                  WHERE o.asiento_id = OLD.id AND public.conta_sf_asiento_vivo(x.asiento_id)) THEN
    RAISE EXCEPTION 'COBRO_SALDO_FAVOR_APLICADO: este asiento generó un saldo a favor que ya se aplicó a otros documentos. Revierte esas aplicaciones antes de reversar o anular el asiento.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_asiento_sf_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_asiento_sf_guard
  BEFORE UPDATE OF anulado_por_id, estado ON public.conta_asientos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_asiento_sf_guard();

-- ── 7. Saldo de un cargo: también las aplicaciones de saldo a favor ─────────
-- Cuerpo idéntico a 20261004000200 salvo el sumando de aplicaciones vivas.
-- De aquí salen el estado derivado, el resumen de Condominios y el saldo que
-- ve cada cobro nuevo.
CREATE OR REPLACE FUNCTION public.conta_cargo_saldo_cobro(
  p_cargo_id    uuid,
  p_excluir_pago uuid DEFAULT NULL
)
RETURNS TABLE (
  devengo_asiento_id  uuid,
  devengo_estado      text,
  devengo_monto       numeric,
  cuenta_id           uuid,
  auxiliar_cliente_id uuid,
  unidad_id           uuid,
  tipo_cargo          text,
  aplicado            numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.asiento_id, d.estado, d.monto_doc, d.cuenta_id, d.auxiliar_cliente_id, d.unidad_id, d.tipo_cargo,
         COALESCE((
           SELECT sum(ap.monto)
             FROM public.conta_cobro_aplicaciones ap
             JOIN public.conta_asientos a ON a.id = ap.asiento_id
            WHERE ap.cargo_adicional_id = p_cargo_id
              AND (p_excluir_pago IS NULL OR ap.pago_id <> p_excluir_pago)
              AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL), 0)::numeric(14,2)
         -- Aplicaciones de saldo a favor vivas (20261007000000): reducen el
         -- saldo del cargo igual que un cobro.
         + COALESCE((
           SELECT sum(x.monto)
             FROM public.conta_saldo_favor_aplicaciones x
            WHERE x.cargo_adicional_id = p_cargo_id
              AND public.conta_sf_asiento_vivo(x.asiento_id)), 0)::numeric(14,2)
    FROM (SELECT 1) uno
    LEFT JOIN LATERAL (
      SELECT a.id AS asiento_id, a.estado, COALESCE(l.monto_origen, l.debe)::numeric(14,2) AS monto_doc,
             l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo
        FROM public.cargos_adicionales_unidad ca
        JOIN public.conta_asientos a
          ON a.company_id = ca.company_id AND a.origen = 'automatico'
         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = ca.id
         AND a.origen_evento = 'cargo_adicional_emitido'
         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
        JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
       WHERE ca.id = p_cargo_id
       ORDER BY a.created_at DESC, l.orden
       LIMIT 1
    ) d ON true
$$;

-- ── 8. Estado derivado del cargo: también si sólo lo cubre un saldo a favor ──
-- Cuerpo idéntico a 20261004000000 salvo la condición de entrada.
CREATE OR REPLACE FUNCTION public.conta_cargo_sincronizar_estado(p_cargo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_derivado text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = p_cargo_id)
     AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                      WHERE x.cargo_adicional_id = p_cargo_id) THEN
    RETURN;
  END IF;
  v_derivado := public.conta_cargo_estado_derivado(p_cargo_id);
  IF v_derivado IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.cargos_adicionales_unidad ca
     SET estado = v_derivado
   WHERE ca.id = p_cargo_id
     AND ca.estado IN ('pendiente','pagado')
     AND ca.estado IS DISTINCT FROM v_derivado;
END;
$$;

-- ── 9. Guard del cargo: una aplicación de saldo a favor cuenta como un cobro ─
-- Cuerpo idéntico a 20261004000100 salvo que las aplicaciones de saldo a favor
-- (vivas para importe y anulación; cualquiera para borrar o moverlo) cuentan
-- como sus cobros. El trigger no cambia.
CREATE OR REPLACE FUNCTION public.conta_tg_cargo_cobros_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_vivos    boolean;
  v_alguno   boolean;
  v_derivado text;
BEGIN
  v_alguno := EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = OLD.id)
             OR EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                         WHERE x.cargo_adicional_id = OLD.id);

  IF TG_OP = 'DELETE' THEN
    IF v_alguno THEN
      RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros registrados (historia contable); no se borra. Anúlalo si no tiene cobros vivos.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;

  v_vivos  := EXISTS (SELECT 1 FROM public.pagos p
                       WHERE p.cargo_adicional_id = OLD.id
                         AND p.deleted_at IS NULL AND p.estado <> 'rechazado')
             OR EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                         WHERE x.cargo_adicional_id = OLD.id AND public.conta_sf_asiento_vivo(x.asiento_id));

  -- Con cobros, el cargo es el documento que respalda su aplicación: no
  -- cambia de empresa, proyecto ni unidad.
  IF v_alguno AND (NEW.company_id IS DISTINCT FROM OLD.company_id
                   OR NEW.project_id IS DISTINCT FROM OLD.project_id
                   OR NEW.unidad_id  IS DISTINCT FROM OLD.unidad_id) THEN
    RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros registrados; no cambia de empresa, proyecto ni unidad.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_vivos AND NEW.monto IS DISTINCT FROM OLD.monto THEN
    RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros vivos; su importe no cambia. Anula los cobros primero.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF NEW.estado = 'anulado' THEN
    IF v_vivos THEN
      RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros vivos; anula cada cobro antes de anular el cargo.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Cargo por tipo: «pagado»/«pendiente» es el que dan sus cobros.
  v_derivado := public.conta_cargo_estado_derivado(OLD.id, NEW.monto);
  IF v_derivado IS NOT NULL AND NEW.estado IN ('pagado','pendiente') AND NEW.estado <> v_derivado THEN
    RAISE EXCEPTION 'CARGO_ESTADO_DERIVADO: el estado de este cargo sale de sus cobros (hoy: %). Registra o anula un cobro en lugar de cambiarlo a mano.',
      v_derivado USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 10. Cobro de una cuota por tipo: el excedente queda como saldo a favor ───
-- Cuerpo idéntico a 20261002000200 salvo: (a) lo aplicado antes incluye las
-- aplicaciones vivas de saldos a favor; (b) un cobro que fue todo remanente no
-- se toma por uno del camino histórico; (c) el excedente se abona a la cuenta
-- de anticipos con el titular y se registra su origen, o queda pendiente con
-- el motivo si no se puede asignar.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_interno(
  p_pago_id uuid,
  p_disparo text
)
RETURNS TABLE (
  resultado  text,
  codigo     text,
  motivo     text,
  asiento_id uuid,
  intento_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago        public.pagos;
  v_cuota       public.cuotas_condominio;
  v_cuota_id    uuid;
  v_company     uuid;
  v_project     uuid;
  v_ts          timestamptz;
  v_asiento     uuid;
  v_intento     uuid;
  v_codigo      text;
  v_motivo      text;
  v_prev_mora   numeric(14,2);
  v_prev_princ  numeric(14,2);
  v_mora        numeric(14,2);
  v_a_mora      numeric(14,2);
  v_a_princ     numeric(14,2);
  v_exceso      numeric(14,2);
  v_lm          record;
  v_lp          record;
  v_estado_dev  text;
  v_cta_mora    uuid;
  v_cta_princ   uuid;
  v_metodo      text;
  v_moneda      text;
  v_lineas      jsonb;
  v_ant         record;
  v_lt          record;
  v_credito     numeric(14,2) := 0;
BEGIN
  IF p_disparo NOT IN ('cobro','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  -- 1) LA FILA DEL PAGO, antes que nada (orden: pago → candado). Si otra
  --    transacción lo está rechazando o borrando, se espera aquí y se ve el
  --    resultado confirmado.
  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'El cobro ya no existe: no se contabiliza.'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_cuota_id := public.conta_cobro_cuota_por_tipo(p_pago_id);
  IF v_cuota_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_interno: el pago % no es de una cuota contabilizada por tipo', p_pago_id
      USING ERRCODE = '22023';
  END IF;

  -- CANDADO POR CUOTA, antes de leer saldos: dos cobros de la misma cuota (o
  -- un cobro y el reproceso de su cuota) se contabilizan uno detrás del otro.
  PERFORM pg_advisory_xact_lock(hashtext('conta_cobro_cuota'), hashtext(v_cuota_id::text));

  SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_cuota_id;
  v_company := v_cuota.company_id;
  v_project := v_cuota.project_id;
  v_ts      := COALESCE(v_pago.verified_at, v_pago.created_at, now());

  -- 2) REVALIDACIÓN con la fila bloqueada: un pago rechazado o borrado no se
  --    contabiliza, llegue por el camino que llegue.
  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'documento_anulado',
      'El cobro fue rechazado o eliminado antes de contabilizarse: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro fue rechazado o eliminado antes de contabilizarse: no se contabiliza.'::text, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ¿Ya tiene su asiento? (idempotencia; se relee DESPUÉS del candado)
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  -- a) Un cobro ANTERIOR de la misma cuota sigue pendiente: el reparto de éste
  --    depende de aquél.
  IF EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE p2.id <> v_pago.id
       AND (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND (COALESCE(p2.verified_at, p2.created_at), p2.id) < (v_ts, v_pago.id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = v_company AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'
                          AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
  ) THEN
    v_codigo := 'cobro_anterior_pendiente';
    v_motivo := 'Otro cobro anterior de la misma cuota sigue pendiente y el reparto entre mora y principal depende del orden. Reprocesa la cuota: contabiliza sus cobros en orden.';
  END IF;

  -- b) Saldos: lo ya aplicado por cobros anteriores con asiento vivo. Los
  --    cobros de la cuota contabilizados por el camino histórico (antes de que
  --    la cuota entrara a la contabilización por tipo) cuentan como principal.
  IF v_codigo IS NULL THEN
    SELECT COALESCE(sum(ap.monto) FILTER (WHERE ap.evento = 'cuota_mora'), 0),
           COALESCE(sum(ap.monto) FILTER (WHERE ap.evento = 'cuota_emitida'), 0)
      INTO v_prev_mora, v_prev_princ
      FROM public.conta_cobro_aplicaciones ap
      JOIN public.conta_asientos a ON a.id = ap.asiento_id
     WHERE ap.cuota_id = v_cuota.id AND ap.pago_id <> v_pago.id
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL;

    -- Aplicaciones de saldo a favor vivas (20261007000000): reducen la mora y
    -- el principal igual que un cobro.
    SELECT v_prev_mora + COALESCE(sum(x.monto_mora), 0),
           v_prev_princ + COALESCE(sum(x.monto_principal), 0)
      INTO v_prev_mora, v_prev_princ
      FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.cuota_id = v_cuota.id AND public.conta_sf_asiento_vivo(x.asiento_id);

    v_prev_princ := v_prev_princ + COALESCE((
      SELECT sum(p2.monto) FROM public.pagos p2
       WHERE p2.id <> v_pago.id
         AND (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
         AND EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = v_company AND a.origen = 'automatico'
                        AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                        AND a.origen_evento = 'pago_contabilizado'
                        AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones ap WHERE ap.pago_id = p2.id)
         -- un cobro que fue TODO saldo a favor no tiene aplicaciones, pero
         -- tampoco es del camino histórico
         AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p2.id)
    ), 0);

    -- La mora cuenta sólo si ya existía cuando se cobró.
    v_mora := CASE WHEN COALESCE(v_cuota.mora_monto, 0) > 0
                    AND COALESCE(v_cuota.mora_aplicada_at, '-infinity'::timestamptz) <= v_ts
                   THEN v_cuota.mora_monto ELSE 0 END;

    -- MORA PRIMERO, luego principal.
    v_a_mora  := LEAST(v_pago.monto, GREATEST(v_mora - v_prev_mora, 0));
    v_a_princ := LEAST(v_pago.monto - v_a_mora, GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
    v_exceso  := v_pago.monto - v_a_mora - v_a_princ;

    -- EXCEDENTE (20261007000000): queda como SALDO A FAVOR del responsable
    -- histórico de la cuota —la dimensión de su devengo— y su unidad, en la
    -- cuenta de anticipos. Si el pagador no es ese responsable, o si falta la
    -- cuenta, el cobro queda pendiente con el motivo (no se pierde).
    IF v_exceso > 0.005 THEN
      SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, a.estado AS estado INTO v_lt
        FROM public.conta_asientos a
        JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
       WHERE a.company_id = v_company AND a.origen = 'automatico'
         AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
         AND a.origen_evento = 'cuota_emitida'
         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
       ORDER BY l.orden LIMIT 1;
      SELECT * INTO v_ant FROM public.conta_cuenta_anticipos(v_company, v_project);
      IF v_lt.cuenta_id IS NULL OR v_lt.estado <> 'publicado' THEN
        v_codigo := 'devengo_pendiente';
        v_motivo := 'Esta cuota todavía no tiene su devengo publicado: el excedente no se puede asignar a su responsable. Resuelve su pendiente y reprocesa la cuota.';
      ELSIF v_lt.auxiliar_cliente_id IS DISTINCT FROM v_pago.cliente_id OR v_lt.unidad_id IS NULL THEN
        v_codigo := 'excede_saldo';
        v_motivo := format('El cobro (%s) supera el saldo pendiente de la cuota (mora %s, principal %s) y el pagador no es el responsable histórico de la cuota: el excedente no se asigna como saldo a favor de otro cliente. Anula el cobro y regístralo por el saldo; el resto, como anticipo del pagador.',
                           v_pago.monto, GREATEST(v_mora - v_prev_mora, 0),
                           GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
      ELSIF v_ant.cuenta_id IS NULL THEN
        v_codigo := 'excede_saldo';
        v_motivo := format('El cobro (%s) supera el saldo pendiente de la cuota (mora %s, principal %s): el excedente de %s queda como saldo a favor, pero no hay cuenta para registrarlo. %s',
                           v_pago.monto, GREATEST(v_mora - v_prev_mora, 0),
                           GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0), v_exceso, v_ant.motivo);
      ELSE
        v_credito := v_exceso;
      END IF;
    ELSIF COALESCE(v_pago.monto, 0) <= 0 THEN
      v_codigo := 'error';
      v_motivo := 'El cobro no tiene importe que contabilizar.';
    END IF;
  END IF;

  -- c) El devengo de cada evento que el cobro toca: publicado y vivo. Su
  --    línea de cargo da la cuenta y las dimensiones del abono.
  IF v_codigo IS NULL AND v_a_mora > 0 THEN
    SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo, a.estado AS estado INTO v_lm
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.company_id = v_company AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
       AND a.origen_evento = 'cuota_mora'
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
     ORDER BY l.orden LIMIT 1;
    v_estado_dev := v_lm.estado;
    v_cta_mora   := v_lm.cuenta_id;
    IF v_cta_mora IS NULL OR v_estado_dev <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      v_motivo := CASE WHEN v_estado_dev = 'borrador'
        THEN 'El devengo de la mora de esta cuota está en borrador. Publícalo en Pólizas y reprocesa el cobro.'
        ELSE 'La mora de esta cuota todavía no está contabilizada. Resuelve su pendiente y reprocesa la cuota: el cobro se contabiliza después.' END;
    END IF;
  END IF;

  IF v_codigo IS NULL AND v_a_princ > 0 THEN
    SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo, a.estado AS estado INTO v_lp
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.company_id = v_company AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
       AND a.origen_evento = 'cuota_emitida'
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
     ORDER BY l.orden LIMIT 1;
    v_estado_dev := v_lp.estado;
    v_cta_princ  := v_lp.cuenta_id;
    IF v_cta_princ IS NULL OR v_estado_dev <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      v_motivo := CASE WHEN v_estado_dev = 'borrador'
        THEN 'El devengo de esta cuota está en borrador. Publícalo en Pólizas y reprocesa el cobro.'
        ELSE 'Esta cuota todavía no está contabilizada. Resuelve su pendiente y reprocesa la cuota: el cobro se contabiliza después.' END;
    END IF;
  END IF;

  -- d) La cuenta del método de pago (mapeo del ledger, como cualquier cobro).
  v_metodo := CASE v_pago.metodo
    WHEN 'efectivo'        THEN 'metodo_efectivo'
    WHEN 'transferencia'   THEN 'metodo_transferencia'
    WHEN 'deposito'        THEN 'metodo_deposito'
    WHEN 'cheque'          THEN 'metodo_cheque'
    WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
    WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
    WHEN 'paypal'          THEN 'metodo_pasarela'
    ELSE 'metodo_otro'
  END;
  IF v_codigo IS NULL AND public.conta_cuenta_para(v_company, v_project, v_metodo) IS NULL THEN
    v_codigo := 'sin_cuenta';
    v_motivo := format('Falta la cuenta del método de pago (%s) en el mapeo de esta contabilidad. Configúrala y reprocesa el cobro.', v_metodo);
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cobro_interno: pago % pendiente (%) — asiento omitido', v_pago.id, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento: cargo a la cuenta del método, abono a la mora y luego al
  --    principal, cada uno con la cuenta y las dimensiones de su devengo ─────
  v_lineas := jsonb_build_array(
    jsonb_build_object('evento', v_metodo, 'debe', v_pago.monto, 'descripcion', 'Cobro'));
  IF v_a_mora > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_lm.cuenta_id, 'haber', v_a_mora, 'descripcion', 'Aplicación a mora',
      'auxiliar_cliente_id', v_lm.auxiliar_cliente_id, 'unidad_id', v_lm.unidad_id, 'tipo_cargo', v_lm.tipo_cargo));
  END IF;
  IF v_a_princ > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_lp.cuenta_id, 'haber', v_a_princ, 'descripcion', 'Aplicación a principal',
      'auxiliar_cliente_id', v_lp.auxiliar_cliente_id, 'unidad_id', v_lp.unidad_id, 'tipo_cargo', v_lp.tipo_cargo));
  END IF;
  -- El remanente, a la cuenta de anticipos con su titular (sin tipo de cargo:
  -- no es un cargo).
  IF v_credito > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_ant.cuenta_id, 'haber', v_credito, 'descripcion', 'Saldo a favor',
      'auxiliar_cliente_id', v_lt.auxiliar_cliente_id, 'unidad_id', v_lt.unidad_id));
  END IF;

  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_project;

  v_asiento := public.conta_generar_asiento(
    v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado',
    COALESCE(v_pago.verified_at, v_pago.created_at)::date,
    'Pago ' || v_pago.metodo || COALESCE(' ref. ' || NULLIF(v_pago.referencia, ''), ''),
    'ingreso', v_moneda, v_lineas);

  IF v_asiento IS NOT NULL THEN
    INSERT INTO public.conta_cobro_aplicaciones
      (company_id, project_id, pago_id, cuota_id, evento, monto, cuenta_id, asiento_id)
    SELECT v_company, v_project, v_pago.id, v_cuota.id, x.evento, x.monto, x.cuenta_id, v_asiento
      FROM (VALUES ('cuota_mora', v_a_mora, v_cta_mora),
                   ('cuota_emitida', v_a_princ, v_cta_princ)) AS x(evento, monto, cuenta_id)
     WHERE x.monto > 0;

    IF v_credito > 0 THEN
      PERFORM public.conta_sf_registrar_origen(v_asiento, v_pago.id, 'excedente', v_ant.cuenta_id,
                                               'cuotas_condominio', v_cuota.id);
    END IF;

    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('mora', v_a_mora, 'principal', v_a_princ, 'saldo_a_favor', v_credito)), v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento del cobro. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento del cobro.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_interno(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cobro_interno(uuid, text) IS
  'INTERNA. Bloquea y revalida el pago, y contabiliza el cobro de una cuota por tipo: mora primero, luego principal, cada porción contra la cuenta y dimensiones de su devengo; el excedente, a la cuenta de anticipos como saldo a favor del responsable histórico (si es el pagador). Pendiente visible si falta un devengo, si un cobro anterior está pendiente o si el excedente no se puede asignar. Candado por cuota.';

-- ── 11. Cobro de un cargo adicional: el excedente queda como saldo a favor ──
-- Cuerpo idéntico a 20261004000200 salvo el paso (e) y el asiento: se aplica
-- lo que cabe en el saldo del cargo y el remanente va a anticipos.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_cargo_interno(
  p_pago_id uuid,
  p_disparo text
)
RETURNS TABLE (
  resultado  text,
  codigo     text,
  motivo     text,
  asiento_id uuid,
  intento_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago     public.pagos;
  v_cargo    public.cargos_adicionales_unidad;
  v_ts       timestamptz;
  v_asiento  uuid;
  v_intento  uuid;
  v_codigo   text;
  v_motivo   text;
  v_s        record;
  v_saldo    numeric(14,2);
  v_dev_i    record;
  v_metodo   text;
  v_moneda   text;
  v_coh      record;
  v_ant      record;
  v_aplica   numeric(14,2);
  v_credito  numeric(14,2) := 0;
  v_lineas   jsonb;
BEGIN
  IF p_disparo NOT IN ('cobro','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_cargo_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'El cobro ya no existe: no se contabiliza.'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF v_pago.cargo_adicional_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_cargo_interno: el pago % no es de un cargo adicional', p_pago_id
      USING ERRCODE = '22023';
  END IF;

  -- CANDADO POR CARGO, antes de leer saldos.
  PERFORM pg_advisory_xact_lock(hashtext('conta_cobro_cargo'), hashtext(v_pago.cargo_adicional_id::text));

  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pago.cargo_adicional_id;
  v_ts := COALESCE(v_pago.verified_at, v_pago.created_at, now());

  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'documento_anulado',
      'El cobro fue anulado o eliminado antes de contabilizarse: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro fue anulado o eliminado antes de contabilizarse: no se contabiliza.'::text, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- Idempotencia: ya tiene asiento vivo.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- Un asiento reversado no se recrea: eso lo decide una persona.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'asiento_reversado',
      'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.', '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'bloqueada'::text, 'asiento_reversado'::text,
      'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.'::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  -- a) El cargo dejó de estar vigente (no debería: no se anula con cobros vivos).
  IF v_cargo.estado = 'anulado' THEN
    v_codigo := 'documento_anulado';
    v_motivo := 'El cargo está anulado: su cobro no se contabiliza. Anula el cobro.';
  END IF;

  -- b) Un cobro ANTERIOR del mismo cargo sigue pendiente: el saldo de éste
  --    depende de aquél.
  IF v_codigo IS NULL AND EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE p2.id <> v_pago.id
       AND p2.cargo_adicional_id = v_cargo.id
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND (COALESCE(p2.verified_at, p2.created_at), p2.id) < (v_ts, v_pago.id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'
                          AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
  ) THEN
    v_codigo := 'cobro_anterior_pendiente';
    v_motivo := 'Otro cobro anterior de este cargo sigue pendiente y el saldo que éste reduce depende de aquél. Resuelve o anula el anterior y reprocesa el cargo: sus cobros se contabilizan en orden.';
  END IF;

  -- c) El devengo: publicado y vivo. Su línea de cargo da la cuenta y las
  --    dimensiones del abono. Si falta, el motivo del cargo dice por qué
  --    (configuración, cuenta, responsable).
  IF v_codigo IS NULL THEN
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id, v_pago.id);
    IF v_s.devengo_asiento_id IS NULL OR v_s.devengo_estado <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      IF v_s.devengo_estado = 'borrador' THEN
        v_motivo := 'El devengo de este cargo está en borrador. Publícalo en Pólizas y reprocesa el cargo: sus cobros se contabilizan después.';
      ELSE
        SELECT i.codigo, i.motivo INTO v_dev_i FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = v_cargo.id
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1;
        v_motivo := 'Este cargo todavía no está contabilizado'
          || COALESCE(' (' || v_dev_i.codigo || ': ' || v_dev_i.motivo || ')', '')
          || '. Resuelve su pendiente y reprocesa el cargo: sus cobros se contabilizan después.';
      END IF;
    END IF;
  END IF;

  -- c') El cargo concuerda con su devengo vigente: mismo importe, en la misma
  --     moneda (20261004000200). Si el cargo se modificó después de
  --     devengarse, el cobro no se aplica: el devengo no se recalcula solo ni
  --     se tocan asientos publicados.
  IF v_codigo IS NULL THEN
    SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_cargo.id) k;
    IF v_coh.codigo IS NOT NULL THEN
      v_codigo := v_coh.codigo;
      v_motivo := v_coh.motivo;
    END IF;
  END IF;

  -- d) Dimensiones del devengo = responsable histórico y unidad del cargo.
  IF v_codigo IS NULL AND (v_s.auxiliar_cliente_id IS DISTINCT FROM v_pago.cliente_id
                           OR v_s.unidad_id IS DISTINCT FROM v_cargo.unidad_id) THEN
    v_codigo := 'error';
    v_motivo := 'El devengo del cargo no lleva el responsable o la unidad del cobro: no se aplica a ciegas. Revisa el asiento del cargo.';
  END IF;

  -- e) Saldo. Lo que cabe se aplica al cargo; el EXCEDENTE (20261007000000)
  --    queda como saldo a favor del responsable histórico del cargo (que es el
  --    pagador: lo exige el alta) y su unidad, en la cuenta de anticipos. Sin
  --    cuenta válida, el cobro queda pendiente con el motivo (no se pierde).
  IF v_codigo IS NULL THEN
    v_saldo  := GREATEST(v_s.devengo_monto - v_s.aplicado, 0);
    v_aplica := LEAST(v_pago.monto, v_saldo);
    IF v_pago.monto - v_saldo > 0.005 THEN
      SELECT * INTO v_ant FROM public.conta_cuenta_anticipos(v_cargo.company_id, v_cargo.project_id);
      IF v_ant.cuenta_id IS NULL THEN
        v_codigo := 'excede_saldo';
        v_motivo := format('El cobro (%s) supera el saldo pendiente del cargo (%s): el excedente de %s queda como saldo a favor, pero no hay cuenta para registrarlo. %s',
                           v_pago.monto, v_saldo, v_pago.monto - v_saldo, v_ant.motivo);
      ELSE
        v_credito := v_pago.monto - v_aplica;
      END IF;
    END IF;
  END IF;

  -- f) La cuenta del método de pago (mapeo del ledger).
  v_metodo := CASE v_pago.metodo
    WHEN 'efectivo'        THEN 'metodo_efectivo'
    WHEN 'transferencia'   THEN 'metodo_transferencia'
    WHEN 'deposito'        THEN 'metodo_deposito'
    WHEN 'cheque'          THEN 'metodo_cheque'
    WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
    WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
    WHEN 'paypal'          THEN 'metodo_pasarela'
    ELSE 'metodo_otro'
  END;
  IF v_codigo IS NULL AND public.conta_cuenta_para(v_cargo.company_id, v_cargo.project_id, v_metodo) IS NULL THEN
    v_codigo := 'sin_cuenta';
    v_motivo := format('Falta la cuenta del método de pago (%s) en el mapeo de esta contabilidad. Configúrala y reprocesa el cobro.', v_metodo);
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cobro_cargo_interno: pago % pendiente (%) — asiento omitido', v_pago.id, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento: cargo al método por lo RECIBIDO, abono a la CxC del
  --    devengo por lo APLICADO y a anticipos por el REMANENTE ──────────────
  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_cargo.project_id;

  v_lineas := jsonb_build_array(
    jsonb_build_object('evento', v_metodo, 'debe', v_pago.monto, 'descripcion', 'Cobro'));
  IF v_aplica > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_s.cuenta_id, 'haber', v_aplica, 'descripcion', 'Aplicación a cargo adicional',
      'auxiliar_cliente_id', v_s.auxiliar_cliente_id, 'unidad_id', v_s.unidad_id, 'tipo_cargo', v_s.tipo_cargo));
  END IF;
  IF v_credito > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_ant.cuenta_id, 'haber', v_credito, 'descripcion', 'Saldo a favor',
      'auxiliar_cliente_id', v_s.auxiliar_cliente_id, 'unidad_id', v_s.unidad_id));
  END IF;

  v_asiento := public.conta_generar_asiento(
    v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado',
    COALESCE(v_pago.verified_at, v_pago.created_at)::date,
    'Pago ' || v_pago.metodo || COALESCE(' ref. ' || NULLIF(v_pago.referencia, ''), '') || ' · cargo ' || v_cargo.concepto,
    'ingreso', v_moneda, v_lineas);

  IF v_asiento IS NOT NULL THEN
    IF v_aplica > 0 THEN
      INSERT INTO public.conta_cobro_aplicaciones
        (company_id, project_id, pago_id, cargo_adicional_id, evento, monto, cuenta_id, asiento_id)
      VALUES (v_cargo.company_id, v_cargo.project_id, v_pago.id, v_cargo.id, 'cargo_adicional_emitido',
              v_aplica, v_s.cuenta_id, v_asiento);
    END IF;
    IF v_credito > 0 THEN
      PERFORM public.conta_sf_registrar_origen(v_asiento, v_pago.id, 'excedente', v_ant.cuenta_id,
                                               'cargos_adicionales_unidad', v_cargo.id);
    END IF;

    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('cargo', v_aplica, 'saldo_restante', v_saldo - v_aplica,
                                           'saldo_a_favor', v_credito)), v_asiento);

    PERFORM public.conta_cargo_sincronizar_estado(v_cargo.id);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento del cobro. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento del cobro.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_cargo_interno(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cobro_cargo_interno(uuid, text) IS
  'INTERNA. Contabiliza el cobro de un cargo adicional por tipo: cargo a la cuenta del método por lo recibido, abono a la CxC de su devengo por lo aplicado y a la cuenta de anticipos por el remanente (saldo a favor del responsable histórico). Pendiente visible si falta el devengo publicado, si el cargo no concuerda con su devengo, si un cobro anterior está pendiente, si falta la cuenta del método o la de anticipos. Candado por cargo; idempotente; deriva el estado del cargo.';

-- ── 12. Contabilizar un ANTICIPO sin deuda (INTERNO) ────────────────────────
-- Mismo contrato que los otros contabilizadores de cobros: bloquea y revalida
-- el pago, es idempotente, no recrea un asiento reversado y deja un intento
-- con el motivo si queda pendiente. El asiento: cargo al método, abono a
-- anticipos con el titular. Nunca ingreso.
CREATE FUNCTION public.conta_contabilizar_anticipo_interno(
  p_pago_id uuid,
  p_disparo text
)
RETURNS TABLE (
  resultado  text,
  codigo     text,
  motivo     text,
  asiento_id uuid,
  intento_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago    public.pagos;
  v_an      public.conta_anticipos;
  v_asiento uuid;
  v_intento uuid;
  v_codigo  text;
  v_motivo  text;
  v_metodo  text;
  v_moneda  text;
  v_ant     record;
BEGIN
  IF p_disparo NOT IN ('cobro','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_anticipo_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'El cobro ya no existe: no se contabiliza.'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  SELECT * INTO v_an FROM public.conta_anticipos an WHERE an.pago_id = p_pago_id;
  IF v_an.pago_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_anticipo_interno: el pago % no es un anticipo', p_pago_id USING ERRCODE = '22023';
  END IF;

  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'documento_anulado',
      'El anticipo fue anulado o eliminado antes de contabilizarse: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'El anticipo fue anulado o eliminado antes de contabilizarse: no se contabiliza.'::text, NULL::uuid, v_intento;
    RETURN;
  END IF;

  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_an.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_an.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'asiento_reversado',
      'El asiento de este anticipo fue anulado o reversado: no se recrea automáticamente.', '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'bloqueada'::text, 'asiento_reversado'::text,
      'El asiento de este anticipo fue anulado o reversado: no se recrea automáticamente.'::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- a) La cuenta de anticipos del ledger.
  SELECT * INTO v_ant FROM public.conta_cuenta_anticipos(v_an.company_id, v_an.project_id);
  IF v_ant.cuenta_id IS NULL THEN
    v_codigo := v_ant.codigo;
    v_motivo := 'El anticipo quedó registrado, pero no se contabiliza todavía. ' || v_ant.motivo;
  END IF;

  -- b) La cuenta del método de pago (mapeo del ledger).
  v_metodo := CASE v_pago.metodo
    WHEN 'efectivo'        THEN 'metodo_efectivo'
    WHEN 'transferencia'   THEN 'metodo_transferencia'
    WHEN 'deposito'        THEN 'metodo_deposito'
    WHEN 'cheque'          THEN 'metodo_cheque'
    WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
    WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
    WHEN 'paypal'          THEN 'metodo_pasarela'
    ELSE 'metodo_otro'
  END;
  IF v_codigo IS NULL AND public.conta_cuenta_para(v_an.company_id, v_an.project_id, v_metodo) IS NULL THEN
    v_codigo := 'sin_cuenta';
    v_motivo := format('Falta la cuenta del método de pago (%s) en el mapeo de esta contabilidad. Configúrala y reprocesa el anticipo.', v_metodo);
  END IF;

  IF v_codigo IS NULL AND COALESCE(v_pago.monto, 0) <= 0 THEN
    v_codigo := 'error';
    v_motivo := 'El anticipo no tiene importe que contabilizar.';
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_anticipo_interno: pago % pendiente (%) — asiento omitido', v_pago.id, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_an.project_id;

  v_asiento := public.conta_generar_asiento(
    v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado',
    COALESCE(v_pago.verified_at, v_pago.created_at)::date,
    'Anticipo ' || v_pago.metodo || COALESCE(' ref. ' || NULLIF(v_pago.referencia, ''), ''),
    'ingreso', v_moneda,
    jsonb_build_array(
      jsonb_build_object('evento', v_metodo, 'debe', v_pago.monto, 'descripcion', 'Cobro'),
      jsonb_build_object('cuenta_id', v_ant.cuenta_id, 'haber', v_pago.monto, 'descripcion', 'Saldo a favor',
                         'auxiliar_cliente_id', v_an.cliente_id, 'unidad_id', v_an.unidad_id)));

  IF v_asiento IS NOT NULL THEN
    PERFORM public.conta_sf_registrar_origen(v_asiento, v_pago.id, 'anticipo', v_ant.cuenta_id, NULL, NULL);
    v_intento := public.conta_registrar_intento_cargo(
      v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('saldo_a_favor', v_pago.monto)), v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_an.company_id, v_an.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento del anticipo. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento del anticipo.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_anticipo_interno(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_anticipo_interno(uuid, text) IS
  'INTERNA. Contabiliza un anticipo sin deuda: cargo a la cuenta del método, abono a la cuenta de anticipos con el cliente y la unidad del anticipo, y registra el origen del saldo a favor. Pendiente visible si falta la cuenta de anticipos o la del método.';

-- Envoltorio para el trigger: la contabilidad nunca rompe el cobro.
CREATE FUNCTION public.conta_contabilizar_anticipo_seguro(p_pago_id uuid, p_disparo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_an public.conta_anticipos;
BEGIN
  BEGIN
    PERFORM public.conta_contabilizar_anticipo_interno(p_pago_id, p_disparo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_contabilizar_anticipo_seguro(%): %', p_pago_id, SQLERRM;
    BEGIN
      SELECT * INTO v_an FROM public.conta_anticipos an WHERE an.pago_id = p_pago_id;
      IF v_an.pago_id IS NOT NULL THEN
        PERFORM public.conta_registrar_intento_cargo(
          v_an.company_id, v_an.project_id, 'pagos', p_pago_id, 'pago_contabilizado', p_disparo,
          'pendiente', 'error',
          'Error inesperado al contabilizar el anticipo. Reprocesa; si persiste, consulta el registro del servidor.',
          '[]'::jsonb, NULL);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'conta_contabilizar_anticipo_seguro: no se pudo registrar el intento: %', SQLERRM;
    END;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_anticipo_seguro(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 13. Trigger de PAGOS: anticipos y cobros con saldo a favor aplicado ─────
-- Cuerpo idéntico a 20261005000000 salvo el bloque inicial (validación de
-- anticipos y guard de aplicaciones vivas) y la rama de contabilización de un
-- anticipo. El trigger no cambia (no se tocan los triggers de `pagos`).
CREATE OR REPLACE FUNCTION public.conta_tg_pagos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_project    uuid;
  v_company    uuid;
  v_moneda     text;
  v_metodo     text;
  v_contra     text;
  v_es_cuota   boolean;
  v_reg_estado text;
  v_anticipo   boolean;
BEGIN
  -- SALDOS A FAVOR (20261007000000). Un anticipo sólo se escribe por sus RPC
  -- y sus datos no cambian; un cobro cuyo saldo a favor tiene aplicaciones
  -- VIVAS no se rechaza, anula ni borra: primero se revierten las
  -- aplicaciones (así ninguna queda sin respaldo). Lanzar aquí aborta la
  -- sentencia entera, como en un trigger BEFORE.
  v_anticipo := EXISTS (SELECT 1 FROM public.conta_anticipos an
                         WHERE an.pago_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  IF v_anticipo THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ANTICIPO_INBORRABLE: un anticipo es historia contable; se anula con conta_anular_anticipo, no se borra.'
        USING ERRCODE = 'check_violation';
    ELSIF TG_OP = 'INSERT' THEN
      IF current_setting('conta.anticipo_pago', true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'ANTICIPO_SOLO_RPC: los anticipos se registran con conta_registrar_anticipo.' USING ERRCODE = '42501';
      END IF;
      IF NEW.cuota_id IS NOT NULL OR NEW.registro_id IS NOT NULL OR NEW.convenio_id IS NOT NULL
         OR NEW.cargo_adicional_id IS NOT NULL THEN
        RAISE EXCEPTION 'ANTICIPO_EXCLUSIVO: un anticipo no se vincula a ningún documento.' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.monto IS DISTINCT FROM OLD.monto OR NEW.metodo IS DISTINCT FROM OLD.metodo
         OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.cuota_id IS DISTINCT FROM OLD.cuota_id OR NEW.registro_id IS DISTINCT FROM OLD.registro_id
         OR NEW.convenio_id IS DISTINCT FROM OLD.convenio_id
         OR NEW.cargo_adicional_id IS DISTINCT FROM OLD.cargo_adicional_id THEN
        RAISE EXCEPTION 'ANTICIPO_INMUTABLE: titular, proyecto, importe, método y fecha de un anticipo no cambian. Anúlalo y registra otro.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status)
         AND current_setting('conta.anticipo_pago', true) IS DISTINCT FROM OLD.id::text THEN
        RAISE EXCEPTION 'ANTICIPO_SOLO_RPC: un anticipo se anula con conta_anular_anticipo (Contabilidad › Estado de cuenta › Saldos a favor).'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF (TG_OP = 'DELETE'
      OR (TG_OP = 'UPDATE'
          AND ((NEW.estado = 'rechazado' AND OLD.estado IS DISTINCT FROM 'rechazado')
               OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL))))
     AND EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                  WHERE x.pago_id = OLD.id AND public.conta_sf_asiento_vivo(x.asiento_id)) THEN
    RAISE EXCEPTION 'COBRO_SALDO_FAVOR_APLICADO: el saldo a favor de este cobro ya se aplicó a otros documentos. Revierte esas aplicaciones (Contabilidad › Estado de cuenta › Saldos a favor) y después rechaza o anula el cobro.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cobros de cargos adicionales (20261004000100): la validación que antes
  -- hacía un trigger BEFORE propio. Lanzar aquí aborta la sentencia igual.
  IF (TG_OP <> 'INSERT' AND OLD.cargo_adicional_id IS NOT NULL)
     OR (TG_OP <> 'DELETE' AND NEW.cargo_adicional_id IS NOT NULL) THEN
    PERFORM public.conta_cobro_cargo_validar_escritura(
      TG_OP,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW END);
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Hard delete de un pago contabilizado → reverso (company vía proyecto).
    v_project := COALESCE(OLD.project_id, (SELECT project_id FROM public.clientes WHERE id = OLD.cliente_id));
    SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
    IF v_company IS NOT NULL THEN
      PERFORM public.conta_reversar_automatico(v_company, 'pagos', OLD.id,
        'pago_contabilizado', 'Pago eliminado');
    END IF;
    RETURN OLD;
  END IF;

  v_project := COALESCE(NEW.project_id, (SELECT project_id FROM public.clientes WHERE id = NEW.cliente_id));
  SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Evidencia del rechazo (20261005000000). La hora es la del servidor y el
  -- actor el de la sesión: nada de lo que manda el cliente. Sólo la
  -- TRANSICIÓN escribe: repetir un rechazo no deja otra fila.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado' AND NEW.estado = 'rechazado'
     AND (NEW.verification_notes IS DISTINCT FROM OLD.verification_notes
          OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'PAGO_RECHAZADO_INMUTABLE: el cobro ya está rechazado; su motivo y sus datos de revisión no se reescriben.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado = 'rechazado'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'rechazado') THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'rechazo',
       CASE WHEN TG_OP = 'INSERT' THEN 'alta' ELSE COALESCE(OLD.estado, '-') END,
       'rechazado', NULLIF(btrim(COALESCE(NEW.verification_notes, '')), ''), auth.uid(),
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.verified_at END);
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado'
        AND NEW.estado IS DISTINCT FROM 'rechazado' THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'reactivacion', 'rechazado', COALESCE(NEW.estado, '-'),
       NULL, auth.uid(), OLD.verified_at);
  END IF;

  -- Reverso: rechazado o soft-delete después de contabilizado.
  IF TG_OP = 'UPDATE'
     AND OLD.estado IN ('verificado','aplicado')
     AND (NEW.estado = 'rechazado'
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    PERFORM public.conta_reversar_automatico(v_company, 'pagos', NEW.id,
      'pago_contabilizado',
      CASE WHEN NEW.estado = 'rechazado' THEN 'Pago rechazado' ELSE 'Pago eliminado' END);
    -- Cobro de un cargo adicional (20261004000000): el reverso reabre el saldo
    -- y el estado del cargo se vuelve a derivar de sus cobros vivos.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_cargo_sincronizar_estado(NEW.cargo_adicional_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

    -- ANTICIPO sin deuda (20261007000000): a la cuenta de anticipos con su
    -- titular; nunca a ingreso_otros.
    IF v_anticipo THEN
      PERFORM public.conta_contabilizar_anticipo_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    -- Cobro de un CARGO ADICIONAL (20261004000000): se aplica contra la CxC
    -- de su devengo, nunca el mapeo general ni ingreso directo.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_cargo_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    -- Cobro de una cuota contabilizada por tipo (20261002000100): NUNCA el
    -- mapeo general. Reparto mora→principal contra la cuenta y dimensiones de
    -- cada devengo, o pendiente visible si falta alguno.
    IF public.conta_cobro_cuota_por_tipo(NEW.id) IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    v_metodo := CASE NEW.metodo
      WHEN 'efectivo'        THEN 'metodo_efectivo'
      WHEN 'transferencia'   THEN 'metodo_transferencia'
      WHEN 'deposito'        THEN 'metodo_deposito'
      WHEN 'cheque'          THEN 'metodo_cheque'
      WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
      WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
      WHEN 'paypal'          THEN 'metodo_pasarela'
      ELSE 'metodo_otro'
    END;

    -- Contrapartida: CxC si el documento origen ya devengó; ingreso directo si no.
    v_es_cuota := EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE pago_id = NEW.id);
    IF NEW.registro_id IS NOT NULL THEN
      SELECT factura_estado INTO v_reg_estado FROM public.registros WHERE id = NEW.registro_id;
      v_contra := CASE WHEN v_reg_estado IN ('emitida','vencida','pagada')
                       THEN 'cxc_agua' ELSE 'ingreso_agua' END;
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    ELSIF v_es_cuota THEN
      v_contra := 'cxc_cuotas';
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
    ELSE
      v_contra := 'ingreso_otros';
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    END IF;

    PERFORM public.conta_generar_asiento(
      v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
      COALESCE(NEW.verified_at::date, CURRENT_DATE),
      'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'ingreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
        jsonb_build_object('evento', v_contra, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_pagos() FROM PUBLIC, anon, authenticated;

-- ── 14. Reproceso: también los anticipos ──────────────────────────────────
-- conta_reprocesar_un_cobro: cuerpo idéntico a 20261004000000 salvo el
-- proyecto y el contabilizador de un anticipo.
CREATE OR REPLACE FUNCTION public.conta_reprocesar_un_cobro(
  p_pago_id    uuid,
  p_company_id uuid
)
RETURNS TABLE (
  evento         text,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_estado text,
  intento_id     uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago     public.pagos;
  v_project  uuid;
  v_a        record;
  v_res      record;
  v_intento  uuid;
  v_periodo  text;
BEGIN
  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id;
  IF EXISTS (SELECT 1 FROM public.conta_anticipos an WHERE an.pago_id = p_pago_id) THEN
    SELECT an.project_id INTO v_project FROM public.conta_anticipos an WHERE an.pago_id = p_pago_id;
  ELSIF v_pago.cargo_adicional_id IS NOT NULL THEN
    SELECT ca.project_id INTO v_project FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = v_pago.cargo_adicional_id;
  ELSE
    SELECT c.project_id INTO v_project FROM public.cuotas_condominio c
     WHERE c.id = public.conta_cobro_cuota_por_tipo(p_pago_id);
  END IF;

  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
      'pago_contabilizado', 'reproceso', 'bloqueada', 'documento_anulado',
      'El cobro está rechazado, sin verificar o eliminado: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro está rechazado, sin verificar o eliminado: no se contabiliza.'::text,
      NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
    FROM public.conta_asientos a
   WHERE a.company_id = p_company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = p_pago_id
     AND a.origen_evento = 'pago_contabilizado'
   ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
      v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
        'pago_contabilizado', 'reproceso', 'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_a.id);
      RETURN QUERY SELECT 'pago_contabilizado'::text, 'ya_contabilizada'::text, NULL::text,
        'El cobro ya está contabilizado.'::text, v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
    ELSE
      v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
        'pago_contabilizado', 'reproceso', 'bloqueada', 'asiento_reversado',
        'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.', '[]'::jsonb, v_a.id);
      RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'asiento_reversado'::text,
        'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.'::text,
        v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
    END IF;
    RETURN;
  END IF;

  v_periodo := to_char(public.conta_fecha_evento_cargo('pagos', p_pago_id, 'pago_contabilizado'), 'YYYY-MM');
  IF v_project IS NOT NULL AND public.conta_periodo_cerrado(v_project, v_periodo) THEN
    v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
      'pago_contabilizado', 'reproceso', 'bloqueada', 'periodo_cerrado',
      format('El período %s del cobro está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
      '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'periodo_cerrado'::text,
      format('El período %s del cobro está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
      NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.conta_anticipos an WHERE an.pago_id = p_pago_id) THEN
    SELECT * INTO v_res FROM public.conta_contabilizar_anticipo_interno(p_pago_id, 'reproceso');
  ELSIF v_pago.cargo_adicional_id IS NOT NULL THEN
    SELECT * INTO v_res FROM public.conta_contabilizar_cobro_cargo_interno(p_pago_id, 'reproceso');
  ELSE
    SELECT * INTO v_res FROM public.conta_contabilizar_cobro_interno(p_pago_id, 'reproceso');
  END IF;
  IF v_res.asiento_id IS NOT NULL THEN
    SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
    RETURN QUERY SELECT 'pago_contabilizado'::text, v_res.resultado, v_res.codigo,
      CASE WHEN v_a.estado = 'borrador'
           THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
           ELSE NULL END,
      v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
  ELSE
    RETURN QUERY SELECT 'pago_contabilizado'::text, v_res.resultado, v_res.codigo, v_res.motivo,
      NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_un_cobro(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- conta_reprocesar_cargo: cuerpo idéntico a 20261004000000 salvo la rama del
-- anticipo, antes que la de los cobros de documentos.
CREATE OR REPLACE FUNCTION public.conta_reprocesar_cargo(
  p_origen_tabla text,
  p_origen_id    uuid
)
RETURNS TABLE (
  evento         text,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_estado text,
  intento_id     uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_doc_co   uuid;
  v_project  uuid;
  v_anulado  boolean;
  v_fecha    date;
  v_evento   text;
  v_a        record;
  v_res      record;
  v_intento  uuid;
  v_periodo  text;
  v_alguno   boolean := false;
  v_pago_id  uuid;
  v_pagos    uuid[] := '{}';
  v_cargo_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;

  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  -- Genera y publica un asiento: exige crear Y cambiar estado.
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para contabilizar cargos.' USING ERRCODE = '42501';
  END IF;

  IF p_origen_tabla IS NULL OR p_origen_tabla NOT IN ('cuotas_condominio','cargos_adicionales_unidad','pagos') THEN
    RAISE EXCEPTION 'Origen inválido: %', p_origen_tabla USING ERRCODE = '22023';
  END IF;
  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere el id del documento.' USING ERRCODE = '22023';
  END IF;

  -- BLOQUEO: serializa con otro reproceso, con la anulación y con el borrado.
  -- Otra empresa o un proyecto no autorizado responden igual que un
  -- documento inexistente: no se confirma la existencia de lo ajeno.
  -- Un COBRO: se bloquea su fila y se reprocesa él solo. Su cuota da empresa y
  -- proyecto; fuera de ámbito responde como inexistente.
  -- Un COBRO DE CARGO ADICIONAL (20261004000000): mismo orden que el resto
  -- de caminos de un cargo — fila del cargo → fila del pago → candado.
  -- Un ANTICIPO (20261007000000): no tiene documento; se bloquea su fila
  -- (orden: pago → candado) y se reprocesa él solo. Fuera de ámbito responde
  -- como inexistente.
  IF p_origen_tabla = 'pagos'
     AND EXISTS (SELECT 1 FROM public.conta_anticipos an WHERE an.pago_id = p_origen_id) THEN
    SELECT an.company_id INTO v_doc_co
      FROM public.conta_anticipos an
      JOIN public.pagos p ON p.id = an.pago_id
     WHERE an.pago_id = p_origen_id AND an.company_id = v_company
       AND public.can_access_project(an.project_id)
       FOR UPDATE OF p;
    IF v_doc_co IS NULL THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
        'El documento no existe o no está en tu ámbito.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(p_origen_id, v_doc_co);
    RETURN;
  END IF;

  IF p_origen_tabla = 'pagos' THEN
    SELECT p.cargo_adicional_id INTO v_cargo_id FROM public.pagos p WHERE p.id = p_origen_id;
  END IF;
  IF p_origen_tabla = 'pagos' AND v_cargo_id IS NOT NULL THEN
    SELECT ca.company_id INTO v_doc_co
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = v_cargo_id AND ca.company_id = v_company
       AND public.can_access_project(ca.project_id)
       FOR UPDATE;
    IF v_doc_co IS NOT NULL THEN
      PERFORM 1 FROM public.pagos p WHERE p.id = p_origen_id FOR UPDATE;
    END IF;
    IF v_doc_co IS NULL THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
        'El documento no existe o no está en tu ámbito.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_origen_id) THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
        'Este cobro no pasó por la contabilización por tipo de cargo: no se contabiliza retroactivamente.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(p_origen_id, v_doc_co);
    RETURN;
  END IF;

  IF p_origen_tabla = 'pagos' THEN
    SELECT c.company_id INTO v_doc_co
      FROM public.pagos p
      JOIN public.cuotas_condominio c
        ON c.id = COALESCE(p.cuota_id,
                           (SELECT c2.id FROM public.cuotas_condominio c2 WHERE c2.pago_id = p.id
                             ORDER BY c2.created_at, c2.id LIMIT 1))
     WHERE p.id = p_origen_id AND c.company_id = v_company
       AND public.can_access_project(c.project_id)
       FOR UPDATE OF p;
    IF v_doc_co IS NULL THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
        'El documento no existe o no está en tu ámbito.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF public.conta_cobro_cuota_por_tipo(p_origen_id) IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                       WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_origen_id) THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
        'Este cobro no pasó por la contabilización por tipo de cargo: no se contabiliza retroactivamente.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(p_origen_id, v_doc_co);
    RETURN;
  END IF;

  IF p_origen_tabla = 'cuotas_condominio' THEN
    SELECT c.company_id, c.project_id, c.deleted_at IS NOT NULL, c.created_at::date
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cuotas_condominio c
     WHERE c.id = p_origen_id AND c.company_id = v_company
       AND public.can_access_project(c.project_id)
       FOR UPDATE;
  ELSE
    SELECT ca.company_id, ca.project_id, ca.estado = 'anulado', ca.fecha_cargo
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = p_origen_id AND ca.company_id = v_company
       AND public.can_access_project(ca.project_id)
       FOR UPDATE;
  END IF;

  IF v_doc_co IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
      'El documento no existe o no está en tu ámbito.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  FOR v_evento IN
    SELECT DISTINCT i.evento
      FROM public.conta_intentos_contabilizacion i
     WHERE i.origen_tabla = p_origen_tabla AND i.origen_id = p_origen_id
     ORDER BY 1
  LOOP
    v_alguno := true;

    IF v_anulado THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'documento_anulado',
        'El documento está anulado o eliminado: no se contabiliza.', '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'documento_anulado'::text,
        'El documento está anulado o eliminado: no se contabiliza.'::text,
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- ¿Ya tiene asiento? Vivo → ya contabilizado. Reversado o anulado → no
    -- se recrea: eso lo decide una persona, no un botón.
    SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
      FROM public.conta_asientos a
     WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
       AND a.origen_tabla = p_origen_tabla AND a.origen_id = p_origen_id
       AND a.origen_evento = v_evento
     ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'ya_contabilizada'::text, NULL::text,
          'El documento ya está contabilizado.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      ELSE
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'bloqueada', 'asiento_reversado',
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.',
          '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'asiento_reversado'::text,
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      END IF;
      CONTINUE;
    END IF;

    -- Período cerrado: el reproceso no re-fecha ni abre el período.
    -- La fecha del EVENTO: la mora tiene la suya (20261002000100).
    v_periodo := to_char(public.conta_fecha_evento_cargo(p_origen_tabla, p_origen_id, v_evento), 'YYYY-MM');
    IF v_project IS NOT NULL AND public.conta_periodo_cerrado(v_project, v_periodo) THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'periodo_cerrado',
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
        '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'periodo_cerrado'::text,
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- La MISMA lógica que la emisión.
    SELECT * INTO v_res FROM public.conta_contabilizar_cargo_interno(p_origen_tabla, p_origen_id, v_evento, 'reproceso');
    IF v_res.asiento_id IS NOT NULL THEN
      SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo,
        CASE WHEN v_a.estado = 'borrador'
             THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
             ELSE NULL END,
        v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
    ELSE
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo, v_res.motivo,
        NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
    END IF;
  END LOOP;

  -- Cobros de la cuota que esperaban su devengo: ahora, en orden cronológico
  -- (el reparto de cada uno depende de los anteriores).
  IF p_origen_tabla = 'cuotas_condominio' AND NOT v_anulado THEN
    -- BLOQUEO de los cobros pendientes, por id, ANTES de contabilizar ninguno
    -- (orden: cuota → pagos → candado de cobros). Un rechazo o borrado en
    -- curso se espera aquí; al confirmarse, la fila deja de cumplir el filtro
    -- (se re-evalúa sobre la versión nueva) o desaparece, y no se toca.
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE (p.cuota_id = p_origen_id
              OR p.id = (SELECT c.pago_id FROM public.cuotas_condominio c WHERE c.id = p_origen_id))
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id)
       ORDER BY p.id
       FOR UPDATE OF p
    LOOP
      v_pagos := v_pagos || v_pago_id;
    END LOOP;

    -- Sólo los pagos BLOQUEADOS, en orden cronológico y revalidados.
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.id = ANY (v_pagos)
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
                            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                            AND a.origen_evento = 'pago_contabilizado')
       ORDER BY COALESCE(p.verified_at, p.created_at), p.id
    LOOP
      v_alguno := true;
      RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(v_pago_id, v_doc_co);
    END LOOP;
  END IF;

  -- Cobros del CARGO ADICIONAL que esperaban su devengo (20261004000000):
  -- mismo patrón que la cuota — se bloquean por id y se contabilizan en orden.
  IF p_origen_tabla = 'cargos_adicionales_unidad' AND NOT v_anulado THEN
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.cargo_adicional_id = p_origen_id
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id)
       ORDER BY p.id
       FOR UPDATE OF p
    LOOP
      v_pagos := v_pagos || v_pago_id;
    END LOOP;

    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.id = ANY (v_pagos)
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
                            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                            AND a.origen_evento = 'pago_contabilizado')
       ORDER BY COALESCE(p.verified_at, p.created_at), p.id
    LOOP
      v_alguno := true;
      RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(v_pago_id, v_doc_co);
    END LOOP;
  END IF;

  -- Sin intentos previos: documento anterior a esta contabilización, o cuota
  -- sin clasificar. No se contabiliza retroactivamente, y NO se registra un
  -- intento (eso lo volvería elegible).
  IF NOT v_alguno THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
      'Este documento no pasó por la contabilización por tipo de cargo (es anterior a ella o no está clasificado): no se contabiliza retroactivamente.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) TO authenticated;

-- ── 15. Bandeja: también los anticipos pendientes ─────────────────────────
-- Cuerpo idéntico a 20261004000000 salvo la rama de anticipos.
CREATE OR REPLACE FUNCTION public.conta_cargos_pendientes(
  p_project_id uuid    DEFAULT NULL,
  p_codigo     text    DEFAULT NULL,
  p_busqueda   text    DEFAULT NULL,
  p_limite     integer DEFAULT 25,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  origen_tabla      text,
  origen_id         uuid,
  evento            text,
  concepto          text,
  unidad_id         uuid,
  unidad_nombre     text,
  responsable_id    uuid,
  responsable_nombre text,
  tipo_cargo        text,
  fecha             date,
  monto             numeric,
  project_id        uuid,
  codigo            text,
  motivo            text,
  ultimo_intento_at timestamptz,
  ultimo_disparo    text,
  intentos          bigint,
  puede_reprocesar  boolean,
  total_filas       bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_puede    boolean;
  v_busqueda text;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  IF p_codigo IS NOT NULL AND p_codigo NOT IN
     ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado',
      'devengo_pendiente','excede_saldo','otro') THEN
    RAISE EXCEPTION 'Filtro de motivo inválido: %', p_codigo USING ERRCODE = '22023';
  END IF;

  v_puede := public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status');
  v_busqueda := NULLIF(btrim(COALESCE(p_busqueda, '')), '');

  RETURN QUERY
  WITH docs AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, c.concepto || ' ' || c.periodo AS o_concepto,
           c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp, c.created_at::date AS o_fecha,
           c.monto AS o_monto, c.mora_monto AS o_mora, c.project_id AS o_project
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND c.deleted_at IS NULL AND c.tipo_cargo IS NOT NULL
    UNION ALL
    SELECT 'cargos_adicionales_unidad', ca.id, ca.concepto, ca.unidad_id, ca.responsable_cliente_id,
           ca.fecha_cargo, ca.monto, NULL::numeric, ca.project_id
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.company_id = v_company AND ca.project_id IS NOT DISTINCT FROM p_project_id
       AND ca.estado IS DISTINCT FROM 'anulado'
    UNION ALL
    SELECT 'pagos', p.id,
           'Cobro ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' — ' || c.concepto || ' ' || c.periodo,
           c.unidad_id, c.responsable_cliente_id, COALESCE(p.verified_at, p.created_at)::date,
           p.monto, NULL::numeric, c.project_id
      FROM public.pagos p
      JOIN public.cuotas_condominio c
        ON c.id = COALESCE(p.cuota_id,
                           (SELECT c2.id FROM public.cuotas_condominio c2 WHERE c2.pago_id = p.id
                             ORDER BY c2.created_at, c2.id LIMIT 1))
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND p.cargo_adicional_id IS NULL
       AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
    UNION ALL
    -- Cobros de cargos adicionales (20261004000000)
    SELECT 'pagos', p.id,
           'Cobro ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' — cargo ' || ca.concepto,
           ca.unidad_id, ca.responsable_cliente_id, COALESCE(p.verified_at, p.created_at)::date,
           p.monto, NULL::numeric, ca.project_id
      FROM public.pagos p
      JOIN public.cargos_adicionales_unidad ca ON ca.id = p.cargo_adicional_id
     WHERE ca.company_id = v_company AND ca.project_id IS NOT DISTINCT FROM p_project_id
       AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
    UNION ALL
    -- Anticipos sin deuda (20261007000000)
    SELECT 'pagos', p.id,
           'Anticipo ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
           an.unidad_id, an.cliente_id, COALESCE(p.verified_at, p.created_at)::date,
           p.monto, NULL::numeric, an.project_id
      FROM public.pagos p
      JOIN public.conta_anticipos an ON an.pago_id = p.id
     WHERE an.company_id = v_company AND an.project_id IS NOT DISTINCT FROM p_project_id
       AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
  ),
  eventos AS (
    SELECT DISTINCT d.*, i.evento AS o_evento
      FROM docs d
      JOIN public.conta_intentos_contabilizacion i
        ON i.origen_tabla = d.o_tabla AND i.origen_id = d.o_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.conta_asientos a
        WHERE a.company_id = v_company AND a.origen = 'automatico'
          AND a.origen_tabla = d.o_tabla AND a.origen_id = d.o_id
          AND a.origen_evento = i.evento)
  ),
  diag AS (
    SELECT e.*, ui.created_at AS i_at, ui.disparo AS i_disparo, ui.resultado AS i_resultado,
           ui.codigo AS i_codigo, ui.motivo AS i_motivo,
           (SELECT count(*) FROM public.conta_intentos_contabilizacion i2
             WHERE i2.origen_tabla = e.o_tabla AND i2.origen_id = e.o_id AND i2.evento = e.o_evento) AS n_intentos,
           u.nombre AS u_nombre, cl.nombre AS r_nombre,
           public.conta_tipo_cargo_de_documento(e.o_tabla, e.o_id, e.o_evento) AS o_tipo
      FROM eventos e
      LEFT JOIN LATERAL (
        SELECT i.* FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
      LEFT JOIN public.unidades u ON u.id = e.o_unidad
      LEFT JOIN public.clientes cl ON cl.id = e.o_resp
     WHERE v_busqueda IS NULL
        OR e.o_concepto ILIKE '%' || v_busqueda || '%'
        OR u.nombre ILIKE '%' || v_busqueda || '%'
        OR cl.nombre ILIKE '%' || v_busqueda || '%'
  ),
  clasif AS (
    SELECT d.*,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_codigo ELSE 'error' END AS c_codigo,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_motivo
           ELSE 'El último intento no dejó asiento vigente. Reprocesa para diagnosticar.' END AS c_motivo
      FROM diag d
  ),
  filtrado AS (
    SELECT c.* FROM clasif c
     WHERE p_codigo IS NULL
        OR (p_codigo = 'otro' AND c.c_codigo NOT IN ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado',
                                                       'devengo_pendiente','excede_saldo'))
        OR c.c_codigo = p_codigo
  )
  SELECT f.o_tabla, f.o_id, f.o_evento, f.o_concepto, f.o_unidad, f.u_nombre, f.o_resp, f.r_nombre,
         f.o_tipo, f.o_fecha,
         (CASE WHEN f.o_evento = 'cuota_mora' THEN f.o_mora ELSE f.o_monto END)::numeric,
         f.o_project, f.c_codigo, f.c_motivo, f.i_at, f.i_disparo, f.n_intentos, v_puede,
         count(*) OVER ()
    FROM filtrado f
   ORDER BY f.i_at DESC NULLS LAST, f.o_id, f.o_evento
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) TO authenticated;

-- ── 16. Saldo de una cuota por tipo para aplicarle un saldo a favor (INTERNA)
-- Los devengos VIVOS de principal y mora (línea de cargo: cuenta, dimensiones,
-- importe en la moneda del documento y su moneda) y lo ya aplicado a cada uno:
-- cobros con asiento vivo, cobros del camino histórico (como principal, igual
-- que al contabilizar un cobro) y aplicaciones vivas de saldos a favor.
CREATE FUNCTION public.conta_cuota_saldo_cobro(p_cuota_id uuid)
RETURNS TABLE (
  princ_asiento_id uuid,
  princ_estado     text,
  princ_monto      numeric,
  princ_cuenta_id  uuid,
  princ_auxiliar   uuid,
  princ_unidad     uuid,
  princ_tipo_cargo text,
  princ_moneda     text,
  mora_asiento_id  uuid,
  mora_estado      text,
  mora_monto       numeric,
  mora_cuenta_id   uuid,
  mora_auxiliar    uuid,
  mora_unidad      uuid,
  mora_tipo_cargo  text,
  mora_moneda      text,
  aplicado_princ   numeric,
  aplicado_mora    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.cuotas_condominio x WHERE x.id = p_cuota_id),
  dev AS (
    SELECT DISTINCT ON (a.origen_evento)
           a.origen_evento AS ev, a.id AS asiento_id, a.estado,
           COALESCE(l.monto_origen, l.debe)::numeric(14,2) AS monto,
           l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo,
           COALESCE(l.moneda_origen, a.moneda_base) AS moneda
      FROM c
      JOIN public.conta_asientos a
        ON a.company_id = c.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
       AND a.origen_evento IN ('cuota_emitida','cuota_mora')
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     ORDER BY a.origen_evento, a.created_at DESC, l.orden
  ),
  ap AS (
    SELECT COALESCE(sum(x.monto) FILTER (WHERE x.evento = 'cuota_emitida'), 0) AS princ,
           COALESCE(sum(x.monto) FILTER (WHERE x.evento = 'cuota_mora'), 0) AS mora
      FROM public.conta_cobro_aplicaciones x
      JOIN public.conta_asientos a ON a.id = x.asiento_id
     WHERE x.cuota_id = p_cuota_id AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
  ),
  hist AS (
    SELECT COALESCE(sum(p2.monto), 0) AS princ
      FROM c
      JOIN public.pagos p2 ON (p2.cuota_id = c.id OR p2.id = c.pago_id)
     WHERE EXISTS (SELECT 1 FROM public.conta_asientos a
                    WHERE a.company_id = c.company_id AND a.origen = 'automatico'
                      AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                      AND a.origen_evento = 'pago_contabilizado'
                      AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones x WHERE x.pago_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p2.id)
  ),
  sf AS (
    SELECT COALESCE(sum(x.monto_principal), 0) AS princ, COALESCE(sum(x.monto_mora), 0) AS mora
      FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(x.asiento_id)
  )
  SELECT p.asiento_id, p.estado, p.monto, p.cuenta_id, p.auxiliar_cliente_id, p.unidad_id, p.tipo_cargo, p.moneda,
         m.asiento_id, m.estado, m.monto, m.cuenta_id, m.auxiliar_cliente_id, m.unidad_id, m.tipo_cargo, m.moneda,
         (ap.princ + hist.princ + sf.princ)::numeric(14,2),
         (ap.mora + sf.mora)::numeric(14,2)
    FROM ap, hist, sf
    LEFT JOIN dev p ON p.ev = 'cuota_emitida'
    LEFT JOIN dev m ON m.ev = 'cuota_mora'
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_saldo_cobro(uuid) FROM PUBLIC, anon, authenticated;

-- ── 17. Autorización de las operaciones de saldo a favor (INTERNA) ─────────
-- Registrar o anular un anticipo: como un cobro de back-office (Condominios
-- editar o rol de empresa). Aplicar o revertir: decide sobre la contabilidad,
-- así que exige lo mismo que el reproceso: crear Y cambiar estado en
-- Contabilidad (o rol de empresa). Leer: ver Condominios o Contabilidad.
CREATE FUNCTION public.conta_sf_autorizar(p_accion text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  IF p_accion = 'anticipo' OR p_accion = 'leer' THEN
    RETURN public.conta_cobro_cargo_autorizar(p_accion = 'anticipo');
  END IF;
  IF p_accion <> 'aplicar' THEN
    RAISE EXCEPTION 'conta_sf_autorizar: acción inválida %', p_accion USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para aplicar o revertir saldos a favor: requiere crear y cambiar estado en Contabilidad.'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_sf_autorizar(text) FROM PUBLIC, anon, authenticated;

-- ── 18. RPC: registrar un ANTICIPO sin deuda ────────────────────────────────
-- Cobro ya verificado de back-office para un cliente y una unidad. p_pago_id
-- es la clave de idempotencia (la genera la pantalla): los mismos datos
-- devuelven el mismo anticipo; datos distintos se rechazan.
CREATE FUNCTION public.conta_registrar_anticipo(
  p_project_id uuid,
  p_unidad_id  uuid,
  p_cliente_id uuid,
  p_monto      numeric,
  p_metodo     text,
  p_fecha      date,
  p_referencia text DEFAULT NULL,
  p_notas      text DEFAULT NULL,
  p_pago_id    uuid DEFAULT NULL
)
RETURNS TABLE (
  pago_id        uuid,
  repetido       boolean,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  saldo_a_favor  numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_id       uuid := COALESCE(p_pago_id, gen_random_uuid());
  v_existe   public.pagos;
  v_an       public.conta_anticipos;
  v_repetido boolean := false;
  v_ts       timestamptz;
  v_difiere  text[];
  v_i        record;
BEGIN
  v_company := public.conta_sf_autorizar('anticipo');

  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  -- Misma clave a la vez: la segunda espera aquí y ve la primera confirmada.
  PERFORM pg_advisory_xact_lock(hashtext('conta_anticipo_clave'), hashtext(v_id::text));

  SELECT * INTO v_existe FROM public.pagos p WHERE p.id = v_id;
  IF v_existe.id IS NOT NULL THEN
    SELECT * INTO v_an FROM public.conta_anticipos an WHERE an.pago_id = v_id;
    IF v_an.pago_id IS NULL OR v_an.company_id <> v_company THEN
      RAISE EXCEPTION 'ANTICIPO_CLAVE_REUSADA: esa clave ya identifica otro cobro. No se registró nada: usa una clave nueva.'
        USING ERRCODE = '23505';
    END IF;
    v_difiere := array_remove(ARRAY[
      CASE WHEN v_an.project_id IS DISTINCT FROM p_project_id THEN 'proyecto' END,
      CASE WHEN v_an.unidad_id IS DISTINCT FROM p_unidad_id THEN 'unidad' END,
      CASE WHEN v_an.cliente_id IS DISTINCT FROM p_cliente_id THEN 'cliente' END,
      CASE WHEN v_existe.monto IS DISTINCT FROM p_monto THEN 'importe' END,
      CASE WHEN v_existe.metodo IS DISTINCT FROM p_metodo THEN 'método' END,
      CASE WHEN COALESCE(v_existe.verified_at, v_existe.created_at)::date IS DISTINCT FROM p_fecha THEN 'fecha' END,
      CASE WHEN NULLIF(btrim(COALESCE(v_existe.referencia, '')), '')
                IS DISTINCT FROM NULLIF(btrim(COALESCE(p_referencia, '')), '') THEN 'referencia' END,
      CASE WHEN NULLIF(btrim(COALESCE(v_existe.notas, '')), '')
                IS DISTINCT FROM NULLIF(btrim(COALESCE(p_notas, '')), '') THEN 'notas' END], NULL);
    IF cardinality(v_difiere) > 0 THEN
      RAISE EXCEPTION 'ANTICIPO_CLAVE_REUSADA: esa clave ya identifica un anticipo registrado con otros datos (difiere: %). No se registró otro ni se modificó el anterior.',
        array_to_string(v_difiere, ', ') USING ERRCODE = '23505';
    END IF;
    v_repetido := true;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.unidades u
                    WHERE u.id = p_unidad_id AND u.company_id = v_company AND u.project_id = p_project_id) THEN
      RAISE EXCEPTION 'ANTICIPO_UNIDAD: la unidad no pertenece a esta contabilidad.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.company_clientes cc
                    WHERE cc.company_id = v_company AND cc.cliente_id = p_cliente_id) THEN
      RAISE EXCEPTION 'ANTICIPO_CLIENTE: el cliente no pertenece a la empresa activa.' USING ERRCODE = '42501';
    END IF;
    -- El titular: un cliente vinculado (hoy o antes) a esa unidad. No se
    -- acredita a un tercero sin relación con la unidad.
    IF NOT EXISTS (SELECT 1 FROM public.unidad_residentes ur
                    WHERE ur.unidad_id = p_unidad_id AND ur.cliente_id = p_cliente_id)
       AND NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = p_unidad_id AND u.cliente_id = p_cliente_id) THEN
      RAISE EXCEPTION 'ANTICIPO_TITULAR: el cliente no está vinculado a esa unidad; el saldo a favor sería de un tercero.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 OR p_monto <> round(p_monto, 2) OR p_monto >= 100000000 THEN
      RAISE EXCEPTION 'ANTICIPO_IMPORTE: el importe debe ser positivo y con dos decimales como máximo.' USING ERRCODE = '22023';
    END IF;
    IF p_metodo IS NULL OR p_metodo NOT IN
       ('efectivo','transferencia','deposito','cheque','tarjeta_credito','tarjeta_debito','otro') THEN
      RAISE EXCEPTION 'ANTICIPO_METODO: método de pago inválido: %', p_metodo USING ERRCODE = '22023';
    END IF;
    IF p_fecha IS NULL OR p_fecha > CURRENT_DATE THEN
      RAISE EXCEPTION 'ANTICIPO_FECHA: la fecha del anticipo es obligatoria y no puede ser futura.' USING ERRCODE = '22023';
    END IF;

    v_ts := CASE WHEN p_fecha = CURRENT_DATE THEN now()
                 ELSE (p_fecha + (now() - date_trunc('day', now())))::timestamptz END;

    -- Primero el titular (el trigger de pagos lo lee al contabilizar), luego
    -- el cobro, con la marca de que viene de esta RPC.
    INSERT INTO public.conta_anticipos (pago_id, company_id, project_id, cliente_id, unidad_id, created_by)
    VALUES (v_id, v_company, p_project_id, p_cliente_id, p_unidad_id, auth.uid());
    PERFORM set_config('conta.anticipo_pago', v_id::text, true);
    INSERT INTO public.pagos (
      id, cliente_id, project_id, monto, metodo, referencia, notas,
      estado, verification_status, verified_at, verified_by, created_by, created_at, tipo_aplicacion)
    VALUES (
      v_id, p_cliente_id, p_project_id, p_monto, p_metodo,
      NULLIF(btrim(COALESCE(p_referencia, '')), ''), NULLIF(btrim(COALESCE(p_notas, '')), ''),
      'verificado', 'verificado', v_ts, auth.uid(), auth.uid(), v_ts, 'abono');
    PERFORM set_config('conta.anticipo_pago', '', true);
  END IF;

  SELECT i.resultado, i.codigo, i.motivo, i.asiento_id INTO v_i
    FROM public.conta_intentos_contabilizacion i
   WHERE i.origen_tabla = 'pagos' AND i.origen_id = v_id
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1;

  RETURN QUERY
  SELECT v_id, v_repetido,
         CASE WHEN v_repetido AND v_i.resultado = 'ya_contabilizada' THEN 'contabilizada' ELSE v_i.resultado END,
         v_i.codigo, v_i.motivo, a.id, a.numero::bigint,
         COALESCE((SELECT public.conta_sf_disponible(o.id) FROM public.conta_saldo_favor_origenes o
                    WHERE o.pago_id = v_id), 0)::numeric
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.id = COALESCE(v_i.asiento_id,
                         (SELECT x.id FROM public.conta_asientos x
                           WHERE x.company_id = v_company AND x.origen = 'automatico'
                             AND x.origen_tabla = 'pagos' AND x.origen_id = v_id
                             AND x.origen_evento = 'pago_contabilizado'
                           ORDER BY x.created_at DESC LIMIT 1));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_anticipo(uuid, uuid, uuid, numeric, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_registrar_anticipo(uuid, uuid, uuid, numeric, text, date, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_registrar_anticipo(uuid, uuid, uuid, numeric, text, date, text, text, uuid) IS
  'Registra en back-office un anticipo YA VERIFICADO sin documento para un cliente vinculado a una unidad del proyecto, y lo contabiliza contra la cuenta de anticipos como saldo a favor. Si falta configuración, el anticipo queda registrado y pendiente con su motivo. Idempotente por p_pago_id sobre el contenido completo (ANTICIPO_CLAVE_REUSADA si difiere).';

-- ── 19. RPC: anular un anticipo ─────────────────────────────────────────────
-- Lo rechaza con motivo y su asiento se reversa (el trigger). Si su saldo ya
-- se aplicó, el trigger lo impide (COBRO_SALDO_FAVOR_APLICADO). Idempotente.
CREATE FUNCTION public.conta_anular_anticipo(p_pago_id uuid, p_motivo text)
RETURNS TABLE (
  pago_id        uuid,
  resultado      text,
  asiento_id     uuid,
  reverso_id     uuid,
  reverso_numero bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_pago    public.pagos;
  v_res     text;
BEGIN
  v_company := public.conta_sf_autorizar('anticipo');
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación.' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_pago
    FROM public.pagos p
    JOIN public.conta_anticipos an ON an.pago_id = p.id
   WHERE p.id = p_pago_id AND an.company_id = v_company AND public.can_access_project(an.project_id)
     FOR UPDATE OF p;
  IF v_pago.id IS NULL THEN
    RAISE EXCEPTION 'El anticipo no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_company);

  IF v_pago.estado = 'rechazado' OR v_pago.deleted_at IS NOT NULL THEN
    v_res := 'ya_anulado';
  ELSE
    PERFORM set_config('conta.anticipo_pago', v_pago.id::text, true);
    UPDATE public.pagos p
       SET estado = 'rechazado', verification_status = 'rechazado',
           verification_notes = btrim(p_motivo), updated_at = now()
     WHERE p.id = v_pago.id;
    PERFORM set_config('conta.anticipo_pago', '', true);
    v_res := 'anulado';
  END IF;

  RETURN QUERY
  SELECT v_pago.id, v_res, a.id, r.id, r.numero::bigint
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id AND a.origen_evento = 'pago_contabilizado'
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_anular_anticipo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_anular_anticipo(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_anular_anticipo(uuid, text) IS
  'Anula (rechaza con motivo) un anticipo sin deuda: su asiento se reversa y su saldo deja de estar disponible. Se rechaza si su saldo ya se aplicó (primero se revierten las aplicaciones). Idempotente.';

-- ── 20. RPC: aplicar un saldo a favor a un documento ────────────────────────
CREATE FUNCTION public.conta_aplicar_saldo_favor(
  p_origen_id       uuid,
  p_documento_tabla text,
  p_documento_id    uuid,
  p_monto           numeric,
  p_notas           text DEFAULT NULL,
  p_aplicacion_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  aplicacion_id       uuid,
  repetido            boolean,
  asiento_id          uuid,
  asiento_numero      bigint,
  monto               numeric,
  monto_mora          numeric,
  monto_principal     numeric,
  disponible_restante numeric,
  saldo_documento     numeric,
  estado_documento    text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_id       uuid := COALESCE(p_aplicacion_id, gen_random_uuid());
  v_o        public.conta_saldo_favor_origenes;
  v_pago     public.pagos;
  v_existe   public.conta_saldo_favor_aplicaciones;
  v_cuota    public.cuotas_condominio;
  v_cargo    public.cargos_adicionales_unidad;
  v_q        record;
  v_s        record;
  v_coh      record;
  v_disp     numeric(14,2);
  v_saldo_m  numeric(14,2) := 0;
  v_saldo_p  numeric(14,2) := 0;
  v_a_mora   numeric(14,2) := 0;
  v_a_princ  numeric(14,2) := 0;
  v_aux      uuid;
  v_unidad   uuid;
  v_moneda   text;
  v_lineas   jsonb;
  v_asiento  uuid;
  v_estado   text;
  v_numero   bigint;
  v_notas    text := NULLIF(btrim(COALESCE(p_notas, '')), '');
BEGIN
  v_company := public.conta_sf_autorizar('aplicar');

  IF p_documento_tabla IS NULL OR p_documento_tabla NOT IN ('cuotas_condominio','cargos_adicionales_unidad') THEN
    RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO: el documento tiene que ser una cuota o un cargo adicional.' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 OR p_monto <> round(p_monto, 2) THEN
    RAISE EXCEPTION 'SALDO_FAVOR_IMPORTE: el importe debe ser positivo y con dos decimales como máximo.' USING ERRCODE = '22023';
  END IF;

  -- El origen (su empresa y proyecto acotan todo lo demás). Ajeno =
  -- inexistente.
  SELECT * INTO v_o FROM public.conta_saldo_favor_origenes o
   WHERE o.id = p_origen_id AND o.company_id = v_company AND public.can_access_project(o.project_id);
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_o.company_id);

  -- ORDEN ÚNICO DE BLOQUEOS: fila del documento → fila del cobro de origen →
  -- candado de cobros del documento → candado del origen.
  IF p_documento_tabla = 'cuotas_condominio' THEN
    SELECT * INTO v_cuota FROM public.cuotas_condominio c
     WHERE c.id = p_documento_id AND c.company_id = v_o.company_id AND c.project_id = v_o.project_id
       FOR UPDATE;
    IF v_cuota.id IS NULL THEN
      RAISE EXCEPTION 'La cuota no existe o no es de la contabilidad del saldo a favor.' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = p_documento_id AND ca.company_id = v_o.company_id AND ca.project_id = v_o.project_id
       FOR UPDATE;
    IF v_cargo.id IS NULL THEN
      RAISE EXCEPTION 'El cargo no existe o no es de la contabilidad del saldo a favor.' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = v_o.pago_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(
    hashtext(CASE WHEN p_documento_tabla = 'cuotas_condominio' THEN 'conta_cobro_cuota' ELSE 'conta_cobro_cargo' END),
    hashtext(p_documento_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('conta_saldo_favor'), hashtext(v_o.id::text));

  -- Idempotencia del CONTENIDO: releída con todo bloqueado.
  SELECT * INTO v_existe FROM public.conta_saldo_favor_aplicaciones x WHERE x.id = v_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.company_id <> v_company OR v_existe.origen_id IS DISTINCT FROM v_o.id
       OR COALESCE(v_existe.cuota_id, v_existe.cargo_adicional_id) IS DISTINCT FROM p_documento_id
       OR v_existe.monto IS DISTINCT FROM p_monto OR v_existe.notas IS DISTINCT FROM v_notas THEN
      RAISE EXCEPTION 'SALDO_FAVOR_CLAVE_REUSADA: esa clave ya identifica otra aplicación (con otro origen, documento, importe o notas). No se aplicó nada ni se modificó la anterior.'
        USING ERRCODE = '23505';
    END IF;
    SELECT a.numero INTO v_numero FROM public.conta_asientos a WHERE a.id = v_existe.asiento_id;
    RETURN QUERY SELECT v_existe.id, true, v_existe.asiento_id, v_numero, v_existe.monto,
      v_existe.monto_mora, v_existe.monto_principal, public.conta_sf_disponible(v_o.id), NULL::numeric,
      CASE WHEN v_existe.cargo_adicional_id IS NOT NULL
           THEN (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_existe.cargo_adicional_id)
           ELSE (SELECT COALESCE(c.cuota_estado, c.estado) FROM public.cuotas_condominio c WHERE c.id = v_existe.cuota_id) END;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagos p WHERE p.id = v_id) THEN
    RAISE EXCEPTION 'SALDO_FAVOR_CLAVE_REUSADA: esa clave ya identifica un cobro. Usa una clave nueva.' USING ERRCODE = '23505';
  END IF;

  -- El origen, vigente: su cobro sigue verificado y su asiento publicado y
  -- sin reverso. Un cobro sin verificar nunca generó saldo.
  IF v_pago.id IS NULL OR v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado')
     OR NOT public.conta_sf_asiento_vivo(v_o.asiento_id) THEN
    RAISE EXCEPTION 'SALDO_FAVOR_NO_DISPONIBLE: el cobro que generó este saldo está rechazado, anulado, sin publicar o reversado.'
      USING ERRCODE = 'check_violation';
  END IF;
  v_disp := public.conta_sf_disponible(v_o.id);
  IF p_monto > v_disp THEN
    RAISE EXCEPTION 'SALDO_FAVOR_INSUFICIENTE: el disponible de este saldo a favor es % %; no alcanza para %.',
      v_disp, v_o.moneda, p_monto USING ERRCODE = 'check_violation';
  END IF;

  -- El documento: por tipo, vivo, sin cobros esperando contabilizarse (su
  -- reparto depende del orden), con su devengo publicado y del MISMO titular
  -- y moneda.
  IF NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                  WHERE i.origen_tabla = p_documento_tabla AND i.origen_id = p_documento_id) THEN
    RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO_HISTORICO: el documento es anterior a la contabilización por tipo (no tiene devengo por auxiliar).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_cuota.id IS NOT NULL AND (v_cuota.deleted_at IS NOT NULL
                                  OR COALESCE(v_cuota.cuota_estado, '') = 'anulada'))
     OR (v_cargo.id IS NOT NULL AND v_cargo.estado = 'anulado') THEN
    RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO_ANULADO: el documento está anulado o eliminado.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE (CASE WHEN v_cuota.id IS NOT NULL
                 THEN (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
                 ELSE p2.cargo_adicional_id = v_cargo.id END)
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = v_company AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'))
  THEN
    RAISE EXCEPTION 'SALDO_FAVOR_COBROS_PENDIENTES: el documento tiene cobros pendientes de contabilizar; su saldo todavía no se conoce. Resuélvelos o anúlalos y vuelve a aplicar.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_cuota.id IS NOT NULL THEN
    SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_cuota.id);
    IF v_q.princ_asiento_id IS NULL OR v_q.princ_estado <> 'publicado'
       OR (COALESCE(v_cuota.mora_monto, 0) > 0 AND (v_q.mora_asiento_id IS NULL OR v_q.mora_estado <> 'publicado')) THEN
      RAISE EXCEPTION 'SALDO_FAVOR_DEVENGO_PENDIENTE: la cuota (o su mora) todavía no tiene su devengo publicado.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Documento y devengo concuerdan (no se aplica contra un importe viejo).
    IF v_q.princ_monto IS DISTINCT FROM v_cuota.monto::numeric(14,2)
       OR (COALESCE(v_cuota.mora_monto, 0) > 0 AND v_q.mora_monto IS DISTINCT FROM v_cuota.mora_monto::numeric(14,2))
       OR (v_q.mora_asiento_id IS NOT NULL AND v_q.mora_moneda IS DISTINCT FROM v_q.princ_moneda) THEN
      RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO_DESALINEADO: el importe de la cuota (o de su mora) no concuerda con su devengo; corrígelo antes de aplicar.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_aux := v_q.princ_auxiliar; v_unidad := v_q.princ_unidad; v_moneda := v_q.princ_moneda;
    IF v_q.mora_asiento_id IS NOT NULL
       AND (v_q.mora_auxiliar IS DISTINCT FROM v_aux OR v_q.mora_unidad IS DISTINCT FROM v_unidad) THEN
      RAISE EXCEPTION 'SALDO_FAVOR_TITULAR_DISTINTO: la mora y el principal de la cuota tienen titulares distintos.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_saldo_m := CASE WHEN v_q.mora_asiento_id IS NOT NULL THEN GREATEST(v_q.mora_monto - v_q.aplicado_mora, 0) ELSE 0 END;
    v_saldo_p := GREATEST(v_q.princ_monto - v_q.aplicado_princ, 0);
  ELSE
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id);
    IF v_s.devengo_asiento_id IS NULL OR v_s.devengo_estado <> 'publicado' THEN
      RAISE EXCEPTION 'SALDO_FAVOR_DEVENGO_PENDIENTE: el cargo todavía no tiene su devengo publicado.'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_cargo.id) k;
    IF v_coh.codigo IS NOT NULL THEN
      RAISE EXCEPTION 'SALDO_FAVOR_DOCUMENTO_DESALINEADO: %', v_coh.motivo USING ERRCODE = 'check_violation';
    END IF;
    v_aux := v_s.auxiliar_cliente_id; v_unidad := v_s.unidad_id;
    SELECT COALESCE(l.moneda_origen, a.moneda_base) INTO v_moneda
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.id = v_s.devengo_asiento_id ORDER BY l.orden LIMIT 1;
    v_saldo_p := GREATEST(v_s.devengo_monto - v_s.aplicado, 0);
  END IF;

  -- EL MISMO TITULAR Y LA MISMA MONEDA: nunca se traslada un saldo a otro
  -- cliente, unidad o moneda de forma implícita.
  IF v_aux IS DISTINCT FROM v_o.cliente_id OR v_unidad IS DISTINCT FROM v_o.unidad_id THEN
    RAISE EXCEPTION 'SALDO_FAVOR_TITULAR_DISTINTO: el documento es de otro cliente o de otra unidad que el saldo a favor; no se traslada.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_moneda IS DISTINCT FROM v_o.moneda THEN
    RAISE EXCEPTION 'SALDO_FAVOR_MONEDA_DISTINTA: el documento está en % y el saldo a favor en %; no se aplica entre monedas.',
      COALESCE(v_moneda, '?'), v_o.moneda USING ERRCODE = 'check_violation';
  END IF;

  IF p_monto > v_saldo_m + v_saldo_p THEN
    RAISE EXCEPTION 'SALDO_FAVOR_EXCEDE_DOCUMENTO: el documento debe % %; no se aplica más que su saldo.',
      (v_saldo_m + v_saldo_p), v_o.moneda USING ERRCODE = 'check_violation';
  END IF;
  -- Dentro de una cuota, la regla que ya rige sus cobros: mora primero.
  v_a_mora  := LEAST(p_monto, v_saldo_m);
  v_a_princ := p_monto - v_a_mora;

  -- El asiento: cargo a anticipos (la cuenta y el titular del ORIGEN), abono
  -- a la CxC y dimensiones de cada devengo. Fecha: hoy (el día en que se
  -- decide la aplicación).
  v_lineas := jsonb_build_array(jsonb_build_object(
    'cuenta_id', v_o.cuenta_id, 'debe', p_monto, 'descripcion', 'Aplicación de saldo a favor',
    'auxiliar_cliente_id', v_o.cliente_id, 'unidad_id', v_o.unidad_id));
  IF v_a_mora > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_q.mora_cuenta_id, 'haber', v_a_mora, 'descripcion', 'Aplicación a mora',
      'auxiliar_cliente_id', v_q.mora_auxiliar, 'unidad_id', v_q.mora_unidad, 'tipo_cargo', v_q.mora_tipo_cargo));
  END IF;
  IF v_a_princ > 0 THEN
    IF v_cuota.id IS NOT NULL THEN
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta_id', v_q.princ_cuenta_id, 'haber', v_a_princ, 'descripcion', 'Aplicación a principal',
        'auxiliar_cliente_id', v_q.princ_auxiliar, 'unidad_id', v_q.princ_unidad, 'tipo_cargo', v_q.princ_tipo_cargo));
    ELSE
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta_id', v_s.cuenta_id, 'haber', v_a_princ, 'descripcion', 'Aplicación a cargo adicional',
        'auxiliar_cliente_id', v_s.auxiliar_cliente_id, 'unidad_id', v_s.unidad_id, 'tipo_cargo', v_s.tipo_cargo));
    END IF;
  END IF;

  v_asiento := public.conta_generar_asiento(
    v_o.company_id, v_o.project_id, 'conta_saldo_favor_aplicaciones', v_id, 'saldo_favor_aplicado',
    CURRENT_DATE,
    'Aplicación de saldo a favor · '
      || CASE WHEN v_cuota.id IS NOT NULL THEN 'cuota ' || v_cuota.concepto || ' ' || v_cuota.periodo
              ELSE 'cargo ' || v_cargo.concepto END,
    'diario', v_o.moneda, v_lineas);
  IF v_asiento IS NULL THEN
    RAISE EXCEPTION 'SALDO_FAVOR_SIN_ASIENTO: no se pudo generar el asiento de la aplicación (revisa que las cuentas sigan activas y en esta contabilidad). No se aplicó nada.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.estado, a.numero INTO v_estado, v_numero FROM public.conta_asientos a WHERE a.id = v_asiento;
  IF v_estado <> 'publicado' THEN
    RAISE EXCEPTION 'SALDO_FAVOR_SIN_TIPO_CAMBIO: falta el tipo de cambio % → moneda base para hoy; el asiento no se puede publicar. No se aplicó nada.',
      v_o.moneda USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.conta_saldo_favor_aplicaciones
    (id, company_id, project_id, origen_id, pago_id, cliente_id, unidad_id, moneda,
     cuota_id, cargo_adicional_id, monto, monto_mora, monto_principal, cuenta_anticipo_id, asiento_id,
     notas, created_by)
  VALUES
    (v_id, v_o.company_id, v_o.project_id, v_o.id, v_o.pago_id, v_o.cliente_id, v_o.unidad_id, v_o.moneda,
     v_cuota.id, v_cargo.id, p_monto, v_a_mora, v_a_princ, v_o.cuenta_id, v_asiento,
     v_notas, auth.uid());

  IF v_cargo.id IS NOT NULL THEN
    PERFORM public.conta_cargo_sincronizar_estado(v_cargo.id);
  END IF;

  RETURN QUERY SELECT v_id, false, v_asiento, v_numero, p_monto::numeric(14,2), v_a_mora, v_a_princ,
    public.conta_sf_disponible(v_o.id),
    (v_saldo_m + v_saldo_p - p_monto)::numeric(14,2),
    CASE WHEN v_cargo.id IS NOT NULL
         THEN (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_cargo.id)
         ELSE COALESCE(v_cuota.cuota_estado, v_cuota.estado) END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_aplicar_saldo_favor(uuid, text, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_aplicar_saldo_favor(uuid, text, uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_aplicar_saldo_favor(uuid, text, uuid, numeric, text, uuid) IS
  'Aplica, por decisión explícita de un usuario autorizado, un saldo a favor (origen) total o parcialmente a una cuota o un cargo adicional por tipo del MISMO titular (cliente y unidad), contabilidad y moneda. Una transacción: bloquea documento → cobro de origen → candados, relee disponible y saldo, genera y publica el asiento (anticipos contra la CxC del devengo) o no aplica nada. Idempotente por p_aplicacion_id (SALDO_FAVOR_CLAVE_REUSADA si difiere el contenido).';

-- ── 21. RPC: revertir una aplicación ────────────────────────────────────────
CREATE FUNCTION public.conta_revertir_aplicacion_saldo_favor(p_aplicacion_id uuid, p_motivo text)
RETURNS TABLE (
  aplicacion_id       uuid,
  resultado           text,
  reverso_id          uuid,
  reverso_numero      bigint,
  disponible_restante numeric,
  estado_documento    text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_x       public.conta_saldo_favor_aplicaciones;
  v_rev     uuid;
  v_res     text;
BEGIN
  v_company := public.conta_sf_autorizar('aplicar');
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la reversión.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x
   WHERE x.id = p_aplicacion_id AND x.company_id = v_company AND public.can_access_project(x.project_id);
  IF v_x.id IS NULL THEN
    RAISE EXCEPTION 'La aplicación no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_x.company_id);

  -- Mismo orden que la aplicación: documento → cobro de origen → candados.
  IF v_x.cuota_id IS NOT NULL THEN
    PERFORM 1 FROM public.cuotas_condominio c WHERE c.id = v_x.cuota_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_x.cargo_adicional_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.pagos p WHERE p.id = v_x.pago_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(
    hashtext(CASE WHEN v_x.cuota_id IS NOT NULL THEN 'conta_cobro_cuota' ELSE 'conta_cobro_cargo' END),
    hashtext(COALESCE(v_x.cuota_id, v_x.cargo_adicional_id)::text));
  PERFORM pg_advisory_xact_lock(hashtext('conta_saldo_favor'), hashtext(v_x.origen_id::text));

  -- Releída bajo los bloqueos: la reversión se decide una vez.
  SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x WHERE x.id = p_aplicacion_id;
  IF v_x.revertida_at IS NOT NULL THEN
    v_res := 'ya_revertida';
    v_rev := v_x.asiento_reverso_id;
  ELSE
    -- Si su asiento ya se reversó desde Pólizas, ese reverso es el suyo: se
    -- sella la evidencia sin reversar dos veces.
    SELECT a.anulado_por_id INTO v_rev FROM public.conta_asientos a WHERE a.id = v_x.asiento_id;
    IF v_rev IS NULL THEN
      v_rev := public.conta_reversar_automatico(v_x.company_id, 'conta_saldo_favor_aplicaciones', v_x.id,
        'saldo_favor_aplicado', 'Reverso de aplicación de saldo a favor');
    END IF;
    IF v_rev IS NULL THEN
      RAISE EXCEPTION 'SALDO_FAVOR_SIN_REVERSO: no se pudo reversar el asiento de la aplicación. No se revirtió nada.'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.conta_saldo_favor_aplicaciones x
       SET revertida_at = now(), revertida_por = auth.uid(), motivo_reverso = btrim(p_motivo),
           asiento_reverso_id = v_rev
     WHERE x.id = v_x.id;
    v_res := 'revertida';
  END IF;

  IF v_x.cargo_adicional_id IS NOT NULL THEN
    PERFORM public.conta_cargo_sincronizar_estado(v_x.cargo_adicional_id);
  END IF;

  RETURN QUERY SELECT v_x.id, v_res, v_rev, (SELECT a.numero::bigint FROM public.conta_asientos a WHERE a.id = v_rev),
    public.conta_sf_disponible(v_x.origen_id),
    CASE WHEN v_x.cargo_adicional_id IS NOT NULL
         THEN (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_x.cargo_adicional_id)
         ELSE (SELECT COALESCE(c.cuota_estado, c.estado) FROM public.cuotas_condominio c WHERE c.id = v_x.cuota_id) END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_revertir_aplicacion_saldo_favor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_revertir_aplicacion_saldo_favor(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_revertir_aplicacion_saldo_favor(uuid, text) IS
  'Revierte una aplicación de saldo a favor: reversa su asiento (misma fecha o hoy si el período está cerrado) y sella hora del servidor, usuario y motivo. El documento vuelve a deber y el saldo vuelve a estar disponible. Idempotente.';

-- ── 22. Lecturas: saldos a favor de una contabilidad (o de un sujeto) ──────
-- Orígenes con su disponible, aplicaciones con su reverso y anticipos
-- pendientes de contabilizar. Filtro opcional por cliente y/o unidad.
CREATE FUNCTION public.conta_saldos_favor(
  p_project_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_unidad_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.conta_sf_autorizar('leer');
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'origenes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'origen_id', o.id, 'pago_id', o.pago_id, 'tipo', o.tipo,
               'fecha', a.fecha, 'asiento_id', a.id, 'asiento_numero', a.numero,
               'estado', CASE WHEN a.anulado_por_id IS NOT NULL THEN 'reversado'
                              WHEN a.estado = 'publicado' THEN 'vigente' ELSE a.estado END,
               'metodo', p.metodo, 'referencia', p.referencia, 'cobro_monto', p.monto,
               'cobro_estado', p.estado, 'cliente_id', o.cliente_id, 'cliente_nombre', cl.nombre,
               'unidad_id', o.unidad_id, 'unidad_nombre', u.nombre, 'moneda', o.moneda,
               'monto', o.monto,
               'aplicado', COALESCE((SELECT sum(x.monto) FROM public.conta_saldo_favor_aplicaciones x
                                      WHERE x.origen_id = o.id AND public.conta_sf_asiento_vivo(x.asiento_id)), 0),
               'disponible', public.conta_sf_disponible(o.id),
               'documento_tabla', o.documento_tabla, 'documento_id', o.documento_id,
               'documento', CASE WHEN o.documento_tabla = 'cuotas_condominio'
                                 THEN (SELECT 'Cuota ' || c.concepto || ' ' || c.periodo FROM public.cuotas_condominio c WHERE c.id = o.documento_id)
                                 WHEN o.documento_tabla = 'cargos_adicionales_unidad'
                                 THEN (SELECT 'Cargo ' || ca.concepto FROM public.cargos_adicionales_unidad ca WHERE ca.id = o.documento_id)
                            END)
               ORDER BY a.fecha, a.numero, o.id)
        FROM public.conta_saldo_favor_origenes o
        JOIN public.conta_asientos a ON a.id = o.asiento_id
        LEFT JOIN public.pagos p ON p.id = o.pago_id
        LEFT JOIN public.clientes cl ON cl.id = o.cliente_id
        LEFT JOIN public.unidades u ON u.id = o.unidad_id
       WHERE o.company_id = v_company AND o.project_id = p_project_id
         AND (p_cliente_id IS NULL OR o.cliente_id = p_cliente_id)
         AND (p_unidad_id IS NULL OR o.unidad_id = p_unidad_id)), '[]'::jsonb),
    'aplicaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'aplicacion_id', x.id, 'origen_id', x.origen_id, 'pago_id', x.pago_id,
               'documento_tabla', CASE WHEN x.cuota_id IS NOT NULL THEN 'cuotas_condominio' ELSE 'cargos_adicionales_unidad' END,
               'documento_id', COALESCE(x.cuota_id, x.cargo_adicional_id),
               'documento', COALESCE((SELECT 'Cuota ' || c.concepto || ' ' || c.periodo FROM public.cuotas_condominio c WHERE c.id = x.cuota_id),
                                     (SELECT 'Cargo ' || ca.concepto FROM public.cargos_adicionales_unidad ca WHERE ca.id = x.cargo_adicional_id)),
               'cliente_id', x.cliente_id, 'unidad_id', x.unidad_id, 'moneda', x.moneda,
               'monto', x.monto, 'monto_mora', x.monto_mora, 'monto_principal', x.monto_principal,
               'fecha', a.fecha, 'asiento_id', a.id, 'asiento_numero', a.numero, 'notas', x.notas,
               'creada_at', x.created_at, 'creada_por', x.created_by,
               'vigente', public.conta_sf_asiento_vivo(x.asiento_id),
               'revertida_at', x.revertida_at, 'revertida_por', x.revertida_por,
               'motivo_reverso', x.motivo_reverso,
               'reverso_id', COALESCE(x.asiento_reverso_id, a.anulado_por_id),
               'reverso_numero', r.numero, 'reverso_fecha', r.fecha)
               ORDER BY x.created_at, x.id)
        FROM public.conta_saldo_favor_aplicaciones x
        JOIN public.conta_asientos a ON a.id = x.asiento_id
        LEFT JOIN public.conta_asientos r ON r.id = COALESCE(x.asiento_reverso_id, a.anulado_por_id)
       WHERE x.company_id = v_company AND x.project_id = p_project_id
         AND (p_cliente_id IS NULL OR x.cliente_id = p_cliente_id)
         AND (p_unidad_id IS NULL OR x.unidad_id = p_unidad_id)), '[]'::jsonb),
    -- Anticipos registrados cuyo saldo todavía NO existe: sin asiento vivo.
    'anticipos_pendientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pago_id', p.id, 'fecha', COALESCE(p.verified_at, p.created_at)::date, 'monto', p.monto,
               'metodo', p.metodo, 'referencia', p.referencia, 'estado', p.estado,
               'cliente_id', an.cliente_id, 'cliente_nombre', cl.nombre,
               'unidad_id', an.unidad_id, 'unidad_nombre', u.nombre,
               'codigo', ui.codigo, 'motivo', ui.motivo)
               ORDER BY p.created_at, p.id)
        FROM public.conta_anticipos an
        JOIN public.pagos p ON p.id = an.pago_id
        LEFT JOIN public.clientes cl ON cl.id = an.cliente_id
        LEFT JOIN public.unidades u ON u.id = an.unidad_id
        LEFT JOIN LATERAL (
          SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
           WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id
           ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
       WHERE an.company_id = v_company AND an.project_id = p_project_id
         AND (p_cliente_id IS NULL OR an.cliente_id = p_cliente_id)
         AND (p_unidad_id IS NULL OR an.unidad_id = p_unidad_id)
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p.id)), '[]'::jsonb),
    'disponible_por_moneda', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('moneda', q.moneda, 'disponible', q.disp) ORDER BY q.moneda)
        FROM (SELECT o.moneda, sum(public.conta_sf_disponible(o.id))::numeric(14,2) AS disp
                FROM public.conta_saldo_favor_origenes o
               WHERE o.company_id = v_company AND o.project_id = p_project_id
                 AND (p_cliente_id IS NULL OR o.cliente_id = p_cliente_id)
                 AND (p_unidad_id IS NULL OR o.unidad_id = p_unidad_id)
               GROUP BY o.moneda) q), '[]'::jsonb),
    'cuenta_anticipos', (SELECT jsonb_build_object('cuenta_id', k.cuenta_id, 'codigo', k.codigo, 'motivo', k.motivo)
                           FROM public.conta_cuenta_anticipos(v_company, p_project_id) k),
    'puede_aplicar', (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status'))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_saldos_favor(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_saldos_favor(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_saldos_favor(uuid, uuid, uuid) IS
  'Saldos a favor de una contabilidad (opcionalmente de un cliente y/o una unidad): orígenes (excedentes y anticipos) con su disponible, aplicaciones con su reverso, anticipos registrados todavía sin contabilizar, disponible por moneda y el estado de la cuenta de anticipos.';

-- Documentos a los que se puede aplicar un origen: los del MISMO titular,
-- contabilidad y moneda, por tipo, con devengo publicado y saldo > 0.
CREATE FUNCTION public.conta_saldo_favor_documentos(p_origen_id uuid)
RETURNS TABLE (
  documento_tabla text,
  documento_id    uuid,
  concepto        text,
  fecha           date,
  moneda          text,
  saldo_mora      numeric,
  saldo_principal numeric,
  saldo           numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_o       public.conta_saldo_favor_origenes;
BEGIN
  v_company := public.conta_sf_autorizar('leer');
  SELECT * INTO v_o FROM public.conta_saldo_favor_origenes o
   WHERE o.id = p_origen_id AND o.company_id = v_company AND public.can_access_project(o.project_id);
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_o.company_id);

  RETURN QUERY
  SELECT d.t, d.id, d.concepto, d.fecha, d.moneda, d.sm, d.sp, (d.sm + d.sp)::numeric
    FROM (
      SELECT 'cuotas_condominio'::text AS t, c.id, c.concepto || ' ' || c.periodo AS concepto,
             c.created_at::date AS fecha, q.princ_moneda AS moneda,
             CASE WHEN q.mora_asiento_id IS NOT NULL AND q.mora_estado = 'publicado'
                  THEN GREATEST(q.mora_monto - q.aplicado_mora, 0) ELSE 0 END::numeric(14,2) AS sm,
             GREATEST(q.princ_monto - q.aplicado_princ, 0)::numeric(14,2) AS sp,
             q.princ_auxiliar AS aux, q.princ_unidad AS uni, q.princ_estado AS est
        FROM public.cuotas_condominio c
        CROSS JOIN LATERAL public.conta_cuota_saldo_cobro(c.id) q
       WHERE c.company_id = v_o.company_id AND c.project_id = v_o.project_id
         AND c.unidad_id = v_o.unidad_id AND c.deleted_at IS NULL
         AND COALESCE(c.cuota_estado, '') <> 'anulada'
         AND q.princ_asiento_id IS NOT NULL
      UNION ALL
      SELECT 'cargos_adicionales_unidad', ca.id, ca.concepto, ca.fecha_cargo,
             (SELECT COALESCE(l.moneda_origen, a.moneda_base) FROM public.conta_asientos a
                JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
               WHERE a.id = s.devengo_asiento_id ORDER BY l.orden LIMIT 1),
             0::numeric(14,2), GREATEST(s.devengo_monto - s.aplicado, 0)::numeric(14,2),
             s.auxiliar_cliente_id, s.unidad_id, s.devengo_estado
        FROM public.cargos_adicionales_unidad ca
        CROSS JOIN LATERAL public.conta_cargo_saldo_cobro(ca.id) s
       WHERE ca.company_id = v_o.company_id AND ca.project_id = v_o.project_id
         AND ca.unidad_id = v_o.unidad_id AND ca.estado IS DISTINCT FROM 'anulado'
         AND s.devengo_asiento_id IS NOT NULL
    ) d
   WHERE d.aux = v_o.cliente_id AND d.uni = v_o.unidad_id AND d.moneda = v_o.moneda
     AND d.est = 'publicado' AND d.sm + d.sp > 0
   ORDER BY d.fecha, d.concepto, d.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_saldo_favor_documentos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_saldo_favor_documentos(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_saldo_favor_documentos(uuid) IS
  'Cuotas y cargos adicionales por tipo del mismo titular (cliente y unidad), contabilidad y moneda que un saldo a favor, con devengo publicado y saldo pendiente (mora y principal). Es la lista de candidatos: la validación definitiva la hace conta_aplicar_saldo_favor bajo bloqueo.';

-- ── 23. Cobros de un cargo: con el remanente que quedó a favor ────────────
-- Cambia el tipo de retorno (columna nueva): DROP y CREATE. Cuerpo idéntico a
-- 20261004000000 salvo `saldo_a_favor`: lo que de ese cobro quedó como saldo
-- a favor (recibido = aplicado + saldo_a_favor).
DROP FUNCTION public.conta_cargo_cobros(uuid);

CREATE FUNCTION public.conta_cargo_cobros(p_cargo_id uuid)
RETURNS TABLE (
  pago_id         uuid,
  fecha           date,
  monto           numeric,
  metodo          text,
  referencia      text,
  estado          text,
  anulacion_motivo text,
  aplicado        numeric,
  asiento_id      uuid,
  asiento_numero  bigint,
  asiento_estado  text,
  reverso_id      uuid,
  reverso_numero  bigint,
  reverso_fecha   date,
  codigo          text,
  motivo          text,
  saldo_a_favor   numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_cargo   public.cargos_adicionales_unidad;
BEGIN
  v_company := public.conta_cobro_cargo_autorizar(false);
  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
   WHERE ca.id = p_cargo_id AND ca.company_id = v_company
     AND public.can_access_project(ca.project_id);
  IF v_cargo.id IS NULL THEN
    RAISE EXCEPTION 'El cargo no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_cargo.company_id);

  RETURN QUERY
  SELECT p.id, COALESCE(p.verified_at, p.created_at)::date, p.monto, p.metodo, p.referencia, p.estado,
         CASE WHEN p.estado = 'rechazado' THEN p.verification_notes END,
         COALESCE(ap.monto, 0)::numeric(14,2),
         a.id, a.numero::bigint, a.estado::text, r.id, r.numero::bigint, r.fecha,
         CASE WHEN a.id IS NULL AND p.estado IN ('verificado','aplicado') AND p.deleted_at IS NULL THEN ui.codigo END,
         CASE WHEN a.id IS NULL AND p.estado IN ('verificado','aplicado') AND p.deleted_at IS NULL THEN ui.motivo END,
         COALESCE((SELECT o.monto FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p.id), 0)::numeric(14,2)
    FROM public.pagos p
    LEFT JOIN LATERAL (
      SELECT x.id, x.numero, x.estado, x.anulado_por_id FROM public.conta_asientos x
       WHERE x.company_id = v_company AND x.origen = 'automatico'
         AND x.origen_tabla = 'pagos' AND x.origen_id = p.id AND x.origen_evento = 'pago_contabilizado'
       ORDER BY x.created_at DESC LIMIT 1) a ON true
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id
    LEFT JOIN public.conta_cobro_aplicaciones ap ON ap.pago_id = p.id AND ap.cargo_adicional_id = p.cargo_adicional_id
    LEFT JOIN LATERAL (
      SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
       WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id
       ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
   WHERE p.cargo_adicional_id = v_cargo.id
   ORDER BY COALESCE(p.verified_at, p.created_at), p.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_cobros(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargo_cobros(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cargo_cobros(uuid) IS
  'Cobros de un cargo adicional con su aplicación, el remanente que quedó como saldo a favor, asiento, reverso y, si está pendiente, el motivo.';

-- ── 24. Estado de cuenta: el saldo a favor del sujeto ─────────────────────
-- Del libro, no de las tablas auxiliares: las líneas PUBLICADAS de la cuenta
-- de anticipos (las que usaron los orígenes y la mapeada hoy) con la
-- dimensión del sujeto, hasta el corte. Reversos incluidos: un reverso
-- posterior al corte no existía a esa fecha. Se concilia contra los orígenes
-- y aplicaciones VIVOS al corte. INTERNA (la llama conta_estado_cuenta, que ya
-- autorizó).
CREATE FUNCTION public.conta_ec_saldo_favor(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_desde   date,
  p_hasta   date
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH ctas AS (
    SELECT o.cuenta_id FROM public.conta_saldo_favor_origenes o
     WHERE o.company_id = p_company AND o.project_id IS NOT DISTINCT FROM p_project
    UNION
    SELECT k.cuenta_id FROM public.conta_cuenta_anticipos(p_company, p_project) k WHERE k.cuenta_id IS NOT NULL
  ),
  base AS (
    SELECT l.id AS linea_id, l.orden, a.id AS asiento_id, a.numero, a.created_at AS creado, a.fecha,
           a.origen, a.origen_tabla, a.origen_id, a.reversa_de_id, l.debe, l.haber
      FROM public.conta_asiento_lineas l
      JOIN public.conta_asientos a ON a.id = l.asiento_id
     WHERE l.company_id = p_company AND a.company_id = p_company
       AND a.project_id IS NOT DISTINCT FROM p_project
       AND a.estado = 'publicado'
       AND l.cuenta_id IN (SELECT c.cuenta_id FROM ctas c)
       AND (p_cliente IS NULL OR l.auxiliar_cliente_id = p_cliente)
       AND (p_unidad  IS NULL OR l.unidad_id = p_unidad)
       AND (p_hasta IS NULL OR a.fecha <= p_hasta)
  ),
  ini AS (
    SELECT COALESCE(sum(b.haber - b.debe), 0)::numeric(14,2) AS s
      FROM base b WHERE p_desde IS NOT NULL AND b.fecha < p_desde
  ),
  per AS (
    SELECT b.*,
           (SELECT s FROM ini) + sum(b.haber - b.debe) OVER w AS saldo,
           row_number() OVER w AS n
      FROM base b
     WHERE p_desde IS NULL OR b.fecha >= p_desde
    WINDOW w AS (ORDER BY b.fecha, b.numero NULLS LAST, b.creado, b.asiento_id, b.orden, b.linea_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ),
  -- Vivo al corte: publicado, con fecha hasta el corte y sin un reverso
  -- publicado hasta el corte.
  vivo AS (
    SELECT a.id
      FROM public.conta_asientos a
     WHERE a.company_id = p_company AND a.estado = 'publicado'
       AND (p_hasta IS NULL OR a.fecha <= p_hasta)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                        WHERE r.id = a.anulado_por_id AND r.estado = 'publicado'
                          AND (p_hasta IS NULL OR r.fecha <= p_hasta))
  ),
  docs AS (
    SELECT (COALESCE((SELECT sum(o.monto) FROM public.conta_saldo_favor_origenes o
                       WHERE o.company_id = p_company AND o.project_id IS NOT DISTINCT FROM p_project
                         AND (p_cliente IS NULL OR o.cliente_id = p_cliente)
                         AND (p_unidad  IS NULL OR o.unidad_id = p_unidad)
                         AND o.asiento_id IN (SELECT v.id FROM vivo v)), 0)
          - COALESCE((SELECT sum(x.monto) FROM public.conta_saldo_favor_aplicaciones x
                       WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
                         AND (p_cliente IS NULL OR x.cliente_id = p_cliente)
                         AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
                         AND x.asiento_id IN (SELECT v.id FROM vivo v)), 0))::numeric(14,2) AS s
  ),
  tot AS (
    SELECT COALESCE(sum(p.haber), 0)::numeric(14,2) AS abonos,
           COALESCE(sum(p.debe), 0)::numeric(14,2)  AS aplicaciones,
           count(*) AS n
      FROM per p
  )
  SELECT jsonb_build_object(
    'saldo_inicial', (SELECT s FROM ini),
    'abonos', tot.abonos,
    'aplicaciones', tot.aplicaciones,
    'saldo_final', ((SELECT s FROM ini) + tot.abonos - tot.aplicaciones)::numeric(14,2),
    'saldo_documentos', (SELECT s FROM docs),
    'cuadra', ((SELECT s FROM ini) + tot.abonos - tot.aplicaciones)::numeric(14,2) = (SELECT s FROM docs),
    'total_movimientos', tot.n,
    'movimientos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'n', p.n, 'fecha', p.fecha, 'asiento_id', p.asiento_id, 'asiento_numero', p.numero,
               'tipo', CASE
                 WHEN p.origen = 'automatico' AND p.origen_tabla = 'pagos'
                   THEN CASE WHEN p.reversa_de_id IS NULL THEN COALESCE(o.tipo, 'abono') ELSE 'reverso_abono' END
                 WHEN p.origen = 'automatico' AND p.origen_tabla = 'conta_saldo_favor_aplicaciones'
                   THEN CASE WHEN p.reversa_de_id IS NULL THEN 'aplicacion' ELSE 'reverso_aplicacion' END
                 ELSE 'otro' END,
               'pago_id', CASE WHEN p.origen_tabla = 'pagos' THEN p.origen_id ELSE x.pago_id END,
               'aplicacion_id', x.id,
               'documento', COALESCE(
                 (SELECT 'Cuota ' || c.concepto || ' ' || c.periodo FROM public.cuotas_condominio c
                   WHERE c.id = COALESCE(x.cuota_id, CASE WHEN o.documento_tabla = 'cuotas_condominio' THEN o.documento_id END)),
                 (SELECT 'Cargo ' || ca.concepto FROM public.cargos_adicionales_unidad ca
                   WHERE ca.id = COALESCE(x.cargo_adicional_id, CASE WHEN o.documento_tabla = 'cargos_adicionales_unidad' THEN o.documento_id END))),
               'abono', p.haber, 'aplicado', p.debe, 'saldo', p.saldo::numeric(14,2))
               ORDER BY p.n)
        FROM (SELECT * FROM per ORDER BY n LIMIT 200) p
        LEFT JOIN public.conta_saldo_favor_origenes o
          ON p.origen_tabla = 'pagos' AND o.pago_id = p.origen_id
        LEFT JOIN public.conta_saldo_favor_aplicaciones x
          ON p.origen_tabla = 'conta_saldo_favor_aplicaciones' AND x.id = p.origen_id), '[]'::jsonb))
    FROM tot
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ec_saldo_favor(uuid, uuid, uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;

-- conta_estado_cuenta: cuerpo idéntico a 20261004000000 salvo: la línea de
-- CxC de una aplicación de saldo a favor se presenta como tal (documento y
-- componente), y la clave nueva `saldo_a_favor`.
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta(
  p_project_id uuid,
  p_cliente_id uuid    DEFAULT NULL,
  p_unidad_id  uuid    DEFAULT NULL,
  p_desde      date    DEFAULT NULL,
  p_hasta      date    DEFAULT NULL,
  p_limite     integer DEFAULT 100,
  p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sujeto  jsonb;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_desde > p_hasta THEN
    RAISE EXCEPTION 'La fecha inicial es posterior a la final.' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'El tamaño de página debe estar entre 1 y 500.' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'El desplazamiento no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT jsonb_build_object('tipo', 'cliente', 'id', cl.id, 'nombre', cl.nombre,
                              'codigo_auxiliar', ax.codigo)
      INTO v_sujeto
      FROM public.clientes cl
      LEFT JOIN public.conta_auxiliares ax ON ax.company_id = v_company AND ax.cliente_id = cl.id
     WHERE cl.id = p_cliente_id;
  ELSE
    SELECT jsonb_build_object('tipo', 'unidad', 'id', u.id, 'nombre', u.nombre)
      INTO v_sujeto
      FROM public.unidades u WHERE u.id = p_unidad_id;
  END IF;

  WITH base AS (
    SELECT * FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) b
     WHERE p_hasta IS NULL OR b.fecha <= p_hasta
  ),
  ini AS (
    SELECT COALESCE(sum(b.debe - b.haber), 0)::numeric(14,2) AS saldo
      FROM base b WHERE p_desde IS NOT NULL AND b.fecha < p_desde
  ),
  per AS (
    SELECT b.*,
           (SELECT saldo FROM ini)
             + sum(b.debe - b.haber) OVER w AS saldo,
           row_number() OVER w AS n
      FROM base b
     WHERE p_desde IS NULL OR b.fecha >= p_desde
    WINDOW w AS (ORDER BY b.fecha, b.asiento_numero NULLS LAST, b.asiento_creado, b.asiento_id,
                          b.linea_orden, b.linea_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ),
  tot AS (
    SELECT count(*) AS movimientos,
           COALESCE(sum(p.debe), 0)::numeric(14,2)  AS cargos,
           COALESCE(sum(p.haber), 0)::numeric(14,2) AS abonos
      FROM per p
  ),
  por_tipo AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'tipo_cargo', t.tipo_cargo,
             'saldo_inicial', t.ini, 'cargos', t.cargos, 'abonos', t.abonos,
             'saldo_final', t.ini + t.cargos - t.abonos) ORDER BY t.tipo_cargo NULLS LAST), '[]'::jsonb) AS j
      FROM (
        SELECT b.tipo_cargo,
               COALESCE(sum(b.debe - b.haber) FILTER (WHERE p_desde IS NOT NULL AND b.fecha < p_desde), 0)::numeric(14,2) AS ini,
               COALESCE(sum(b.debe)  FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS cargos,
               COALESCE(sum(b.haber) FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS abonos
          FROM base b GROUP BY b.tipo_cargo
      ) t
  ),
  pagina AS (
    SELECT p.* FROM per p
     WHERE p.n > p_offset AND p.n <= p_offset + p_limite
  ),
  filas AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'n', p.n,
             'linea_id', p.linea_id,
             'asiento_id', p.asiento_id,
             'asiento_numero', p.asiento_numero,
             'fecha', p.fecha,
             'origen', p.origen,
             'documento_tabla', CASE WHEN p.origen = 'automatico' THEN p.origen_tabla END,
             'documento_id', CASE WHEN p.origen = 'automatico' THEN p.origen_id END,
             'evento', p.origen_evento,
             'documento', CASE
                WHEN p.origen <> 'automatico' THEN 'Póliza manual'
                WHEN p.origen_tabla = 'cuotas_condominio' THEN
                  COALESCE('Cuota ' || c.concepto || ' ' || c.periodo, 'Cuota')
                WHEN p.origen_tabla = 'cargos_adicionales_unidad' THEN
                  COALESCE('Cargo ' || ca.concepto, 'Cargo adicional')
                WHEN p.origen_tabla = 'conta_saldo_favor_aplicaciones' THEN
                  'Aplicación de saldo a favor'
                    || COALESCE(' · cuota ' || csf.concepto || ' ' || csf.periodo, '')
                    || COALESCE(' · cargo ' || casf.concepto, '')
                WHEN p.origen_tabla = 'pagos' THEN
                  'Pago' || COALESCE(' ' || pg.metodo, '')
                    || COALESCE(' ref. ' || NULLIF(pg.referencia, ''), '')
                    || COALESCE(' · cuota ' || cap.concepto || ' ' || cap.periodo, '')
                    || COALESCE(' · cargo ' || cag.concepto, '')
                ELSE p.origen_tabla
              END,
             'concepto', p.asiento_concepto,
             'descripcion', p.linea_descripcion,
             'tipo_cargo', p.tipo_cargo,
             'componente', CASE
                WHEN p.origen_tabla = 'conta_saldo_favor_aplicaciones' AND p.origen = 'automatico' THEN
                  CASE WHEN sfa.cargo_adicional_id IS NOT NULL THEN 'cargo'
                       WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_tabla = 'pagos' AND p.origen = 'automatico' THEN
                  CASE WHEN ap.cargo_adicional_id IS NOT NULL THEN 'cargo'
                       WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_evento LIKE 'cuota_mora%' THEN 'mora'
                WHEN p.origen_evento LIKE 'cuota_emitida%' THEN 'principal'
                WHEN p.origen_evento LIKE 'cargo_adicional_emitido%' THEN 'cargo'
              END,
             'cuota_id', COALESCE(ap.cuota_id, sfa.cuota_id),
             'cargo_adicional_id', COALESCE(ap.cargo_adicional_id, sfa.cargo_adicional_id),
             'saldo_favor_aplicacion_id', sfa.id,
             'cuenta_id', p.cuenta_id,
             'cuenta_codigo', cta.codigo,
             'cuenta_nombre', cta.nombre,
             'unidad_id', p.unidad_id,
             'unidad_nombre', un.nombre,
             'auxiliar_id', p.auxiliar_cliente_id,
             'auxiliar_nombre', cl.nombre,
             'es_reverso', p.reversa_de_id IS NOT NULL,
             'reversa_de_id', p.reversa_de_id,
             'reversa_de_numero', ro.numero,
             -- Un reverso con fecha POSTERIOR al corte no existía a esa fecha:
             -- no se presenta como reverso, se avisa aparte.
             'reversado_por_id', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.id END,
             'reversado_por_numero', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.numero END,
             'reversado_por_fecha', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.fecha END,
             'reversado_despues_del_corte', rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta,
             'reversado_despues_fecha', CASE WHEN rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta THEN rv.fecha END,
             'cargo', p.debe,
             'abono', p.haber,
             'saldo', p.saldo::numeric(14,2)
           ) ORDER BY p.n), '[]'::jsonb) AS j
      FROM pagina p
      LEFT JOIN public.conta_cuentas cta ON cta.id = p.cuenta_id
      LEFT JOIN public.unidades un ON un.id = p.unidad_id
      LEFT JOIN public.clientes cl ON cl.id = p.auxiliar_cliente_id
      LEFT JOIN public.conta_asientos ro ON ro.id = p.reversa_de_id
      LEFT JOIN public.conta_asientos rv ON rv.id = p.anulado_por_id
      LEFT JOIN public.cuotas_condominio c
        ON p.origen = 'automatico' AND p.origen_tabla = 'cuotas_condominio' AND c.id = p.origen_id
      LEFT JOIN public.cargos_adicionales_unidad ca
        ON p.origen = 'automatico' AND p.origen_tabla = 'cargos_adicionales_unidad' AND ca.id = p.origen_id
      LEFT JOIN public.pagos pg
        ON p.origen = 'automatico' AND p.origen_tabla = 'pagos' AND pg.id = p.origen_id
      LEFT JOIN LATERAL (
        SELECT x.cuota_id, x.cargo_adicional_id FROM public.conta_cobro_aplicaciones x
         WHERE p.origen = 'automatico' AND p.origen_tabla = 'pagos'
           AND x.asiento_id = COALESCE(p.reversa_de_id, p.asiento_id)
           AND (x.cargo_adicional_id IS NOT NULL
                OR x.evento = CASE WHEN p.tipo_cargo = 'recargo_mora' THEN 'cuota_mora' ELSE 'cuota_emitida' END)
         LIMIT 1
      ) ap ON true
      LEFT JOIN public.cuotas_condominio cap ON cap.id = ap.cuota_id
      LEFT JOIN public.cargos_adicionales_unidad cag ON cag.id = ap.cargo_adicional_id
      LEFT JOIN public.conta_saldo_favor_aplicaciones sfa
        ON p.origen = 'automatico' AND p.origen_tabla = 'conta_saldo_favor_aplicaciones' AND sfa.id = p.origen_id
      LEFT JOIN public.cuotas_condominio csf ON csf.id = sfa.cuota_id
      LEFT JOIN public.cargos_adicionales_unidad casf ON casf.id = sfa.cargo_adicional_id
  ),
  fuera_filas AS (
    SELECT * FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
  ),
  fuera AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'clase', f.clase, 'naturaleza', f.naturaleza, 'documentos', f.n, 'monto', f.monto)
             ORDER BY f.clase, f.naturaleza), '[]'::jsonb) AS j
      FROM (
        SELECT x.clase, x.naturaleza, count(*) AS n, sum(x.monto)::numeric(14,2) AS monto
          FROM fuera_filas x
         GROUP BY x.clase, x.naturaleza
      ) f
  ),
  -- Lo que NO se puede reconstruir al corte con los datos existentes: se dice,
  -- con cuántos documentos afecta, en vez de presentar el estado de hoy como
  -- si fuera el de entonces.
  limitaciones AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'codigo', l.codigo, 'documentos', l.documentos, 'monto', l.monto, 'descripcion', l.descripcion)
             ORDER BY l.codigo), '[]'::jsonb) AS j
      FROM (
        SELECT * FROM public.conta_ec_limitaciones(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
        UNION ALL
        SELECT 'estado_actual_sin_fecha', count(*), sum(x.monto)::numeric(14,2),
               'Cargos adicionales que HOY figuran como pagados: el documento no registra cuándo se marcaron, así que no se sabe si ya lo estaban al corte. Se informan con su estado de hoy.'
          FROM fuera_filas x WHERE x.limitacion = 'estado_actual_sin_fecha'
        HAVING count(*) > 0
      ) l
  )
  SELECT jsonb_build_object(
           'sujeto', v_sujeto,
           'project_id', p_project_id,
           'desde', p_desde,
           'hasta', p_hasta,
           'resumen', jsonb_build_object(
             'saldo_inicial', (SELECT saldo FROM ini),
             'cargos', tot.cargos,
             'abonos', tot.abonos,
             'saldo_final', ((SELECT saldo FROM ini) + tot.cargos - tot.abonos)::numeric(14,2),
             'movimientos', tot.movimientos),
           'por_tipo', (SELECT j FROM por_tipo),
           'fuera_de_saldo', (SELECT j FROM fuera),
           'limitaciones', (SELECT j FROM limitaciones),
           'limite', p_limite,
           'offset', p_offset,
           'movimientos', (SELECT j FROM filas),
           -- 20261007000000: el saldo a favor del sujeto, aparte del saldo de
           -- CxC (un remanente nunca estuvo en la CxC).
           'saldo_a_favor', public.conta_ec_saldo_favor(v_company, p_project_id, p_cliente_id, p_unidad_id,
                                                       p_desde, p_hasta))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) TO authenticated;

-- conta_estado_cuenta_conciliacion: cuerpo idéntico a 20261004000000 salvo:
-- la línea de CxC de una aplicación de saldo a favor se concilia contra su
-- documento, lo aplicado por saldos a favor descuenta del documento, y el
-- saldo a favor se concilia aparte (y cuenta para `cuadra`).
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta_conciliacion(
  p_project_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_unidad_id  uuid DEFAULT NULL,
  p_corte      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

  WITH lin AS (
    SELECT l.*,
           -- el asiento «raíz» de un reverso es el reversado
           COALESCE(l.reversa_de_id, l.asiento_id) AS raiz_id
      FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) l
     WHERE p_corte IS NULL OR l.fecha <= p_corte
  ),
  lin_doc AS (
    SELECT l.*,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_tabla
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND ap.cuota_id IS NOT NULL
               THEN 'cuotas_condominio'
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND ap.cargo_adicional_id IS NOT NULL
               THEN 'cargos_adicionales_unidad'
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones'
               THEN CASE WHEN sfa.cuota_id IS NOT NULL THEN 'cuotas_condominio' ELSE 'cargos_adicionales_unidad' END
           END AS doc_tabla,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_id
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos'
               THEN COALESCE(ap.cuota_id, ap.cargo_adicional_id)
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones'
               THEN COALESCE(sfa.cuota_id, sfa.cargo_adicional_id)
           END AS doc_id
      FROM lin l
      LEFT JOIN public.conta_saldo_favor_aplicaciones sfa
        ON l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones' AND sfa.id = l.origen_id
      LEFT JOIN LATERAL (
        SELECT x.cuota_id, x.cargo_adicional_id FROM public.conta_cobro_aplicaciones x
         WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND x.asiento_id = l.raiz_id
         ORDER BY x.evento LIMIT 1
      ) ap ON true
  ),
  -- documentos por tipo del sujeto, por evento
  ev AS (
    SELECT 'cuotas_condominio'::text AS t, c.id, 'cuota_emitida'::text AS e, c.monto AS monto
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', COALESCE(c.mora_monto, 0)
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', x.monto
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = v_company AND x.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR x.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR x.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id)
  ),
  ev_doc AS (
    SELECT e.t, e.id, e.e,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.conta_asientos a
              WHERE a.company_id = v_company AND a.origen = 'automatico'
                AND a.origen_tabla = e.t AND a.origen_id = e.id AND a.origen_evento = e.e
                AND a.estado = 'publicado'
                AND (p_corte IS NULL OR a.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = a.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte)))
           THEN e.monto ELSE 0 END::numeric(14,2) AS devengado,
           COALESCE((
             SELECT sum(ap.monto) FROM public.conta_cobro_aplicaciones ap
               JOIN public.conta_asientos pa ON pa.id = ap.asiento_id
              WHERE ((e.t = 'cuotas_condominio' AND ap.cuota_id = e.id)
                     OR (e.t = 'cargos_adicionales_unidad' AND ap.cargo_adicional_id = e.id))
                AND ap.evento = e.e
                AND pa.estado = 'publicado'
                AND (p_corte IS NULL OR pa.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = pa.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte))
           ), 0)::numeric(14,2)
           -- aplicaciones de saldos a favor vivas al corte (20261007000000)
           + COALESCE((
             SELECT sum(CASE WHEN e.e = 'cuota_mora' THEN x.monto_mora ELSE x.monto_principal END)
               FROM public.conta_saldo_favor_aplicaciones x
               JOIN public.conta_asientos pa ON pa.id = x.asiento_id
              WHERE ((e.t = 'cuotas_condominio' AND x.cuota_id = e.id)
                     OR (e.t = 'cargos_adicionales_unidad' AND x.cargo_adicional_id = e.id))
                AND pa.estado = 'publicado'
                AND (p_corte IS NULL OR pa.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = pa.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte))
           ), 0)::numeric(14,2) AS aplicado
      FROM ev e
  ),
  doc_saldo AS (
    SELECT d.t, d.id, sum(d.devengado - d.aplicado)::numeric(14,2) AS documentos
      FROM ev_doc d GROUP BY d.t, d.id
  ),
  lin_saldo AS (
    SELECT l.doc_tabla AS t, l.doc_id AS id, sum(l.debe - l.haber)::numeric(14,2) AS contable
      FROM lin_doc l WHERE l.doc_id IS NOT NULL
     GROUP BY l.doc_tabla, l.doc_id
  ),
  disc_doc AS (
    SELECT 'documento'::text AS clase, COALESCE(d.t, s.t) AS origen_tabla, COALESCE(d.id, s.id) AS origen_id,
           NULL::uuid AS asiento_id,
           COALESCE(s.contable, 0)::numeric(14,2) AS contable,
           COALESCE(d.documentos, 0)::numeric(14,2) AS documentos
      FROM doc_saldo d
      FULL JOIN lin_saldo s ON s.t = d.t AND s.id = d.id
     WHERE COALESCE(s.contable, 0) <> COALESCE(d.documentos, 0)
  ),
  -- asientos de cobro (originales) con líneas del sujeto: sus abonos en CxC
  -- por cuenta contra sus aplicaciones por cuenta
  cobro_lin AS (
    SELECT l.asiento_id, l.cuenta_id, sum(l.haber - l.debe)::numeric(14,2) AS abonado
      FROM lin l
     WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND l.reversa_de_id IS NULL
       -- sólo cobros vivos al corte: uno reversado ya no aplica nada, y si su
       -- pago se eliminó, sus aplicaciones se fueron con él
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                        WHERE r.id = l.anulado_por_id AND r.estado = 'publicado'
                          AND (p_corte IS NULL OR r.fecha <= p_corte))
     GROUP BY l.asiento_id, l.cuenta_id
  ),
  cobro_ap AS (
    SELECT ap.asiento_id, ap.cuenta_id, sum(ap.monto)::numeric(14,2) AS aplicado
      FROM public.conta_cobro_aplicaciones ap
     WHERE ap.asiento_id IN (SELECT DISTINCT c.asiento_id FROM cobro_lin c)
     GROUP BY ap.asiento_id, ap.cuenta_id
  ),
  disc_ap AS (
    SELECT 'aplicacion'::text, 'pagos'::text,
           (SELECT a.origen_id FROM public.conta_asientos a WHERE a.id = COALESCE(c.asiento_id, x.asiento_id)),
           COALESCE(c.asiento_id, x.asiento_id),
           COALESCE(c.abonado, 0)::numeric(14,2), COALESCE(x.aplicado, 0)::numeric(14,2)
      FROM cobro_lin c
      FULL JOIN cobro_ap x ON x.asiento_id = c.asiento_id AND x.cuenta_id = c.cuenta_id
     WHERE COALESCE(c.abonado, 0) <> COALESCE(x.aplicado, 0)
  ),
  -- agrupado por el asiento raíz: un asiento y su reverso se compensan y no
  -- son una discrepancia
  disc_sin AS (
    SELECT 'sin_documento'::text, CASE WHEN l.origen = 'automatico' THEN l.origen_tabla END,
           CASE WHEN l.origen = 'automatico' THEN l.origen_id END,
           l.raiz_id, sum(l.debe - l.haber)::numeric(14,2), 0::numeric(14,2)
      FROM lin_doc l
     WHERE l.doc_id IS NULL
     GROUP BY l.origen, l.origen_tabla, l.origen_id, l.raiz_id
    HAVING sum(l.debe - l.haber) <> 0
  ),
  disc AS (
    SELECT * FROM disc_doc
    UNION ALL SELECT * FROM disc_ap
    UNION ALL SELECT * FROM disc_sin
  ),
  por_cuenta AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cuenta_id', q.cuenta_id, 'codigo', c.codigo, 'nombre', c.nombre, 'saldo', q.saldo)
             ORDER BY c.codigo), '[]'::jsonb) AS j
      FROM (SELECT l.cuenta_id, sum(l.debe - l.haber)::numeric(14,2) AS saldo
              FROM lin l GROUP BY l.cuenta_id) q
      JOIN public.conta_cuentas c ON c.id = q.cuenta_id
  ),
  tot AS (
    SELECT (SELECT COALESCE(sum(l.debe - l.haber), 0) FROM lin l)::numeric(14,2) AS contable,
           (SELECT COALESCE(sum(d.documentos), 0) FROM doc_saldo d)::numeric(14,2) AS documentos,
           public.conta_ec_saldo_favor(v_company, p_project_id, p_cliente_id, p_unidad_id, NULL, p_corte) AS sf
  )
  SELECT jsonb_build_object(
           'corte', p_corte,
           'saldo_contable', tot.contable,
           'saldo_documentos', tot.documentos,
           'diferencia', (tot.contable - tot.documentos)::numeric(14,2),
           'cuadra', tot.contable = tot.documentos AND NOT EXISTS (SELECT 1 FROM disc)
                     AND COALESCE((tot.sf->>'cuadra')::boolean, true),
           -- 20261007000000: el saldo a favor, del libro contra sus orígenes y
           -- aplicaciones vivos al corte.
           'saldo_a_favor', jsonb_build_object(
             'contable', tot.sf->'saldo_final', 'documentos', tot.sf->'saldo_documentos',
             'cuadra', tot.sf->'cuadra'),
           'por_cuenta', (SELECT j FROM por_cuenta),
           'total_discrepancias', (SELECT count(*) FROM disc),
           'discrepancias', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'clase', d.clase, 'origen_tabla', d.origen_tabla, 'origen_id', d.origen_id,
                      'asiento_id', d.asiento_id, 'asiento_numero', a.numero,
                      'contable', d.contable, 'documentos', d.documentos,
                      'diferencia', (d.contable - d.documentos)::numeric(14,2))
                      ORDER BY d.clase, d.origen_tabla, d.origen_id, d.asiento_id)
               FROM (SELECT * FROM disc ORDER BY clase, origen_tabla, origen_id, asiento_id LIMIT 200) d
               LEFT JOIN public.conta_asientos a ON a.id = d.asiento_id), '[]'::jsonb))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) TO authenticated;
