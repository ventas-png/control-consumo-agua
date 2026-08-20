-- Fixtures del sandbox de recepción.
--
-- Van DESPUÉS de las migraciones, no antes: las columnas que usan (`clase`,
-- `destinatario_tipo`, `prioridad`) las añade 20260829000000. Sembrar primero
-- obligaría a inventarse la tabla ya generalizada, que es justo lo que este
-- sandbox dejó de hacer para no ocultar la contradicción del FK.
--
-- UNA empresa, DOS proyectos y DOS unidades vecinas del mismo proyecto: la
-- prueba negativa que importa es entre vecinos, no entre empresas. La empresa
-- ajena está solo para el control de tenant.

\set ON_ERROR_STOP on

\set emp   '''11111111-1111-1111-1111-111111111111'''
\set otra  '''22222222-2222-2222-2222-222222222222'''
\set proy  '''33333333-3333-3333-3333-333333333333'''
\set proyb '''33333333-3333-3333-3333-3333333333bb'''
\set proyc '''33333333-3333-3333-3333-3333333333cc'''

\set owner '''a0000000-0000-0000-0000-000000000001'''
\set admin '''a0000000-0000-0000-0000-000000000002'''
\set gcorr '''a0000000-0000-0000-0000-000000000003'''
\set gpaq  '''a0000000-0000-0000-0000-000000000004'''
\set gotro '''a0000000-0000-0000-0000-000000000005'''
\set gdeny '''a0000000-0000-0000-0000-000000000006'''
\set resa  '''a0000000-0000-0000-0000-00000000000a'''
\set resb  '''a0000000-0000-0000-0000-00000000000b'''
\set super '''a0000000-0000-0000-0000-000000000009'''
\set ajeno '''a0000000-0000-0000-0000-000000000008'''

INSERT INTO public.app_users (id, company_id, role, full_name) VALUES
  (:owner, :emp,  'company_owner', 'Dueña'),
  (:admin, :emp,  'admin',         'Administrador'),
  (:gcorr, :emp,  'operator',      'Recepción (correspondencia)'),
  (:gpaq,  :emp,  'operator',      'Guardia (paquetería)'),
  (:gotro, :emp,  'operator',      'Recepción de la otra torre'),
  (:gdeny, :emp,  'operator',      'Recepción con veto explícito'),
  (:resa,  :emp,  'cliente',       'Residente A-1'),
  (:resb,  :emp,  'cliente',       'Residente A-2'),
  (:super, :otra, 'super_admin',   'Soporte'),
  (:ajeno, :otra, 'admin',         'Admin de otra empresa');

\set rolcorr '''b0000000-0000-0000-0000-000000000001'''
\set rolpaq  '''b0000000-0000-0000-0000-000000000002'''
\set rolveto '''b0000000-0000-0000-0000-000000000003'''
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (:gcorr, :rolcorr), (:gpaq, :rolpaq), (:gotro, :rolcorr),
  -- `gdeny` acumula el rol que CONCEDE correspondencia y otro que la NIEGA.
  -- Es el caso que distingue "deny vence a allow" de "basta un allow".
  (:gdeny, :rolcorr), (:gdeny, :rolveto);
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (:rolcorr, 'condominios.tab.correspondencia', 'allow'),
  (:rolpaq,  'condominios.tab.paqueteria',      'allow'),
  (:rolveto, 'condominios.tab.correspondencia', 'deny');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  (:proy, :emp, 'Torre Norte'), (:proyc, :emp, 'Torre Sur'), (:proyb, :otra, 'Proyecto ajeno');

-- El alcance por proyecto es parte del gate: `gotro` tiene el MISMO permiso que
-- `gcorr` pero otra torre.
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  (:gcorr, :proy), (:gpaq, :proy), (:gotro, :proyc), (:gdeny, :proy);

\set unia  '''d0000000-0000-0000-0000-00000000000a'''
\set unib  '''d0000000-0000-0000-0000-00000000000b'''
\set unisin '''d0000000-0000-0000-0000-00000000000c'''
INSERT INTO public.unidades (id, company_id, project_id, nombre, cliente_id) VALUES
  (:unia,   :emp, :proy, 'A-1', :resa),
  (:unib,   :emp, :proy, 'A-2', :resb),
  -- Sin historial de recepción: la única que se puede borrar.
  (:unisin, :emp, :proy, 'A-3', NULL);

