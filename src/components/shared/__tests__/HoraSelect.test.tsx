import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { HoraSelect, horaDePartes, partesDeHora } from '../HoraSelect'

afterEach(cleanup)

describe('conversión 24 h ↔ 12 h', () => {
  it('medianoche y mediodía son las 12', () => {
    expect(partesDeHora('00:15')).toEqual({ hora: 12, minuto: '15', pm: false })
    expect(partesDeHora('12:30')).toEqual({ hora: 12, minuto: '30', pm: true })
    expect(partesDeHora('15:00:00')).toEqual({ hora: 3, minuto: '00', pm: true })
    expect(partesDeHora('')).toBeNull()
    expect(partesDeHora('25:00')).toBeNull()
    expect(horaDePartes(12, '00', false)).toBe('00:00')
    expect(horaDePartes(12, '00', true)).toBe('12:00')
    expect(horaDePartes(3, '45', true)).toBe('15:45')
    expect(horaDePartes(11, '00', false)).toBe('11:00')
  })
})

describe('HoraSelect', () => {
  const montar = (value: string) => {
    const onChange = vi.fn()
    render(<HoraSelect value={value} onChange={onChange} label="Hora estimada de llegada" />)
    return onChange
  }
  const sel = (parte: string) => screen.getByLabelText(`Hora estimada de llegada: ${parte}`) as HTMLSelectElement

  it('vacío: sólo se puede elegir la hora, y arranca en :00 p. m.', () => {
    const onChange = montar('')
    expect(sel('hora').value).toBe('')
    expect(sel('minutos').disabled).toBe(true)
    fireEvent.change(sel('hora'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith('15:00')
  })

  it('muestra la hora guardada y cambia cada parte por selección', () => {
    const onChange = montar('15:30')
    expect([sel('hora').value, sel('minutos').value, sel('a. m. o p. m.').value]).toEqual(['3', '30', 'pm'])
    fireEvent.change(sel('minutos'), { target: { value: '45' } })
    expect(onChange).toHaveBeenLastCalledWith('15:45')
    fireEvent.change(sel('a. m. o p. m.'), { target: { value: 'am' } })
    expect(onChange).toHaveBeenLastCalledWith('03:30')
    fireEvent.change(sel('hora'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('conserva un minuto guardado que no cae en cuartos', () => {
    montar('12:20')
    expect(sel('minutos').value).toBe('20')
    expect([...sel('minutos').options].map(o => o.value)).toEqual(['00', '15', '20', '30', '45'])
  })
})
