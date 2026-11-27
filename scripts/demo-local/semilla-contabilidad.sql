-- DATOS CONTABLES de la empresa demo (copia local), para el manual de Contabilidad. Datos inventados.
--   Contabilidad del proyecto «Condominio Demo»: catálogo básico + cuentas de banco, fondo de reserva, caja chica,
--   equipo y gastos; 8 casas con su responsable de pago; tipos de cargo; cuotas del mes con cobros verificados;
--   una cuenta bancaria con su extracto; una caja chica con vales; dos activos fijos.
--   Lo que el manual enseña a HACER (saldos por residente, conciliar, reponer, depreciar, fondo de reserva)
--   NO viene hecho: se hace con clics en recorridos/r5_contabilidad.mjs.
-- Corre como el dueño de la empresa (admin@demo.local), igual que si lo capturara en pantalla.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
CREATE FUNCTION pg_temp.e() RETURNS uuid LANGUAGE sql AS $$ SELECT 'd0000000-0000-4000-8000-00000000000e'::uuid $$;
CREATE FUNCTION pg_temp.p() RETURNS uuid LANGUAGE sql AS $$ SELECT 'd1000000-0000-4000-8000-0000000000c1'::uuid $$;
CREATE FUNCTION pg_temp.c(cod text) RETURNS uuid LANGUAGE sql AS
$$ SELECT id FROM public.conta_cuentas WHERE company_id = pg_temp.e() AND project_id = pg_temp.p() AND codigo = cod $$;

-- ── Catálogo ────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT count(*) FROM public.conta_inicializar_catalogo('basico', pg_temp.p());
RESET ROLE;
INSERT INTO public.conta_cuentas (company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, padre_id) VALUES
  (pg_temp.e(), pg_temp.p(), '14',   'Propiedad y equipo',            'activo',  'deudora',   2, false, pg_temp.c('1'));
INSERT INTO public.conta_cuentas (company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, padre_id) VALUES
  (pg_temp.e(), pg_temp.p(), '1102', 'Banco Industrial — operativa',  'activo',  'deudora',   3, true, pg_temp.c('11')),
  (pg_temp.e(), pg_temp.p(), '1103', 'Banco — fondo de reserva',      'activo',  'deudora',   3, true, pg_temp.c('11')),
  (pg_temp.e(), pg_temp.p(), '1104', 'Caja chica',                    'activo',  'deudora',   3, true, pg_temp.c('11')),
  (pg_temp.e(), pg_temp.p(), '1401', 'Equipo de bombeo y maquinaria', 'activo',  'deudora',   3, true, pg_temp.c('14')),
  (pg_temp.e(), pg_temp.p(), '1402', 'Depreciación acumulada',        'activo',  'acreedora', 3, true, pg_temp.c('14')),
  (pg_temp.e(), pg_temp.p(), '4102', 'Recargos por mora',             'ingreso', 'acreedora', 3, true, pg_temp.c('41')),
  (pg_temp.e(), pg_temp.p(), '4103', 'Intereses ganados',             'ingreso', 'acreedora', 3, true, pg_temp.c('41')),
  (pg_temp.e(), pg_temp.p(), '5102', 'Mantenimiento menor',           'gasto',   'deudora',   3, true, pg_temp.c('51')),
  (pg_temp.e(), pg_temp.p(), '5103', 'Transporte y mensajería',       'gasto',   'deudora',   3, true, pg_temp.c('51')),
  (pg_temp.e(), pg_temp.p(), '5104', 'Depreciación',                  'gasto',   'deudora',   3, true, pg_temp.c('51'));
-- Los depósitos y transferencias de los residentes entran al banco operativo.
UPDATE public.conta_mapeo_cuentas SET cuenta_id = pg_temp.c('1102')
 WHERE company_id = pg_temp.e() AND project_id = pg_temp.p() AND evento IN ('metodo_deposito', 'metodo_transferencia');
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (pg_temp.e(), pg_temp.p(), 'gasto_depreciacion', pg_temp.c('5104')),
  (pg_temp.e(), pg_temp.p(), 'depreciacion_acumulada', pg_temp.c('1402')),
  (pg_temp.e(), pg_temp.p(), 'activo_fijo', pg_temp.c('1401'))
ON CONFLICT DO NOTHING;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (pg_temp.e(), pg_temp.p(), 'mantenimiento',        pg_temp.c('1201'), pg_temp.c('4101')),
  (pg_temp.e(), pg_temp.p(), 'cuota_extraordinaria', pg_temp.c('1201'), pg_temp.c('4101')),
  (pg_temp.e(), pg_temp.p(), 'recargo_mora',         pg_temp.c('1201'), pg_temp.c('4102'));

-- ── Casas y residentes ──────────────────────────────────────────────────────
CREATE TEMP TABLE casas (n int, casa text, residente text, u uuid DEFAULT gen_random_uuid(), cl uuid DEFAULT gen_random_uuid());
INSERT INTO casas (n, casa, residente) VALUES
  (1, 'Casa 1', 'María López'), (2, 'Casa 2', 'Jorge Castillo'), (3, 'Casa 3', 'Lucía Morales'), (4, 'Casa 4', 'Pedro Ramírez'),
  (5, 'Casa 5', 'Elena Guzmán'), (6, 'Casa 6', 'Roberto Méndez'), (7, 'Casa 7', 'Carmen Ortiz'), (8, 'Casa 8', 'Luis Herrera');
