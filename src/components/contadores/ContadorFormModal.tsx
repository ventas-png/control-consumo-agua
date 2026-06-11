// Modal de alta/edición de contadores (P1 #3, extraído de ContadoresSection
// con el JSX intacto). Estado y handlers viven en la sección (vía ctx).
import { EditModal } from '../shared/EditModal'
import type { TipoAgua } from '../../types'
import { tarifasParaTipo } from '../../lib/contadoresReglas'
import type { ContadoresCtx } from './ctx'
import {
  inputStyle, labelStyle, MATERIALES_CONTADOR, MEDIDAS_CONTADOR,
  OPCIONES_SI_NO, OPCIONES_SIN, TIPOS_AGUA, TIPOS_CONTADOR, TIPOS_LLAVE,
} from './ui'

export function ContadorFormModal({ ctx }: { ctx: ContadoresCtx }) {
  const { tarifas, unidades, moneda, form, setForm, editingId, loading, cancelForm, handleGuardar } = ctx

  return (
    <EditModal title={editingId ? 'Editar Contador' : 'Nuevo Contador'} onClose={cancelForm} maxWidth="820px">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div>
          <label style={labelStyle}>Número de Serie *</label>
          <input
            style={inputStyle}
            value={form.numero_serie}
            onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))}
            placeholder="Ej: CTR-2024-001"
            maxLength={100}
          />
        </div>
        <div>
          <label style={labelStyle}>Tipología / Tipo de Agua *</label>
          <select
            style={inputStyle}
            value={form.tipo_agua}
            onChange={e => setForm(f => ({ ...f, tipo_agua: e.target.value as TipoAgua, tarifa_id: '' }))}
          >
            {TIPOS_AGUA.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Tarifa aplicable</label>
          <select
            style={inputStyle}
            value={form.tarifa_id}
            onChange={e => setForm(f => ({ ...f, tarifa_id: e.target.value }))}
          >
            <option value="">— Sin tarifa asignada —</option>
            {tarifasParaTipo(tarifas, form.tipo_agua).map(t => (
              <option key={t.id} value={t.id}>
                {t.nombre} — {t.precio_m3} {moneda}/m³{Number(t.precio_m3_exceso ?? 0) > 0 ? ` (exceso: ${t.precio_m3_exceso} ${moneda}/m³)` : ''}{t.canon_fijo > 0 ? ` + ${t.canon_fijo} ${moneda} canon` : ''}
              </option>
            ))}
            {tarifasParaTipo(tarifas, form.tipo_agua).length === 0 && (
              <option disabled value="">No hay tarifas activas para este tipo</option>
            )}
          </select>
        </div>
        {unidades.length > 0 && (
          <div>
            <label style={labelStyle}>Unidad asignada</label>
            <select
              style={inputStyle}
              value={form.unidad_id}
              onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
            >
              <option value="">— Sin unidad asignada —</option>
              {unidades.filter(u => u.activo).map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label style={labelStyle}>Marca</label>
          <input
            style={inputStyle}
            value={form.marca}
            onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
            placeholder="Ej: Sensus, Elster, Itron..."
            maxLength={100}
          />
        </div>
        <div>
          <label style={labelStyle}>Modelo</label>
          <input
            style={inputStyle}
            value={form.modelo}
            onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
            placeholder="Ej: 620M, V200, HR-E..."
            maxLength={100}
          />
        </div>
        <div>
          <label style={labelStyle}>Fecha de Instalación</label>
          <input
            style={inputStyle}
            type="date"
            value={form.fecha_instalacion}
            onChange={e => setForm(f => ({ ...f, fecha_instalacion: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>Lectura Inicial (m³)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            step="0.0001"
            value={form.lectura_inicial}
            onChange={e => setForm(f => ({ ...f, lectura_inicial: e.target.value }))}
            placeholder="0.0000"
          />
        </div>
        {/* Technical fields — separator */}
        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--at-line)', paddingTop: '16px', marginTop: '4px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-primary)', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Características Técnicas e Instalación
          </div>
        </div>
        <div>
          <label style={labelStyle}>Medida del Contador</label>
          <select
            style={inputStyle}
            value={form.medida}
            onChange={e => setForm(f => ({ ...f, medida: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {MEDIDAS_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Material del Contador</label>
          <select
            style={inputStyle}
            value={form.material}
            onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {MATERIALES_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Tipo de Contador</label>
          <select
            style={inputStyle}
            value={form.tipo_contador}
            onChange={e => setForm(f => ({ ...f, tipo_contador: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {TIPOS_CONTADOR.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Válvula de Cheque instalada</label>
          <select
            style={inputStyle}
            value={form.valvula_cheque}
            onChange={e => setForm(f => ({ ...f, valvula_cheque: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Tipo de Llave instalada</label>
          <select
            style={inputStyle}
            value={form.tipo_llave}
            onChange={e => setForm(f => ({ ...f, tipo_llave: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {TIPOS_LLAVE.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Llave Antifraude instalada</label>
          <select
            style={inputStyle}
            value={form.llave_antifraude}
            onChange={e => setForm(f => ({ ...f, llave_antifraude: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {OPCIONES_SI_NO.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Válvula Liberadora de Aire</label>
          <select
            style={inputStyle}
            value={form.valvula_aire}
            onChange={e => setForm(f => ({ ...f, valvula_aire: e.target.value }))}
          >
            <option value="">— Seleccionar —</option>
            {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Fecha Sugerida de Reemplazo</label>
          <input
            style={inputStyle}
            type="date"
            value={form.fecha_reemplazo_sugerida}
            onChange={e => setForm(f => ({ ...f, fecha_reemplazo_sugerida: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>Contratista / Instalador</label>
          <input
            style={inputStyle}
            value={form.contratista_instalador}
            onChange={e => setForm(f => ({ ...f, contratista_instalador: e.target.value }))}
            placeholder="Nombre del instalador o empresa"
            maxLength={150}
          />
        </div>
        <div>
          <label style={labelStyle}>Garantía de Instalación Vence</label>
          <input
            style={inputStyle}
            type="date"
            value={form.garantia_instalacion_vence}
            onChange={e => setForm(f => ({ ...f, garantia_instalacion_vence: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>N° Derecho de Servicio (Título de Agua)</label>
          <input
            style={inputStyle}
            value={form.numero_derecho_servicio}
            onChange={e => setForm(f => ({ ...f, numero_derecho_servicio: e.target.value }))}
            placeholder="Ej: DS-2024-00123"
            maxLength={100}
          />
        </div>
        <div>
          <label style={labelStyle}>Cantidad Derecho de Servicio (m³)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            step="0.01"
            value={form.cantidad_derecho_servicio_m3}
            onChange={e => setForm(f => ({ ...f, cantidad_derecho_servicio_m3: e.target.value }))}
            placeholder="Ej: 15.00"
          />
        </div>
        <div>
          <label style={labelStyle}>Periodicidad de Lectura (días)</label>
          <input
            style={inputStyle}
            type="number"
            min="1"
            step="1"
            value={form.periodicidad_lectura_dias}
            onChange={e => setForm(f => ({ ...f, periodicidad_lectura_dias: e.target.value }))}
            placeholder="Ej: 30"
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Descripción</label>
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Descripción opcional del contador..."
            maxLength={500}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              background: form.activo ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
              color: form.activo ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
            }}
          >
            {form.activo ? 'Activo' : 'Inactivo'}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleGuardar}
          disabled={loading}
          style={{
            padding: '10px 24px',
            background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
          }}
        >
          {loading ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
        </button>
        <button
          onClick={cancelForm}
          style={{
            padding: '10px 24px',
            background: 'var(--at-chip)',
            color: 'var(--at-ink-2)',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Cancelar
        </button>
      </div>
    </EditModal>
  )
}
