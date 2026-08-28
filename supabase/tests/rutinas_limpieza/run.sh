#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de las rutinas de limpieza (20260907000200).
#
# POR QUÉ EXISTE
# La migración descansa en CUATRO FKs compuestas (id, company_id, project_id) y
# un trigger de sellado. Ninguna de las dos cosas se puede verificar leyendo el
# SQL: que una FK compuesta esté escrita no demuestra que el motor rechace mover
# de proyecto una fila ya relacionada, y que el trigger exista no demuestra que
# imponga el tenant por encima de lo que mande el cliente. El fallo silencioso
# que se busca prevenir es el peor de todos en multi-tenant: una rutina de un
# condominio apuntando a un área o a una actividad de otro.
#
# QUÉ COMPRUEBA (11 invariantes)
#   A · DEFINICIÓN  la rutina se crea, sabe de quién es y la BD impone el autor
#                   (sello inmutable); nombre en blanco y servicio fuera de
#                   dominio rechazados; el duplicado por nombre normalizado
#                   —acentos, mayúsculas y espacios— bloqueado, pero el
#                   homónimo de OTRO proyecto convive.
#   B · TENANT      área y jornada no cruzan empresa NI proyecto; sin ellas la
#                   rutina se acepta (MATCH SIMPLE); el paso hereda el tenant de
#                   su rutina aunque el cliente mienta; actividad ajena abortada
#                   distinguiendo "de otro tenant" de "no existe"; una actividad
#                   por rutina; y el tenant queda CONGELADO — rutina, actividad
#                   y área ya relacionadas no se mudan de proyecto.
#   C · BORRADO     lo referenciado (actividad, área, jornada) no se borra;
#                   la rutina sí y se lleva sus pasos.
#   D · RLS         prog_limpieza administra la rutina completa SIN permisos del
#                   módulo Seguridad; sin permiso no hay lectura ni escritura;
#                   la empresa vecina —con el MISMO permiso— no ve ni escribe lo
#                   ajeno; anon fuera y la SECURITY DEFINER sin EXECUTE público.
#   + IDEMPOTENCIA  re-aplicar no duplica policies ni triggers, no pierde datos
#                   y conserva las garantías.
#
# USO
#   supabase/tests/rutinas_limpieza/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
# Las migraciones REALES de las que depende: de ellas salen
# `areas_normalizar_nombre` y el ancla `plantillas_cargo_id_tenant_uq`. Se
# aplican en vez de copiarlas al fixture, que es como los fixtures se
# desincronizan del repo.
MIG_AREAS="$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
MIG_PLANT="$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
MIG_RUTINAS="$RAIZ/supabase/migrations/20260907000200_rutinas_limpieza.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/rutinasdata.XXXX)
SOCK=$(mktemp -d /tmp/rutinassock.XXXX)
PUERTO=${PGPORT_TEST:-55449}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE rutinas" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# revocan/conceden permisos por nombre de rol.
psql -q -d rutinas -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture (estado previo a la serie 20260904*) ──────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rutinas -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/4 · aplicar las migraciones ──────────────────────────────────────"
for m in "$MIG_AREAS" "$MIG_PLANT" "$MIG_RUTINAS"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rutinas -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/4 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rutinas -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algo se tragó un error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── 4/4 · idempotencia (re-aplicar y re-verificar) ──────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rutinas -f "$MIG_RUTINAS" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rutinas -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ rutinas_limpieza: 11 invariantes (definición, tenant congelado por FK"
echo "   compuesta, borrado y RLS por prog_limpieza), migración idempotente."
