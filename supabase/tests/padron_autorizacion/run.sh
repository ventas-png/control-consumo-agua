#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261031000500_padron_mascotas_vehiculos_autorizacion:
# el residente registra mascotas y vehículos desde el portal y la
# administración los autoriza (con TAG de ingreso para los vehículos).
#
# QUÉ COMPRUEBA (37 invariantes en assert.sql + concurrencia + auditoría)
#   · la base impide que algo no aprobado esté activo, y el padrón previo queda
#     intacto (aprobado/activo)
#   · el residente solo escribe por las RPC: reservar idempotente, validación
#     server-side de vacunas/fechas/placa/foto/documentos, expediente inmutable
#   · inquilino, vecina, otra empresa y staff sin permiso: cada uno solo hace
#     lo que le toca
#   · aprobación con TAG único por condominio, rechazo con motivo, avisos
#   · placa única por proyecto garantizada por la base (idx_vehiculos_placa_unica)
#   · baja libera el TAG; descartar borra solo borradores; ACL
#   · concurrencia con SESIONES REALES: dos envíos simultáneos de la misma
#     placa (normalizada) → solo uno queda; si el primero se revierte, el
#     segundo entra
#   · auditoría previa: con placas duplicadas preexistentes la migración aborta
#     nombrándolas, sin alterar ni una fila
#   · mutantes: copias de la migración, cada una sin una compuerta → la suite
#     DEBE fallar (si pasa, la regla no está probada)
#
# USO:  supabase/tests/padron_autorizacion/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
NUESTRA="$RAIZ/supabase/migrations/20261031000500_padron_mascotas_vehiculos_autorizacion.sql"

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
for db in padron padconc padaud padm1 padm2 padm3 padm4 padm5 padm6 padm7 padm8 padm9 padm10; do
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

echo "── 1/6 · fixture: esquema, padrón previo y policies VIGENTES ───────────"
aplicar padron "$AQUI/fixture.sql"
echo "  OK    mascotas/vehiculos_residentes con su RLS real, storage y cuentas"

echo "── 2/6 · la migración, DOS veces ───────────────────────────────────────"
aplicar padron "$NUESTRA"
H1=$(huella)
aplicar padron "$NUESTRA"
H2=$(huella)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: el catálogo no cambia al re-aplicar"

echo "── 3/6 · invariantes ───────────────────────────────────────────────────"
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

# ── Concurrencia ────────────────────────────────────────────────────────────
# Dos residentes de unidades distintas envían A LA VEZ la misma placa (con otra
# grafía). La sesión A envía y mantiene la transacción abierta; B envía mientras
# tanto: su IF EXISTS no ve la fila sin confirmar de A, así que solo el índice
# único puede detenerla. Debe ESPERAR a A y fallar con el mensaje de placa
# duplicada. En el segundo escenario A revierte y B debe entrar.
MARCO=e0000000-0000-0000-0000-00000000000c   # 1D
LUIS=e0000000-0000-0000-0000-00000000000d    # inquilino de 1D
ANA=e0000000-0000-0000-0000-00000000000e     # 3D
U1=11d10000-0000-0000-0000-000000000001
U3=11d10000-0000-0000-0000-000000000003

reservar() {   # $1 base · $2 usuario · $3 unidad → id del borrador
  psql -q -X -At -v ON_ERROR_STOP=1 -d "$1" <<SQL | tail -1
SELECT set_config('app.uid', '$2', false) \\g /dev/null
SET ROLE authenticated;
SELECT public.portal_reservar_vehiculo('$3');
SQL
}
enviar_en_tx() {   # $1 base · $2 usuario · $3 id · $4 placa · $5 espera con la tx abierta · $6 COMMIT|ROLLBACK
  psql -q -X -At -v ON_ERROR_STOP=1 -d "$1" <<SQL
SELECT set_config('app.uid', '$2', false) \\g /dev/null
SET ROLE authenticated;
BEGIN;
SELECT public.portal_enviar_vehiculo('$3', '{"placa":"$4","tipo":"auto"}'::jsonb, '[]'::jsonb) \\g /dev/null
SELECT pg_sleep($5) \\g /dev/null
$6;
SQL
}
contar() {   # $1 base · $2 placa normalizada → filas pendientes/aprobadas con esa placa
  psql -q -X -At -d "$1" -c "SELECT count(*) FROM public.vehiculos_residentes WHERE estado IN ('pendiente','aprobada') AND upper(regexp_replace(btrim(placa), '\\s+', ' ', 'g')) = '$2'"
}
estado_de() { psql -q -X -At -d "$1" -c "SELECT estado FROM public.vehiculos_residentes WHERE id = '$2'"; }

