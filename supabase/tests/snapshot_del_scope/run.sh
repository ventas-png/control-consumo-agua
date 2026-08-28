#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260907000800: el UUID ajeno deja de ser credencial
#
# POR QUÉ EXISTE
# El trigger del snapshot (20260907000600 / #810) es SECURITY DEFINER y busca
# la plantilla POR ID: cualquier usuario autenticado que pueda crear tareas en
# SU bloque y conozca el UUID de una plantilla AJENA se lleva copiado su
# checklist, sus instrucciones de seguridad y sus exigencias — aunque la RLS
# jamás le dejaría leer esa plantilla. Y las FKs simples de tareas_bloque
# (plantilla_id, area_id, rutina_id) permiten colgar la referencia cruzada,
# porque el chequeo de FK ignora la RLS.
#
# QUÉ COMPRUEBA (con DOS compañías y DOS proyectos, como usuaria autenticada)
#   NEGATIVA   con 20260907000600 a solas, el ataque FUNCIONA: el snapshot de
#              la compañía B llega a una tarea de la compañía A. Si dejara de
#              reproducirse, el escenario no prueba nada.
#   RECHAZOS   tras 20260907000800: plantilla de otra compañía, plantilla de
#              otro proyecto de la MISMA compañía, área y rutina cruzadas — en
#              INSERT y en UPDATE — todas rechazadas con foreign_key_violation,
#              sin fila, sin columna copiada y sin datos ajenos en el mensaje.
#   SIN ORÁCULO el error responde LO MISMO para «ajena» e «inexistente».
#   INTACTO    la plantilla del scope correcto conserva su snapshot completo y
#              la tarea ad-hoc (plantilla_id NULL) sigue entrando limpia.
#   BARRIDO    como superusuario y sin RLS: cero referencias y cero columnas
#              del snapshot ajeno en TODA la tabla tras los intentos.
#   + IDEMPOTENCIA  re-aplicar no duplica triggers ni afloja el guard.
#
# El fixture es el de snapshot_al_crear (forma real de producción: RLS, RBAC,
# GRANTs de Supabase, padrón con permisos disjuntos) más la semilla de los dos
# scopes ajenos; encima corren las MIGRACIONES REALES del módulo.
#
# USO
#   supabase/tests/snapshot_del_scope/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
FIXTURE="$RAIZ/supabase/tests/snapshot_al_crear/fixture.sql"
MIGS=(
  "$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
  "$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
  "$RAIZ/supabase/migrations/20260904000300_plantilla_tarea_recursos.sql"
  "$RAIZ/supabase/migrations/20260907000200_rutinas_limpieza.sql"
  "$RAIZ/supabase/migrations/20260907000300_materializar_rutinas.sql"
  "$RAIZ/supabase/migrations/20260907000400_evidencia_al_cerrar.sql"
  "$RAIZ/supabase/migrations/20260907000600_snapshot_al_crear_tarea.sql"
)
MIG_SCOPE="$RAIZ/supabase/migrations/20260907000800_snapshot_y_referencias_del_scope.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/scopedata.XXXX)
SOCK=$(mktemp -d /tmp/scopesock.XXXX)
PUERTO=${PGPORT_TEST:-55490}

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
psql -q -d postgres -c "CREATE DATABASE scopedb" >/dev/null
psql -q -d scopedb -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d scopedb "$@"; }

asertar() { # asertar <archivo.sql>
  local SALIDA
  SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d scopedb -f "$1" 2>&1) || {
    sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
    echo
    echo "❌ invariante incumplida:"
    sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
    exit 1
  }
  sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
  if grep -q 'WARNING:' <<<"$SALIDA"; then
    echo
    echo "❌ algo se tragó un error:"
    sed -n 's/.*WARNING:  /  ⚠ /p' <<<"$SALIDA"
    exit 1
  fi
}

echo "── 1/6 · fixture (forma real) y migraciones del módulo ─────────────────"
silencio -f "$FIXTURE" >/dev/null
for m in "${MIGS[@]}"; do
  silencio -f "$m" >/dev/null
done
echo "  OK    fixture + $(basename "${MIGS[0]}")…$(basename "${MIGS[6]}")"

echo "── 2/6 · sembrar los dos scopes ajenos ─────────────────────────────────"
silencio -f "$AQUI/seed.sql" >/dev/null
echo "  OK    dos compañías, dos proyectos, plantillas marcadas SECRETO"

echo "── 3/6 · NEGATIVA: sin la reparación, el ataque funciona ───────────────"
asertar "$AQUI/pre_assert.sql"

echo "── 4/6 · aplicar la reparación ─────────────────────────────────────────"
silencio -f "$MIG_SCOPE" >/dev/null
echo "  OK    $(basename "$MIG_SCOPE")"

echo "── 5/6 · invariantes ───────────────────────────────────────────────────"
asertar "$AQUI/assert.sql"

echo
echo "── 6/6 · idempotencia (re-aplicar) ─────────────────────────────────────"
silencio -f "$MIG_SCOPE" >/dev/null
asertar "$AQUI/reassert.sql"

echo
echo "✅ snapshot_del_scope: el UUID ajeno ya no inserta la referencia ni copia"
echo "   checklist, instrucciones o exigencias; las plantillas del scope y las"
echo "   tareas ad-hoc conservan su comportamiento (INSERT y UPDATE, sin oráculo)."
