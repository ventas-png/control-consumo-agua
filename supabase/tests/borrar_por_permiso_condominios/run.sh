#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261104000100 (borrar en cinco pestañas de
# condominios exige, en la base, el permiso `.delete` del tab).
#
# POR QUÉ EXISTE
# Cambiar cinco policies es SQL válido aunque se teclee otro tab, otra acción o
# se caiga la mitad de la empresa de un predicado. Eso sólo se ve EJECUTANDO los
# borrados con cada forma de permiso, y comparando con lo que dice la UI
# (`canActInCondominiosTab`, src/lib/permissions.ts).
#
# QUÉ HACE
#   1 · cadena   bootstrap + TODAS las migraciones anteriores a la versión, en
#                una base vacía (el esquema real, no uno copiado a mano), y el
#                padrón encima (fixture.sql + casos.sql)
#   2 · antes    mide los casos SIN la migración y exige ver los dos huecos: un
#                rol que sólo VE el tab borra un ticket, y uno con `.delete`
#                no logra borrar en las otras cuatro tablas
#   3 · migra    la migración DOS veces: la segunda no cambia la huella del
#                auditor de drift, y la primera cambia EXACTAMENTE las policies
#                de las cinco tablas
#   4 · después  los mismos casos, con la regla de `canDelete`
#   5 · mutantes copias de la migración, cada una sin una regla y SIN la
#                autoverificación del final (que se probaría a sí misma): la
#                suite DEBE fallar con cada una
#   5b · autoverificación  copias rotas COMPLETAS: la sección 3 de la migración
#                tiene que abortarlas al aplicarse
#
# USO:  supabase/tests/borrar_por_permiso_condominios/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
MIGRACION=20261104000100_condominios_borrar_exige_permiso_delete
VERSION=${MIGRACION%%_*}
NUESTRA="$MIGS/$MIGRACION.sql"
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"

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
DATA=$(mktemp -d /tmp/bpcdata.XXXX)
SOCK=$(mktemp -d /tmp/bpcsock.XXXX)
TRABAJO=$(mktemp -d /tmp/bpctrab.XXXX)
chmod 777 "$TRABAJO"
PUERTO=${PGPORT_TEST:-55574}

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
BD=bpc_base
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
medir() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -v etapa="$2" -d "$1" -f "$AQUI/medir.sql" >/dev/null; }

# Mide y compara una etapa; exige que TERMINE bien y muestra sus OK.
suite() {         # suite BD ETAPA
  local salida codigo=0
  medir "$1" "$2"
  salida=$(psql -q -v ON_ERROR_STOP=1 -v etapa="$2" -d "$1" -f "$AQUI/assert.sql" 2>&1) || codigo=$?
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
  if [ "$codigo" -ne 0 ]; then
    echo; echo "❌ una invariante no se cumple (etapa $2):"
    echo "$salida" | sed -n '/ERROR/,/CONTEXT/p' | grep -v CONTEXT | head -60
    exit 1
  fi
}

echo "── 1/5 · andamiaje de plataforma, cadena de migraciones ANTERIORES a $VERSION y padrón"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$VERSION" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"
# La huella de referencia se toma ANTES del padrón: el padrón añade tablas
# propias (bpc_*) que no son de la migración.
huella "$BD" > "$TRABAJO/h0"
aplicar "$BD" "$AQUI/fixture.sql"
aplicar "$BD" "$AQUI/casos.sql"
echo "  OK    padrón: 8 usuarios (una forma de permiso cada uno), una fila por tabla y $(psql -tA -d "$BD" -c 'SELECT count(*) FROM public.bpc_casos') casos"

echo "── 2/5 · ANTES de la migración: los dos huecos se reproducen"
copia "$BD" bpc_antes
suite bpc_antes antes

echo "── 3/5 · la migración, DOS veces, y lo que cambia en la huella"
copia "$BD" bpc_post
aplicar bpc_post "$NUESTRA"
huella bpc_post | grep -v -E '^[a-z_]+:bpc_' > "$TRABAJO/h1"
aplicar bpc_post "$NUESTRA"
huella bpc_post | grep -v -E '^[a-z_]+:bpc_' > "$TRABAJO/h2"
cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
echo "  OK    idempotente: la segunda pasada deja la misma huella"
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="tabla:asambleas/policies tabla:checklist_areas/policies tabla:incidentes_seguridad/policies tabla:permisos_obra_unidad/policies tabla:tickets_mantenimiento/policies "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    la huella cambia EXACTAMENTE en las policies de las cinco tablas (ninguna función, grant ni columna)"
posteriores bpc_post

echo "── 4/5 · DESPUÉS de la migración: la regla de canDelete"
suite bpc_post despues

