-- Fase 2: Crear funciones helper combinadas para evitar evaluación redundante

-- Función optimizada: Admin con acceso a proyecto
-- Evita múltiples evaluaciones de current_user_role() en políticas
CREATE OR REPLACE FUNCTION public.has_admin_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT 
    current_user_role() = 'admin' AND (
      EXISTS (
        SELECT 1 FROM public.app_users
        WHERE id = auth.uid() AND project_id = p_project_id
      )
      OR EXISTS (
        SELECT 1 FROM public.app_users u
        JOIN public.user_project_assignments upa ON upa.user_id = u.id
        WHERE u.id = auth.uid() AND upa.project_id = p_project_id
      )
    )
$$;

-- Función optimizada: Operator con acceso a proyecto  
-- Evita múltiples evaluaciones en políticas
CREATE OR REPLACE FUNCTION public.has_operator_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT 
    current_user_role() IN ('operator','operador') AND EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$$;

-- Función optimizada: Viewer solo lectura a proyecto
-- Combinado con role check
CREATE OR REPLACE FUNCTION public.has_viewer_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT 
    current_user_role() IN ('viewer','visor') AND EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$$;

-- Comentarios para documentación
COMMENT ON FUNCTION has_admin_project_access(uuid) IS 'Performance: Combined role + project access check (avoids duplicate current_user_role() calls)';
COMMENT ON FUNCTION has_operator_project_access(uuid) IS 'Performance: Combined role + project access check for operators';
COMMENT ON FUNCTION has_viewer_project_access(uuid) IS 'Performance: Combined role + project access check for viewers';
