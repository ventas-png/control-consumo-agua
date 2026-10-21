import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConversationStatsBar } from '../ConversationStatsBar'

beforeEach(cleanup)

const stats = { abiertas: 3, en_progreso: 1, esperando: 0, resueltas: 5 }

describe('ConversationStatsBar', () => {
  it('tocar una tarjeta filtra por ese estado', () => {
    const onSelect = vi.fn()
    render(<ConversationStatsBar stats={stats} onSelectStatus={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Abiertas/ }))
    expect(onSelect).toHaveBeenCalledWith('abierta')
  })

  it('tocar la tarjeta activa quita el filtro', () => {
    const onSelect = vi.fn()
    render(<ConversationStatsBar stats={stats} activeStatus="resuelta" onSelectStatus={onSelect} />)
    const card = screen.getByRole('button', { name: /Resueltas/ })
    expect(card.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith('todas')
  })
})
