#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261102000000 (rutinas como recorrido por áreas).
#
# POR QUÉ EXISTE
# El recorrido se guarda con una RPC que reconcilia una foto completa contra lo
# que ya hay (conservar, crear, borrar) y la materialización cambia cómo decide
# el área y el orden de cada tarea. Nada de eso se valida leyéndolo: que el SQL
# compile no dice que reordenar conserve las filas, que una foto inválida no
# deje el recorrido a medias, ni que «barrer» en dos apartamentos sean dos
# tareas sin que «Cargar tareas del cargo» vuelva a duplicar el checklist.
#
# QUÉ HACE
#   1 · cadena   bootstrap + TODAS las migraciones anteriores a la versión, en
#                una base vacía (el esquema real, no uno copiado a mano)
#   2 · migra    la migración DOS veces: la segunda no cambia la huella del
#                auditor de drift, y la primera cambia EXACTAMENTE los grupos
#                esperados (ni una policy, grant o tabla de más)
#      2b-2c    la forma desconocida de producción: la unicidad vieja con otro
#                nombre y como constraint; y el pre-vuelo con duplicados
#   3 · invariantes  fixture.sql + assert.sql (A–G: recorrido, atomicidad,
#                tenant, RLS, materialización, índice y borrado)
#   4 · purga    assert_purga.sql sobre la forma de llaves de producción
#   5 · mutantes copias de la migración, cada una sin una compuerta: la suite
#                DEBE fallar con cada una
#
# USO:  supabase/tests/rutinas_recorrido/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261102000000_rutinas_recorrido_por_areas
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
FORMA_PROD="$RAIZ/supabase/tests/purgar_empresa/forma_produccion.sql"

