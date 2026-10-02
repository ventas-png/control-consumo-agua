#!/usr/bin/env bash
# ============================================================================
# 20261023000200 · la protección de inventario NO es opcional
# Se prueba contra la base del arnés con duplicados REALES, siempre dentro de una transacción que se
# revierte (la base queda intacta):
#   1. índice presente y válido            → la migración pasa sin tocar nada
#   2. índice AUSENTE + movimientos duplicados → SE DETIENE con diagnóstico; no crea el índice, no borra nada
#   3. índice presente pero con OTRA definición → SE DETIENE (no pisa a ciegas)
#   4. índice INVÁLIDO                      → se reconstruye y queda válido
#   5. índice ausente y sin duplicados      → se crea único, válido y con la definición esperada
#   6. mismo nombre y columnas, único, pero predicado MÁS RESTRICTIVO (AND cantidad > 0) → SE DETIENE
#   7. predicado que omite 'recepcion_lineas_anulada' / que cambia el conjunto → SE DETIENE
#   8. mismo predicado en otro orden de columnas → SE DETIENE
# Uso: BD=<base> bash indice_obligatorio.sh   (psql ya apuntando a la base por PG*)
# ============================================================================
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$AQUI/../../migrations/20261023000200_compras_inventario_indice_obligatorio.sql"
BD="${BD:?falta BD}"
SUM=50000000-0000-0000-0000-0000000000c1
C=cccccccc-cccc-cccc-cccc-cccccccccccc
C1=c1c1c1c1-0000-0000-0000-000000000001
OR1=0ff00000-0000-0000-0000-000000000001

correr() { psql -X -q -v ON_ERROR_STOP=0 -d "$BD" -f - 2>&1; }
ok()  { echo "  ✓ $1"; }
mal() { echo "❌ $1"; echo "$2"; exit 1; }

DUP="INSERT INTO public.movimientos_suministro (company_id, project_id, suministro_id, tipo, cantidad, origen_tabla, origen_id)
     VALUES ('$C','$C1','$SUM','entrada',5,'recepcion_lineas','$OR1'), ('$C','$C1','$SUM','entrada',5,'recepcion_lineas','$OR1');"
N_ANTES=$(psql -X -q -t -A -d "$BD" -c "SELECT count(*) FROM public.movimientos_suministro")

# 1 ── presente y válido
S=$(correr <<SQL
BEGIN;
\i $MIG
SELECT 'INDICE=' || indisvalid || '/' || indisunique FROM pg_index WHERE indexrelid = 'public.uq_mov_suministro_origen_recepcion'::regclass;
ROLLBACK;
SQL
)
echo "$S" | grep -q 'INDICE=true/true' && ! echo "$S" | grep -q 'ERROR' \
  && ok "1 · con el índice presente y válido, la migración pasa y no cambia nada" || mal "1 · no pasó con el índice válido" "$S"

# 2 ── ausente + duplicados: se detiene con diagnóstico
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
$DUP
SAVEPOINT antes;
\i $MIG
ROLLBACK TO antes;
SELECT 'MOVS=' || count(*) FROM public.movimientos_suministro WHERE origen_id = '$OR1';
SELECT 'INDICE_EXISTE=' || count(*) FROM pg_class WHERE relname = 'uq_mov_suministro_origen_recepcion';
ROLLBACK;
SQL
)
echo "$S" | grep -q 'COMPRAS_INVENTARIO_DUPLICADOS' && ok "2 · con duplicados históricos la migración SE DETIENE (COMPRAS_INVENTARIO_DUPLICADOS), no sigue con un WARNING" || mal "2 · no se detuvo por duplicados" "$S"
echo "$S" | grep -q "recepcion_lineas $OR1: 2 movimientos" && ok "2 · el diagnóstico nombra el renglón, el origen y cuántos movimientos hay" || mal "2 · el diagnóstico no nombra el renglón" "$S"
echo "$S" | grep -q 'MOVS=2' && ok "2 · NO se borró ni se modificó ningún movimiento (siguen los 2 duplicados)" || mal "2 · cambió el número de movimientos" "$S"
echo "$S" | grep -q 'INDICE_EXISTE=0' && ok "2 · y el índice NO se creó (no queda una protección a medias)" || mal "2 · quedó un índice" "$S"

# 3 ── mismo nombre, otra definición
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
CREATE INDEX uq_mov_suministro_origen_recepcion ON public.movimientos_suministro (origen_tabla, origen_id);
\i $MIG
ROLLBACK;
SQL
)
echo "$S" | grep -q 'COMPRAS_INVENTARIO_INDICE' && ok "3 · un índice del mismo nombre NO único / con otra definición: la migración se detiene" || mal "3 · aceptó un índice con otra definición" "$S"

