# Librería mínima de concurrencia (sesiones psql REALES). Se "sourcea" desde run.sh o desde conc_harness.sh.
# Requiere exportados: PGHOST PGPORT PGUSER, BD (base de datos) y SALIDAS (directorio de salidas, escribible).
#
# sesion_u <uuid-usuario|-> <retardo-previo s> <SQL dentro de la transacción> <pausa-antes-del-COMMIT s>
#   Abre BEGIN … COMMIT como `authenticated` con ese sub de JWT (o como superusuario si el usuario es «-»).
sesion_u() {
  local u="$1" ret="$2" sql="$3" hold="$4" rol=""
  if [ "$u" != "-" ]; then rol="SELECT set_config('request.jwt.claim.sub', '$u', false); SET ROLE authenticated;"; fi
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d "$BD" <<SQL
SELECT pg_sleep($ret);
$rol
BEGIN;
$sql
SELECT pg_sleep($hold);
COMMIT;
SQL
}
# par_u <etiqueta> <usuario1> <sql1> <hold1> <usuario2> <sql2> <hold2>
#   Dos sesiones simultáneas (la segunda arranca 0.3 s después). Salidas en $SALIDAS/<etiqueta>1.txt y <etiqueta>2.txt.
par_u() {
  sesion_u "$2" 0   "$3" "$4" > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion_u "$5" 0.3 "$6" "$7" > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}
# q "<SQL>" → resultado escalar (superusuario)
q() { psql -q -X -t -A -d "$BD" -c "$1"; }