echo "── 5/5 · mutantes: sin cada regla, la suite debe fallar"
# Cada mutante quita UNA regla y también la autoverificación del final: si la
# dejara, la propia migración abortaría y no se sabría si los CASOS ven el cambio.
mutante() {   # $1 = etiqueta · $2 = ocurrencia (1, 2…) · $3 = texto que se quita · $4 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/mutante.sql" "$2" "$3" "$4" <<'PY' || { echo "❌ el mutante «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, n, pat, rep = sys.argv[1:6]
s = open(src, encoding='utf-8').read()
i = -1
for _ in range(int(n)):
    i = s.find(pat, i + 1)
    if i < 0:
        sys.exit(1)
s = s[:i] + rep + s[i + len(pat):]
corte = s.find('-- 3 · Autoverificación')
if corte < 0:
    sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s[:corte])
PY
  chmod 644 "$TRABAJO/mutante.sql"
  copia "$BD" bpc_mut
  aplicar bpc_mut "$TRABAJO/mutante.sql"
  posteriores bpc_mut
  medir bpc_mut despues
  local salida
  if salida=$(psql -q -v ON_ERROR_STOP=1 -v etapa=despues -d bpc_mut -f "$AQUI/assert.sql" 2>&1); then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla: $(echo "$salida" | grep -oE '[0-9]+ de [0-9]+ casos no cuadran' | head -1)"
}
GUARDA_TICKET=$'        AND (deleted_at IS NULL\n             OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'delete\'))))'
mutante "borrar un ticket (WITH CHECK) exige .delete"     2 "$GUARDA_TICKET" ")"
mutante "restaurar un ticket (USING) exige .delete"       1 "$GUARDA_TICKET" ")"
mutante "DELETE pide la acción delete, no edit"           1 "condominios_puede_actuar('incidentes', 'delete')" "condominios_puede_actuar('incidentes', 'edit')"
mutante "DELETE no cruza la empresa"                      1 \
  $'    OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'asambleas\', \'delete\')))' \
  $'    OR (SELECT public.condominios_puede_actuar(\'asambleas\', \'delete\'))'
mutante "DELETE exige VER el tab, no sólo .delete"        1 \
  "(SELECT public.condominios_puede_actuar('checklist_areas', 'delete'))" \
  "(SELECT public.user_has_permission('condominios.tab.checklist_areas.delete'))"
mutante "DELETE acepta el par legado platform.condominios" 1 \
  "(SELECT public.condominios_puede_actuar('permisos_obra', 'delete'))" \
  "(SELECT public.user_has_permission('condominios.tab.permisos_obra') AND public.user_has_permission('condominios.tab.permisos_obra.delete'))"
mutante "DELETE no autoriza por el rol legado admin"      1 \
  "(SELECT public.condominios_puede_actuar('incidentes', 'delete'))" \
  "(SELECT public.current_user_role() = ANY (ARRAY['company_owner','admin']))"

echo "── 5b · la autoverificación de la migración aborta si la regla no quedó"
# La otra red: la sección 3 de la migración, que es lo único que corre en
# producción. Se le dan copias rotas COMPLETAS (con la sección 3) y cada una
# tiene que fallar al aplicarse, no quedar a medias.
autoverificacion() {   # $1 = etiqueta · $2 = ocurrencia · $3 = texto que se quita · $4 = reemplazo
  python3 - "$NUESTRA" "$TRABAJO/rota.sql" "$2" "$3" "$4" <<'PY' || { echo "❌ «$1» no encuentra su texto en la migración"; exit 1; }
import sys
src, dst, n, pat, rep = sys.argv[1:6]
s = open(src, encoding='utf-8').read()
i = -1
for _ in range(int(n)):
    i = s.find(pat, i + 1)
    if i < 0:
        sys.exit(1)
open(dst, 'w', encoding='utf-8').write(s[:i] + rep + s[i + len(pat):])
PY
  chmod 644 "$TRABAJO/rota.sql"
  copia "$BD" bpc_rota
  local salida
  if salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -1 -d bpc_rota -f "$TRABAJO/rota.sql" 2>&1); then
    echo "❌ la migración se aplicó sin [$1]: la autoverificación no lo detecta"; exit 1
  fi
  echo "  OK    sin [$1] la migración aborta: $(echo "$salida" | grep -oE 'ERROR:  .*' | head -1 | sed 's/^ERROR:  //' | cut -c1-90)"
}
autoverificacion "WITH CHECK del ticket" 2 "$GUARDA_TICKET" ")"
autoverificacion "acción delete en incidentes" 1 "condominios_puede_actuar('incidentes', 'delete')" "condominios_puede_actuar('incidentes', 'edit')"
autoverificacion "empresa en asambleas" 1 \
  $'    OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'asambleas\', \'delete\')))' \
  $'    OR (SELECT public.condominios_puede_actuar(\'asambleas\', \'delete\'))'

echo
echo "✅ borrar_por_permiso_condominios: en Incidentes, Asambleas, Checklist y Permisos de obra borra quien tiene .delete (o el par legado) y ve el tab, en su empresa; en Mantenimiento, marcar o deshacer un borrado exige lo mismo y editar un ticket vivo no cambia"
