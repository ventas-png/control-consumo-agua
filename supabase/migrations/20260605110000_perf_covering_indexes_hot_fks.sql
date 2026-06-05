-- ============================================================================
-- Índices de cobertura para FKs CALIENTES (Track T8/QA · banda de perf)
-- ============================================================================
-- Banda: 20260605, horas 10–13 reservadas para esta sesión (ver el "por qué" del
-- timestamp en 20260605100000_perf_rls_initplan_and_permissive.sql). Sortea
-- después del último mergeado (…0604300000); lejos de la banda 14–15 de Ops.
--
-- POR QUÉ: get_advisors(performance) reporta 260 unindexed_foreign_keys (nivel
-- INFO). NO se agregan los 260 a ciegas. Esta migración cubre SOLO las 11 FKs de
-- las tablas de alto tráfico señaladas por el track (contadores, cuotas_condominio,
-- recargos_mora, user_invitations). Una FK sin índice obliga a un seq-scan de la
-- tabla hija cada vez que se borra/actualiza-PK una fila PADRE (chequeo de la
-- restricción). Aquí los padres SÍ se borran en operaciones reales:
--   • delete-user (edge function) borra app_users → chequea *_by / accepted_user_id
--     / invited_by / updated_by en cada tabla hija.
--   • baja de project / tarifa / company (offboarding/limpieza) → chequea
--     company_id / project_id / tarifa_id / pago_id.
-- Sin estos índices, borrar 1 usuario/proyecto hace seq-scan O(n) sobre tablas
-- calientes.
--
-- ⚠️ TENSIÓN CONOCIDA (deliberada, documentada): la migración
-- 20260417000015_fix_indexes_drop_unused_add_fk.sql DROP-eó EXACTAMENTE
-- idx_contadores_{company_id,project_id,tarifa_id,updated_by} por estar en
-- idx_scan=0 (no usados por queries de LECTURA). Se re-agregan aquí a conciencia
-- porque el costo que importa NO es el de lectura sino el del CHEQUEO de FK al
-- borrar el padre (que idx_scan no refleja hasta que ocurre un borrado). Efecto
-- secundario esperado: el advisor unused_index (INFO) puede volver a listarlos
-- hasta que haya tráfico de borrado de padres — es aceptable para cobertura de FK.
-- Si se observa amplificación de escritura problemática en contadores, revertir
-- es seguro (ver abajo).
--
-- Estilo: plain b-tree con IF NOT EXISTS, igual que la sección "Add missing FK
-- indexes" de 20260417000015. Idempotente.
--
-- CÓMO REVERTIR: DROP INDEX IF EXISTS sobre cada idx_* creado abajo.
--
-- VALIDACIÓN: NO apply_migration a prod. Validar en el preview branch del PR.
-- cuotas_condominio es facturación: respetar el checklist de migrations/README.md
-- (validar contra preview; CREATE INDEX toma lock SHARE breve — tablas chicas en
-- preview, en prod considerar CONCURRENTLY al aplicar fuera de transacción).
-- ============================================================================

-- contadores (agua) — FKs a companies / projects / tarifas / app_users
CREATE INDEX IF NOT EXISTS idx_contadores_company_id
  ON public.contadores (company_id);
CREATE INDEX IF NOT EXISTS idx_contadores_project_id
  ON public.contadores (project_id);
CREATE INDEX IF NOT EXISTS idx_contadores_tarifa_id
  ON public.contadores (tarifa_id);
CREATE INDEX IF NOT EXISTS idx_contadores_updated_by
  ON public.contadores (updated_by);

-- cuotas_condominio (facturación condominios) — FKs a companies / app_users / pagos
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_company_id
  ON public.cuotas_condominio (company_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_created_by
  ON public.cuotas_condominio (created_by);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_deleted_by
  ON public.cuotas_condominio (deleted_by);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_pago_id
  ON public.cuotas_condominio (pago_id);

-- recargos_mora (mora agua) — FK a companies
CREATE INDEX IF NOT EXISTS idx_recargos_mora_company_id
  ON public.recargos_mora (company_id);

-- user_invitations (plataforma) — FKs a app_users (invitador / usuario aceptante)
CREATE INDEX IF NOT EXISTS idx_user_invitations_accepted_user_id
  ON public.user_invitations (accepted_user_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_invited_by
  ON public.user_invitations (invited_by);
