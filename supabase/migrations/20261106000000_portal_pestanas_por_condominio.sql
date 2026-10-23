-- ════════════════════════════════════════════════════════════════════════════
-- Portal del residente: la empresa decide qué pestañas ve el cliente en el
-- portal de cada condominio.
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ HACE
--   projects.portal_tabs_ocultos text[] NOT NULL DEFAULT '{}' — las pestañas
--   APAGADAS del portal en ese condominio. Se guarda la lista de apagadas (y no
--   la de encendidas) a propósito:
--     · los condominios que ya existen siguen viendo todo, sin backfill;
--     · una pestaña nueva del portal nace visible: nadie tiene que acordarse de
--       encenderla en cada condominio.
--   CHECK: sólo ids del portal (espejo de PORTAL_TABS_CONFIGURABLES en
--   src/lib/portalTabs.ts) y NUNCA 'mi_unidad': es la pestaña de aterrizaje y a
--   la que el portal vuelve cuando la activa deja de estar permitida. Agregar
--   una pestaña al portal exige ampliar este CHECK en una migración nueva; la
--   prueba src/__tests__/portalPestanasMigracion.test.ts falla si las dos listas
--   se separan.
--
-- QUIÉN LA ESCRIBE Y QUIÉN LA LEE
--   Ninguna policy nueva.
--   · Escribe projects_update, que ya limita a super_admin y a company_owner /
--     admin de la empresa del proyecto: el propietario de la empresa (y su
--     administrador) prende y apaga; el personal del condominio no.
--   · Lee el residente por la rama 'cliente' de projects_select (empresa vía
--     company_clientes): la misma por la que el portal ya lee moneda y empresa.
--
-- QUÉ NO ES
--   No es un candado de datos. Apagar una pestaña la saca de la navegación del
--   portal; qué filas ve o escribe el residente lo sigue decidiendo el RLS de
--   cada tabla, igual que antes.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS y el CHECK se recrea.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS portal_tabs_ocultos text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_portal_tabs_ocultos_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_portal_tabs_ocultos_check CHECK (
    portal_tabs_ocultos <@ ARRAY[
      'reservas', 'cuenta', 'tickets', 'visitantes', 'paquetes', 'correspondencia',
      'anuncios', 'asambleas', 'transparencia', 'rentas', 'mudanza', 'mascotas',
      'vehiculos'
    ]::text[]
  );

COMMENT ON COLUMN public.projects.portal_tabs_ocultos IS
  'Pestañas del portal del residente APAGADAS en este condominio (ids de PORTAL_TABS en src/lib/portalTabs.ts). Vacío = el portal muestra todas las que el rol del residente permite. Nunca incluye mi_unidad. La escribe el propietario/administrador de la empresa (projects_update).';
