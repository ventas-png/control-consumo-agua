-- ============================================================================
-- Lecturas heredadas: sellar `registros.project_id`
-- ============================================================================
-- Hallazgo al verificar 20260815000000 contra los datos reales del tenant: el
-- alcance por proyecto de `registros_select` ya funciona para las lecturas
-- selladas, pero 1 951 lecturas (de 4 768) se guardaron SIN `project_id` —todas
-- anteriores al 2026-03-28; desde entonces la app lo sella siempre—. Como una
-- fila sin proyecto es AMBIGUA por convención (`can_access_project(NULL)` →
-- true, ver la cabecera de 20260815000000), esas 1 951 seguían viajando al
-- navegador de cualquier usuario de la empresa: un usuario acotado a un
-- condominio recibía las lecturas heredadas de todos los demás.
--
-- No son ambiguas de verdad: 1 948 llevan `contador_id`, y el contador SÍ tiene
-- `project_id` NOT NULL — el proyecto de una lectura es, por definición, el del
-- medidor del que se tomó. Sellarlas es a la vez la corrección del dato y el
-- cierre del hueco: la policy pasa a hacer coincidencia exacta y la RPC
-- `agua_anomalias_consumo` (que hace JOIN por project_id) empieza a ver ese
-- histórico, hoy invisible para la detección de fugas.
--
-- Cobertura medida en producción antes de escribir esta migración:
--   · 1 948 se sellan por su contador;
--   ·     1 se sella por su cliente (vive en un único proyecto);
--   ·     2 quedan sin sellar (ni contador ni cliente resoluble) → siguen
--         siendo visibles para la empresa, que es la regla de ambigüedad.
--
-- POR QUÉ ES SEGURO ESCRIBIR ESTAS FILAS (triggers de `registros` revisados):
--   · trg_sellar_creado_por  → en UPDATE restaura el valor ANTERIOR de
--     `creado_por`: la trazabilidad de quién capturó la lectura no se toca.
--   · trg_bitacora           → `registrar_bitacora` sale temprano cuando
--     `auth.uid()` es NULL (una migración no tiene JWT), así que el backfill NO
--     inunda la bitácora con 1 949 "ediciones".
--   · trg_conta_registros    → solo dispara en UPDATE OF factura_estado /
--     mora_monto; aquí únicamente cambia `project_id`.
--   · trg_enforce_write_active_registros → solo aplica a `authenticated`.
--
-- IMPACTO EN DATOS: rellena una columna que estaba NULL. No cambia consumos,
-- montos, estados ni fechas.
--
-- CÓMO REVERTIR: no hay vuelta atrás fila a fila (el NULL previo no se guarda
-- en ningún sitio), y devolverlo sería reabrir el hueco. Si hiciera falta
-- deshacerlo, el criterio es reproducible: `project_id` = el del contador de la
-- lectura. El trigger del paso 3 se quita con
-- DROP TRIGGER trg_registros_project_id ON public.registros.

-- ── 1. Pasada principal: el proyecto del contador ───────────────────────────
UPDATE public.registros r
   SET project_id = c.project_id
  FROM public.contadores c
 WHERE r.project_id IS NULL
   AND r.contador_id = c.id
   AND c.project_id IS NOT NULL;

-- ── 2. Pasada secundaria: lecturas sin contador ─────────────────────────────
-- Se derivan del cliente, y SOLO cuando vive en un único proyecto (misma regla
-- que el backfill de conversaciones en 20260814000000): si cruza varios, la
-- elección sería arbitraria y es preferible dejarla ambigua que encerrarla en el
-- proyecto equivocado.
WITH cliente_proyecto AS (
  SELECT cliente_id, MIN(project_id::text)::uuid AS project_id
    FROM (
      SELECT u.cliente_id, u.project_id
        FROM public.unidades u
       WHERE u.cliente_id IS NOT NULL AND u.project_id IS NOT NULL
      UNION
      SELECT r.cliente_id, r.project_id
        FROM public.registros r
       WHERE r.cliente_id IS NOT NULL AND r.project_id IS NOT NULL
    ) s
   GROUP BY cliente_id
  HAVING COUNT(DISTINCT project_id) = 1
)
UPDATE public.registros r
   SET project_id = cp.project_id
  FROM cliente_proyecto cp
 WHERE r.project_id IS NULL
   AND r.cliente_id = cp.cliente_id;

-- ── 3. Que el backlog no se vuelva a formar ─────────────────────────────────
-- Hoy la UI sella `project_id` en cada lectura nueva, pero es un invariante que
-- vive en el cliente: cualquier ruta de escritura que lo olvide (importador,
-- sync offline, edge function futura) volvería a crear filas ambiguas, y con
-- ellas el hueco que esta migración cierra. El trigger lo deriva del contador
-- cuando falta — no pisa nunca un valor explícito.
CREATE OR REPLACE FUNCTION public.set_registros_project_id()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.project_id IS NULL AND NEW.contador_id IS NOT NULL THEN
    SELECT c.project_id INTO NEW.project_id
      FROM public.contadores c WHERE c.id = NEW.contador_id;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.set_registros_project_id() IS
  'Sella registros.project_id desde el contador cuando la escritura no lo trae. Mantiene el invariante del alcance por proyecto (20260815000000).';

-- BEFORE INSERT únicamente: en UPDATE, un `project_id` puesto a NULL a propósito
-- no debe rellenarse a espaldas de quien lo hizo.
--
-- El prefijo `a_` del nombre NO es decorativo: Postgres dispara los triggers de
-- un mismo evento en orden ALFABÉTICO, y así éste corre antes que
-- `trg_enforce_write_active_registros`, que lee `NEW.project_id` para resolver
-- la empresa y saltarse el chequeo cuando viene NULL. Sellando primero, una
-- lectura sin proyecto explícito deja de esquivar el guard de empresa
-- suspendida / suscripción vencida.
DROP TRIGGER IF EXISTS trg_registros_project_id ON public.registros;
DROP TRIGGER IF EXISTS trg_a_registros_project_id ON public.registros;
CREATE TRIGGER trg_a_registros_project_id
  BEFORE INSERT ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.set_registros_project_id();
