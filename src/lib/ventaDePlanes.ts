// Dónde se puede vender el plan de AdministraTodo.
//
// El plan es una suscripción digital, y App Store (guideline 3.1.1) y Google
// Play (política de pagos) rechazan las apps que la venden —o empujan a
// comprarla— por fuera de su sistema de cobro. La app nativa sí puede dar acceso
// a lo que la empresa contrató en la web (guideline 3.1.3(c), servicios
// empresariales: AdministraTodo se vende directamente a organizaciones), pero
// sin precios, botones de compra o de ampliación, portal de facturación ni
// avisos que conduzcan a pagar.
//
// No afecta a los cobros de servicios del mundo real que pagan los residentes
// (cuotas de condominio, agua): Apple los permite fuera de su sistema
// (guideline 3.1.5(a)) y siguen disponibles en la app.
//
// Toda superficie de venta del plan pasa por aquí, para que auditarlas antes de
// cada envío a las tiendas sea un `grep mostrarVentaDePlanes`.
import { isNative } from './platform'

/** `false` en la app nativa: ahí no se muestra nada que venda o amplíe el plan. */
export function mostrarVentaDePlanes(): boolean {
  return !isNative()
}
