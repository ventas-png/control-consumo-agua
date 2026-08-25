#!/usr/bin/env bash
# Corre la migración de cierre posfusión (20260903000000) contra un Postgres
# desechable, en siete escenarios, y comprueba QUÉ HIZO en cada uno.
#
# La migración no se copia: se aplica el archivo real del repo. Si alguien la
# afloja —un IF EXISTS de más, una comparación que deja de comparar—, los
# escenarios que esperan un aborto se vuelven verdes y esto lo dice.
#
#   scripts/cierre-posfusion-sandbox.sh
#   PGURL=postgres://... scripts/cierre-posfusion-sandbox.sh   # base DESECHABLE
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base DESECHABLE.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260903000000_recepcion_cierre_posfusion.sql"
ANDAMIAJE="$RAIZ/scripts/cierre-posfusion-sandbox.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$MIGRACION" ]] || { echo "✗ No existe $MIGRACION" >&2; exit 1; }

# ── Base desechable ─────────────────────────────────────────────────────────
if [[ -n "${PGURL:-}" ]]; then
  PSQL_BASE=(psql "$PGURL")
  ADMIN=("${PSQL_BASE[@]}")
  usar_db() { PSQL=(psql "${PGURL%/*}/$1"); }
else
  PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
  DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"
  COMO=""
  if [[ "$(id -u)" == "0" ]]; then COMO="ubuntu"; chown -R "$COMO" "$TMP"; fi
  correr() { if [[ -n "$COMO" ]]; then su "$COMO" -c "$1"; else bash -c "$1"; fi }
  correr "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
  correr "$PGBIN/pg_ctl -D $DATA -o '-p 55433 -k $SOCK -c listen_addresses=' -l $TMP/pg.log start" >/dev/null
  trap 'correr "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  ADMIN=(psql -h "$SOCK" -p 55433 -U postgres -d postgres)
  usar_db() { PSQL=(psql -h "$SOCK" -p 55433 -U postgres -d "$1"); }
fi

FALLOS=0
ok()    { echo "  ok  $1"; }
falla() { echo "  ✗   $1"; FALLOS=$((FALLOS + 1)); }

# consulta <sql> → imprime el escalar
consulta() { "${PSQL[@]}" -tAqc "$1"; }

# afirma <descripción> <obtenido> <esperado>
afirma() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else falla "$1 (obtenido: '$2', esperado: '$3')"; fi
}

# contiene <descripción> <archivo> <patrón>
contiene() {
  if grep -qF -- "$3" "$2"; then ok "$1"; else falla "$1 — no apareció: $3"; fi
}

# ── El escenario ────────────────────────────────────────────────────────────
# monta <escenario> → deja $PSQL apuntando a una base nueva, ya sembrada, y la
# migración ya aplicada; $RC con su código de salida y $ERR con su salida.
aplica() {
  ERR="$TMP/$1.err"
  set +e
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$MIGRACION" >"$TMP/$1.out" 2>"$ERR"
  RC=$?
  set -e
}

monta() {
  local esc="$1" db="esc_${1//-/_}"
  "${ADMIN[@]}" -qc "CREATE DATABASE $db" >/dev/null
  usar_db "$db"
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$ANDAMIAJE" >/dev/null
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -c "CALL sandbox.montar('$esc')" >/dev/null
  aplica "$esc"
  echo
  echo "── $esc ── (psql salió $RC)"
}

validada()      { consulta "SELECT convalidated FROM pg_constraint WHERE conname='paquetes_estado_chk'"; }
comentario()    { consulta "SELECT obj_description('public.correspondencia_condominio'::regclass, 'pg_class')"; }
# Huella del CONTENIDO del respaldo, no sólo de su conteo: una fila alterada en
# sitio no cambia el número de filas.
huella()        { consulta "SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r.id), '∅')) FROM public.correspondencia_condominio_respaldo r"; }
COMENTARIO_PREVIO='COMENTARIO ANTERIOR DEL SANDBOX — no debe cambiar si la migración aborta'
hay_respaldo()  { consulta "SELECT to_regclass('public.correspondencia_condominio_respaldo') IS NOT NULL"; }
filas_respaldo(){ consulta "SELECT count(*) FROM public.correspondencia_condominio_respaldo"; }
id_de()         { consulta "SELECT sandbox.id('$1')"; }

