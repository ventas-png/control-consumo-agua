-- Drop unused indexes (idx_scan = 0) and add missing FK indexes

DROP INDEX IF EXISTS public.broadcast_recipients_cliente_id_idx;
DROP INDEX IF EXISTS public.broadcast_recipients_company_id_idx;
DROP INDEX IF EXISTS public.idx_clientes_project_id;
DROP INDEX IF EXISTS public.idx_clientes_updated_by;
DROP INDEX IF EXISTS public.idx_companies_default_currency;
DROP INDEX IF EXISTS public.idx_company_clientes_added_by;
DROP INDEX IF EXISTS public.idx_company_payment_secrets_company_id;
DROP INDEX IF EXISTS public.idx_contadores_company_id;
DROP INDEX IF EXISTS public.idx_contadores_project_id;
DROP INDEX IF EXISTS public.idx_contadores_tarifa_id;
DROP INDEX IF EXISTS public.idx_contadores_updated_by;
DROP INDEX IF EXISTS public.idx_convenios_pago_company_id;
DROP INDEX IF EXISTS public.idx_convenios_pago_created_by;
DROP INDEX IF EXISTS public.idx_convenios_pago_project_id;
DROP INDEX IF EXISTS public.conv_assignments_conversation_idx;
DROP INDEX IF EXISTS public.conv_assignments_user_idx;
DROP INDEX IF EXISTS public.conversations_assigned_to_idx;
DROP INDEX IF EXISTS public.idx_empresa_pagos_config_company_id;
DROP INDEX IF EXISTS public.idx_empresa_pagos_config_configured_by;
DROP INDEX IF EXISTS public.idx_facturas_energia_company_estado;
DROP INDEX IF EXISTS public.idx_facturas_energia_company_id;
DROP INDEX IF EXISTS public.idx_facturas_energia_fuente_energia_id;
DROP INDEX IF EXISTS public.idx_facturas_energia_fuente_periodo;
DROP INDEX IF EXISTS public.idx_facturas_energia_project_id;
DROP INDEX IF EXISTS public.idx_fuentes_agua_company_id;
DROP INDEX IF EXISTS public.idx_fuentes_energia_company_id;
DROP INDEX IF EXISTS public.idx_fuentes_energia_fuente_agua_id;
DROP INDEX IF EXISTS public.idx_fuentes_energia_project_id;
DROP INDEX IF EXISTS public.idx_fuentes_energia_proveedor_id;
DROP INDEX IF EXISTS public.idx_pagos_convenio_id;
DROP INDEX IF EXISTS public.idx_pagos_created_by;
DROP INDEX IF EXISTS public.idx_pagos_project_id;
DROP INDEX IF EXISTS public.idx_pagos_registro_id;
DROP INDEX IF EXISTS public.idx_pagos_verified_by;
DROP INDEX IF EXISTS public.idx_password_reset_tokens_user_id;
DROP INDEX IF EXISTS public.idx_payment_requests_company_id;
DROP INDEX IF EXISTS public.idx_payment_requests_registro_id;
DROP INDEX IF EXISTS public.idx_proveedores_energia_company_activo;
DROP INDEX IF EXISTS public.idx_proveedores_energia_company_id;
DROP INDEX IF EXISTS public.idx_proveedores_energia_project_id;
DROP INDEX IF EXISTS public.idx_registros_contador_id;
DROP INDEX IF EXISTS public.idx_registros_project_id;
DROP INDEX IF EXISTS public.idx_registros_calidad_company_id;
DROP INDEX IF EXISTS public.idx_registros_calidad_created_by;
DROP INDEX IF EXISTS public.idx_registros_calidad_fuente_id;
DROP INDEX IF EXISTS public.idx_rutas_asignado_a;
DROP INDEX IF EXISTS public.idx_tarifas_company_id;
DROP INDEX IF EXISTS public.idx_tarifas_project_id;
DROP INDEX IF EXISTS public.idx_tarifas_updated_by;
DROP INDEX IF EXISTS public.idx_tarifas_energia_company_activa;
DROP INDEX IF EXISTS public.idx_tarifas_energia_company_id;
DROP INDEX IF EXISTS public.idx_tarifas_energia_project_id;
DROP INDEX IF EXISTS public.idx_tarifas_energia_proveedor_id;
DROP INDEX IF EXISTS public.idx_unidades_project_id;
DROP INDEX IF EXISTS public.idx_unidades_updated_by;
DROP INDEX IF EXISTS public.idx_ump_module;
DROP INDEX IF EXISTS public.idx_user_module_permissions_updated_by;
DROP INDEX IF EXISTS public.idx_user_project_assignments_project_id;

-- Add missing FK indexes
CREATE INDEX IF NOT EXISTS idx_facturas_energia_proveedor_id
  ON public.facturas_energia (proveedor_id);

CREATE INDEX IF NOT EXISTS idx_facturas_energia_tarifa_id
  ON public.facturas_energia (tarifa_id);

CREATE INDEX IF NOT EXISTS idx_fuentes_energia_tarifa_id
  ON public.fuentes_energia (tarifa_id);
