// Puesta en marcha de una contabilidad (ledger): qué le falta para operar.
//
// Función PURA: recibe lo que las pantallas ya consultan (catálogo, cuentas
// especiales, mapeo por evento, tipos de cargo, apertura, bancos) y devuelve
// los pasos con su estado. No consulta nada: así se prueba sin red y la misma
// regla sirve al panel y a cualquier aviso futuro.
//
// POR QUÉ EXISTE. Un evento sin cuenta no genera póliza y, salvo facturas de
// proveedor y cargos a unidades, tampoco aparece en «Pendientes»: el hueco de
// configuración se descubría semanas después, al cuadrar. Aquí se ve antes de
// operar, por contabilidad.
import { EVENTOS_MAPEO } from '../../types/contabilidad'
import type { ConfigTipoCargoEstado, CuentaEspecialEstado } from '../../types/contabilidad'

/** A qué pestaña de Contabilidad lleva cada paso. */
export type DestinoPuestaEnMarcha =
  | 'catalogo' | 'configuracion' | 'tiposcargo' | 'polizas' | 'bancos'

export interface PasoPuestaEnMarcha {
  id: 'catalogo' | 'especiales' | 'eventos' | 'tiposcargo' | 'apertura' | 'bancos'
  titulo: string
  /** `requerido`: sin él hay operaciones que no se contabilizan. `recomendado`: se puede operar sin él. */
  nivel: 'requerido' | 'recomendado'
  listo: boolean
  /** Qué falta, en una línea; vacío cuando está listo. */
  detalle: string
  destino: DestinoPuestaEnMarcha
  /** Texto del enlace que lleva a resolverlo. */
  accion: string
}

export interface EntradaPuestaEnMarcha {
  /** null = contabilidad de la EMPRESA. */
  projectId: string | null
  totalCuentas: number
  especiales: readonly Pick<CuentaEspecialEstado, 'etiqueta' | 'estado' | 'bloqueante'>[]
  /** Eventos que YA tienen fila de mapeo en este ledger. */
  eventosMapeados: readonly string[]
  tiposCargo: readonly Pick<ConfigTipoCargoEstado, 'etiqueta' | 'estado'>[]
  hayApertura: boolean
  totalCuentasBancarias: number
}

/** «A, B y 3 más»: nombra lo primero y cuenta el resto. */
function nombrar(etiquetas: readonly string[], max = 2): string {
  if (etiquetas.length <= max) return etiquetas.join(', ')
  return `${etiquetas.slice(0, max).join(', ')} y ${etiquetas.length - max} más`
}

export function evaluarPuestaEnMarcha(e: EntradaPuestaEnMarcha): PasoPuestaEnMarcha[] {
  const hayCatalogo = e.totalCuentas > 0
  const sinCatalogo = 'Primero crea el catálogo de cuentas.'

  const especialesFaltan = e.especiales.filter((c) => c.estado !== 'ok')
  const bloqueantes = especialesFaltan.filter((c) => c.bloqueante).length

  const mapeados = new Set(e.eventosMapeados)
  const eventosFaltan = EVENTOS_MAPEO.filter((ev) => !mapeados.has(ev.evento))

  const tiposFaltan = e.tiposCargo.filter((t) => t.estado !== 'ok')

  const pasos: PasoPuestaEnMarcha[] = [
    {
      id: 'catalogo', titulo: 'Catálogo de cuentas', nivel: 'requerido',
      listo: hayCatalogo,
      detalle: hayCatalogo ? '' : 'Esta contabilidad no tiene cuentas: no se genera ninguna póliza.',
      destino: 'catalogo', accion: 'Crear catálogo',
    },
    {
      id: 'especiales', titulo: 'Cuentas especiales', nivel: 'requerido',
      listo: hayCatalogo && especialesFaltan.length === 0,
      detalle: !hayCatalogo ? sinCatalogo
        : especialesFaltan.length === 0 ? ''
        : `Faltan ${especialesFaltan.length}${bloqueantes > 0 ? ` (${bloqueantes} detienen su proceso)` : ''}: ${nombrar(especialesFaltan.map((c) => c.etiqueta))}.`,
      destino: 'configuracion', accion: 'Asignar cuentas',
    },
    {
      id: 'eventos', titulo: 'Cuentas por evento', nivel: 'requerido',
      listo: hayCatalogo && eventosFaltan.length === 0,
      detalle: !hayCatalogo ? sinCatalogo
        : eventosFaltan.length === 0 ? ''
        : `${eventosFaltan.length} sin cuenta: ${nombrar(eventosFaltan.map((ev) => ev.label))}. Lo que caiga ahí no se contabiliza.`,
      destino: 'configuracion', accion: 'Completar mapeo',
    },
  ]

  // Los cargos a unidades (cuotas, mora, cargos adicionales) son de los proyectos:
  // en la contabilidad de la empresa el paso no aplica y no se muestra.
  if (e.projectId) {
    pasos.push({
      id: 'tiposcargo', titulo: 'Tipos de cargo', nivel: 'requerido',
      listo: hayCatalogo && tiposFaltan.length === 0,
      detalle: !hayCatalogo ? sinCatalogo
        : tiposFaltan.length === 0 ? ''
        : `${tiposFaltan.length} sin configurar: ${nombrar(tiposFaltan.map((t) => t.etiqueta))}. Sus cargos quedarán en Pendientes.`,
      destino: 'tiposcargo', accion: 'Configurar tipos',
    })
  }

  pasos.push(
    {
      id: 'apertura', titulo: 'Saldos iniciales', nivel: 'recomendado',
      listo: e.hayApertura,
      detalle: e.hayApertura ? '' : !hayCatalogo ? sinCatalogo
        : 'Sin apertura, los libros arrancan en cero. Se registra una sola vez.',
      destino: 'polizas', accion: 'Registrar apertura',
    },
    {
      id: 'bancos', titulo: 'Cuentas bancarias', nivel: 'recomendado',
      listo: e.totalCuentasBancarias > 0,
      detalle: e.totalCuentasBancarias > 0 ? '' : 'Sin cuenta bancaria no se importan extractos ni se concilia.',
      destino: 'bancos', accion: 'Agregar cuenta',
    },
  )
  return pasos
}

export interface ResumenPuestaEnMarcha {
  listos: number
  total: number
  /** Pasos REQUERIDOS sin terminar: mientras haya, hay operaciones que no se contabilizan. */
  requeridosPendientes: number
  completa: boolean
}

export function resumirPuestaEnMarcha(pasos: readonly PasoPuestaEnMarcha[]): ResumenPuestaEnMarcha {
  const listos = pasos.filter((p) => p.listo).length
  return {
    listos,
    total: pasos.length,
    requeridosPendientes: pasos.filter((p) => !p.listo && p.nivel === 'requerido').length,
    completa: listos === pasos.length,
  }
}
