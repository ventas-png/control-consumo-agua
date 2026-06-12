import { confirm } from './Dialog'

// ============================================================================
// promptUpgrade — F4.1.2: Plan upgrade CTA cuando se alcanza el limite.
// ============================================================================
// Reemplaza el patron previo de `notify({variant:'warning', text:'Actualizalo
// desde Perfil...'})` que era informativo sin ruta de conversion. Ahora muestra
// un confirm modal accesible con CTA directa "Ver planes" — al aceptar dispara
// un CustomEvent global que App.tsx escucha para navegar a Perfil con flag de
// auto-scroll a la card "Mi plan".
//
// Cross-component nav sin router: usa CustomEvent + sessionStorage flag para
// que PerfilSection abra el plan picker al montar. Evita un router URL solo
// para este flow.
//
// Roles: el CTA se muestra a todos. Si el usuario no tiene canManageBilling
// (no owner ni admin) vera la Card "Mi plan" en modo read-only con texto
// "Comuniquese con su administrador" — consistente con el flow existente.

export type UpgradeResource = 'project' | 'unit'

interface ResourceLabel {
  /** Forma plural usada en el mensaje principal */
  plural: string
}

const RESOURCE_LABELS: Record<UpgradeResource, ResourceLabel> = {
  project: { plural: 'proyectos' },
  unit:    { plural: 'unidades' },
}

export interface UpgradePromptOptions {
  resource: UpgradeResource
  /** Conteo actual del recurso. Solo se usa en el texto para contexto. */
  current: number
  /** Limite efectivo del plan actual */
  limit: number
}

/** Evento que dispara la navegacion a Perfil + auto-scroll a "Mi plan" */
export const OPEN_BILLING_EVENT = 'at:open-billing'

/** Flag en sessionStorage que PerfilSection lee al montar para auto-scroll */
export const OPEN_BILLING_FLAG = 'at:open-billing-on-mount'

/** Evento que dispara la navegacion a Empresa para abrir el modal "Ampliar plan" */
export const OPEN_AMPLIAR_EVENT = 'at:open-ampliar-plan'

/** Flag en sessionStorage que EmpresaProyectosSection lee al montar para abrir el modal */
export const OPEN_AMPLIAR_FLAG = 'at:open-ampliar-on-mount'

/**
 * Navega a Perfil → "Mi plan" (plan picker). Flow de BILLING (cambiar de
 * módulos / configurar pago) — lo usa TrialExpirationBanner. Distinto del
 * flow de límites de promptUpgrade.
 */
export function openBillingSection(): void {
  try {
    sessionStorage.setItem(OPEN_BILLING_FLAG, '1')
  } catch {
    // sessionStorage puede estar bloqueado (private mode); el flag es best-effort
  }
  window.dispatchEvent(new CustomEvent(OPEN_BILLING_EVENT))
}

/**
 * Muestra un modal accesible explicando que se alcanzo el limite de
 * proyectos/unidades, con CTA "Ampliar plan" que navega a la seccion Empresa
 * y abre el modal de ampliacion self-service (el cobro es por uso: ampliar
 * limites no cobra nada hoy; el cobro sube al crear los recursos). Devuelve
 * true si el usuario eligio ampliar (y la navegacion ya se disparo).
 */
export async function promptUpgrade(opts: UpgradePromptOptions): Promise<boolean> {
  const labels = RESOURCE_LABELS[opts.resource]
  const result = await confirm({
    icon: 'warning',
    title: 'Límite del plan alcanzado',
    text: `Tu plan permite hasta ${opts.limit} ${labels.plural} y ya tienes ${opts.current}. Amplía tus límites para crear más ${labels.plural} — el cobro se ajusta según tu uso.`,
    confirmText: 'Ampliar plan',
    cancelText: 'Más tarde',
  })
  if (result.isConfirmed) {
    try {
      sessionStorage.setItem(OPEN_AMPLIAR_FLAG, '1')
    } catch {
      // sessionStorage puede estar bloqueado (private mode); el flag es best-effort
    }
    window.dispatchEvent(new CustomEvent(OPEN_AMPLIAR_EVENT))
  }
  return result.isConfirmed
}
