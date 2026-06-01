import { supabase } from './supabase'

// F4.2.3: helper unico para soft delete en tablas con columnas `deleted_at`
// y `deleted_by` (definidas en F2.7).
//
// Reemplaza `.delete().eq('id', X)` por `.update({deleted_at, deleted_by})`
// preservando el row para auditoria + papelera. El audit_log tambien captura
// el cambio via el trigger SECURITY DEFINER.
//
// Restore: setear deleted_at=null, deleted_by=null (ver PapeleraModal).

export type SoftDeleteTable =
  | 'pagos'
  | 'cuotas_condominio'
  | 'fondo_reserva_condominio'
  | 'gastos_condominio'
  | 'tickets_mantenimiento'

export async function softDelete(table: SoftDeleteTable, id: string): Promise<{ error: { message: string } | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from(table)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id ?? null,
    })
    .eq('id', id)
  return { error }
}
