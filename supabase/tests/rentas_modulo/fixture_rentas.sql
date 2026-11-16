-- Fixture adicional de rentas_modulo: lo que 20261125000000 necesita y los fixtures
-- compartidos (housekeeping_evidencias + RBAC real + str_importacion) no traen.
--
-- · `permissions` (20260518000004): catálogo RBAC, con la FK de role_permissions.
-- · El rol Administrador General con el id fijo de 20260518000006 (destino del grant).
-- · `touch_updated_at()` (20260528000030), copia literal.
CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text NOT NULL,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;

INSERT INTO public.roles (id, company_id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Administrador General', true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
