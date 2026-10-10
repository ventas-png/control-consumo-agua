#!/usr/bin/env python3
"""Genera sandbox_housekeeping.sql a partir de assert.sql y lib.sql (una sola fuente de aserciones).

El sandbox (`control-agua-rls-sandbox`) solo admite la herramienta SQL: no hay psql, ni \\i, ni varias
sentencias con sesiones. Por eso el guion es UNA sentencia DO que TERMINA SIEMPRE con una excepción para
REVERTIR todo (DDL incluido: el esquema `hkt` y sus tablas no sobreviven):
    GUION_OK_REVERTIDO  → todas las comprobaciones coinciden
    GUION_FALLO         → alguna no coincide (el mensaje lista cuáles)
    GUION_ABORTA        → no se pudo montar el padrón; no se escribió nada
Diferencias con el PostgreSQL desechable, y por qué:
  · el JWT se fija con `request.jwt.claim.sub` (lo que lee auth.uid() de Supabase), no con `app.uid`;
  · los permisos salen del RBAC real (roles / role_permissions / user_roles), no de `test_permisos`;
  · sin residente (necesita `unidades` reales) → se omiten A9, B6 y C7;
  · sin la cascada de PROYECTO (G32): borrar un proyecto arrastra decenas de tablas del sandbox;
  · la concurrencia real (dos sesiones) no cabe en una sentencia: se prueba solo en el PostgreSQL desechable.
Uso: python3 generar_guion_sandbox.py > sandbox_housekeeping.sql
"""
import re, sys, pathlib

aqui = pathlib.Path(__file__).parent
asr = (aqui / 'assert.sql').read_text()
lib = (aqui / 'lib.sql').read_text()

# ── lib: mismas ayudas, con el JWT de Supabase y resultados acumulados en vez de excepción ──
lib = lib.replace('app.uid', 'request.jwt.claim.sub')
lib = lib.replace('CREATE SCHEMA IF NOT EXISTS hkt;', 'CREATE SCHEMA hkt;')
ok_old = lib[lib.index('CREATE OR REPLACE FUNCTION hkt.ok'):lib.index('-- Cambia de persona')]
ok_new = '''CREATE TABLE hkt.res (n serial PRIMARY KEY, ok boolean NOT NULL, txt text NOT NULL);
GRANT ALL ON hkt.res TO PUBLIC;
GRANT USAGE ON SEQUENCE hkt.res_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION hkt.ok(p_lbl text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hkt.res (ok, txt) VALUES (coalesce(p_cond, false), p_lbl);
END $$;

'''
lib = lib.replace(ok_old, ok_new)

# ── padrón del sandbox: tablas reales ──
datos = '''
IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (hkt.ca(), hkt.cb())) THEN
  RAISE EXCEPTION 'GUION_ABORTA: las empresas de prueba ya existen; no se escribe nada.';
END IF;
IF to_regclass('public.servicio_housekeeping_fotos') IS NULL OR to_regprocedure('public.hk_acceso(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'GUION_ABORTA: la migración 20261028000000_housekeeping_evidencias NO está aplicada en este proyecto.';
END IF;
IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias') <> 0
   OR (SELECT count(*) FROM public.servicio_housekeeping_fotos) <> 0 THEN
  RAISE EXCEPTION 'GUION_ABORTA: el bucket o la tabla de fotos ya tienen datos; las comprobaciones de conteo no serían atribuibles.';
END IF;
ALTER TABLE public.servicios_housekeeping ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;   -- se revierte con todo lo demás
INSERT INTO public.companies (id, nombre, default_currency) VALUES (hkt.ca(), 'ZZ HK Empresa A', 'gtq'), (hkt.cb(), 'ZZ HK Empresa B', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES
  (hkt.pa1(), hkt.ca(), 'ZZ HK A1'), (hkt.pa2(), hkt.ca(), 'ZZ HK A2'), (hkt.pb1(), hkt.cb(), 'ZZ HK B1');
INSERT INTO auth.users (id) SELECT hkt.uid(n) FROM generate_series(1, 7) n;
INSERT INTO public.app_users (id, company_id, full_name, role, project_id) VALUES
  (hkt.uid(1), hkt.ca(), 'ZZ HK Owner A',        'company_owner', NULL),
  (hkt.uid(2), hkt.ca(), 'ZZ HK Admin A (PA1)',  'admin',         NULL),
  (hkt.uid(3), hkt.ca(), 'ZZ HK Operador PA1',   'operator',      hkt.pa1()),
  (hkt.uid(4), hkt.ca(), 'ZZ HK Operador PA2',   'operator',      hkt.pa2()),
  (hkt.uid(5), hkt.ca(), 'ZZ HK Operador sin permiso', 'operator', hkt.pa1()),
  (hkt.uid(6), hkt.ca(), 'ZZ HK Operador PA1 bis', 'operator',    hkt.pa1()),
  (hkt.uid(7), hkt.cb(), 'ZZ HK Admin B',        'admin',         NULL);
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (hkt.uid(2), hkt.pa1(), 'total');
INSERT INTO public.roles (id, company_id, name) VALUES ('5b710000-0000-0000-0000-0000000000a8', hkt.ca(), 'ZZ HK Housekeeping');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('5b710000-0000-0000-0000-0000000000a8', 'condominios.tab.housekeeping', 'allow');
INSERT INTO public.user_roles (user_id, role_id) SELECT hkt.uid(n), '5b710000-0000-0000-0000-0000000000a8' FROM unnest(ARRAY[3,4,6]) n;
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, estado) VALUES
  (hkt.sv(1), hkt.ca(), hkt.pa1(), NULL, 'en_proceso'),
  (hkt.sv(2), hkt.ca(), hkt.pa2(), NULL, 'en_proceso'),
  (hkt.sv(3), hkt.cb(), hkt.pb1(), NULL, 'en_proceso');
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado)
  SELECT hkt.sv(n), hkt.ca(), hkt.pa1(), 'en_proceso' FROM generate_series(4, 30) n;
'''

