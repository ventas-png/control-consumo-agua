-- Permitir que el cliente del portal lea config_condominio para los
-- proyectos en los que tiene una unidad activa. Necesario para que el
-- formulario "Nueva solicitud de mudanza" muestre los términos
-- configurados por la empresa y bloquee el envío hasta que el residente
-- los acepte. Sin esta política la SELECT desde PortalMudanzaTab regresa
-- vacío (RLS) y la sección de términos nunca se renderiza aunque la
-- empresa los tenga guardados.

CREATE POLICY "config_cond_cliente_select" ON public.config_condominio
  AS PERMISSIVE
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.project_id = config_condominio.project_id
        AND u.cliente_id = get_my_cliente_id()
        AND u.activo = true
    )
  );
