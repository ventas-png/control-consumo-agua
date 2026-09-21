-- Semilla: corre DESPUÉS de la migración porque usa las columnas que ella crea
-- (`punto_id`, `requiere_foto` en puntos_control_ruta).
--
-- Lo que se arma:
--   · P1 (proyecto A1) con dos áreas y tres puntos de catálogo: uno que exige
--     foto, dos que no.
--   · Una ruta de P1 con TRES paradas que cubren los tres casos de herencia
--     (hereda true, hereda false, override a true sobre un punto que no pide).
--   · Una parada LEGADA (punto_id NULL): lo que había antes del catálogo.
--   · Una ronda en curso con una visita pendiente por parada.
--   · Un área y una ruta del proyecto A2 (misma empresa) para el guard de
--     tenant.

-- ── Áreas ──────────────────────────────────────────────────────────────────
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, orden) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 'Estacionamiento B2', 0),
  ('c0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 'Piscina', 1),
  -- Área del OTRO proyecto de la misma empresa.
  ('c0000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a2222222-0000-0000-0000-000000000001', 'Lobby torre 2', 0);

-- ── Catálogo de puntos ─────────────────────────────────────────────────────
INSERT INTO public.puntos_verificacion
  (id, company_id, project_id, area_id, nombre, instrucciones, requiere_foto, orden) VALUES
  ('d0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000a1', 'Tablero eléctrico', 'Fotografiar el tablero cerrado', true, 0),
  ('d0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000a1', 'Puerta peatonal', 'Verificar candado', false, 1),
  ('d0000000-0000-0000-0000-0000000000f3', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000a2', 'Bomba de la piscina', NULL, false, 0),
  -- Punto del OTRO proyecto de la misma empresa.
  ('d0000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'a2222222-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000b1', 'Recepción', NULL, false, 0);

-- ── Rutas ──────────────────────────────────────────────────────────────────
INSERT INTO public.rutas_ronda (id, company_id, project_id, nombre) VALUES
  ('e0000000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 'Ronda nocturna'),
  ('e0000000-0000-0000-0000-000000000012', 'aaaaaaaa-0000-0000-0000-000000000001', 'a2222222-0000-0000-0000-000000000001', 'Ronda torre 2');

-- ── Paradas de la ruta nocturna ────────────────────────────────────────────
INSERT INTO public.puntos_control_ruta (id, ruta_id, area_id, punto_id, orden, requiere_foto, instrucciones) VALUES
  -- Hereda true del catálogo.
  ('f0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000f1', 0, NULL, 'Fotografiar el tablero cerrado'),
  -- Hereda false.
  ('f0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000f2', 1, NULL, 'Verificar candado'),
  -- Override a true sobre un punto que el catálogo no obliga.
  ('f0000000-0000-0000-0000-000000000023', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000f3', 2, true, NULL),
  -- LEGADA: sin punto del catálogo, como las que había antes de la migración.
  ('f0000000-0000-0000-0000-000000000029', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a2', NULL, 3, NULL, 'Revisar reja del fondo');

-- ── Ronda en curso con su checklist ────────────────────────────────────────
INSERT INTO public.rondas_seguridad (id, company_id, project_id) VALUES
  ('90000000-0000-0000-0000-000000000031', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001');

INSERT INTO public.visitas_control (id, ronda_id, punto_id) VALUES
  ('a0000000-0000-0000-0000-000000000041', '90000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-000000000021'),
  ('a0000000-0000-0000-0000-000000000042', '90000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-000000000022'),
  ('a0000000-0000-0000-0000-000000000043', '90000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-000000000023'),
  ('a0000000-0000-0000-0000-000000000049', '90000000-0000-0000-0000-000000000031', 'f0000000-0000-0000-0000-000000000029');