# ════════════════════════════════════════════════════════════════════════════
# 1 · Vocabulario válido: las siete combinaciones admitidas pasan
# ════════════════════════════════════════════════════════════════════════════
monta vocabulario-valido
afirma "la migración aplica"                       "$RC" "0"
afirma "el CHECK queda VALIDADO"                   "$(validada)" "t"
contiene "informa que no hay combinaciones inválidas" "$ERR" "sin combinaciones inválidas"

# ════════════════════════════════════════════════════════════════════════════
# 2 · Vocabulario inválido: aborta y ENUMERA, no sólo cuenta
# ════════════════════════════════════════════════════════════════════════════
monta vocabulario-invalido
afirma "la migración ABORTA"                       "$([[ $RC -ne 0 ]] && echo si || echo no)" "si"
contiene "dice cuántas filas son"                  "$ERR" "4 fila(s) fuera del vocabulario"
contiene "enumera paquete/atendido"                "$ERR" "clase='paquete' estado='atendido'"
contiene "enumera correspondencia/entregado"       "$ERR" "clase='correspondencia' estado='entregado'"
contiene "enumera la clase inventada"              "$ERR" "clase='sobre' estado='pendiente'"
contiene "agrupa: dos filas con la misma combinación" "$ERR" "→ 2 fila(s)"
contiene "el HINT dice el vocabulario admitido"    "$ERR" "pendiente|entregado|devuelto"
afirma "el CHECK NO se validó"                     "$(validada)" "f"
afirma "el comentario de la vista NO cambió"       "$(comentario)" "$COMENTARIO_PREVIO"

# ════════════════════════════════════════════════════════════════════════════
# 3 · Respaldo vacío: se retira sin ceremonia
# ════════════════════════════════════════════════════════════════════════════
monta respaldo-vacio
afirma "la migración aplica"                       "$RC" "0"
afirma "el respaldo se retiró"                     "$(hay_respaldo)" "f"
afirma "el CHECK queda VALIDADO"                   "$(validada)" "t"
contiene "informa las filas verificadas"           "$ERR" "Respaldo verificado (0 fila(s))"

# ════════════════════════════════════════════════════════════════════════════
# 4 · Respaldo completo: se verifica campo a campo y se retira
# ════════════════════════════════════════════════════════════════════════════
monta respaldo-completo
afirma "la migración aplica"                       "$RC" "0"
afirma "el respaldo se retiró"                     "$(hay_respaldo)" "f"
afirma "el CHECK queda VALIDADO"                   "$(validada)" "t"
contiene "verificó las tres filas"                 "$ERR" "Respaldo verificado (3 fila(s))"
afirma "la correspondencia migrada sigue ahí"      \
  "$(consulta "SELECT count(*) FROM public.paquetes_recibidos WHERE clase='correspondencia'")" "3"
afirma "el relleno de acuse se aceptó como esperado" \
  "$(consulta "SELECT entregado_a_nombre FROM public.paquetes_recibidos WHERE id=sandbox.id('r2')")" \
  "No registrado (acuse anterior a 2026-08-31)"
afirma "la pieza de paquetería quedó intacta"      \
  "$(consulta "SELECT estado FROM public.paquetes_recibidos WHERE id=sandbox.id('paq')")" "entregado"

# ════════════════════════════════════════════════════════════════════════════
# 5 · Respaldo incompleto: falta una pieza en destino → aborta y CONSERVA
# ════════════════════════════════════════════════════════════════════════════
monta respaldo-incompleto
afirma "la migración ABORTA"                       "$([[ $RC -ne 0 ]] && echo si || echo no)" "si"
contiene "dice que hay filas sin equivalente"      "$ERR" "SIN equivalente en paquetes_recibidos"
contiene "nombra la pieza que falta"               "$ERR" "$(id_de r2)"
afirma "el respaldo SIGUE existiendo"              "$(hay_respaldo)" "t"
afirma "y conserva sus tres filas"                 "$(filas_respaldo)" "3"
afirma "el CHECK NO se validó"                     "$(validada)" "f"
afirma "el comentario de la vista NO cambió"       "$(comentario)" "$COMENTARIO_PREVIO"

