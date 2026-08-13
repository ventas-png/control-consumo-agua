-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · el catálogo de cuentas admite 8 niveles (antes 5)
--
-- El catálogo real de la empresa abre más ramas de las que caben en 5 niveles:
-- clase → grupo → rubro → mayor → sub-cuenta → auxiliar → sub-auxiliar →
-- detalle (p. ej. ACTIVO ▸ NO CORRIENTE ▸ PROPIEDAD PLANTA Y EQUIPO ▸
-- Mobiliario y Equipo ▸ Circuito Cerrado de Cámaras ▸ …). Con el tope en 5, la
-- carga masiva rechazaba esas ramas y había que aplanar el catálogo a mano.
--
-- Solo se AMPLÍA el rango del CHECK: 1..5 sigue siendo válido, así que ninguna
-- fila existente se toca y no hay backfill. Nada más en el esquema depende de
-- la profundidad — el árbol se recorre por padre_id (sin recursión con tope) y
-- balanza/EEFF hacen el rollup por padre, no por número de nivel.
--
-- Idempotente. RLS intacta.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.conta_cuentas DROP CONSTRAINT IF EXISTS conta_cuentas_nivel_check;

ALTER TABLE public.conta_cuentas
  ADD CONSTRAINT conta_cuentas_nivel_check CHECK (nivel BETWEEN 1 AND 8);

COMMENT ON COLUMN public.conta_cuentas.nivel IS
  'Profundidad en el árbol, 1..8 (1=clase · 2=grupo · 3=mayor · 4=sub-cuenta · '
  '5..8=auxiliares). Debe ser el nivel del padre + 1; la UI y la carga masiva '
  'lo calculan, el CHECK solo acota el rango.';

COMMENT ON TABLE public.conta_cuentas IS
  'Catálogo de cuentas contables (partida doble, fase 1 ERP). Jerárquico hasta 8 niveles por padre_id.';
