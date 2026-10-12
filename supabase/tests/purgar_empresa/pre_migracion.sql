-- ════════════════════════════════════════════════════════════════════════════
-- Se aplica ANTES de 20261030000000: siembra lo que su limpieza previa tiene
-- que arreglar para que las llaves nuevas validen. Es la forma que se midió en
-- producción el 2026-10-12 (2 conversaciones con un cliente ya borrado) más un
-- caso que puede aparecer antes del despliegue (filas de una empresa purgada
-- por 20261029000100 en tablas que todavía no tenían llave).
--
--   P  «Preexistente»: su conversación apunta a un cliente que ya no existe
--      → la conversación se conserva con cliente_id NULL.
--   Una difusión y una conversación de una empresa que ya no existe
--      → se borran.
-- Sin la limpieza, ADD CONSTRAINT falla y la migración no aplica: así muere su
-- mutante en run.sh.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

INSERT INTO public.companies (id, nombre, activa) VALUES
  ('e5000000-0000-4000-8000-000000000005', 'Preexistente', true);

INSERT INTO public.conversations (id, company_id, cliente_id, subject) VALUES
  ('95000000-0000-4000-8000-0000000000c1', 'e5000000-0000-4000-8000-000000000005',
   '95000000-0000-4000-8000-00000000dead', 'Cliente ya borrado'),
  ('95000000-0000-4000-8000-0000000000c2', '95000000-0000-4000-8000-0000000dea1e',
   NULL, 'Empresa ya purgada');

INSERT INTO public.broadcasts (id, company_id, title, body, sent_by_id, sent_by_name, target_type) VALUES
  ('95000000-0000-4000-8000-0000000000d1', '95000000-0000-4000-8000-0000000dea1e',
   'Aviso de una empresa ya purgada', '…', '95000000-0000-4000-8000-0000000dea1e', '—', 'todos');
