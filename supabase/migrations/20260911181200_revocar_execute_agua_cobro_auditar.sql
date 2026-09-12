-- ════════════════════════════════════════════════════════════════════════════
-- `agua_cobro_auditar` es un HELPER INTERNO, y estaba concedido a `authenticated`
-- ════════════════════════════════════════════════════════════════════════════
-- 20260910235732 la creó con:
--
--   REVOKE EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb)
--     FROM PUBLIC, anon;
--   GRANT  EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb)
--     TO authenticated;
--
-- El GRANT no hacía falta y no debió escribirse. La función no es una RPC: es el
-- escritor de `security_logs` que usan por dentro las seis transiciones de cobro.
-- Nadie de fuera tiene por qué poder invocarla.
--
-- ── POR QUÉ NO BASTABA LA LLAVE ─────────────────────────────────────────────
-- El cuerpo exige `agua.cobro_autoritativo = 'on'` y aborta con 42501 si no lo
-- está, así que una llamada suelta desde la Data API hoy no escribe nada. Eso
-- hace que el agujero no sea explotable POR AHORA — no que el GRANT esté bien.
-- La diferencia importa: con el GRANT puesto, la única cosa que separa a un
-- cliente de fabricar una fila de auditoría es el VALOR de un GUC. Cualquier
-- camino futuro que deje esa llave encendida mientras el cliente aún puede
-- emitir sentencias convierte un helper interno en un falsificador de bitácora,
-- y el log de auditoría es justo lo que no se puede permitir que mienta.
--
-- Defensa en profundidad quiere decir que la llave Y la ACL tienen que fallar
-- las dos para que se cuele algo. Aquí sólo estaba la llave.
--
-- ── POR QUÉ REVOCAR NO ROMPE A NADIE ────────────────────────────────────────
-- Las seis que la llaman son SECURITY DEFINER:
--
--   agua_factura_emitir · agua_factura_anular · agua_factura_registrar_pago
--   agua_registro_marcar_mora · agua_registro_cambiar_estado
--   agua_registro_acreditar_pago_externo
--
-- (y `conciliar_pago_externo`, que llega por la última). Una SECURITY DEFINER
-- corre como su DUEÑO, y el dueño es el mismo que el de `agua_cobro_auditar`.
-- El dueño conserva su privilegio implícito sobre sus propias funciones: la ACL
-- de un rol de API no interviene en la llamada anidada. Por eso se revoca a los
-- CUATRO —PUBLIC, anon, authenticated, service_role— y no se concede a ninguno.
--
-- `service_role` entra en la lista aunque hoy ya no lo tenga (lo perdió al
-- revocarle PUBLIC 20260910235732): declararlo es lo que convierte «no lo tiene»
-- en «no puede tenerlo por accidente», y es lo que la prueba comprueba.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- Las RPC públicas de cobro SIGUEN concedidas a `authenticated`: son la API del
-- módulo y su autorización es su guard de permiso, no su ACL. Cerrarlas sería
-- romper el producto para callar un aviso.
--
-- REVERSIÓN
--   GRANT EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb)
--     TO authenticated;   -- (volvería a abrir lo que este archivo cierra)
--
-- Idempotente: REVOKE sobre un privilegio ausente es un no-op.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb) IS
  'Escribe en security_logs el rastro de una transición de cobro de agua. Helper INTERNO: ningún rol de API lo ejecuta (20260911181200 revocó el GRANT a authenticated que traía 20260910235732). Lo llaman las seis RPC de cobro, que son SECURITY DEFINER y por tanto corren como el dueño. Además exige la llave agua.cobro_autoritativo, que esas RPC encienden tras validar el permiso: hacen falta las dos cosas, la ACL y la llave.';

-- ── Autoverificación ────────────────────────────────────────────────────────
-- Una migración de ACL que no comprueba la ACL resultante es una declaración de
-- intenciones. Se mira celda por celda con has_function_privilege, que es lo que
-- de verdad decide en tiempo de ejecución, y no el texto del GRANT.
DO $$
DECLARE
  v_fn  constant regprocedure := 'public.agua_cobro_auditar(uuid, text, jsonb)'::regprocedure;
  v_rol text;
  v_api text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    -- Un rol ausente no es un fallo: los entornos de prueba no siempre los
    -- traen. Lo que no se tolera es que EXISTA y pueda ejecutar.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol)
       AND has_function_privilege(v_rol, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION
        '20260911181200: % conserva EXECUTE sobre agua_cobro_auditar — es un helper interno', v_rol
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF has_function_privilege('public', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION
      '20260911181200: PUBLIC conserva EXECUTE sobre agua_cobro_auditar'
      USING ERRCODE = '42501';
  END IF;

  -- Y el contrapunto, para que esto no se convierta en «revocar hasta que no
  -- quede nada»: las RPC públicas de cobro TIENEN que seguir siendo ejecutables
  -- por authenticated. Si una de ellas cayera de rebote, el módulo deja de
  -- funcionar y nadie se entera hasta producción.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH v_api IN ARRAY ARRAY[
      'public.agua_factura_emitir(uuid)',
      'public.agua_factura_anular(uuid, text)',
      'public.agua_factura_registrar_pago(uuid, numeric, date)',
      'public.agua_registro_marcar_mora(uuid[])',
      'public.agua_registro_cambiar_estado(uuid, text)'
    ] LOOP
      IF to_regprocedure(v_api) IS NULL THEN
        RAISE EXCEPTION
          '20260911181200: no existe %, que debería ser una RPC de cobro viva', v_api
          USING ERRCODE = '42883';
      END IF;
      IF NOT has_function_privilege('authenticated', to_regprocedure(v_api), 'EXECUTE') THEN
        RAISE EXCEPTION
          '20260911181200: la revocación se llevó por delante %, que es API', v_api
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
END $$;