# 4 ── índice inválido: se reconstruye
S=$(correr <<SQL
BEGIN;
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.uq_mov_suministro_origen_recepcion'::regclass;
\i $MIG
SELECT 'VALIDO=' || indisvalid || '/' || indisready || '/' || indisunique FROM pg_index WHERE indexrelid = 'public.uq_mov_suministro_origen_recepcion'::regclass;
ROLLBACK;
SQL
)
echo "$S" | grep -q 'VALIDO=true/true/true' && ! echo "$S" | grep -q 'ERROR' && ok "4 · un índice INVÁLIDO se reconstruye y queda válido" || mal "4 · no reparó el índice inválido" "$S"

# 5 ── ausente y sin duplicados: se crea
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
\i $MIG
SELECT 'CREADO=' || indisvalid || '/' || indisunique || '/' || indnatts FROM pg_index WHERE indexrelid = 'public.uq_mov_suministro_origen_recepcion'::regclass;
$DUP
ROLLBACK;
SQL
)
echo "$S" | grep -q 'CREADO=true/true/2' && ok "5 · sin el índice y sin duplicados, se crea único, válido y de dos columnas" || mal "5 · no creó el índice" "$S"
echo "$S" | grep -q 'uq_mov_suministro_origen_recepcion' && ok "5 · y con él instalado, un duplicado nuevo se rechaza" || mal "5 · el duplicado no fue rechazado por el índice" "$S"

# 6 ── mismo nombre y columnas, único, predicado MÁS RESTRICTIVO: contiene todos los fragmentos esperados
#      (por eso un LIKE lo aceptaría) pero dejaría sin proteger los movimientos con cantidad <= 0
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
CREATE UNIQUE INDEX uq_mov_suministro_origen_recepcion ON public.movimientos_suministro (origen_tabla, origen_id)
  WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL AND cantidad > 0;
\i $MIG
ROLLBACK;
SQL
)
echo "$S" | grep -q 'COMPRAS_INVENTARIO_INDICE' && ok "6 · índice único con predicado más restrictivo (AND cantidad > 0): la migración lo RECHAZA" || mal "6 · aceptó un predicado más restrictivo" "$S"
echo "$S" | grep -q 'cantidad > (0)::numeric' && ok "6 · y el mensaje muestra el predicado actual para el diagnóstico" || mal "6 · el mensaje no muestra el predicado" "$S"

# 7 ── único, mismas columnas, predicado que cubre menos orígenes
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
CREATE UNIQUE INDEX uq_mov_suministro_origen_recepcion ON public.movimientos_suministro (origen_tabla, origen_id)
  WHERE origen_tabla IN ('recepcion_lineas') AND origen_id IS NOT NULL;
\i $MIG
ROLLBACK;
SQL
)
echo "$S" | grep -q 'COMPRAS_INVENTARIO_INDICE' && ok "7 · índice único que no cubre recepcion_lineas_anulada: la migración lo rechaza" || mal "7 · aceptó un predicado que cubre menos orígenes" "$S"

# 8 ── mismas columnas en otro orden
S=$(correr <<SQL
BEGIN;
DROP INDEX public.uq_mov_suministro_origen_recepcion;
CREATE UNIQUE INDEX uq_mov_suministro_origen_recepcion ON public.movimientos_suministro (origen_id, origen_tabla)
  WHERE origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada') AND origen_id IS NOT NULL;
\i $MIG
ROLLBACK;
SQL
)
echo "$S" | grep -q 'COMPRAS_INVENTARIO_INDICE' && ok "8 · mismas columnas en otro orden: la migración lo rechaza" || mal "8 · aceptó otro orden de columnas" "$S"

# 9 ── el índice de referencia no queda en la base tras una verificación correcta
S=$(correr <<SQL
BEGIN;
\i $MIG
SELECT 'REF=' || count(*) FROM pg_class WHERE relname = 'uq_mov_suministro_origen_recepcion_ref';
ROLLBACK;
SQL
)
echo "$S" | grep -q 'REF=0' && ok "9 · la verificación no deja índices auxiliares" || mal "9 · quedó el índice de referencia" "$S"

N_DESPUES=$(psql -X -q -t -A -d "$BD" -c "SELECT count(*) FROM public.movimientos_suministro")
[ "$N_ANTES" = "$N_DESPUES" ] && ok "la base quedó intacta ($N_DESPUES movimientos antes y después)" || mal "cambió el número de movimientos: $N_ANTES → $N_DESPUES" ""
