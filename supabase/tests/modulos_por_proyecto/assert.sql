-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261127000000_modulos_por_proyecto, como cada persona.
--   A · columnas: los tres interruptores, encendidos por defecto
--   B · quién los mueve: la dueña y la plataforma; un administrador no (pero sigue editando el proyecto)
--   C · un proyecto conserva al menos un módulo de los CONTRATADOS por su empresa
--   D · portal del residente: servicio de la empresa ∩ módulo del proyecto de cada unidad
--   E · Rentas: no se enlaza a un proyecto con Rentas apagado; lo ya enlazado se conserva
-- Personas: 1 dueña de A · 12 admin exento de A · 8 residente de A · 14 plataforma.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.proy(p uuid) RETURNS public.projects LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.projects WHERE id = p $$;
CREATE OR REPLACE FUNCTION hkt.portal(p_unidad uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT x FROM public.portal_mis_unidades() x WHERE (x ->> 'id')::uuid = p_unidad $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · columnas ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 tres interruptores NOT NULL con default true',
    (SELECT count(*) = 3 AND bool_and(is_nullable = 'NO' AND column_default = 'true')
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name LIKE 'modulo\_%'));
  PERFORM hkt.ok('A2 los proyectos que ya existían quedan con los tres encendidos',
    (SELECT bool_and(modulo_agua AND modulo_condominios AND modulo_rentas) FROM public.projects));
END $$;

-- ── B · quién mueve los interruptores ───────────────────────────────────────
SELECT hkt.como(hkt.uid(12));
DO $$
BEGIN
  PERFORM hkt.ok('B1 un administrador no cambia los módulos → 42501 MODULOS_PROYECTO_SOLO_PRINCIPAL',
    hkt.estado_de(format('UPDATE public.projects SET modulo_condominios = false WHERE id = %L', hkt.pa2())) = '42501'
    AND hkt.mensaje_de(format('UPDATE public.projects SET modulo_condominios = false WHERE id = %L', hkt.pa2())) LIKE 'MODULOS_PROYECTO_SOLO_PRINCIPAL%');
  UPDATE public.projects SET nombre = 'A · Proyecto 2 (editado)', modulo_agua = true WHERE id = hkt.pa2();
  PERFORM hkt.ok('B2 el administrador sigue editando el resto del proyecto (y reenviar el mismo valor no es un cambio)',
    (hkt.proy(hkt.pa2())).nombre = 'A · Proyecto 2 (editado)');
END $$;
SELECT hkt.como(hkt.uid(1));
DO $$
BEGIN
  UPDATE public.projects SET modulo_condominios = false, modulo_rentas = false WHERE id = hkt.pa2();
  PERFORM hkt.ok('B3 la dueña deja PA2 en sólo Agua',
    (SELECT p.modulo_agua AND NOT p.modulo_condominios AND NOT p.modulo_rentas FROM hkt.proy(hkt.pa2()) p));
  PERFORM hkt.ok('B4 PA1 no se movió: sigue con los tres',
    (SELECT p.modulo_agua AND p.modulo_condominios AND p.modulo_rentas FROM hkt.proy(hkt.pa1()) p));
END $$;
SELECT hkt.como(hkt.uid(14));
DO $$
BEGIN
  UPDATE public.projects SET modulo_rentas = true WHERE id = hkt.pa2();
  UPDATE public.projects SET modulo_rentas = false WHERE id = hkt.pa2();
  PERFORM hkt.ok('B5 la plataforma también los mueve', NOT (hkt.proy(hkt.pa2())).modulo_rentas);
END $$;
SELECT hkt.como_servicio();
DO $$
BEGIN
  UPDATE public.projects SET modulo_condominios = true WHERE id = hkt.pa2();
  UPDATE public.projects SET modulo_condominios = false WHERE id = hkt.pa2();
  PERFORM hkt.ok('B6 el servicio (service_role) no pasa por la compuerta de rol', NOT (hkt.proy(hkt.pa2())).modulo_condominios);
END $$;

-- ── C · al menos un módulo contratado ───────────────────────────────────────
SELECT hkt.como(hkt.uid(1));
DO $$
BEGIN
  PERFORM hkt.ok('C1 apagar el último módulo de PA2 → 23514 MODULOS_PROYECTO_VACIO',
    hkt.estado_de(format('UPDATE public.projects SET modulo_agua = false WHERE id = %L', hkt.pa2())) = '23514'
    AND hkt.mensaje_de(format('UPDATE public.projects SET modulo_agua = false WHERE id = %L', hkt.pa2())) LIKE 'MODULOS_PROYECTO_VACIO%');
END $$;
SELECT hkt.como(hkt.uid(14));
DO $$
BEGIN
  PERFORM hkt.ok('C2 B sólo contrata Agua: apagar Agua en PB1 lo deja vacío aunque Condominios y Rentas sigan encendidos',
    hkt.mensaje_de(format('UPDATE public.projects SET modulo_agua = false WHERE id = %L', hkt.pb1())) LIKE 'MODULOS_PROYECTO_VACIO%');
  UPDATE public.projects SET modulo_condominios = false WHERE id = hkt.pb1();
  PERFORM hkt.ok('C3 apagar en PB1 un módulo que B no contrata sí se puede', NOT (hkt.proy(hkt.pb1())).modulo_condominios);
