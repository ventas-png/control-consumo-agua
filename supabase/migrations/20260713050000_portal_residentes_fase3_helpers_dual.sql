-- Portal propietario vs inquilino — FASE 3 · paso 1: habilitar duplicidad (P1).
--
-- Extiende los DOS helpers (mis_unidades_ids / mis_proyectos_ids) para unir también
-- `unidad_residentes`. Como la fase 2 centralizó TODAS las policies condominio en
-- estos helpers, este cambio habilita —en UN solo lugar— que un residente vea los
-- datos de su unidad tanto si es el `unidades.cliente_id` como si está en
-- `unidad_residentes` (propietario Y/O inquilino).
--
-- BEHAVIOR-PRESERVING HOY: el backfill dejó unidad_residentes reflejando
-- unidades.cliente_id (0 filas que den acceso nuevo). Probado contra prod que el
-- conjunto (cliente,unidad) es IDÉNTICO antes/después (extra=0, falta=0). El acceso
-- DUAL se activa por-unidad recién cuando un operador asigna un inquilino
-- (unidad_residentes con otro cliente_id) — momento de QA en preview. Hoy no hay UI
-- para asignarlos, así que este cambio queda "armado" pero inerte.
--
-- SECURITY DEFINER + get_my_cliente_id() (auth.uid()): siempre acotado al llamante.

CREATE OR REPLACE FUNCTION public.mis_unidades_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT u.id FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
  UNION
  SELECT ur.unidad_id FROM public.unidad_residentes ur
    JOIN public.unidades u2 ON u2.id = ur.unidad_id
  WHERE ur.activo = true AND u2.activo = true AND ur.cliente_id = public.get_my_cliente_id()
$fn$;

CREATE OR REPLACE FUNCTION public.mis_proyectos_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT DISTINCT u.project_id FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
  UNION
  SELECT DISTINCT u2.project_id FROM public.unidad_residentes ur
    JOIN public.unidades u2 ON u2.id = ur.unidad_id
  WHERE ur.activo = true AND u2.activo = true AND ur.cliente_id = public.get_my_cliente_id()
$fn$;
