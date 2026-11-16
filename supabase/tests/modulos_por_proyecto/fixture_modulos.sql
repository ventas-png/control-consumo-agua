-- Fixture de modulos_por_proyecto: lo que 20261127000000 necesita y los fixtures
-- compartidos (padrón, Rentas, cobro) no traen.
-- · `is_company_owner()` (20261029000000) en versión mínima.
-- · `mis_unidad_roles()` (20260822000000): aquí sale de test_mis_unidades, con rol propietario.
-- · La residente (8) ocupa una unidad de PA1 y otra de PA2.
-- · La empresa A contrata los tres módulos; la B, sólo Agua.
CREATE OR REPLACE FUNCTION public.is_company_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(current_user_role() = 'company_owner', false) $$;
CREATE OR REPLACE FUNCTION public.mis_unidad_roles() RETURNS TABLE (unidad uuid, rol text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT unidad_id, 'propietario'::text FROM public.test_mis_unidades WHERE user_id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.is_company_owner(), public.mis_unidad_roles() TO authenticated, service_role;

INSERT INTO public.test_mis_unidades (user_id, unidad_id) VALUES (hkt.uid(8), hkt.un(1)), (hkt.uid(8), hkt.un(3));

UPDATE public.companies SET servicio_agua = true, servicio_condominios = true, servicio_rentas = true WHERE id = hkt.ca();
UPDATE public.companies SET servicio_agua = true, servicio_condominios = false, servicio_rentas = false WHERE id = hkt.cb();
