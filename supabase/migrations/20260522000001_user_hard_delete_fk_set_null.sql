-- Permite eliminar definitivamente un usuario de la empresa (auth.users + app_users)
-- sin que las claves foráneas de auditoría bloqueen el borrado ni destruyan datos
-- de negocio.
--
-- Hoy varias FK "creado_por / actualizado_por / verificado_por / asignado_a /
-- publicado_por" son ON DELETE NO ACTION (bloquean el borrado del usuario) o
-- apuntan a columnas NOT NULL con SET NULL / CASCADE (fallarían o borrarían el
-- registro). Las pasamos todas a ON DELETE SET NULL: los registros (pagos,
-- contadores, tarifas, unidades, clientes, anuncios, etc.) se conservan intactos;
-- solo se limpia el vínculo "quién" cuando ese usuario se elimina.
--
-- Se conservan tal cual (correctas):
--   user_roles.user_id            -> CASCADE  (limpia las asignaciones de rol)
--   password_reset_tokens.user_id -> CASCADE  (limpia tokens del usuario)

-- ── 1) Columnas NOT NULL que deben permitir NULL para poder usar SET NULL ──────
ALTER TABLE public.anuncios_comunidad ALTER COLUMN publicado_por DROP NOT NULL;
ALTER TABLE public.revisiones_tarea   ALTER COLUMN revisado_por  DROP NOT NULL;

-- ── 2) FKs hacia public.app_users ─────────────────────────────────────────────
ALTER TABLE public.asambleas_digital  DROP CONSTRAINT IF EXISTS asambleas_digital_created_by_fkey;
ALTER TABLE public.asambleas_digital  ADD  CONSTRAINT asambleas_digital_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.eventos_calendario DROP CONSTRAINT IF EXISTS eventos_calendario_created_by_fkey;
ALTER TABLE public.eventos_calendario ADD  CONSTRAINT eventos_calendario_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.ordenes_compra     DROP CONSTRAINT IF EXISTS ordenes_compra_created_by_fkey;
ALTER TABLE public.ordenes_compra     ADD  CONSTRAINT ordenes_compra_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL;

ALTER TABLE public.revisiones_tarea   DROP CONSTRAINT IF EXISTS revisiones_tarea_revisado_por_fkey;
ALTER TABLE public.revisiones_tarea   ADD  CONSTRAINT revisiones_tarea_revisado_por_fkey
  FOREIGN KEY (revisado_por) REFERENCES public.app_users(id) ON DELETE SET NULL;

-- anuncios_comunidad.publicado_por tiene DOS FKs sobre la misma columna: una a
-- app_users (ya SET NULL) y otra a auth.users (CASCADE, borraría el anuncio).
-- La de auth.users pasa a SET NULL para preservar el anuncio.
ALTER TABLE public.anuncios_comunidad DROP CONSTRAINT IF EXISTS anuncios_comunidad_publicado_por_fkey;
ALTER TABLE public.anuncios_comunidad ADD  CONSTRAINT anuncios_comunidad_publicado_por_fkey
  FOREIGN KEY (publicado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 3) FKs hacia auth.users (módulo Agua, pagos y operación) ──────────────────
ALTER TABLE public.bloques_turno        DROP CONSTRAINT IF EXISTS bloques_turno_creado_por_fkey;
ALTER TABLE public.bloques_turno        ADD  CONSTRAINT bloques_turno_creado_por_fkey
  FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.clientes             DROP CONSTRAINT IF EXISTS clientes_updated_by_fkey;
ALTER TABLE public.clientes             ADD  CONSTRAINT clientes_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.company_clientes     DROP CONSTRAINT IF EXISTS company_clientes_added_by_fkey;
ALTER TABLE public.company_clientes     ADD  CONSTRAINT company_clientes_added_by_fkey
  FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.contadores           DROP CONSTRAINT IF EXISTS contadores_updated_by_fkey;
ALTER TABLE public.contadores           ADD  CONSTRAINT contadores_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.convenios_pago       DROP CONSTRAINT IF EXISTS convenios_pago_created_by_fkey;
ALTER TABLE public.convenios_pago       ADD  CONSTRAINT convenios_pago_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.empresa_pagos_config DROP CONSTRAINT IF EXISTS empresa_pagos_config_configured_by_fkey;
ALTER TABLE public.empresa_pagos_config ADD  CONSTRAINT empresa_pagos_config_configured_by_fkey
  FOREIGN KEY (configured_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pagos                DROP CONSTRAINT IF EXISTS pagos_created_by_fkey;
ALTER TABLE public.pagos                ADD  CONSTRAINT pagos_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pagos                DROP CONSTRAINT IF EXISTS pagos_verified_by_fkey;
ALTER TABLE public.pagos                ADD  CONSTRAINT pagos_verified_by_fkey
  FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.registros_calidad    DROP CONSTRAINT IF EXISTS registros_calidad_created_by_fkey;
ALTER TABLE public.registros_calidad    ADD  CONSTRAINT registros_calidad_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.rutas                DROP CONSTRAINT IF EXISTS rutas_asignado_a_fkey;
ALTER TABLE public.rutas                ADD  CONSTRAINT rutas_asignado_a_fkey
  FOREIGN KEY (asignado_a) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tarifas              DROP CONSTRAINT IF EXISTS tarifas_updated_by_fkey;
ALTER TABLE public.tarifas              ADD  CONSTRAINT tarifas_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.unidades             DROP CONSTRAINT IF EXISTS unidades_updated_by_fkey;
ALTER TABLE public.unidades             ADD  CONSTRAINT unidades_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
