#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del catálogo de puntos de verificación (20260921000100).
#
# POR QUÉ EXISTE
# Lo que esta migración promete son RECHAZOS, y un rechazo no se comprueba
# leyendo el SQL: se comprueba intentándolo. Tres de ellos tienen además un filo
# que es fácil desafilar sin notarlo:
#
#   · el gate de evidencia mira la FILA QUE QUEDA, no la transición, pero deja
#     fuera `omitido` — si lo exigiera, un punto que el guardia no pudo visitar
#     bloquearía el cierre de la ronda entera;
#   · el guard de tenant corre en `UPDATE OF ruta_id, area_id, punto_id` con
#     guardia de cambio real — si validara la fila, reordenar una parada legada
#     que ya viole la regla sería imposible;
#   · el override por ruta es un COALESCE en LOS DOS SENTIDOS — si solo apretara,
#     `puntoExigeFoto` en cliente estaría mintiendo.
#
# QUÉ COMPRUEBA (12 invariantes)
#   A · SE EXIGE      el punto que hereda `requiere_foto` no cierra sin imagen,
#                     tampoco como novedad, y re-cerrar vuelve a exigir.
#   B · NO SE EXIGE   `omitido` queda fuera del gate; el punto sin exigencia y la
#                     parada LEGADA (sin catálogo) cierran de un clic; el
#                     override afloja además de apretar, y NULL rehereda.
#   C · NO SE MEZCLA  único por nombre normalizado POR ÁREA (el guard de la carga
#                     masiva), nombre en blanco rechazado, y ni un punto ni un
#                     área de otro proyecto se cuelgan de la ruta — el cruce que
#                     una RLS por empresa no ve. La FK compuesta ata la parada al
#                     área de su punto en ambas direcciones.
#   D · NO SE ROMPE   reordenar y reescribir una parada no tropieza con el guard;
#                     `creado_por` se sella y es inmutable; el área no se borra
#                     con puntos colgando y el punto sí arrastra sus paradas.
#
# USO
#   supabase/tests/puntos_verificacion/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_VOCAB="$RAIZ/supabase/migrations/20260920000000_visitas_control_vocabulario_estado.sql"
MIG="$RAIZ/supabase/migrations/20260921000100_puntos_verificacion_catalogo.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/pvdata.XXXX)
SOCK=$(mktemp -d /tmp/pvsock.XXXX)
PUERTO=${PGPORT_TEST:-55461}

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
psql -q -d postgres -c "CREATE DATABASE pv" >/dev/null
psql -q -d pv -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (esquema y padrón) ───────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pv -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones ──────────────────────────────────────"
for m in "$MIG_VOCAB" "$MIG"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pv -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · sembrar catálogo, ruta y ronda ───────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pv -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla cargada"

echo "── 4/5 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pv -f "$AQUI/assert.sql" 2>&1) || {
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
echo "── 5/5 · idempotencia (re-aplicar y re-verificar) ─────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pv -f "$MIG" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pv -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ puntos_verificacion: 13 invariantes (lo que se exige, lo que no, lo que"
echo "   no se mezcla entre proyectos y lo que no se rompe), migración idempotente."