INSERT INTO public.unidades (id, project_id, company_id, nombre, tipo) SELECT u, pg_temp.p(), pg_temp.e(), casa, 'casa' FROM casas;
INSERT INTO public.clientes (id, nombre, codigo, project_id) SELECT cl, residente, 'RES-' || lpad(n::text, 3, '0'), pg_temp.p() FROM casas;
INSERT INTO public.company_clientes (company_id, cliente_id) SELECT pg_temp.e(), cl FROM casas;
INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo, responsable_pago)
  SELECT u, cl, pg_temp.e(), pg_temp.p(), 'propietario', true FROM casas;

-- ── Cuotas del mes y sus cobros (lo que el banco va a mostrar) ───────────────
INSERT INTO public.cuotas_condominio (company_id, project_id, unidad_id, concepto, tipo_cargo, monto, periodo, fecha_vencimiento, cuota_estado, emitida_at)
  SELECT pg_temp.e(), pg_temp.p(), u, 'mantenimiento', 'mantenimiento', 600, to_char(CURRENT_DATE, 'YYYY-MM'),
         (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date, 'emitida', now()
    FROM casas;
-- Cuatro casas ya pagaron por depósito: tres el mismo día (el banco los muestra como UN depósito) y una aparte.
WITH pagadas AS (
  INSERT INTO public.pagos (cliente_id, project_id, monto, metodo, referencia, estado, verification_status, verified_at, cuota_id, tipo_aplicacion)
  SELECT k.cl, pg_temp.p(), 600, 'deposito', 'BOL-' || (1000 + k.n), 'verificado', 'verificado',
         (CURRENT_DATE - CASE WHEN k.n = 5 THEN 2 ELSE 3 END) + time '10:00', q.id, 'pago_total'
    FROM casas k JOIN public.cuotas_condominio q ON q.unidad_id = k.u WHERE k.n IN (1, 2, 3, 5)
  RETURNING id, cuota_id
)
UPDATE public.cuotas_condominio q SET estado = 'pagado', cuota_estado = 'pagada', pagada_at = now(), fecha_pago = CURRENT_DATE - 3,
       metodo_pago = 'deposito', pago_id = p.id
  FROM pagadas p WHERE q.id = p.cuota_id;

-- Un cargo cuyo tipo aún no tiene cuentas configuradas: es lo que el manual muestra en «Pendientes».
INSERT INTO public.cargos_adicionales_unidad (company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, fecha_vencimiento)
  SELECT pg_temp.e(), pg_temp.p(), u, 'Reparación de portón dañado', 'reparacion', 350, CURRENT_DATE - 5, CURRENT_DATE + 10 FROM casas WHERE n = 8;

-- ── Banco: la cuenta y su extracto ──────────────────────────────────────────
INSERT INTO public.cuentas_bancarias (company_id, project_id, nombre, banco, numero_mascara, cuenta_contable_id)
VALUES (pg_temp.e(), pg_temp.p(), 'BI monetaria', 'Banco Industrial', '4321', pg_temp.c('1102'));
INSERT INTO public.banco_movimientos (company_id, project_id, cuenta_bancaria_id, fecha, descripcion, referencia, monto)
SELECT pg_temp.e(), pg_temp.p(), (SELECT id FROM public.cuentas_bancarias WHERE company_id = pg_temp.e()), f, d, r, m FROM (VALUES
  (CURRENT_DATE - 3, 'DEPOSITO EN AGENCIA',        'DEP-88213', 1800.00),
  (CURRENT_DATE - 2, 'DEPOSITO EN AGENCIA',        'DEP-88277',  600.00),
  (CURRENT_DATE - 1, 'COMISION MANEJO DE CUENTA',  'COM-1126',   -35.00)) v(f, d, r, m);

-- ── Caja chica: una caja abierta con tres vales ─────────────────────────────
INSERT INTO public.caja_chica (company_id, project_id, fecha_apertura, monto_inicial, responsable, notas)
VALUES (pg_temp.e(), pg_temp.p(), date_trunc('month', CURRENT_DATE)::date, 1000, 'Administración', 'Fondo fijo para gastos menores');
INSERT INTO public.movimientos_caja (company_id, caja_id, project_id, tipo, concepto, monto, comprobante, fecha, registrado_por)
SELECT pg_temp.e(), (SELECT id FROM public.caja_chica WHERE company_id = pg_temp.e()), pg_temp.p(), 'egreso', c, m, comp, f, 'Administración' FROM (VALUES
  ('Bombillas para pasillos', 150.25, 'F-101', CURRENT_DATE - 6),
  ('Mensajería a la municipalidad', 80.00, 'R-22', CURRENT_DATE - 4),
  ('Candado para bodega', 95.00, 'F-117', CURRENT_DATE - 2)) v(c, m, comp, f);

-- ── Activos fijos (dados de alta hace unos meses) ───────────────────────────
INSERT INTO public.activos_fijos (company_id, project_id, codigo, nombre, categoria, fecha_alta, costo, valor_residual, vida_util_meses,
                                  cuenta_activo_id, cuenta_dep_acum_id, cuenta_gasto_dep_id, estado)
VALUES
  (pg_temp.e(), pg_temp.p(), 'AF-0001', 'Bomba sumergible 5 HP', 'maquinaria', (date_trunc('month', CURRENT_DATE) - interval '3 months' + interval '14 days')::date,
   24000, 0, 60, pg_temp.c('1401'), pg_temp.c('1402'), pg_temp.c('5104'), 'activo'),
  (pg_temp.e(), pg_temp.p(), 'AF-0002', 'Planta eléctrica de emergencia', 'maquinaria', (date_trunc('month', CURRENT_DATE) - interval '1 month' + interval '9 days')::date,
   45000, 4500, 120, pg_temp.c('1401'), pg_temp.c('1402'), pg_temp.c('5104'), 'activo');
COMMIT;
