// Vista PREVIA de la cuenta que el servidor fijará para un renglón de compra.
//
// Es solo información: lo que se guarda lo resuelve y valida el SERVIDOR al
// guardar (trigger de `orden_compra_lineas`), con la misma función que consulta
// esta vista. Por eso la latencia o el fallo de la consulta no pueden cambiar la
// cuenta que queda: el formulario ni la manda. Aquí solo importa no engañar:
//   · consultando…            → no se afirma nada todavía;
//   · consulta FALLIDA        → se dice, y se aclara que igual se resuelve al guardar;
//   · SIN regla aplicable     → es un resultado válido, distinto de un fallo;
//   · regla de compra         → la cuenta que quedará;
//   · otro origen (regla del proveedor / mapeo) → se informa pero NO se fija en el renglón;
//   · sin_resolver            → configuración incompleta, con su motivo.
// No guarda estado propio: depende solo de sus props, así que cambiar proveedor
// o categoría, o quitar renglones, nunca deja a la vista mostrando la entrada anterior.
import { useSugerenciaCuentaQuery } from '../../domain/proveedores/queries'
import { ORIGEN_CUENTA_LABELS, type DestinoCompra } from '../../types/proveedores'

interface Props {
  indice: number
  projectId: string | null
  proveedorId: string | null
  destino: DestinoCompra
  categoria: string
  fecha: string
}

export function SugerenciaCuentaLinea({ indice, projectId, proveedorId, destino, categoria, fecha }: Props) {
  const { data, isLoading, isError, error } = useSugerenciaCuentaQuery({
    projectId, destino, categoria, suministroId: null, proveedorId, fecha,
  })
  const etiqueta = `Renglón ${indice + 1}: `
  let texto: string
  let tono: 'info' | 'warn' | 'error' = 'info'

  if (isError) {
    tono = 'error'
    texto = `no se pudo consultar la cuenta sugerida (${error instanceof Error ? error.message : 'error desconocido'}). Puedes guardar: el servidor la resuelve al guardar.`
  } else if (isLoading || !data) {
    texto = 'consultando la cuenta sugerida…'
  } else if (data.origen === 'regla_compra') {
    texto = `el servidor fijará la cuenta ${data.cuenta_codigo ?? ''} ${data.cuenta_nombre ?? ''} · ${ORIGEN_CUENTA_LABELS.regla_compra}`
  } else if (data.origen === 'sin_resolver') {
    tono = 'warn'
    texto = `configuración incompleta${data.motivo ? ` — ${data.motivo}` : ''}. Se podrá guardar, pero habrá que configurarla antes de contabilizar.`
  } else {
    texto = `sin regla de compra aplicable. Al contabilizar regirá ${ORIGEN_CUENTA_LABELS[data.origen].toLowerCase()} (${data.cuenta_codigo ?? '—'} ${data.cuenta_nombre ?? ''}).`
  }

  return (
    <span
      role={tono === 'error' ? 'alert' : 'status'}
      data-testid={`sugerencia-${indice}`}
      data-estado={isError ? 'error' : isLoading || !data ? 'cargando' : data.origen}
      style={{ fontSize: 11, color: tono === 'info' ? 'var(--at-ink-soft)' : tono === 'warn' ? 'var(--at-warning)' : 'var(--at-danger)' }}
    >
      {etiqueta}{texto}
    </span>
  )
}