# ── assert.sql: siembra de lectura + bloques DO ──
cuerpo = asr
cuerpo = cuerpo.replace('\\set ON_ERROR_STOP on\n', '').replace('\\i lib.sql\n', '').replace('\\i datos.sql\n', '')
cuerpo = cuerpo.replace("SELECT 'ASSERT_OK' AS resultado;", '')

def quitar(txt, ini, fin, incluir_fin=False):
    i = txt.index(ini); j = txt.index(fin, i)
    return txt[:i] + txt[j + (len(fin) if incluir_fin else 0):]

# sin residente
cuerpo = cuerpo.replace(',[7,1],[8,0]]', ',[7,1]]').replace('FOR i IN 1..8 LOOP', 'FOR i IN 1..7 LOOP')
cuerpo = quitar(cuerpo, '  -- El residente de la unidad U1', '  -- anon no lee nada')
cuerpo = quitar(cuerpo, "  PERFORM hkt.como(hkt.uid(8));\n  PERFORM hkt.ok('B6", '  PERFORM hkt.como_anon();')
cuerpo = quitar(cuerpo, "  PERFORM hkt.como(hkt.uid(8));\n  PERFORM hkt.ok('C7", '  PERFORM hkt.como_anon();')
# sin cascada de proyecto
cuerpo = quitar(cuerpo, '  -- Cascada de PROYECTO', 'END $$;')

# PL/pgSQL resuelve los tipos de TODO el DO al compilarlo: con `DECLARE r public.servicio_housekeeping_fotos`
# un sandbox sin la migración fallaría con «type does not exist» antes de llegar al preflight. Con `record`
# el preflight se ejecuta primero y aborta con un mensaje claro.
cuerpo = '\n'.join(
    re.sub(r'(\b\w+) public\.(servicios_housekeeping|servicio_housekeeping_fotos);', r'\1 record;', ln) if ln.startswith('DECLARE') else ln
    for ln in cuerpo.split('\n'))

# ── Sin sentencias destructivas escritas a mano ─────────────────────────────────────────────
# La herramienta SQL del sandbox RETIENE (espera una confirmación humana que no llega y corta a los 60 s)
# las sentencias destructivas: se comprobó que ni siquiera llegan a la base (pg_stat_activity vacío). No se
# disfraza el texto para esquivarlo: estas partes NO contienen DELETE/TRUNCATE/DROP escritos aquí. El borrado
# se ejerce llamando a las RPC del producto (hk_eliminar_foto / hk_eliminar_servicio), cuyos DELETE internos
# sí corren en el sandbox sobre filas de prueba y dentro de una transacción que se revierte.
# Lo que se omite aquí (D2, D4, G11, G12, G29, G30, G31 y los vaciados de la cola) se prueba en el
# PostgreSQL desechable con assert.sql completo.
def quitar_entre(txt, ini, fin, incluir_fin=True):
    a = txt.index(ini); b = txt.index(fin, a)
    return txt[:a] + txt[b + (len(fin) if incluir_fin else 0):]

