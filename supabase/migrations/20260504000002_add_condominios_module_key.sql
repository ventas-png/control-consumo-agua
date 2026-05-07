-- Agrega 'servicios_energia' y 'condominios' al CHECK constraint de user_module_permissions
-- y actualiza populate_default_module_permissions para incluir condominios.

-- 1. Reemplazar constraint CHECK con todos los módulos actuales
ALTER TABLE public.user_module_permissions
  DROP CONSTRAINT IF EXISTS chk_module_key;

ALTER TABLE public.user_module_permissions
  ADD CONSTRAINT chk_module_key CHECK (module_key IN (
    'clientes','lecturas','tabla','dashboard','cobros',
    'mapa','calidad','rutas','tarifas','unidades',
    'contadores','configuracion','comunicacion',
    'servicios_energia','condominios'
  ));

-- 2. Actualizar función de defaults para incluir 'condominios'
CREATE OR REPLACE FUNCTION public.populate_default_module_permissions(
  p_user_id uuid,
  p_role text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defaults jsonb;
BEGIN
  v_defaults := CASE p_role
    WHEN 'admin' THEN '[
      {"m":"clientes",          "v":true, "c":true, "e":true, "s":true},
      {"m":"lecturas",          "v":true, "c":true, "e":false,"s":false},
      {"m":"tabla",             "v":true, "c":false,"e":true, "s":true},
      {"m":"dashboard",         "v":true, "c":false,"e":false,"s":false},
      {"m":"cobros",            "v":true, "c":true, "e":true, "s":true},
      {"m":"mapa",              "v":true, "c":false,"e":false,"s":false},
      {"m":"calidad",           "v":true, "c":true, "e":true, "s":false},
      {"m":"rutas",             "v":true, "c":true, "e":true, "s":false},
      {"m":"tarifas",           "v":true, "c":true, "e":true, "s":false},
      {"m":"unidades",          "v":true, "c":true, "e":true, "s":false},
      {"m":"contadores",        "v":true, "c":true, "e":true, "s":false},
      {"m":"servicios_energia", "v":true, "c":true, "e":true, "s":true},
      {"m":"configuracion",     "v":true, "c":false,"e":true, "s":false},
      {"m":"comunicacion",      "v":true, "c":true, "e":true, "s":false},
      {"m":"condominios",       "v":true, "c":true, "e":true, "s":true}
    ]'::jsonb
    WHEN 'operator' THEN '[
      {"m":"clientes",          "v":true, "c":true, "e":true, "s":true},
      {"m":"lecturas",          "v":true, "c":true, "e":false,"s":false},
      {"m":"tabla",             "v":true, "c":false,"e":false,"s":false},
      {"m":"dashboard",         "v":true, "c":false,"e":false,"s":false},
      {"m":"mapa",              "v":true, "c":false,"e":false,"s":false},
      {"m":"calidad",           "v":true, "c":true, "e":true, "s":false},
      {"m":"rutas",             "v":true, "c":false,"e":true, "s":false},
      {"m":"contadores",        "v":true, "c":false,"e":true, "s":false},
      {"m":"servicios_energia", "v":true, "c":true, "e":true, "s":false},
      {"m":"comunicacion",      "v":true, "c":false,"e":true, "s":false},
      {"m":"condominios",       "v":true, "c":false,"e":true, "s":false}
    ]'::jsonb
    WHEN 'operador' THEN '[
      {"m":"clientes",          "v":true, "c":true, "e":true, "s":true},
      {"m":"lecturas",          "v":true, "c":true, "e":false,"s":false},
      {"m":"tabla",             "v":true, "c":false,"e":false,"s":false},
      {"m":"dashboard",         "v":true, "c":false,"e":false,"s":false},
      {"m":"mapa",              "v":true, "c":false,"e":false,"s":false},
      {"m":"calidad",           "v":true, "c":true, "e":true, "s":false},
      {"m":"rutas",             "v":true, "c":false,"e":true, "s":false},
      {"m":"contadores",        "v":true, "c":false,"e":true, "s":false},
      {"m":"servicios_energia", "v":true, "c":true, "e":true, "s":false},
      {"m":"comunicacion",      "v":true, "c":false,"e":true, "s":false},
      {"m":"condominios",       "v":true, "c":false,"e":true, "s":false}
    ]'::jsonb
    WHEN 'viewer' THEN '[
      {"m":"tabla",     "v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard", "v":true,"c":false,"e":false,"s":false},
      {"m":"mapa",      "v":true,"c":false,"e":false,"s":false}
    ]'::jsonb
    WHEN 'visor' THEN '[
      {"m":"tabla",     "v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard", "v":true,"c":false,"e":false,"s":false},
      {"m":"mapa",      "v":true,"c":false,"e":false,"s":false}
    ]'::jsonb
    WHEN 'collector' THEN '[
      {"m":"cobros",       "v":true,"c":true,"e":true,"s":true},
      {"m":"comunicacion", "v":true,"c":true,"e":true,"s":false}
    ]'::jsonb
    ELSE '[]'::jsonb
  END;

  INSERT INTO public.user_module_permissions
    (user_id, module_key, can_view, can_create, can_edit, can_change_status)
  SELECT
    p_user_id,
    (item->>'m')::text,
    (item->>'v')::boolean,
    (item->>'c')::boolean,
    (item->>'e')::boolean,
    (item->>'s')::boolean
  FROM jsonb_array_elements(v_defaults) AS item
  ON CONFLICT (user_id, module_key) DO NOTHING;
END;
$$;
