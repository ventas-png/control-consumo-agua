// Lógica pura de create-charge, extraída del handler para poder testearla en
// aislamiento (infra:I22). Sin Deno ni supabase-js → corre directo en vitest.
//
// Alcance deliberadamente pequeño. El resto de lo que #545 proponía extraer aquí
// ya NO aplica: `credsDeAmbiente` y `parseAmbiente` los superó main llevándolos
// a _shared/payments/ y _shared/, que es mejor sitio (se reutilizan desde varias
// funciones), y `buildCobroCanonico` quedó obsoleto — la versión de #545 no
// conoce el recargo de tarjeta, el `cuota_id` de la referencia interna ni el de
// metadata, o sea el concepto entero de cuotas de condominio que main añadió
// después. Su aritmética de dinero ya está cubierta por los tests de
// _shared/payments/{recargo,comision,reconcile}.test.ts.

import type { EstadoCobroProveedor } from '../_shared/payments/types.ts'

/** Mapea el estado normalizado del provider al estado de payment_requests. */
export function estadoPaymentRequest(estado: EstadoCobroProveedor): string {
  switch (estado) {
    case 'aprobado':
      return 'succeeded'
    case 'rechazado':
    case 'error':
      return 'failed'
    default:
      // 'pendiente' | 'requiere_accion' → esperando confirmación/retorno.
      return 'pending'
  }
}