\set corr_a   '''c0000000-0000-0000-0000-00000000000a'''
\set corr_b   '''c0000000-0000-0000-0000-00000000000b'''
\set corr_adm '''c0000000-0000-0000-0000-00000000000c'''
\set paq_a    '''c0000000-0000-0000-0000-00000000000d'''
\set corr_ajena '''c0000000-0000-0000-0000-0000000000ff'''

INSERT INTO public.paquetes_recibidos
  (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo, descripcion, destinatario)
VALUES
  (:corr_a,   :emp, :proy, :unia, 'correspondencia', 'unidad',         'notificacion_legal', 'Citación para A-1', 'Ana Pérez'),
  (:corr_b,   :emp, :proy, :unib, 'correspondencia', 'unidad',         'carta',              'Carta para A-2',    'Bruno Díaz'),
  (:corr_adm, :emp, :proy, NULL,  'correspondencia', 'administracion', 'notificacion_legal', 'Citación municipal', NULL),
  (:paq_a,    :emp, :proy, :unia, 'paquete',         'unidad',         'paquete',            'Caja para A-1',     NULL),
  -- De la OTRA empresa: para probar que no se puede colgar evidencia de su id.
  (:corr_ajena, :otra, :proyb, NULL, 'correspondencia', 'administracion', 'carta', 'Carta de otra empresa', NULL);

-- ── Objetos del bucket ──────────────────────────────────────────────────────
-- `owner` = el operador de correspondencia, que es quien los sube en la app.
-- Los dos primeros están REFERENCIADOS por su pieza (son prueba); los `e*` son
-- huérfanos (descartes de formulario o firmas cuya RPC falló).
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/firma.png',
   :gcorr, '{"mimetype":"image/png"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/sobre.jpg',
   :gcorr, '{"mimetype":"image/jpeg"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000c/citacion.jpg',
   :gcorr, '{"mimetype":"image/jpeg"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000d/paquete.jpg',
   :gpaq, '{"mimetype":"image/jpeg"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000e1/borrador.jpg',
   :gcorr, '{"mimetype":"image/jpeg"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000e2/ajeno.jpg',
   :gpaq, '{"mimetype":"image/jpeg"}'::jsonb);

-- Las tres evidencias que SÍ cuelgan de su pieza. Sin esto, el guard de
-- "huérfano propio" las dejaría borrar y las pruebas de inmutabilidad no
-- probarían nada.
UPDATE public.paquetes_recibidos SET firma_path =
  '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/firma.png'
 WHERE id = :corr_a;
UPDATE public.paquetes_recibidos SET fotos = ARRAY[
  '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/sobre.jpg']
 WHERE id = :corr_b;
UPDATE public.paquetes_recibidos SET fotos = ARRAY[
  '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000c/citacion.jpg']
 WHERE id = :corr_adm;
UPDATE public.paquetes_recibidos SET fotos = ARRAY[
  '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000d/paquete.jpg']
 WHERE id = :paq_a;

-- Firma candidata para el acuse de A-2: subida por el operador de
-- correspondencia, en la ruta correcta y todavía huérfana.
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-b.png',
   :gcorr, '{"mimetype":"image/png"}'::jsonb),
  -- Misma ruta correcta pero subida por OTRO empleado.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-de-otro.png',
   :gpaq, '{"mimetype":"image/png"}'::jsonb);

-- ── Firmas para los casos de MIME (hallazgo C) ──────────────────────────────
-- Todas cuelgan de la ruta CORRECTA de `corr_b`, las sube el operador de
-- correspondencia y llevan extensión de imagen: lo ÚNICO que las distingue es
-- el `mimetype` que Storage guardó en `metadata`. Así, si alguna pasa, el
-- motivo no puede ser otro que el predicado del MIME.
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  -- metadata ausente por completo. El COALESCE anterior la daba por PNG.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/mime-nulo.png',
   :gcorr, NULL),
  -- metadata presente pero SIN la clave `mimetype`.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/mime-sin-clave.png',
   :gcorr, '{"size":2048,"cacheControl":"3600"}'::jsonb),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/mime-octeto.png',
   :gcorr, '{"mimetype":"application/octet-stream"}'::jsonb),
  -- SVG: pasaba el LIKE 'image/%' y no es una imagen inerte.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/mime-svg.png',
   :gcorr, '{"mimetype":"image/svg+xml"}'::jsonb),
  -- Extensión de imagen y MIME prohibido: la extensión la elige quien sube.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/enganosa.jpg',
   :gcorr, '{"mimetype":"text/html"}'::jsonb),
  -- Control POSITIVO: sin él, "todo rechazado" también pasaría el bloque.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-b.webp',
   :gcorr, '{"mimetype":"image/webp"}'::jsonb);
