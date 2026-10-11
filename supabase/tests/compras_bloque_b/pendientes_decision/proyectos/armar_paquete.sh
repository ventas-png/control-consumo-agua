#!/usr/bin/env bash
# ============================================================================
# Arma el paquete de «alcance de proyecto al capturar» sobre UN ÁRBOL del repositorio (el de la rama del PR #926 —medido sobre e9764d3a—, con o sin la
# 20261026000600 del #928 —medido con la de b9b630b1, md5 2281d665…; si la 0600 cambia, repetir la corrida—)
# para reproducir la corrida completa. NO toca esta carpeta ni el checkout desde el que se invoca: solo escribe en el árbol que se le da.
#
# Uso:  bash armar_paquete.sh <ruta-del-arbol>
#
# Qué hace en <ruta-del-arbol>:
#   1. copia propuesta_alcance_proyecto.sql como supabase/migrations/20261027001000_compras_alcance_proyecto_captura.sql (la versión NO es opcional: justo
#      después de la 0900; ver README.md §9) y PRJ-1.sql a supabase/tests/compras_bloque_b/hallazgos/ (la recoge run.sh §5r);
#   2. aplica con `git apply` los tres parches: reversion_script.patch, adaptaciones_aserciones.patch y ui_mensajes.patch (comprobándolos antes con --check).
# Después:  cd <ruta-del-arbol> && PGPORT_TEST=<puerto> bash supabase/tests/compras_bloque_b/run.sh   (rc = 0; 988 líneas ✓ en un repositorio git CON origin/main
#            resoluble —el paso 7, migrations-append-only, lo exige—; si no, 987 y el paso 7 imprime «(omitido: sin git/node en este entorno)». Con un árbol de
#            «git archive»: git init + commit base + git update-ref refs/remotes/origin/main HEAD, y recién entonces armar el paquete; README.md §10.2)
# En una copia SIN .git, exportar antes DIAG=<ruta-del-arbol>/scripts/diagnostico-numeros-factura.sql (README.md §10).
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARBOL="${1:-}"
[ -n "$ARBOL" ] && [ -d "$ARBOL/supabase/migrations" ] || { echo "uso: bash armar_paquete.sh <ruta-del-arbol> (un árbol del repo, con supabase/migrations)"; exit 2; }
ARBOL="$(cd "$ARBOL" && pwd)"

# La 0900 tiene que estar: la propuesta depende de ella (y su pre-vuelo se detiene si no).
ls "$ARBOL"/supabase/migrations/20261027000900_*.sql >/dev/null 2>&1 || { echo "❌ el árbol no tiene la 20261027000900 (PR #926 completo)"; exit 1; }
[ ! -e "$ARBOL"/supabase/migrations/20261027001000_compras_alcance_proyecto_captura.sql ] || { echo "❌ el árbol ya tiene la migración 20261027001000"; exit 1; }

cd "$ARBOL"
for p in reversion_script adaptaciones_aserciones ui_mensajes; do
  git apply --check "$AQUI/$p.patch" || { echo "❌ $p.patch no se aplica a este árbol"; exit 1; }
done
cp "$AQUI/propuesta_alcance_proyecto.sql" supabase/migrations/20261027001000_compras_alcance_proyecto_captura.sql
cp "$AQUI/PRJ-1.sql" supabase/tests/compras_bloque_b/hallazgos/PRJ-1.sql
for p in reversion_script adaptaciones_aserciones ui_mensajes; do
  git apply "$AQUI/$p.patch"
  echo "  ✓ $p.patch aplicado"
done
echo "✓ paquete armado en $ARBOL: migración 20261027001000, hallazgos/PRJ-1.sql y los tres parches."