# ════════════════════════════════════════════════════════════════════════════
# 6 · Respaldo alterado: ROLLBACK COMPLETO, y después reparación
# ════════════════════════════════════════════════════════════════════════════
# El escenario que justifica el bloque DO único. La migración escribe tres
# cosas —valida la constraint, reemplaza el comentario de la vista y borra el
# respaldo— y la tercera es la que puede abortar. Si las tres no van en la misma
# unidad atómica, un aborto deja las dos primeras aplicadas: un estado que no es
# ni el anterior ni el posterior.
#
# Se comprueba el estado ANTERIOR pieza por pieza, no «que no explotó»: la
# constraint sigue sin validar, el comentario sigue siendo el de antes, la tabla
# sigue ahí, y su CONTENIDO —no sólo su conteo— es idéntico.
monta respaldo-alterado
HUELLA_PREVIA="$(huella)"
afirma "de partida el CHECK está NOT VALID"        "$(validada)" "f"
afirma "de partida la vista tiene el comentario anterior" "$(comentario)" "$COMENTARIO_PREVIO"

afirma "la migración ABORTA"                       "$([[ $RC -ne 0 ]] && echo si || echo no)" "si"
contiene "dice que el respaldo no coincide"        "$ERR" "El respaldo NO coincide con lo migrado"
contiene "nombra la fila divergente"               "$ERR" "$(id_de r1)"
contiene "y nombra el CAMPO divergente"            "$ERR" "descripcion"
contiene "y afirma no haber tocado nada"           "$ERR" "No se tocó nada"

# ── Evidencia del rollback: las TRES escrituras quedaron sin efecto ─────────
afirma "ROLLBACK · convalidated sigue en false"    "$(validada)" "f"
afirma "ROLLBACK · el comentario de la vista es el anterior" "$(comentario)" "$COMENTARIO_PREVIO"
afirma "ROLLBACK · el respaldo existe"             "$(hay_respaldo)" "t"
afirma "ROLLBACK · conserva sus tres filas"        "$(filas_respaldo)" "3"
afirma "ROLLBACK · y su contenido es byte a byte el mismo" "$(huella)" "$HUELLA_PREVIA"

# ── Reparada la divergencia, la misma migración completa las tres ──────────
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -c "CALL sandbox.reparar_r1()" >/dev/null

aplica respaldo-alterado-reintento
afirma "reparado: la migración aplica"             "$RC" "0"
afirma "ahora sí el CHECK queda VALIDADO"          "$(validada)" "t"
afirma "ahora sí el comentario se actualiza"       \
  "$([[ "$(comentario)" == *'RETENIDA A PROPÓSITO (20260903000000)'* ]] && echo si || echo no)" "si"
afirma "ahora sí el respaldo se retira"            "$(hay_respaldo)" "f"

# ════════════════════════════════════════════════════════════════════════════
# 7 · Sin respaldo: ausencia previa = no-op seguro, no un fallo
# ════════════════════════════════════════════════════════════════════════════
monta sin-respaldo
afirma "la migración aplica"                       "$RC" "0"
contiene "lo dice en vez de callárselo"            "$ERR" "ya fue retirada"
afirma "el CHECK queda VALIDADO"                   "$(validada)" "t"


# ════════════════════════════════════════════════════════════════════════════
# 8 · Recuperación: reparar datos y reintentar
# ════════════════════════════════════════════════════════════════════════════
# El primer intento debe abortar SIN CAMBIOS gracias a la unidad atómica: la
# migración entera es una sola sentencia DO, así que el aborto revierte
# VALIDATE, COMMENT y DROP por igual, sea quien sea el aplicador. Después de
# reparar la fila faltante, la MISMA migración debe completar las tres
# escrituras en un único intento exitoso. Este escenario prueba
# recuperabilidad sin depender de estados parcialmente aplicados.
monta respaldo-incompleto-recuperado
afirma "primer intento: ABORTA"                    "$([[ $RC -ne 0 ]] && echo si || echo no)" "si"
afirma "el respaldo sobrevive al primer intento"   "$(hay_respaldo)" "t"

# Reponemos la pieza que faltaba, tal como la habría dejado la cadena.
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -c "CALL sandbox.reponer_r2()" >/dev/null

aplica respaldo-incompleto-reintento
afirma "segundo intento: aplica"                   "$RC" "0"
afirma "ahora sí retira el respaldo"               "$(hay_respaldo)" "f"
afirma "el CHECK queda VALIDADO"                   "$(validada)" "t"
contiene "verificó las tres filas"                 "$ERR" "Respaldo verificado (3 fila(s))"

echo
if [[ $FALLOS -eq 0 ]]; then
  echo "✅ Cierre posfusión: 8 escenarios verificados contra Postgres real"
else
  echo "❌ Cierre posfusión: $FALLOS afirmación(es) fallida(s)"
  exit 1
fi
