#!/usr/bin/env bash
# Despliega una edge function de Supabase con REINTENTOS + backoff.
#
# Por qué: `supabase functions deploy` bundlea la función y, al hacerlo, el
# bundler baja dependencias remotas (p. ej. https://esm.sh/@supabase/supabase-js).
# esm.sh devuelve de forma INTERMITENTE 522 (timeout de Cloudflare). Como los
# steps del workflow corren en serie con `bash -e`, un único 522 transitorio
# abortaba TODO el deploy y saltaba las funciones siguientes. Reintentar con
# backoff hace el pipeline robusto a esos fallos transitorios sin enmascarar un
# fallo real (tras agotar los intentos, sale con código !=0 y el step falla).
#
# Uso:
#   .github/scripts/deploy-fn.sh <function-slug> [flags extra de `functions deploy`]
#   .github/scripts/deploy-fn.sh create-user
#   .github/scripts/deploy-fn.sh signup-company --no-verify-jwt
#
# Requiere en el entorno:
#   SUPABASE_PROJECT_ID    (se pasa como --project-ref)
#   SUPABASE_ACCESS_TOKEN  (lo consume el CLI de Supabase)
#
# NOTA: usamos `set -uo pipefail` (SIN `-e`) a propósito: un deploy fallido NO
# debe abortar el script; el bucle de reintentos maneja el código de salida.
set -uo pipefail

fn="${1:?uso: deploy-fn.sh <function-slug> [flags]}"
shift

if [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
  echo "::error::SUPABASE_PROJECT_ID no está seteado"
  exit 1
fi

attempts="${DEPLOY_FN_ATTEMPTS:-4}"

for i in $(seq 1 "$attempts"); do
  echo "::group::Deploy ${fn} (intento ${i}/${attempts})"
  if supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_ID" "$@"; then
    echo "::endgroup::"
    echo "✓ ${fn} desplegada (intento ${i})"
    exit 0
  fi
  echo "::endgroup::"
  if [ "$i" -lt "$attempts" ]; then
    wait=$(( i * 15 ))
    echo "::warning::Deploy de ${fn} falló (intento ${i}/${attempts}); reintentando en ${wait}s (suele ser un 522 transitorio de esm.sh)…"
    sleep "$wait"
  fi
done

echo "::error::Deploy de ${fn} falló tras ${attempts} intentos"
exit 1
