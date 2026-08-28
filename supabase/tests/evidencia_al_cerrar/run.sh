#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del gate de evidencia (20260907000400).
#
# POR QUÉ EXISTE
# El punto de este trigger es que la base RECHACE, y un rechazo no se comprueba
# leyendo el SQL: se comprueba intentándolo. Además la regla tiene dos filos que
# es fácil desafilar sin notarlo — que gatee la TRANSICIÓN y no la fila (si
# validara la fila, editar una tarea vieja reventaría y migrar datos sería
# imposible), y que `con_observacion` / `omitida` queden exentas (exigirles la
# evidencia completa empuja a cerrar en falso, justo lo que se quiere evitar).
#
# QUÉ COMPRUEBA (10 invariantes)
#   A · SE EXIGE      sin foto no cierra la que la exige; sin comentario
#                     tampoco, y en blanco no cuenta; el checklist se exige
#                     COMPLETO, y marcar tres veces el mismo paso no lo completa.
#   B · NO SE EXIGE   la tarea sin exigencias cierra sin ceremonia; con
#                     `motivo_sin_evidencia` declarado también, y un motivo en
#                     blanco NO funciona como bypass; `con_observacion` y
#                     `omitida` no pasan por el gate.
#   C · NO RE-VALIDA  la fila cerrada hace meses sin evidencia se sigue pudiendo
#                     editar (incluso re-afirmando su estado); pero reabrir y
#                     volver a cerrar SÍ vuelve a exigir. Y el trigger no es
#                     SECURITY DEFINER: no lee nada fuera de su fila.
#   D · CONVIVENCIA   el trigger NO corre solo: 20260907000100 ya dejó
#                     `trg_sellar_cierre` y `trg_tareas_bloque_anulacion` sobre
#                     esta misma tabla, los tres son BEFORE UPDATE FOR EACH ROW
#                     y PostgreSQL los dispara en ORDEN ALFABÉTICO, así que el
#                     de evidencia va PRIMERO. Se cierra con el gesto real de
#                     la app (estado + completada_en) y se exige que pasar el
#                     control y quedar sellada ocurran juntos; y que un rechazo
#                     no deje la fila a medio sellar.
#   + IDEMPOTENCIA    re-aplicar no duplica el trigger, conserva los cierres y
#                     sigue exigiendo.
#
# USO
#   supabase/tests/evidencia_al_cerrar/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS=(
  "$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
  "$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
  "$RAIZ/supabase/migrations/20260907000200_rutinas_limpieza.sql"
  "$RAIZ/supabase/migrations/20260907000300_materializar_rutinas.sql"
  "$RAIZ/supabase/migrations/20260907000400_evidencia_al_cerrar.sql"
)
MIG_EVID="${MIGS[4]}"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/eviddata.XXXX)
SOCK=$(mktemp -d /tmp/evidsock.XXXX)
PUERTO=${PGPORT_TEST:-55457}

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
psql -q -d postgres -c "CREATE DATABASE evid" >/dev/null
psql -q -d evid -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/5 · fixture (esquema y padrón) ───────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d evid -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones ──────────────────────────────────────"
for m in "${MIGS[@]}"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d evid -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/5 · sembrar las tareas de prueba ─────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d evid -f "$AQUI/seed.sql" >/dev/null
echo "  OK    semilla cargada"

echo "── 4/5 · invariantes ──────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d evid -f "$AQUI/assert.sql" 2>&1) || {
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
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d evid -f "$MIG_EVID" >/dev/null
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d evid -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ evidencia_al_cerrar: 10 invariantes (lo que se exige, lo que no, lo que"
echo "   no se re-valida y la convivencia con el sellado), migración idempotente."