concurrencia() {   # $1 base ya preparada (fixture + migración). Devuelve ≠0 si la garantía no se sostiene.
  local db=$1 A B C t0 t1 espera salidaB
  A=$(reservar "$db" "$MARCO" "$U1"); B=$(reservar "$db" "$ANA" "$U3"); C=$(reservar "$db" "$LUIS" "$U1")
  [ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] || { echo "    no se pudieron reservar los borradores"; return 1; }

  # Escenario 1: A confirma → B debe quedar fuera.
  enviar_en_tx "$db" "$MARCO" "$A" "P-500CON" 3 COMMIT >/dev/null 2>&1 &
  local pidA=$!
  sleep 1
  t0=$(date +%s%N)
  salidaB=$(enviar_en_tx "$db" "$ANA" "$B" " p-500con " 0 COMMIT 2>&1) && { echo "    B confirmó la misma placa"; wait $pidA; return 1; }
  t1=$(date +%s%N)
  wait $pidA || { echo "    la sesión A falló"; return 1; }
  espera=$(( (t1 - t0) / 1000000 ))
  echo "$salidaB" | grep -q "ya está registrada o en revisión" || { echo "    B falló por otra causa: $salidaB"; return 1; }
  [ "$(contar "$db" P-500CON)" = "1" ] || { echo "    quedaron $(contar "$db" P-500CON) filas con la placa P-500CON"; return 1; }
  [ "$(estado_de "$db" "$B")" = "borrador" ] || { echo "    el borrador de B cambió de estado"; return 1; }
  [ "$espera" -ge 1200 ] || { echo "    B no esperó al índice (${espera} ms): la carrera no se ejerció"; return 1; }
  echo "  OK    escenario 1: B esperó ${espera} ms a la transacción de A y fue rechazada; una sola fila P-500CON"

  # Escenario 2: A revierte → B (el mismo borrador) debe entrar.
  enviar_en_tx "$db" "$LUIS" "$C" "P-600CON" 3 ROLLBACK >/dev/null 2>&1 &
  pidA=$!
  sleep 1
  salidaB=$(enviar_en_tx "$db" "$ANA" "$B" "p 600con" 0 COMMIT 2>&1) || { echo "    B fue rechazada aunque A revirtió: $salidaB"; wait $pidA; return 1; }
  wait $pidA || true
  [ "$(estado_de "$db" "$B")" = "pendiente" ] && [ "$(estado_de "$db" "$C")" = "borrador" ] \
    || { echo "    tras el ROLLBACK de A, B no quedó pendiente o A no quedó en borrador"; return 1; }
  [ "$(contar "$db" 'P 600CON')" = "1" ] || { echo "    filas con P 600CON: $(contar "$db" 'P 600CON')"; return 1; }
  echo "  OK    escenario 2: A revirtió y B entró; sin rechazos falsos"
}

echo "── 4/6 · concurrencia con sesiones reales ──────────────────────────────"
aplicar padconc "$AQUI/fixture.sql"
aplicar padconc "$NUESTRA"
concurrencia padconc || { echo "❌ dos envíos simultáneos de la misma placa no se resolvieron como se espera"; exit 1; }

