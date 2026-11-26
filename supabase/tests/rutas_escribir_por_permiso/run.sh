#!/usr/bin/env bash
# ============================================================================
# RUTAS · ESCRIBIR EXIGE EL PERMISO DEL MÓDULO · arnés contra un PostgreSQL REAL
#
# Prueba 20261221000000 sobre la cadena ENTERA de migraciones anteriores (con
# los triggers reales de `rutas`: company_id, sellos de creado_por y de cierre),
# con el padrón de fail_open_sin_perfil:
#   · control negativo: antes, un visor crea rutas, un operador con sólo «ver»
#     las reescribe y un rol con «Eliminar» no puede borrar;
#   · después, cada escritura exige SU clave (create / edit / delete) y el
#     acceso al proyecto; quien ejecuta la ruta (asignado o con
#     agua.lecturas.create) sólo puede darla por completada;
#   · aplicar dos veces no cambia nada y la guarda de postcondición aborta con
#     una policy permisiva de más.
# ============================================================================
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261221000000_rutas_escribir_exige_permiso
VERSION=${MIGRACION%%_*}
PADRON="$RAIZ/supabase/tests/fail_open_sin_perfil/fixture.sql"
[ -f "$MIGS/$MIGRACION.sql" ] || { echo "❌ no existe $MIGS/$MIGRACION.sql"; exit 1; }

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron (mismo mecanismo que fail_open_sin_perfil).
EXT="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/$(basename "$(dirname "$(command -v initdb)")"))/extension"
for ext in pg_net pg_cron; do
  [ -f "$EXT/$ext.control" ] && continue
  CTL="comment = 'shim vacío del arnés'"$'\n'"default_version = '1.0'"$'\n'"relocatable = true"
  if [ -w "$EXT" ]; then
    printf '%s\n' "$CTL" > "$EXT/$ext.control"; echo 'SELECT 1;' > "$EXT/$ext--1.0.sql"
  else
    printf '%s\n' "$CTL" | sudo -n tee "$EXT/$ext.control" >/dev/null
    echo 'SELECT 1;' | sudo -n tee "$EXT/$ext--1.0.sql" >/dev/null
  fi
done

# El socket unix tiene un tope de 107 bytes: rutas cortas a propósito.
DATA=$(mktemp -d /tmp/rpdata.XXXX)
SOCK=$(mktemp -d /tmp/rpsock.XXXX)
PUERTO=${PGPORT_TEST:-55702}
BD=rp

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null
aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$1" >/dev/null; }

fase() {   # fase antes|despues
  local salida
  salida=$(PGOPTIONS="-c rp.fase=$1" psql -q -v ON_ERROR_STOP=1 -d "$BD" -f "$AQUI/assert.sql" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
    echo "❌ invariante incumplida ($1):"; echo "$salida" | grep -E 'ERROR' | head -4; exit 1; }
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
}

echo "── 1/5 · cadena de migraciones ANTERIORES a $VERSION"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$f"; N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 2/5 · padrón + lectores, roles y rutas de prueba"
aplicar "$PADRON"
psql -q -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<'SQL'
-- LEC_D: operador asignado a la ruta, SIN ningún permiso (el lector de campo).
-- LEC2_D: operador con agua.lecturas.create + agua.rutas.view, no asignado.
INSERT INTO fos.ids (alias, id, tipo) VALUES
  ('LEC_D',    'f0510000-0000-0000-0000-0000000000a1', 'persona'),
  ('LEC2_D',   'f0510000-0000-0000-0000-0000000000a2', 'persona'),
  ('R_OPE',    'f0530000-0000-0000-0000-000000000001', 'rol'),
  ('R_LEC2',   'f0530000-0000-0000-0000-000000000002', 'rol'),
  ('R_OPC',    'f0530000-0000-0000-0000-000000000003', 'rol'),
  ('RUTA_D1',  'f0540000-0000-0000-0000-0000000000d1', 'ruta'),
  ('RUTA_D1C', 'f0540000-0000-0000-0000-0000000000dc', 'ruta'),
  ('RUTA_D2',  'f0540000-0000-0000-0000-0000000000d2', 'ruta'),
  ('RUTA_C1',  'f0540000-0000-0000-0000-0000000000c1', 'ruta');