cuerpo = quitar_entre(cuerpo, "  PERFORM hkt.ok('D2", "  PERFORM hkt.ok('D3", incluir_fin=False)
cuerpo = quitar_entre(cuerpo, "  PERFORM hkt.ok('D4", "  PERFORM hkt.root();\n  SELECT count(*) INTO despues", incluir_fin=False)
cuerpo = quitar_entre(cuerpo, "  -- «Cero filas afectadas»: un BEFORE", "  DROP TRIGGER trg_hkt_cancela ON public.servicio_housekeeping_fotos;\n")
cuerpo = quitar_entre(cuerpo, "  -- «Cero filas» en el servicio", "  PERFORM hkt.ok('G30 …y el servicio sigue ahí', (SELECT count(*) FROM public.servicios_housekeeping WHERE id = hkt.sv(14)) = 1);\n")
# G31 (DELETE directo): desde su comentario hasta el final de su comprobación
a = cuerpo.index("  -- Por la vía vieja")
b = cuerpo.index("= 1);", cuerpo.index("PERFORM hkt.ok('G31", a)) + len("= 1);\n")
cuerpo = cuerpo[:a] + cuerpo[b:]
cuerpo = cuerpo.replace("  DELETE FROM public.hk_limpieza_storage;\n", "")
# La BD de cada parte arranca con la cola vacía (preflight) porque cada parte es su propia transacción.

# Comentarios de línea completa fuera (mismo contenido, menos superficie de texto).
cuerpo = '\n'.join(l for l in cuerpo.split('\n') if not l.strip().startswith('--'))

# Cada «DO $$ … $$;» pasa a ser un bloque anidado.
bloques = []
resto = cuerpo
sembrado = resto[:resto.index('DO $$')]
resto = resto[len(sembrado):]
for m in re.finditer(r'DO \$\$\n(.*?)\n?\$\$;', resto, flags=re.S):
    bloques.append(m.group(1).rstrip() + ';')
assert len(bloques) == 13, f'se esperaban 13 bloques, hay {len(bloques)}'

# Cada parte es SU PROPIA transacción (arranca con la cola y el bucket vacíos). Índices de bloque:
# 0 A · 1 B · 2 C(filas+objetos) · 3 C9/C10 · 4 D · 5 E · 6 F · 7 G(fotos) · 8 G(servicios) · 9 H(cola) · 10 H(huérfanas) · 11 I · 12 J
PARTES = [[0, 1, 2, 3, 4, 5], [6, 12], [7], [8], [9], [10, 11]]

lib_txt = lib.replace('\\i', '--')
lib_txt = '\n'.join(l for l in lib_txt.split('\n') if not l.strip().startswith('--'))

def parte(indices, n):
    salida = [f'-- GENERADO por generar_guion_sandbox.py (parte {n} de {len(PARTES)}): NO editar a mano.',
              '-- Una sentencia que TERMINA SIEMPRE con una excepción que REVIERTE todo (GUION_OK_REVERTIDO / GUION_FALLO / GUION_ABORTA).',
              'DO $guion$', 'DECLARE', '  fallos int; total int; detalle text;', 'BEGIN',
              "  SET LOCAL lock_timeout = '10s';"]
    salida.append(lib_txt.strip())
    salida.append(datos.strip())
    salida.append(sembrado.strip())
    for b in [bloques[i] for i in indices]:
        salida.append('  BEGIN\n' + b + '\n  END;')
    salida.append("""  PERFORM hkt.root();
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO fallos, total FROM hkt.res;
  SELECT string_agg(CASE WHEN ok THEN 'OK    ' ELSE 'FALLO ' END || txt, E'\\n' ORDER BY n) INTO detalle FROM hkt.res;
  IF fallos > 0 THEN
    RAISE EXCEPTION E'GUION_FALLO · % de % comprobaciones no coinciden\\n%', fallos, total, detalle;
  END IF;
  RAISE EXCEPTION E'GUION_OK_REVERTIDO · % comprobaciones, 0 con FALLO\\n%', total, detalle;
END
$guion$;""")
    texto = '\n'.join(salida) + '\n'
    prohibidas = re.findall(r'(?i)\b(delete|truncate|drop)\b', texto)
    assert not prohibidas, f'la parte {n} contiene sentencias destructivas: {set(prohibidas)}'
    return texto

if len(sys.argv) > 1 and sys.argv[1] == '--escribir':
    for n, idx in enumerate(PARTES, 1):
        (aqui / f'sandbox_housekeeping_parte{n}.sql').write_text(parte(idx, n))
    print(f'{len(PARTES)} partes escritas', file=sys.stderr)
elif len(sys.argv) > 2 and sys.argv[1] == '--parte':
    n = int(sys.argv[2]); sys.stdout.write(parte(PARTES[n - 1], n))
else:
    print('uso: generar_guion_sandbox.py --escribir | --parte N', file=sys.stderr); sys.exit(2)