END $$;
SELECT hkt.como_servicio();
DO $$
BEGIN
  PERFORM hkt.ok('C4 tampoco el servicio deja un proyecto sin módulos',
    hkt.mensaje_de(format('UPDATE public.projects SET modulo_agua = false WHERE id = %L', hkt.pa2())) LIKE 'MODULOS_PROYECTO_VACIO%');
END $$;

-- ── D · portal del residente ────────────────────────────────────────────────
-- La residente (8) ocupa un(1) en PA1 (los tres módulos) y un(3) en PA2 (sólo Agua).
SELECT hkt.como(hkt.uid(8));
DO $$
BEGIN
  PERFORM hkt.ok('D1 unidad de PA1: Agua y Condominios',
    (hkt.portal(hkt.un(1)) ->> 'servicio_agua')::boolean AND (hkt.portal(hkt.un(1)) ->> 'servicio_condominios')::boolean);
  PERFORM hkt.ok('D2 unidad de PA2 (sólo Agua): Agua sí, Condominios no',
    (hkt.portal(hkt.un(3)) ->> 'servicio_agua')::boolean AND NOT (hkt.portal(hkt.un(3)) ->> 'servicio_condominios')::boolean);
END $$;
SELECT hkt.root();
UPDATE public.projects SET modulo_agua = false WHERE id = hkt.pa1();
SELECT hkt.como(hkt.uid(8));
DO $$
BEGIN
  PERFORM hkt.ok('D3 PA1 sin Agua: su unidad queda sólo con Condominios',
    NOT (hkt.portal(hkt.un(1)) ->> 'servicio_agua')::boolean AND (hkt.portal(hkt.un(1)) ->> 'servicio_condominios')::boolean);
END $$;
SELECT hkt.root();
UPDATE public.projects SET modulo_agua = true WHERE id = hkt.pa1();
ALTER TABLE public.companies DISABLE TRIGGER USER;
UPDATE public.companies SET servicio_condominios = false WHERE id = hkt.ca();
SELECT hkt.como(hkt.uid(8));
DO $$
BEGIN
  PERFORM hkt.ok('D4 el proyecto no enciende lo que la empresa no contrata: A sin Condominios → ninguna unidad lo tiene',
    NOT (hkt.portal(hkt.un(1)) ->> 'servicio_condominios')::boolean AND NOT (hkt.portal(hkt.un(3)) ->> 'servicio_condominios')::boolean);
END $$;
SELECT hkt.root();
UPDATE public.companies SET servicio_condominios = true WHERE id = hkt.ca();
ALTER TABLE public.companies ENABLE TRIGGER USER;

-- ── E · Rentas ──────────────────────────────────────────────────────────────
SELECT hkt.como(hkt.uid(1));
DO $$
BEGIN
  PERFORM hkt.ok('E1 enlazar una unidad de PA2 (Rentas apagado) → 23514 RENTAS_PROYECTO_SIN_MODULO',
    hkt.mensaje_de(format('INSERT INTO public.rentas_propiedades (company_id, project_id, unidad_id, nombre, tipo_renta) VALUES (%L, %L, %L, %L, %L)',
      hkt.ca(), hkt.pa2(), hkt.un(3), 'Casa 3', 'largo_plazo')) LIKE 'RENTAS_PROYECTO_SIN_MODULO%');
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre, tipo_renta)
    VALUES (hkt.pr(41), hkt.ca(), hkt.pa1(), hkt.un(2), 'Apto 2B', 'largo_plazo');
  INSERT INTO public.rentas_propiedades (id, company_id, nombre, tipo_renta)
    VALUES (hkt.pr(42), hkt.ca(), 'Bodega independiente', 'otro');
  PERFORM hkt.ok('E2 enlazar en PA1 (Rentas encendido) y registrar una independiente sí se puede',
    (SELECT count(*) = 2 FROM public.rentas_propiedades WHERE id IN (hkt.pr(41), hkt.pr(42))));
  UPDATE public.projects SET modulo_rentas = false WHERE id = hkt.pa1();
  UPDATE public.rentas_propiedades SET nombre = 'Apto 2B (renovado)' WHERE id = hkt.pr(41);
  PERFORM hkt.ok('E3 apagar Rentas en PA1 conserva lo ya enlazado, que se sigue pudiendo editar',
    (SELECT nombre = 'Apto 2B (renovado)' AND project_id = hkt.pa1() FROM public.rentas_propiedades WHERE id = hkt.pr(41)));
  PERFORM hkt.ok('E4 pero la independiente ya no se puede enlazar a PA1',
    hkt.mensaje_de(format('UPDATE public.rentas_propiedades SET project_id = %L, unidad_id = %L WHERE id = %L',
      hkt.pa1(), hkt.un(4), hkt.pr(42))) LIKE 'RENTAS_PROYECTO_SIN_MODULO%');
END $$;
SELECT hkt.root();
