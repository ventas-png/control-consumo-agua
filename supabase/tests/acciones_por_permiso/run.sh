#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261103000200, 000300 y 000400: en
# Mantenimiento, Incidentes, Asambleas, Checklist de áreas y Permisos de obra,
# borrar exige la acción «Eliminar» del tab, editar exige «Editar» y crear
# exige «Crear», también en la base.
#
# POR QUÉ EXISTE
# Una policy se lee bien y falla en silencio: si pide de menos, modifica o
# borra quien sólo consulta; si pide de más, la RLS toca cero filas sin error y
# la pantalla lo da por hecho. Y en tickets la baja ES un UPDATE: las dos
# policies RESTRICTIVAS (baja ↔ «Eliminar», ticket vivo ↔ «Editar») tienen que
# repartirse el UPDATE sin que una puentee a la otra ni bloquee al Kanban, que
# edita tickets con su propio permiso. Y el alta de tickets tiene una rama del
# RESIDENTE (portal) que no puede romperse al endurecer la del staff. Nada de
# eso se ve leyendo el SQL.
#
# QUÉ HACE
#   1 · cadena     bootstrap + TODAS las migraciones anteriores a la primera,
#                  en una base vacía (el esquema real, no uno copiado a mano)
#   2 · antes      sobre ese estado, el padrón REPRODUCE los huecos (ver basta
#                  para crear, editar y dar de baja; «Eliminar» no basta para
#                  borrar un incidente). Si no, la suite no probaría nada.
#   3 · migra      cada migración DOS veces: la segunda no cambia la huella del
#                  auditor de drift, y entre las tres cambian EXACTAMENTE las
#                  policies de las cinco tablas
#   4 · invariantes fixture.sql + assert.sql (quién crea, borra, da de baja,
#                  edita, restaura; entre empresas, con y sin WHERE; el
#                  residente en sus unidades)
#   5 · guardas    con una policy permisiva de más, cada migración ABORTA (sus
#                  guardas de postcondición no son decorativas)
#   6 · mutantes   copias de las migraciones (sin guardas), cada una sin una
#                  compuerta: la suite DEBE fallar con cada una
#
# USO:  supabase/tests/acciones_por_permiso/run.sh   (PGPORT_TEST=<puerto> para elegirlo)
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
trap 'rc=$?; echo "❌ run.sh terminó con rc=$rc en la línea $LINENO: $BASH_COMMAND" >&2' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BORRAR="$MIGS/20261103000200_condominios_borrar_exige_permiso_delete.sql"
EDITAR="$MIGS/20261103000300_condominios_editar_exige_permiso_edit.sql"
CREAR="$MIGS/20261103000400_condominios_crear_exige_permiso_create.sql"
NUESTRAS=("$BORRAR" "$EDITAR" "$CREAR")   # en el orden en que se aplican
PRIMERA=20261103000200
ULTIMA=20261103000400
HUELLA="$RAIZ/scripts/schema-drift/fingerprint.sql"
for m in "${NUESTRAS[@]}"; do [ -f "$m" ] || { echo "❌ no existe $m"; exit 1; }; done

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
DATA=$(mktemp -d /tmp/apdata.XXXX)
SOCK=$(mktemp -d /tmp/apsock.XXXX)
TRABAJO=$(mktemp -d /tmp/aptrab.XXXX)
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
posteriores() {   # aplica, sobre $1, las migraciones de versión mayor que las nuestras
  for f in "$MIGS"/*.sql; do
    local base; base="$(basename "$f" .sql)"
    [[ "${base:0:14}" > "$ULTIMA" ]] || continue
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

echo "── 1/6 · andamiaje de plataforma y cadena de migraciones ANTERIORES a $PRIMERA"
aplicar "$BD" "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null   # (su único WARNING es el wal_level de la publicación)
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "${base:0:14}" < "$PRIMERA" ]] || continue
  aplicar "$BD" "$f"
  N=$((N + 1))
done
echo "  OK    $N migraciones aplicadas sobre una base vacía"

echo "── 2/6 · control previo: el padrón reproduce los huecos de ANTES"
copia "$BD" bpp_antes
aplicar bpp_antes "$AQUI/fixture.sql"
suite bpp_antes "$AQUI/antes.sql"

echo "── 3/6 · cada migración, DOS veces, y lo que cambia en la huella"
copia "$BD" bpp_post
huella bpp_post > "$TRABAJO/h0"
for m in "${NUESTRAS[@]}"; do
  aplicar bpp_post "$m"
  huella bpp_post > "$TRABAJO/h1"
  aplicar bpp_post "$m"
  huella bpp_post > "$TRABAJO/h2"
  cmp -s "$TRABAJO/h1" "$TRABAJO/h2" || { echo "❌ la segunda pasada de $(basename "$m") cambió la huella"; diff "$TRABAJO/h1" "$TRABAJO/h2" | head; exit 1; }
  echo "  OK    $(basename "$m" .sql): idempotente, la segunda pasada deja la misma huella"
done
CAMBIADOS=$( { diff <(cut -f1,2 "$TRABAJO/h0") <(cut -f1,2 "$TRABAJO/h1") || true; } | sed -n 's/^[<>] //p' | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')
ESPERADOS="tabla:asambleas/policies tabla:checklist_areas/policies tabla:incidentes_seguridad/policies tabla:permisos_obra_unidad/policies tabla:tickets_mantenimiento/policies "
[ "$CAMBIADOS" = "$ESPERADOS" ] || { echo "❌ la migración cambió otros grupos de la huella:"; echo "   cambiados: $CAMBIADOS"; echo "   esperados: $ESPERADOS"; exit 1; }
echo "  OK    entre las tres, la huella cambia EXACTAMENTE en las policies de las cinco tablas (ninguna función, grant ni columna)"
posteriores bpp_post

echo "── 4/6 · invariantes"
copia bpp_post bpp_inv
aplicar bpp_inv "$AQUI/fixture.sql"
suite bpp_inv "$AQUI/assert.sql"

echo "── 5/6 · guardas: con una policy permisiva de más, cada migración aborta"
guarda() {   # $1 = migración · $2 = policy de más · $3 = motivo esperado en el error
  copia "$BD" bpp_guarda
  local m
  for m in "${NUESTRAS[@]}"; do [ "$m" = "$1" ] && break; aplicar bpp_guarda "$m"; done   # las anteriores a la probada
  psql -q -v ON_ERROR_STOP=1 -d bpp_guarda -c "$2" >/dev/null
  local salida
  if salida=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d bpp_guarda -f "$1" 2>&1); then
    echo "❌ $(basename "$1") pasó en verde con una policy de más: la guarda es decorativa"; exit 1
  fi
  echo "$salida" | grep -q "$3" \
    || { echo "❌ $(basename "$1") falló, pero NO por la guarda esperada:"; echo "$salida" | sed -n 's/.*ERROR:  /  /p'; exit 1; }
  echo "  OK    aborta: $(echo "$salida" | sed -n 's/.*ERROR:  //p' | head -1)"
}
guarda "$BORRAR" "CREATE POLICY borrado_heredado ON public.asambleas FOR DELETE TO authenticated USING (true)" \
  'asambleas conserva 2 policies permisivas de borrado'
guarda "$EDITAR" "CREATE POLICY edicion_heredada ON public.checklist_areas FOR UPDATE TO authenticated USING (true)" \
  'checklist_areas conserva 2 policies permisivas de UPDATE'
guarda "$CREAR" "CREATE POLICY alta_heredada ON public.incidentes_seguridad FOR INSERT TO authenticated WITH CHECK (true)" \
  'incidentes_seguridad conserva 2 policies permisivas de INSERT'

echo "── 6/6 · mutantes: sin cada compuerta, la suite debe fallar"
# A las dos migraciones se les quita la guarda de postcondición: lo que se
# prueba aquí es que la SUITE detecta la regla rota, no que la guarda lo haga
# por ella. El texto se reemplaza en TODAS sus apariciones (USING y WITH CHECK
# repiten la misma condición); que aparezca al menos una vez es obligatorio.
sin_guarda() {   # $1 = migración · $2 = destino · [$3 patrón · $4 reemplazo]
  python3 - "$@" <<'PY'
import sys
src, dst, *mut = sys.argv[1:]
s = open(src, encoding='utf-8').read()
s = s[:s.index('-- ── 3 · Guarda de postcondición')]
if mut:
    pat, rep = mut
    if s.count(pat) == 0:
        sys.exit(1)
    s = s.replace(pat, rep)
open(dst, 'w', encoding='utf-8').write(s)
PY
  chmod 644 "$2"
}
mutante() {   # $1 = etiqueta · $2 = migración mutada · $3 = texto que se quita · $4 = reemplazo
  local m i=0
  copia "$BD" bpp_mut
  for m in "${NUESTRAS[@]}"; do   # todas sin guarda, en orden; sólo $2 lleva la mutación
    i=$((i + 1))
    if [ "$m" = "$2" ]; then
      sin_guarda "$m" "$TRABAJO/m$i.sql" "$3" "$4" || { echo "❌ el mutante «$1» no encuentra su texto en $(basename "$2")"; exit 1; }
    else
      sin_guarda "$m" "$TRABAJO/m$i.sql"
    fi
    aplicar bpp_mut "$TRABAJO/m$i.sql"
  done
  posteriores bpp_mut
  aplicar bpp_mut "$AQUI/fixture.sql"
  if psql -q -v ON_ERROR_STOP=1 -d bpp_mut -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$1» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$1] la suite falla"
}

mutante "Incidentes: ver no basta para borrar" "$BORRAR" \
  "(SELECT public.condominios_puede_actuar('incidentes', 'delete'))" \
  "(SELECT public.user_has_permission('condominios.tab.incidentes'))"
mutante "Asambleas: editar no es eliminar" "$BORRAR" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'delete'))" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'edit'))"
mutante "Checklist: sólo dentro de la empresa" "$BORRAR" \
  $'OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'checklist_areas\', \'delete\')))' \
  $'OR ((SELECT public.condominios_puede_actuar(\'checklist_areas\', \'delete\')))'
mutante "Permisos de obra: «Eliminar» del tab, no sólo admin" "$BORRAR" \
  "(SELECT public.condominios_puede_actuar('permisos_obra', 'delete'))" \
  "((SELECT public.current_user_role()) = ANY (ARRAY['company_owner','admin']))"
mutante "Tickets: dar de baja exige «Eliminar» (WITH CHECK)" "$BORRAR" \
  $'  WITH CHECK (\n    deleted_at IS NULL\n    OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'delete\'))\n  );' \
  $'  WITH CHECK (true);'
mutante "Tickets: restaurar exige «Eliminar» (USING)" "$BORRAR" \
  $'  USING (\n    deleted_at IS NULL\n    OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'delete\'))\n  )\n  WITH CHECK' \
  $'  USING (true)\n  WITH CHECK'
mutante "Tickets: la policy de baja es RESTRICTIVA" "$BORRAR" \
  $'  AS RESTRICTIVE\n' \
  ''

mutante "Incidentes: ver no basta para editar" "$EDITAR" \
  "(SELECT public.condominios_puede_actuar('incidentes', 'edit'))" \
  "(SELECT public.user_has_permission('condominios.tab.incidentes'))"
mutante "Asambleas: eliminar no es editar" "$EDITAR" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'edit'))" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'delete'))"
mutante "Checklist: editar sólo dentro de la empresa" "$EDITAR" \
  $'OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'checklist_areas\', \'edit\')))' \
  $'OR ((SELECT public.condominios_puede_actuar(\'checklist_areas\', \'edit\')))'
mutante "Permisos de obra: WITH CHECK no muda de empresa" "$EDITAR" \
  $'  WITH CHECK (\n    (SELECT public.is_super_admin())\n    OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'permisos_obra\', \'edit\')))\n  );' \
  $'  WITH CHECK ((SELECT public.condominios_puede_actuar(\'permisos_obra\', \'edit\')));'
mutante "Tickets: un ticket vivo exige editar" "$EDITAR" \
  $'  WITH CHECK (\n    deleted_at IS NOT NULL\n    OR (SELECT public.condominios_puede_actuar(\'mantenimiento\', \'edit\'))\n    OR (SELECT public.condominios_puede_actuar(\'kanban_tickets\', \'edit\'))\n  );' \
  $'  WITH CHECK (true);'
mutante "Tickets: el Kanban también edita" "$EDITAR" \
  $'\n    OR (SELECT public.condominios_puede_actuar(\'kanban_tickets\', \'edit\'))' \
  ''
mutante "Tickets: la policy de edición es RESTRICTIVA" "$EDITAR" \
  $'CREATE POLICY tickets_mantenimiento_vivo_exige_editar ON public.tickets_mantenimiento\n  AS RESTRICTIVE\n' \
  $'CREATE POLICY tickets_mantenimiento_vivo_exige_editar ON public.tickets_mantenimiento\n'
mutante "Incidentes: ver no basta para crear" "$CREAR" \
  "(SELECT public.condominios_puede_actuar('incidentes', 'create'))" \
  "(SELECT public.user_has_permission('condominios.tab.incidentes'))"
mutante "Asambleas: editar no es crear" "$CREAR" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'create'))" \
  "(SELECT public.condominios_puede_actuar('asambleas', 'edit'))"
mutante "Checklist: crear sólo en la propia empresa" "$CREAR" \
  $'OR (company_id = (SELECT public.get_my_company_id())\n        AND (SELECT public.condominios_puede_actuar(\'checklist_areas\', \'create\')))' \
  $'OR ((SELECT public.condominios_puede_actuar(\'checklist_areas\', \'create\')))'
mutante "Permisos de obra: eliminar no es crear" "$CREAR" \
  "(SELECT public.condominios_puede_actuar('permisos_obra', 'create'))" \
  "(SELECT public.condominios_puede_actuar('permisos_obra', 'delete'))"
mutante "Tickets: el staff necesita «Crear», no sólo ver" "$CREAR" \
  "(SELECT public.condominios_puede_actuar('mantenimiento', 'create'))" \
  "(SELECT public.user_has_permission('condominios.tab.mantenimiento'))"
mutante "Tickets: el residente reporta en sus unidades" "$CREAR" \
  $'\n    OR (unidad_id IN (SELECT public.mis_unidades_ids()))' \
  ''
echo
echo "✅ acciones_por_permiso: el padrón reproduce los huecos de antes; después,"
echo "   crear exige «Crear», editar «Editar» y borrar «Eliminar» del tab (ver, otra"
echo "   acción, tab oculto y otra empresa no alcanzan; el par legado y el admin sí;"
echo "   el Kanban edita tickets; el residente reporta en sus unidades), las guardas"
echo "   abortan de verdad y veinte mutantes rompen la suite."
