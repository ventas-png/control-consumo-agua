// Diálogo compartido de programación del cierre de ciclo automático (F3).
//
// Lo usan CobrosSection (agua) y CuotasTab (condominios) junto al botón manual
// «Emitir período»: carga la config vigente del proyecto+módulo, la muestra en
// un PromptDialog editable (activo / día / notificar) y la upsertea. El cierre
// en sí lo ejecuta el cron server-side (run_cierres_ciclo_automaticos).
import { openPromptDialog } from './PromptDialog'
import { notify } from './Dialog'
import {
  fetchCierreCicloConfig,
  guardarCierreCicloConfig,
  type ModuloCierre,
} from '../../domain/cierreCiclo'

export async function configurarCierreAutomatico(opts: {
  companyId: string
  projectId: string
  projectNombre?: string
  modulo: ModuloCierre
}): Promise<void> {
  const actual = await fetchCierreCicloConfig(opts.projectId, opts.modulo)
  const ultimoError = typeof actual?.ultimo_resultado?.error === 'string'
    ? (actual.ultimo_resultado.error as string)
    : null
  const estadoActual = actual
    ? (actual.activo
        ? `Hoy: activo, cierra a partir del día ${actual.dia_cierre}.`
        : 'Hoy: configurado pero desactivado.')
      + (actual.ultimo_periodo_cerrado ? ` Último período cerrado: ${actual.ultimo_periodo_cerrado}.` : '')
      + (ultimoError ? ` Último intento falló: ${ultimoError}` : '')
    : 'Hoy: sin programar para este proyecto.'

  const datos = await openPromptDialog({
    title: '🗓️ Cierre de ciclo automático',
    description:
      (opts.projectNombre ? `Proyecto «${opts.projectNombre}». ` : '')
      + 'Cada mes, a partir del día elegido (hora local de tu empresa), se emite '
      + 'automáticamente el período del MES ANTERIOR — igual que «Emitir período» — '
      + 'y el resultado llega a la campana de los administradores. '
      + estadoActual,
    fields: [
      {
        name: 'activo',
        label: 'Cierre automático activado',
        control: 'checkbox',
        initialValue: actual == null || actual.activo ? 'true' : '',
      },
      {
        name: 'dia',
        label: 'Cerrar a partir del día',
        control: 'select',
        initialValue: String(actual?.dia_cierre ?? 1),
        options: Array.from({ length: 28 }, (_, i) => ({
          value: String(i + 1),
          label: `Día ${i + 1} del mes`,
        })),
      },
      {
        name: 'notificar',
        label: 'Avisar a clientes/residentes al emitir',
        control: 'checkbox',
        initialValue: actual == null || actual.notificar ? 'true' : '',
      },
    ],
    submitText: 'Guardar',
  })
  if (!datos) return

  const activo = datos.activo === 'true'
  const { error } = await guardarCierreCicloConfig(opts.companyId, opts.projectId, opts.modulo, {
    activo,
    dia_cierre: Number(datos.dia) || 1,
    notificar: datos.notificar === 'true',
  })
  if (error) {
    notify({ variant: 'error', title: 'No se pudo guardar la programación', text: error.message })
    return
  }
  notify({
    variant: 'success',
    title: '🗓️ Cierre automático guardado',
    text: activo
      ? `El período anterior se cerrará a partir del día ${Number(datos.dia) || 1} de cada mes.`
      : 'El cierre automático quedó desactivado para este proyecto.',
    duration: 2600,
  })
}
