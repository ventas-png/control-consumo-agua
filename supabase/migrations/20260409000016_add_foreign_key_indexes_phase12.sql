-- Fase 12: Add Indexes for Foreign Keys
-- Create indexes on unindexed foreign keys to improve query performance
-- 20 foreign keys need covering indexes across 10 tables

-- ============================================================
-- Tabla: clientes (2 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clientes_project_id ON public.clientes(project_id);
CREATE INDEX IF NOT EXISTS idx_clientes_updated_by ON public.clientes(updated_by);

-- ============================================================
-- Tabla: company_clientes (1 foreign key)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_company_clientes_added_by ON public.company_clientes(added_by);

-- ============================================================
-- Tabla: contadores (4 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contadores_company_id ON public.contadores(company_id);
CREATE INDEX IF NOT EXISTS idx_contadores_project_id ON public.contadores(project_id);
CREATE INDEX IF NOT EXISTS idx_contadores_tarifa_id ON public.contadores(tarifa_id);
CREATE INDEX IF NOT EXISTS idx_contadores_updated_by ON public.contadores(updated_by);

-- ============================================================
-- Tabla: convenios_pago (2 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_convenios_pago_company_id ON public.convenios_pago(company_id);
CREATE INDEX IF NOT EXISTS idx_convenios_pago_created_by ON public.convenios_pago(created_by);

-- ============================================================
-- Tabla: fuentes_agua (1 foreign key)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fuentes_agua_company_id ON public.fuentes_agua(company_id);

-- ============================================================
-- Tabla: payment_requests (1 foreign key)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_payment_requests_company_id ON public.payment_requests(company_id);

-- ============================================================
-- Tabla: registros (2 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_registros_contador_id ON public.registros(contador_id);
CREATE INDEX IF NOT EXISTS idx_registros_project_id ON public.registros(project_id);

-- ============================================================
-- Tabla: registros_calidad (2 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_registros_calidad_company_id ON public.registros_calidad(company_id);
CREATE INDEX IF NOT EXISTS idx_registros_calidad_created_by ON public.registros_calidad(created_by);

-- ============================================================
-- Tabla: tarifas (2 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tarifas_company_id ON public.tarifas(company_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_updated_by ON public.tarifas(updated_by);

-- ============================================================
-- Tabla: unidades (3 foreign keys)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_unidades_company_id ON public.unidades(company_id);
CREATE INDEX IF NOT EXISTS idx_unidades_project_id ON public.unidades(project_id);
CREATE INDEX IF NOT EXISTS idx_unidades_updated_by ON public.unidades(updated_by);

-- ============================================================
-- Nota Final
-- ============================================================
-- Esta migración agrega 20 índices para cubrir claves foráneas sin índices.
-- Estos índices mejoran el rendimiento de JOINs y búsquedas en relaciones.
-- Beneficio esperado: +5-10% mejora en query performance para operaciones de JOIN
--
-- Resultado esperado: 0 advertencias de unindexed_foreign_keys
