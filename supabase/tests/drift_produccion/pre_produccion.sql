-- ════════════════════════════════════════════════════════════════════════════
-- Deformar el esquema hasta la FORMA REAL DE PRODUCCIÓN
-- ════════════════════════════════════════════════════════════════════════════
-- El fixture de limpieza_catalogos monta el esquema tal como lo DECLARAN las
-- migraciones. Producción no es eso, y ahí está el incidente: el 2026-08-27 el
-- apply de la serie falló con 42703 porque `areas_condominio.activo` no existe
-- allí. Este archivo reproduce esa diferencia para poder probar contra ella.
--
-- La forma real se estableció comparando 20260424000059 contra
-- src/types/database.types.ts, que se genera con `npm run gen:db-types`
-- apuntando al proyecto de PRODUCCIÓN (nnsqmeigtgewatameexo). Allí
-- `areas_condominio` tiene ocho columnas —sin `activo`—, `icono`/`orden` son
-- nullable, y la única FK declarada es la de `project_id`.
--
-- Correr esto DESPUÉS del fixture: deforma un esquema ya poblado, igual que el
-- desfase se descubrió sobre una tabla con datos.

-- ── areas_condominio: la forma que reventó el apply ─────────────────────────
ALTER TABLE public.areas_condominio DROP COLUMN activo;

ALTER TABLE public.areas_condominio ALTER COLUMN icono DROP NOT NULL;
ALTER TABLE public.areas_condominio ALTER COLUMN icono DROP DEFAULT;
ALTER TABLE public.areas_condominio ALTER COLUMN orden DROP NOT NULL;
ALTER TABLE public.areas_condominio ALTER COLUMN orden DROP DEFAULT;

ALTER TABLE public.areas_condominio DROP CONSTRAINT areas_condominio_company_id_fkey;

-- Un área capturada con los huecos que la forma laxa permite: sirve para
-- comprobar que la reparación RELLENA en vez de limitarse a poner NOT NULL
-- (que fallaría contra estas filas).
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, icono, orden) VALUES
  ('a0000000-0000-0000-0000-00000000000e', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Gimnasio', NULL, NULL);

-- ── rutas_ronda: el mismo hueco, tal cual está en producción ────────────────
-- 20260424000059 la declara con `activo`; producción tampoco lo tiene. El
-- fixture de limpieza_catalogos no monta esta tabla (no la necesita), así que
-- se crea aquí con la forma real para que la reparación tenga qué reparar.
-- `rutas_ronda` la trae ahora el fixture compartido (la añadió 20260907000000
-- para poder colgar de ella un punto de control). Aquí sólo hace de andamio
-- para las FKs, así que sirve cualquiera de las dos formas y se conserva este
-- CREATE por si el fixture dejara de traerla.
CREATE TABLE IF NOT EXISTS public.rutas_ronda (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  project_id          uuid NOT NULL REFERENCES public.projects(id),
  nombre              text NOT NULL,
  descripcion         text,
  tiempo_estimado_min int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rutas_ronda (id, company_id, project_id, nombre) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Ronda nocturna');
