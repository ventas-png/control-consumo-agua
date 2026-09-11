#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260911231905: el webhook de Stripe ACREDITA el
# recibo, y «lo vi» deja de valer por «lo terminé».
#
# POR QUÉ EXISTE
# El handler insertaba la fila de `pagos` a mano y marcaba la solicitud
# `succeeded`. Ahí se paraba: no tocaba `monto_pagado`, `estado` ni
# `factura_estado`. Un cobro con tarjeta quedaba registrado y el recibo seguía
# debiendo el total.
#
# El segundo agujero es peor. El evento se reclamaba ANTES de procesarlo y
# cualquier duplicado recibía `200 already_processed`, aunque el intento previo
# hubiera muerto a medias. Stripe reintenta ante cualquier respuesta que no sea
# 2xx, así que un 200 significa «no me lo traigas más» — y esa frase sólo es
# verdad cuando el evento se procesó ENTERO. Un 200 prematuro es la forma de
# perder un cobro sin que salte nada.
#
# Nada de esto se ve leyendo el SQL: hay que ejercerlo contra un Postgres real,
# con dos conexiones de verdad y con el fallo inyectado ENTRE el reclamo y la
# acreditación.
#
# QUÉ COMPRUEBA (14 invariantes)
#   1-4   el reclamo del evento: se reclama una vez, el COMPLETADO no se
#         re-reclama nunca, el FALLIDO sí de inmediato, y el `procesando`
#         rancio también (una invocación que murió sin cerrar)
#   4b    `completado` SIN `processed_at` no cuenta como terminado: son dos
#         columnas y pueden divergir; sin la constancia, se reintenta
#   4c    cerrar un evento inexistente FALLA en vez de callar (si el sello no
#         se escribe, la respuesta no puede ser 200)
#   5     DOS entregas simultáneas del mismo evento: una sola lo reclama
#   6     el camino feliz: el pago queda `aplicado` Y con verified_by
#   7     un fallo entre el reclamo y la acreditación deja el evento FALLIDO,
#         el recibo SIN tocar, y el reintento cuadra
#   8     dos entregas del mismo evento acreditan UNA sola vez
#   9     una cuota de condominio por la misma vía
#   10    `confirm-charge` sigue llamando con UN argumento (sin ambigüedad)
#   11-12 ACL: ni anon ni authenticated, ni desde una SECURITY DEFINER suya
#
# USO
#   supabase/tests/webhook_stripe_idempotencia/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_DIR="$RAIZ/supabase/migrations"
MIG_RPC="$MIG_DIR/20260910000200_registrar_lectura_autoritativa.sql"
MIG_REP="$MIG_DIR/20260910000300_reporte_inconsistencias_lecturas.sql"
MIG_UPD="$MIG_DIR/20260910235732_proteger_update_registros_y_cobro_autoritativo.sql"
MIG_SER="$MIG_DIR/20260911031701_cerrar_exencion_definer_y_serializar_cobro.sql"
MIG_CON="$MIG_DIR/20260911042839_conciliar_pago_externo_transaccional.sql"
MIG_AUD="$MIG_DIR/20260911181200_revocar_execute_agua_cobro_auditar.sql"
MIG_WHK="$MIG_DIR/20260911231905_webhook_stripe_idempotencia_real.sql"
# El padrón de agua es el del otro harness: una sola fuente de verdad.
FIXTURE="$RAIZ/supabase/tests/registrar_lectura/fixture.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/whkdata.XXXX)
SOCK=$(mktemp -d /tmp/whksock.XXXX)
PUERTO=${PGPORT_TEST:-55497}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE webhookdb" >/dev/null
# Los tres roles de la Data API. `service_role` con BYPASSRLS, como en Supabase:
# es lo que hace significativa la invariante 16.
psql -q -d webhookdb -c "
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
" >/dev/null
# La invariante de concurrencia necesita una SEGUNDA conexión de verdad: dos
# abonos que se pisan no se reproducen dentro de una sola sesión.
psql -q -d webhookdb -c "CREATE EXTENSION IF NOT EXISTS dblink SCHEMA public" >/dev/null || {
  echo "❌ falta el módulo dblink: la invariante de concurrencia no se puede ejercer"; exit 1; }

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d webhookdb -f "$1" >/dev/null
}

echo "── 1/3 · fixture: padrón de agua compartido + policy real de UPDATE ────"
aplicar "$FIXTURE"
aplicar "$RAIZ/supabase/tests/proteger_update_registros/fixture-extra.sql"
aplicar "$AQUI/fixture-extra.sql"
psql -q -d webhookdb -c "
  GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.registros TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE ON public.payment_requests, public.pagos,
                                  public.cuotas_condominio TO authenticated, service_role;
  GRANT SELECT ON public.contadores, public.tarifas, public.unidades, public.clientes,
                  public.projects, public.companies, public.app_users,
                  public.user_project_assignments, public.test_permisos,
                  public.reglas_mora_config TO authenticated, service_role;
" >/dev/null
echo "  OK    2 empresas · 3 proyectos · 7 cuentas · 7 contadores · IVA 12% · mora a 15 días"

echo "── 2/3 · las siete migraciones, aplicadas DOS veces (idempotentes) ─────"
for _ in 1 2; do aplicar "$MIG_RPC"; aplicar "$MIG_REP"; aplicar "$MIG_UPD"; aplicar "$MIG_SER"; aplicar "$MIG_CON"; aplicar "$MIG_AUD"; aplicar "$MIG_WHK"; done
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d webhookdb \
  -v conn="dbname=webhookdb host=$SOCK port=$PUERTO user=postgres" \
  -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ el webhook de Stripe acredita el recibo, distingue «lo vi» de «lo terminé», y un fallo deja el evento reintentable en vez de perdido."
