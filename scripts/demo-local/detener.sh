#!/usr/bin/env bash
# Detiene la copia local: app, pasarela y PostgREST; con --solo-servicios deja la base encendida.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for s in vite pasarela postgrest; do
  [ -f "$AQUI/.pid-$s" ] && kill "$(cat "$AQUI/.pid-$s")" 2>/dev/null; rm -f "$AQUI/.pid-$s"
done
pkill -f "$AQUI/pasarela.mjs" 2>/dev/null; pkill -f "$AQUI/bin/postgrest" 2>/dev/null; pkill -f "vite --port 5173" 2>/dev/null
if [ "${1:-}" != "--solo-servicios" ]; then
  for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
  su postgres -c "PATH=$PATH pg_ctl -D /tmp/demo-pgdata stop -m fast" >/dev/null 2>&1
fi
echo "OK  copia local detenida"