# ── Auditoría previa ────────────────────────────────────────────────────────
# Supabase aplica cada migración en una transacción: --single-transaction lo
# reproduce. Con duplicados preexistentes la migración debe abortar nombrándolos
# y dejar la base EXACTAMENTE como estaba (datos y esquema).
echo "── 5/6 · auditoría de placas duplicadas preexistentes ─────────────────"
aplicar padaud "$AQUI/fixture.sql"
psql -q -X -v ON_ERROR_STOP=1 -d padaud >/dev/null <<'SQL'
INSERT INTO public.vehiculos_residentes (id, company_id, project_id, unidad_id, placa, tipo) VALUES
  ('bb000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', '11d10000-0000-0000-0000-000000000001', 'p-777aaa', 'auto'),
  ('bb000000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', '11d10000-0000-0000-0000-000000000002', 'M 42  XY', 'moto'),
  ('bb000000-0000-0000-0000-0000000000d3', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', '11d10000-0000-0000-0000-000000000002', 'm 42 xy', 'moto');
SQL
ANTES=$(psql -q -X -At -d padaud -c "SELECT md5(string_agg(to_jsonb(v)::text, '|' ORDER BY id)) FROM public.vehiculos_residentes v")
CODIGO=0
SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -q -X --single-transaction -v ON_ERROR_STOP=1 -d padaud -f "$NUESTRA" 2>&1) || CODIGO=$?
DESPUES=$(psql -q -X -At -d padaud -c "SELECT md5(string_agg(to_jsonb(v)::text, '|' ORDER BY id)) FROM public.vehiculos_residentes v")
COLS=$(psql -q -X -At -d padaud -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'vehiculos_residentes' AND column_name = 'estado'")
[ "$CODIGO" -ne 0 ] || { echo "❌ la migración se aplicó con placas duplicadas"; exit 1; }
echo "$SALIDA" | grep -q "Hay 2 placa(s) duplicada(s)" || { echo "❌ la migración falló, pero no por la auditoría: $SALIDA"; exit 1; }
echo "$SALIDA" | grep -q "placa P-777AAA" && echo "$SALIDA" | grep -q "placa M 42 XY" \
  || { echo "❌ el aviso no nombra los grupos duplicados: $SALIDA"; exit 1; }
[ "$ANTES" = "$DESPUES" ] || { echo "❌ la auditoría alteró filas existentes"; exit 1; }
[ "$COLS" = "0" ] || { echo "❌ la migración dejó cambios a medias"; exit 1; }
echo "  OK    con duplicados preexistentes aborta nombrando P-777AAA y M 42 XY; filas y esquema intactos"

echo "── 6/6 · mutantes: sin cada compuerta, la suite debe fallar ────────────"
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
mutante padm3 "placa única en la base" "CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_placa_unica"                 "CREATE INDEX IF NOT EXISTS idx_vehiculos_placa_unica"
mutante padm10 "solo pendiente/aprobada reservan la placa" "  ON public.vehiculos_residentes (project_id, upper(regexp_replace(btrim(placa), '\\s+', ' ', 'g')))
  WHERE estado IN ('pendiente', 'aprobada');" "  ON public.vehiculos_residentes (project_id, upper(regexp_replace(btrim(placa), '\\s+', ' ', 'g')))
  WHERE estado <> 'borrador';"
mutante padm4 "motivo del rechazo"     "  IF NOT p_aprobar AND v_comentario IS NULL THEN"                              "  IF false THEN"
mutante padm5 "permiso de vehículos"   "        AND public.user_has_permission('condominios.tab.vehiculos'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver" "        OR true)
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver"
mutante padm6 "expediente inmutable"   "             AND m.estado = 'borrador' AND m.cliente_id"                     "             AND m.cliente_id"
mutante padm7 "carpeta de documentos"  "    IF left(v_doc->>'path', length(p_prefijo)) <> p_prefijo OR"               "    IF false AND"
mutante_concurrencia() {   # el índice es la ÚNICA defensa ante la carrera: sin él, el paso 4 debe fallar
  local pat="CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_placa_unica"
  grep -qF -- "$pat" "$NUESTRA" || { echo "❌ el mutante de concurrencia no encuentra el índice"; exit 1; }
  python3 - "$NUESTRA" "$MUT" "$pat" <<'PY'
import sys
src, dst, pat = sys.argv[1:4]
s = open(src, encoding='utf-8').read()
i = s.index(pat); j = s.index(';', i) + 1
open(dst, 'w', encoding='utf-8').write(s[:i] + '-- (mutante: sin índice de placa)' + s[j:])
PY
  aplicar padm9 "$AQUI/fixture.sql"
  aplicar padm9 "$MUT"
  local motivo
  if motivo=$(concurrencia padm9 2>&1); then
    echo "❌ sin idx_vehiculos_placa_unica la prueba de concurrencia pasó: no prueba la carrera"; exit 1
  fi
  echo "  OK    sin [índice de placa] la prueba de concurrencia falla (el IF EXISTS solo no basta):"
  echo "$motivo" | grep -v "^  OK" | sed 's/^ */          → /' | head -2
}
mutante_concurrencia
mutante padm8 "activo solo aprobada"   "\$c\$CHECK (activo = false OR estado = 'aprobada')\$c\$],
    ['mascotas', 'mascotas_documentos_check'," "\$c\$CHECK (true)\$c\$],
    ['mascotas', 'mascotas_documentos_check',"

echo
echo "✅ padron_autorizacion: mascotas y vehículos se registran por RPC, nada no aprobado queda activo, la administración autoriza con TAG único y cada actor solo toca lo suyo."