[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones hacen CREATE EXTENSION.
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
DATA=$(mktemp -d /tmp/rrcdata.XXXX)
SOCK=$(mktemp -d /tmp/rrcsock.XXXX)
TRABAJO=$(mktemp -d /tmp/rrctrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55547}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# El apagado se delega IGUAL que el arranque: con `pg_ctl` a secas, como root falla
# en silencio y el clúster queda vivo ocupando el puerto.
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
# fsync apagado: clúster DESECHABLE; no cambia ninguna semántica de las pruebas.
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c fsync=off -c synchronous_commit=off -c full_page_writes=off' -l $DATA/pg.log start" >/dev/null
for _ in $(seq 1 200); do PGHOST="$SOCK" PGPORT="$PUERTO" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
BD=rrc_base
psql -q -d postgres -c "CREATE DATABASE $BD" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
copia()   { PGOPTIONS="-c client_min_messages=warning" psql -q -d postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1" >/dev/null; }
huella()  { psql -q -v ON_ERROR_STOP=1 -tA -d "$1" -f "$HUELLA" | LC_ALL=C sort; }
posteriores() {   # aplica, sobre $1, las migraciones de versión mayor que la nuestra
  for f in "$MIGS"/*.sql; do
    local base; base="$(basename "$f" .sql)"
    [[ "${base:0:14}" > "$VERSION" ]] || continue
    aplicar "$1" "$f"
  done
}

# Corre una suite y exige que TERMINE bien; muestra sus OK.
suite() {         # suite BD ARCHIVO
  local salida codigo=0
  salida=$(psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1) || codigo=$?
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
  if [ "$codigo" -ne 0 ]; then
    echo; echo "❌ una invariante no se cumple ($(basename "$2")):"
    echo "$salida" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
    exit 1
  fi
}

echo "── 1/5 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/5 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" rrc_post
huella rrc_post > "$TRABAJO/h0"
aplicar rrc_post "$NUESTRA"
huella rrc_post > "$TRABAJO/h1"
aplicar rrc_post "$NUESTRA"
huella rrc_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="funcion:guardar_recorrido_rutina(p_rutina_id uuid, p_recorrido jsonb) funcion:guardar_recorrido_rutina(p_rutina_id uuid, p_recorrido jsonb)/grants funcion:materializar_rutinas_turno(p_project_id uuid, p_desde date, p_hasta date) funcion:rutina_area_coherente() funcion:rutina_area_coherente()/grants tabla:rutina_actividades/columnas tabla:rutina_actividades/constraints tabla:rutina_actividades/indices tabla:rutina_areas/columnas tabla:rutina_areas/constraints tabla:rutina_areas/grants tabla:rutina_areas/indices tabla:rutina_areas/policies tabla:rutina_areas/rls tabla:rutina_areas/triggers tabla:tareas_bloque/indices "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en 16 grupos: la tabla nueva, la columna/constraints/índice de los pasos, el índice de tareas_bloque, dos funciones nuevas con sus grants y el cuerpo de materializar_rutinas_turno (sin tocar sus grants)"
posteriores rrc_post

# Los índices de tareas_bloque tienen drift declarado contra producción (#826):
# allá la unicidad vieja puede tener OTRO nombre, o ser constraint. La migración
# la busca por columnas; esto lo prueba en una base que no se parece al repo.
echo "── 2b/5 · la unicidad vieja con otro nombre (forma desconocida de producción)"
copia "$BD" rrc_forma
psql -q -v ON_ERROR_STOP=1 -d rrc_forma >/dev/null <<'SQL'
DROP INDEX public.uq_tareas_bloque_plantilla;
ALTER TABLE public.tareas_bloque ADD CONSTRAINT tareas_bloque_plantilla_bloque_key UNIQUE (plantilla_id, bloque_id);
SQL
SALIDA=$(PGOPTIONS="-c client_min_messages=notice" psql -q -1 -v ON_ERROR_STOP=1 -d rrc_forma -f "$NUESTRA" 2>&1)
echo "$SALIDA" | grep -q 'retirada la unicidad (bloque_id, plantilla_id) de tareas_bloque: «tareas_bloque_plantilla_bloque_key»' \
  || { echo "❌ no retiró la constraint de otro nombre"; echo "$SALIDA" | tail -5; exit 1; }
QUEDAN=$(psql -q -tA -d rrc_forma -c "
  SELECT count(*) FROM pg_index i
   WHERE i.indrelid = 'public.tareas_bloque'::regclass AND i.indisunique AND NOT i.indisprimary
     AND i.indnkeyatts = 2")
[ "$QUEDAN" = "0" ] || { echo "❌ quedó una unicidad de dos columnas en tareas_bloque"; exit 1; }
echo "  OK    la retira por sus columnas aunque se llame distinto y sea constraint, y lo deja en el log"

echo "── 2c/5 · pre-vuelo: con duplicados (bloque, actividad, área) no toca nada"
copia "$BD" rrc_dup
psql -q -v ON_ERROR_STOP=1 -d rrc_dup >/dev/null <<'SQL'
DROP INDEX public.uq_tareas_bloque_plantilla;
INSERT INTO public.companies (id, nombre) VALUES ('d0000000-0000-0000-0000-00000000000d', 'Dup');
INSERT INTO public.projects (id, company_id, nombre, tipo)
VALUES ('d1000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-00000000000d', 'Dup1', 'condominio');
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre)
VALUES ('d7000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'd1000000-0000-0000-0000-0000000000d1', 'P');
INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, turno, fecha)
VALUES ('d8000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'd1000000-0000-0000-0000-0000000000d1',
        'd7000000-0000-0000-0000-000000000001', 'manana', DATE '2026-11-10');
INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo, servicio)
VALUES ('d5000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'd1000000-0000-0000-0000-0000000000d1',
        'conserje', 'Barrer', 'limpieza');
INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo) VALUES
  ('d8000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'una'),
  ('d8000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'otra');
SQL
if SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q -1 -v ON_ERROR_STOP=1 -d rrc_dup -f "$NUESTRA" 2>&1); then
  echo "❌ la migración pasó con duplicados"; exit 1
fi
echo "$SALIDA" | grep -q 'RUTINAS_RECORRIDO (pre-vuelo): 1 combinación' || { echo "❌ abortó por otro motivo:"; echo "$SALIDA" | tail -3; exit 1; }
[ "$(psql -q -tA -d rrc_dup -c "SELECT to_regclass('public.rutina_areas') IS NULL")" = "t" ] \
  || { echo "❌ el pre-vuelo abortó pero algo de la migración quedó aplicado"; exit 1; }
echo "  OK    aborta con el conteo y la transacción no deja nada a medias"

echo "── 3/5 · invariantes"
copia rrc_post rrc_inv
aplicar rrc_inv "$AQUI/fixture.sql"
suite rrc_inv "$AQUI/assert.sql"

echo "── 4/5 · purga de una empresa con recorridos (forma de llaves de producción)"
copia rrc_post rrc_purga
aplicar rrc_purga "$AQUI/fixture.sql"
aplicar rrc_purga "$FORMA_PROD"
suite rrc_purga "$AQUI/assert_purga.sql"

echo "── 5/5 · mutantes: sin cada compuerta, la suite debe fallar"
mutante() {   # $1 = etiqueta · $2 = texto que se quita (puede abarcar varias líneas) · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mutante.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
if pat not in s:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  chmod 644 "$TRABAJO/mutante.sql"
  copia "$BD" rrc_mut
  aplicar rrc_mut "$TRABAJO/mutante.sql"
  posteriores rrc_mut
  aplicar rrc_mut "$AQUI/fixture.sql"
  if psql -q -v ON_ERROR_STOP=1 -d rrc_mut -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}
mutante "el área de la tarea es la de la parada" \
  "      COALESCE(rz.area_id, p.area_id, r.area_id) AS area_id," \
  "      COALESCE(p.area_id, rz.area_id, r.area_id) AS area_id,"
mutante "«ya existe» compara el área" \
  "          AND tb.area_id IS NOT DISTINCT FROM COALESCE(rz.area_id, p.area_id, r.area_id)" \
  ""
mutante "el orden sigue al recorrido" \
  "                 rz.orden NULLS FIRST, rz.id NULLS FIRST," \
  ""
mutante "el área inactiva no genera" \
  "      AND (rz.id IS NULL OR za.activo)" \
  ""
mutante "la parada que no viene se borra" \
  "      WHERE (e->>'area_id')::uuid = ra.area_id" \
  "      WHERE true"
mutante "área repetida rechazada antes de escribir" \
  $'  GROUP BY e->>\'area_id\'\n  HAVING count(*) > 1' \
  $'  GROUP BY e->>\'area_id\'\n  HAVING false'
mutante "el trigger rechaza el área de otro tenant" \
  $'  IF v_area_company IS DISTINCT FROM v_rutina.company_id\n     OR v_area_project IS DISTINCT FROM v_rutina.project_id THEN' \
  "  IF false THEN"
mutante "el permiso del tab en la lectura de paradas" \
  "        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))" \
  "        OR true)"
mutante "dos cargas sin área siguen chocando" \
  "  ON public.tareas_bloque(bloque_id, plantilla_id, area_id) NULLS NOT DISTINCT" \
  "  ON public.tareas_bloque(bloque_id, plantilla_id, area_id)"

echo
echo "✅ rutinas_recorrido: el recorrido se guarda entero o nada, bajo la RLS de quien llama; la tarea toma el área de su parada y el orden del recorrido; la misma actividad en dos áreas son dos tareas y cargar dos veces sigue sin duplicar"
