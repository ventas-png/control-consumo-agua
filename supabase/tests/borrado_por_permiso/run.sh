#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261103000200 (borrar en Mantenimiento,
# Incidentes, Asambleas, Checklist de áreas y Permisos de obra exige la acción
# «Eliminar» del tab, también en la base).
#
# POR QUÉ EXISTE
# Una policy se lee bien y falla en silencio: si la de DELETE pide de menos,
# borra quien sólo consulta; si pide de más, la RLS borra cero filas sin error y
# la pantalla lo da por hecho. Y la baja de tickets es un UPDATE, así que una
# policy RESTRICTIVA mal puesta o bien no exige nada o bien bloquea la edición
# normal. Nada de eso se ve leyendo el SQL.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores a la versión,
#                  en una base vacía (el esquema real, no uno copiado a mano)
#   2 · antes      sobre ese estado, el padrón REPRODUCE los dos huecos (ver
#                  basta para dar de baja un ticket; «Eliminar» no basta para
#                  borrar un incidente). Si no, la suite no probaría nada.
#   3 · migra      la migración DOS veces: la segunda no cambia la huella del
#                  auditor de drift, y la primera cambia EXACTAMENTE las
#                  policies de las cinco tablas
#   4 · invariantes fixture.sql + assert.sql (quién borra, quién da de baja,
#                  quién restaura, que editar siga igual)
#   5 · guarda     con una policy permisiva de borrado de más, la migración
#                  ABORTA (la guarda de postcondición no es decorativa)
#   6 · mutantes   copias de la migración (sin la guarda), cada una sin una
#                  compuerta: la suite DEBE fallar con cada una
#
# USO:  supabase/tests/borrado_por_permiso/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261103000200_condominios_borrar_exige_permiso_delete
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
[ -f "$NUESTRA" ] || { echo "❌ no existe $NUESTRA"; exit 1; }

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
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
DATA=$(mktemp -d /tmp/bppdata.XXXX)
SOCK=$(mktemp -d /tmp/bppsock.XXXX)
TRABAJO=$(mktemp -d /tmp/bpptrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55571}

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
BD=bpp_base
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

echo "── 1/6 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $VERSION"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/6 · control previo: el padrón reproduce los huecos de ANTES"
copia "$BD" bpp_antes
aplicar bpp_antes "$AQUI/fixture.sql"
suite bpp_antes "$AQUI/antes.sql"

echo "── 3/6 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" bpp_post
huella bpp_post > "$TRABAJO/h0"
aplicar bpp_post "$NUESTRA"
huella bpp_post > "$TRABAJO/h1"
aplicar bpp_post "$NUESTRA"
huella bpp_post > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="tabla:asambleas/policies tabla:checklist_areas/policies tabla:incidentes_seguridad/policies tabla:permisos_obra_unidad/policies tabla:tickets_mantenimiento/policies "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en las policies de las cinco tablas (ninguna función, grant ni columna)"
posteriores bpp_post

echo "── 4/6 · invariantes"
copia bpp_post bpp_inv
aplicar bpp_inv "$AQUI/fixture.sql"
suite bpp_inv "$AQUI/assert.sql"

echo "── 5/6 · guarda: con una policy permisiva de borrado de más, la migración aborta"
copia "$BD" bpp_guarda
psql -q -v ON_ERROR_STOP=1 -d bpp_guarda \
  -c "CREATE POLICY borrado_heredado ON public.asambleas FOR DELETE TO authenticated USING (true)" >/dev/null
if SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d bpp_guarda -f "$NUESTRA" 2>&1); then
  echo "❌ la migración pasó en verde con una policy de borrado de más: la guarda es decorativa"; exit 1
fi
echo "$SALIDA" | grep -q 'asambleas conserva 2 policies permisivas de borrado' \
  || { echo "❌ la migración falló, pero NO por la guarda esperada:"; echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
echo "  OK    aborta: $(echo "$SALIDA" | sed -n 's/.*ERROR:  //p' | head -1)"

echo "── 6/6 · mutantes: sin cada compuerta, la suite debe fallar"
# Al mutante se le quita la guarda de postcondición: lo que se prueba aquí es
# que la SUITE detecta la regla rota, no que la guarda lo haga por ella.
mutante() {   # $1 = etiqueta · $2 = texto que se quita (puede abarcar varias líneas) · $3 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mutante.sql" "$2" "$3" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 3 · Guarda de postcondición')]
if s.count(pat) != 1:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  chmod 644 "$TRABAJO/mutante.sql"
  copia "$BD" bpp_mut
  aplicar bpp_mut "$TRABAJO/mutante.sql"
  posteriores bpp_mut
  aplicar bpp_mut "$AQUI/fixture.sql"
  if psql -q -v ON_ERROR_STOP=1 -d bpp_mut -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}

mutante "Incidentes: ver no basta para borrar" \
  "(SELECT public.condominios_puede_actuar('incidentes', 'delete'))" \
  "(SELECT public.user_has_permission('condominios.tab.incidentes'))"
mutante "Asambleas: editar no es eliminar" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'delete'))" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'edit'))"
mutante "Checklist: sólo dentro de la empresa" \
  $'OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'checklist_areas\', \'delete\')))' \
  $'OR ((SELECT public.condominios_puede_actuar(\'checklist_areas\', \'delete\')))'
mutante "Permisos de obra: «Eliminar» del tab, no sólo admin" \
  "(SELECT public.condominios_puede_actuar('permisos_obra', 'delete'))" \
  "((SELECT public.current_user_role()) = ANY (ARRAY['company_owner','admin']))"
mutante "Tickets: dar de baja exige «Eliminar» (WITH CHECK)" \
  $'  WITH CHECK (\n    deleted_at IS NULL\n    OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'delete\'))\n  );' \
  $'  WITH CHECK (true);'
mutante "Tickets: restaurar exige «Eliminar» (USING)" \
  $'  USING (\n    deleted_at IS NULL\n    OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'delete\'))\n  )\n  WITH CHECK' \
  $'  USING (true)\n  WITH CHECK'
mutante "Tickets: la policy de baja es RESTRICTIVA" \
  $'  AS RESTRICTIVE\n' \
  ''

echo
echo "✅ borrado_por_permiso: el padrón reproduce los huecos de antes; después,"
echo "   borrar y dar de baja exigen «Eliminar» del tab (ver, editar, tab oculto"
echo "   y otra empresa no alcanzan; el par legado y el admin sí), editar sigue"
echo "   igual, la guarda aborta de verdad y siete mutantes rompen la suite."