INSERT INTO auth.users (id, email) VALUES
  (fos.id('LEC_D'),  'lec_d@fos.test'),
  (fos.id('LEC2_D'), 'lec2_d@fos.test');
INSERT INTO public.app_users (id, full_name, role, company_id) VALUES
  (fos.id('LEC_D'),  'Lector asignado D', 'operator', fos.id('D')),
  (fos.id('LEC2_D'), 'Lecturista D',      'operator', fos.id('D'));
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (fos.id('LEC_D'),  fos.id('D1'), 'total'),
  (fos.id('LEC2_D'), fos.id('D1'), 'total');

-- Un rol de empresa por actor: assert.sql reescribe sus claves en cada caso.
INSERT INTO public.roles (id, company_id, name) VALUES
  (fos.id('R_OPE'),  fos.id('D'), 'Rutas prueba OPE_D'),
  (fos.id('R_LEC2'), fos.id('D'), 'Rutas prueba LEC2_D'),
  (fos.id('R_OPC'),  fos.id('C'), 'Rutas prueba OP_C');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (fos.id('OPE_D'),  fos.id('R_OPE')),
  (fos.id('LEC2_D'), fos.id('R_LEC2')),
  (fos.id('OP_C'),   fos.id('R_OPC'));
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (fos.id('R_LEC2'), 'agua.lecturas.create', 'allow'),
  (fos.id('R_LEC2'), 'agua.rutas.view',      'allow');
-- El forastero lleva TODO agua.rutas.* en su empresa: no le sirve en D.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT fos.id('R_OPC'), k, 'allow'
  FROM unnest(ARRAY['agua.rutas.view', 'agua.rutas.create', 'agua.rutas.edit',
                    'agua.rutas.delete', 'agua.lecturas.create']) AS k;

INSERT INTO public.rutas (id, nombre, company_id, project_id, asignado_a, completada) VALUES
  (fos.id('RUTA_D1'),  'Ruta D1',            fos.id('D'), fos.id('D1'), fos.id('LEC_D'), false),
  (fos.id('RUTA_D1C'), 'Ruta D1 completada', fos.id('D'), fos.id('D1'), fos.id('LEC_D'), true),
  (fos.id('RUTA_D2'),  'Ruta D2',            fos.id('D'), fos.id('D2'), NULL,            false),
  (fos.id('RUTA_C1'),  'Ruta C1',            fos.id('C'), fos.id('C1'), NULL,            false);
SQL
echo "   LEC_D asignado sin permisos · LEC2_D con agua.lecturas.create · 4 rutas en D1, D2 y C1"

echo "── 3/5 · CONTROL NEGATIVO: sin la migración"
fase antes

echo "── 4/5 · con la migración (aplicada dos veces)"
aplicar "$MIGS/$MIGRACION.sql"
aplicar "$MIGS/$MIGRACION.sql"
fase despues

echo "── 5/5 · la guarda de postcondición no es decorativa"
psql -q -v ON_ERROR_STOP=1 -d "$BD" -c "CREATE POLICY company_rw_rutas ON public.rutas FOR ALL TO authenticated USING (company_id = public.get_my_company_id())" >/dev/null
if aplicar "$MIGS/$MIGRACION.sql" 2>/dev/null; then
  echo "❌ con una policy permisiva FOR ALL de más, la migración debía abortar"; exit 1
fi
psql -q -v ON_ERROR_STOP=1 -d "$BD" -c "DROP POLICY company_rw_rutas ON public.rutas" >/dev/null
aplicar "$MIGS/$MIGRACION.sql"
echo "   ✓ con una policy permisiva de más, la migración aborta; sin ella, aplica"

echo "✅ rutas: crear, editar y eliminar exigen su permiso; quien ejecuta la ruta sólo la completa"
