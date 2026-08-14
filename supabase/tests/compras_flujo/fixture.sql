-- ════════════════════════════════════════════════════════════════════════════
-- Fixture del riel de compras (Fase 6).
--
-- Se carga DESPUÉS de scripts/conta-smoke/stubs.sql y de las migraciones
-- contables reales (20260611*/20260612*), y ANTES de las migraciones 20260821*.
-- Aporta lo que la Fase 6 toca y que vive en otros módulos:
--   · helpers de RBAC/MFA que crean migraciones fuera de la cadena contable
--   · las tablas de condominios que la fase EVOLUCIONA (ordenes_compra,
--     suministros_condominio + movimientos_suministro, obras_mejoras), tal como
--     están hoy en producción — con su texto libre y su RLS floja, para que el
--     backfill y el endurecimiento se prueben contra el estado real
--   · el padrón de prueba y los helpers de aserción
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helpers de otras migraciones ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_permission(p_key text)
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

-- 20260818000000: la puerta de escritura del módulo contable.
CREATE OR REPLACE FUNCTION public.conta_puede_escribir(p_action text)
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

-- 20260717020000: puerta MFA (las policies RESTRICTIVE la consultan).
CREATE OR REPLACE FUNCTION public.mfa_requirement_met()
  RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

-- ── Condominios · 20260420000037: órdenes de compra COMO ESTÁN HOY ──────────
CREATE TABLE IF NOT EXISTS public.ordenes_compra (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  correlativo   serial,
  proveedor_nombre text NOT NULL,
  concepto      text NOT NULL,
  descripcion   text,
  monto_estimado numeric(12,2),
  monto_real    numeric(12,2),
  fecha_entrega_esperada date,
  estado        text NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','aprobada','emitida','recibida','cancelada')),
  notas         text,
  created_by    uuid REFERENCES public.app_users(id),
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.ordenes_compra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ordenes_compra_select" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_select" ON public.ordenes_compra
  FOR SELECT USING (company_id = get_my_company_id());
DROP POLICY IF EXISTS "ordenes_compra_insert" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_insert" ON public.ordenes_compra
  FOR INSERT WITH CHECK (company_id = get_my_company_id());
DROP POLICY IF EXISTS "ordenes_compra_update" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_update" ON public.ordenes_compra
  FOR UPDATE USING (company_id = get_my_company_id());
DROP POLICY IF EXISTS "ordenes_compra_delete" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_delete" ON public.ordenes_compra
  FOR DELETE USING (company_id = get_my_company_id());

-- ── Condominios · 20260420000021: consumibles y sus movimientos ─────────────
CREATE TABLE IF NOT EXISTS public.suministros_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'limpieza',
  unidad_medida text NOT NULL DEFAULT 'unidad',
  stock_actual numeric(10,2) NOT NULL DEFAULT 0,
  stock_minimo numeric(10,2) NOT NULL DEFAULT 0,
  ubicacion text,
  proveedor text,
  costo_unitario numeric(10,4),
  notas text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suministros_condominio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suministros_all" ON public.suministros_condominio;
CREATE POLICY "suministros_all" ON public.suministros_condominio FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.movimientos_suministro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  suministro_id uuid NOT NULL REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'salida' CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad numeric(10,2) NOT NULL,
  motivo text,
  area_destino text,
  realizado_por text,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_suministro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movimientos_all" ON public.movimientos_suministro;
CREATE POLICY "movimientos_all" ON public.movimientos_suministro FOR ALL USING (true) WITH CHECK (true);

-- ── Condominios · 20260420000015: obras y mejoras ───────────────────────────
CREATE TABLE IF NOT EXISTS public.obras_mejoras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descripcion text,
  contratista text,
  monto_contrato numeric(12,2),
  estado text NOT NULL DEFAULT 'planificada',
  progreso int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.obras_mejoras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "obras_all" ON public.obras_mejoras;
CREATE POLICY "obras_all" ON public.obras_mejoras FOR ALL USING (true) WITH CHECK (true);

-- ── Padrón de prueba ────────────────────────────────────────────────────────
-- La empresa y el proyecto nacen ANTES de las migraciones 20260821*: así se
-- prueba el camino que de verdad importa en producción —la RETRO-siembra de las
-- cuentas nuevas sobre contabilidades que ya operaban—. El camino del trigger
-- (ledger nuevo) lo cubre la aserción 2 de assert.sql, que crea otra empresa
-- después.
INSERT INTO auth.users (id) VALUES
  ('99999999-9999-9999-9999-999999999999')
ON CONFLICT DO NOTHING;

INSERT INTO public.companies (id, nombre, default_currency) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ACME Administradora', 'gtq');

INSERT INTO public.projects (id, company_id, nombre, moneda) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Residencial Maya', 'Q');

-- Una orden de compra VIEJA, con el proveedor en texto libre y sin catálogo:
-- es la que el backfill de la parte B tiene que enganchar.
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_nombre, concepto, monto_estimado, estado)
VALUES ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'Ferretería La Esquina', 'Pintura para el muro perimetral', 1500.00, 'borrador');

INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida, stock_actual, costo_unitario)
VALUES ('44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'Cloro granular', 'saco', 4, 300.0000),
       ('44444444-4444-4444-4444-444444444445',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        'Sellador acrílico', 'galón', 0, NULL);

-- ── Helpers de aserción ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual numeric, esperado numeric, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

CREATE OR REPLACE FUNCTION public.chk_txt(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido "%", esperado "%"', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

-- Ejecuta un SQL que DEBE fallar con un error cuyo mensaje contenga `patron`.
-- Un guard que no se prueba es un guard que no existe: sin esto, un candado mal
-- escrito pasa por bueno porque "no dio error" — cuando el error era el punto.
CREATE OR REPLACE FUNCTION public.chk_falla(sql text, patron text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(patron IN SQLERRM) = 0 THEN
      RAISE EXCEPTION '❌ %  → falló, pero con "%" (se esperaba que contuviera "%")', msg, SQLERRM, patron;
    END IF;
    RAISE NOTICE 'OK    %', msg;
    RETURN;
  END;
  RAISE EXCEPTION '❌ %  → NO falló, y debía fallar con "%"', msg, patron;
END $$;

-- Saldo de una cuenta en los asientos PUBLICADOS (deudor positivo).
CREATE OR REPLACE FUNCTION public.saldo(p_codigo text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(l.debe - l.haber), 0)::numeric(14,2)
  FROM public.conta_asiento_lineas l
  JOIN public.conta_cuentas c ON c.id = l.cuenta_id
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  WHERE c.codigo = p_codigo AND a.estado = 'publicado'
$$;
