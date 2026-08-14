-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de la Fase 7 (gasto ↔ factura).
--
-- Se carga DESPUÉS de supabase/tests/compras_flujo/fixture.sql —que aporta las
-- tablas de condominios, el padrón y los helpers de aserción— y ANTES de las
-- migraciones 20260821*/20260823*.
--
-- QUÉ APORTA: el mundo TAL COMO ESTÁ HOY, con el doble conteo ya dentro de los
-- libros. Ese es el punto: el histórico duplicado tiene que existir antes de que
-- corran las migraciones de la Fase 7, porque lo que se prueba es que las
-- encuentra y las corrige, no que las previene en un tablero recién barrido.
--
-- Los gastos entran en 'pagado', así que `conta_tg_gastos` (v1 de junio, la que
-- todavía no sabe de facturas) les genera su asiento. Las facturas pasan por
-- registrada → aprobada, que es lo que dispara su devengo. Resultado: la cuenta
-- 5101 queda con el gasto contado DOS veces y nada lo señala — exactamente el
-- síntoma que la Fase 7 viene a resolver.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Proveedores del catálogo (existen desde antes de la Fase 6) ─────────────
INSERT INTO public.proveedores (id, company_id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Ferretería El Tornillo'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Distribuidora Central');

-- ── EL DUPLICADO HISTÓRICO ──────────────────────────────────────────────────
-- El mismo desembolso, capturado por las dos puertas: alguien lo anotó como
-- gasto del condominio el día que se pagó, y contabilidad capturó la factura
-- cuando llegó el papel. `proveedor_id` en NULL no es un descuido del fixture:
-- es lo que hay en producción, porque la pantalla guardaba el proveedor como
-- TEXTO LIBRE y nunca tocaba la FK.
INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha,
   proveedor_nombre, comprobante_num, estado, metodo_pago)
VALUES
  ('9a5a0000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Cambio de bomba de la cisterna', 'mantenimiento', 1500.00, DATE '2026-07-10',
   'Ferretería El Tornillo', 'A-4471', 'pagado', 'efectivo');

INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, numero_factura, fecha_emision,
   concepto, categoria, monto_total, estado)
VALUES
  ('fac00000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-0000-0000-0000-000000000001', 'A-4471', DATE '2026-07-10',
   'Bomba centrífuga 1.5 HP', 'mantenimiento', 1500.00, 'registrada');

UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id = 'fac00000-0000-0000-0000-000000000001';

-- ── LOS DOS FALSOS POSITIVOS QUE MATAN ESTOS REPORTES ───────────────────────
-- (a) Mismo proveedor y mismo monto, pero 40 días después: comprar dos veces lo
--     mismo al mismo ferretero es lo NORMAL, no una sospecha.
INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha,
   proveedor_nombre, estado, metodo_pago)
VALUES
  ('9a5a0000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Segunda bomba, edificio B', 'mantenimiento', 1500.00, DATE '2026-08-19',
   'Ferretería El Tornillo', 'pagado', 'efectivo');

-- (b) Mismo monto y misma fecha que la factura, pero de OTRO proveedor.
INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha,
   proveedor_nombre, estado, metodo_pago)
VALUES
  ('9a5a0000-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Compra de luminarias', 'mantenimiento', 1500.00, DATE '2026-07-10',
   'Distribuidora Central', 'pagado', 'efectivo');

-- ── Un gasto de caja chica, sin proveedor ninguno ───────────────────────────
-- Es el caso para el que `gastos_condominio` existe. No debe aparecer en ningún
-- reporte de duplicados ni cambiar de comportamiento por nada de esta fase.
INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha, estado, metodo_pago)
VALUES
  ('9a5a0000-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Café y agua para la asamblea', 'administrativo', 220.00, DATE '2026-07-12',
   'pagado', 'efectivo');

-- ── Helper de aserción propio de esta fase ──────────────────────────────────
-- Cuántos asientos VIVOS tiene un documento. Es la pregunta central de toda la
-- fase —«¿este hecho económico está en los libros una vez o dos?»— y conviene
-- poder hacerla en una línea.
--
-- `reversa_de_id IS NULL` no es cosmético: el reverso NO es un asiento nuevo del
-- documento, es la contrapartida del que se está deshaciendo, y lleva el mismo
-- `origen_tabla`/`origen_id` que el original. Sin ese filtro, anular un gasto
-- lo dejaría con «1 asiento vivo» para siempre.
CREATE OR REPLACE FUNCTION public.asientos_vivos(p_tabla text, p_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.conta_asientos
  WHERE origen = 'automatico' AND origen_tabla = p_tabla AND origen_id = p_id
    AND estado = 'publicado' AND anulado_por_id IS NULL AND reversa_de_id IS NULL
$$;

-- Lo que UN documento aportó a una cuenta. `saldo()` suma la cuenta entera, y
-- la cuenta entera lleva también los otros gastos del escenario: mediría de más
-- y la aserción diría cualquier cosa. Como el reverso conserva `origen_tabla` y
-- `origen_id` del original (solo cambia el evento a `*_revertido`), sumar por
-- documento da CERO en cuanto se reversa, que es justo lo que se quiere leer.
CREATE OR REPLACE FUNCTION public.saldo_de(p_codigo text, p_tabla text, p_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(l.debe - l.haber), 0)::numeric(14,2)
  FROM public.conta_asiento_lineas l
  JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  WHERE c.codigo = p_codigo AND a.estado = 'publicado'
    AND a.origen = 'automatico' AND a.origen_tabla = p_tabla AND a.origen_id = p_id
$$;

-- El helper que consulta el reporte de duplicados vive en assert.sql: aquí
-- `conta_gastos_duplicados` todavía no existe (la crea la migración 20260823*)
-- y Postgres valida el cuerpo de una función SQL al crearla.
