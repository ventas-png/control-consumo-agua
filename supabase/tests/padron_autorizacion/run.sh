#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261101000000_padron_mascotas_vehiculos_autorizacion:
# el residente registra mascotas y vehículos desde el portal y la
# administración los autoriza (con TAG de ingreso para los vehículos).
#
# QUÉ COMPRUEBA (34 invariantes, ver assert.sql)
#   · la base impide que algo no aprobado esté activo, y el padrón previo queda
#     intacto (aprobado/activo)
#   · el residente solo escribe por las RPC: reservar idempotente, validación
#     server-side de vacunas/fechas/placa/foto/documentos, expediente inmutable
#   · inquilino, vecina, otra empresa y staff sin permiso: cada uno solo hace
#     lo que le toca
#   · aprobación con TAG único por condominio, rechazo con motivo, avisos
#   · baja libera el TAG; descartar borra solo borradores; ACL
#   · mutantes: copias de la migración, cada una sin una compuerta → la suite
#     DEBE fallar (si pasa, la regla no está probada)
#
# USO:  supabase/tests/padron_autorizacion/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
NUESTRA="$RAIZ/supabase/migrations/20261101000000_padron_mascotas_vehiculos_autorizacion.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/padrondata.XXXX)
SOCK=$(mktemp -d /tmp/padronsock.XXXX)
MUT=$(mktemp /tmp/padronmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55471}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$MUT"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; chmod 644 "$MUT"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;" >/dev/null
for db in padron padm1 padm2 padm3 padm4 padm5 padm6 padm7 padm8; do
  psql -q -d postgres -c "CREATE DATABASE $db" >/dev/null
done

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() {
  psql -q -At -d padron <<'SQL'
SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con:' || conname || ':' || pg_get_constraintdef(oid) FROM pg_constraint
   WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx:' || indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'fn:' || p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ','), '')
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'pol:' || schemaname || '.' || policyname || ':' || coalesce(qual, '') || coalesce(with_check, '')
    FROM pg_policies
  UNION ALL SELECT 'trg:' || tgname || ':' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
) s(x);
SQL
}

echo "── 1/4 · fixture: esquema, padrón previo y policies VIGENTES ───────────"
aplicar padron "$AQUI/fixture.sql"
echo "  OK    mascotas/vehiculos_residentes con su RLS real, storage y cuentas"

echo "── 2/4 · la migración, DOS veces ───────────────────────────────────────"
aplicar padron "$NUESTRA"
H1=$(huella)
aplicar padron "$NUESTRA"
H2=$(huella)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: el catálogo no cambia al re-aplicar"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d padron -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi

TOTAL=$(echo "$SALIDA" | grep -c "NOTICE:  [0-9]* *OK")
echo "  OK    $TOTAL comprobaciones"

echo "── 4/4 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
mutante() {   # $1 = base · $2 = etiqueta · $3 = texto que se reemplaza · $4 = reemplazo
  grep -qF -- "$3" "$NUESTRA" || { echo "❌ el mutante «$2» no encuentra su línea en la migración: $3"; exit 1; }
  python3 - "$NUESTRA" "$MUT" "$3" "$4" <<'PY'
import sys
src, dst, pat, rep = sys.argv[1:5]
s = open(src, encoding='utf-8').read()
assert s.count(pat) >= 1
open(dst, 'w', encoding='utf-8').write(s.replace(pat, rep, 1))
PY
  aplicar "$1" "$AQUI/fixture.sql"
  aplicar "$1" "$MUT"
  if psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    echo "❌ el mutante «$2» pasó la suite: la regla no está probada"; exit 1
  fi
  echo "  OK    sin [$2] la suite falla"
}
mutante padm1 "vacuna obligatoria"     "IF v_especie IN ('perro', 'gato') AND jsonb_array_length(v_vacunas) = 0 THEN" "IF false THEN"
mutante padm2 "vacuna no futura"       "    IF v_fecha > v_hoy THEN"                                                  "    IF false THEN"
mutante padm3 "placa única"            "       AND x.estado IN ('pendiente', 'aprobada')"                              "       AND false"
mutante padm4 "motivo del rechazo"     "  IF NOT p_aprobar AND v_comentario IS NULL THEN"                              "  IF false THEN"
mutante padm5 "permiso de vehículos"   "        AND public.user_has_permission('condominios.tab.vehiculos'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver" "        OR true)
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver"
mutante padm6 "expediente inmutable"   "             AND m.estado = 'borrador' AND m.cliente_id"                     "             AND m.cliente_id"
mutante padm7 "carpeta de documentos"  "    IF left(v_doc->>'path', length(p_prefijo)) <> p_prefijo OR"               "    IF false AND"
mutante padm8 "activo solo aprobada"   "\$c\$CHECK (activo = false OR estado = 'aprobada')\$c\$],
    ['mascotas', 'mascotas_documentos_check'," "\$c\$CHECK (true)\$c\$],
    ['mascotas', 'mascotas_documentos_check',"

echo
echo "✅ padron_autorizacion: mascotas y vehículos se registran por RPC, nada no aprobado queda activo, la administración autoriza con TAG único y cada actor solo toca lo suyo."
