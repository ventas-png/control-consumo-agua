-- Allow operators with project access to insert and update tarifas
-- The module-level permission check (can_create/can_edit) is enforced by the UI
CREATE POLICY "operator write tarifas"
ON public.tarifas
FOR ALL
USING (has_operator_project_access(project_id))
WITH CHECK (has_operator_project_access(project_id));
