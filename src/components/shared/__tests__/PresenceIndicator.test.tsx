import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { PresenceIndicator } from '../PresenceIndicator'
import type { PresenceRow } from '../../../hooks/usePresence'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({
          data: [
            { id: 'u1', full_name: 'Ana López' },
            { id: 'u2', full_name: 'Carlos Mendez' },
            { id: 'u3', full_name: 'Beatriz Ruiz' },
            { id: 'u4', full_name: 'Daniel Pérez' },
            { id: 'u5', full_name: 'Eva Soto' },
          ],
        }),
      }),
    }),
  },
}))

function row(user_id: string, secondsAgo: number = 5): PresenceRow {
  return {
    user_id,
    company_id: 'c1',
    project_id: null,
    section: 'clientes',
    record_id: null,
    last_seen: new Date(Date.now() - secondsAgo * 1000).toISOString(),
  }
}

beforeEach(() => { cleanup() })

describe('PresenceIndicator', () => {
  it('no renderiza si no hay otros usuarios', () => {
    const { container } = render(<PresenceIndicator others={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renderiza avatares con iniciales de cada usuario', async () => {
    render(<PresenceIndicator others={[row('u1'), row('u2')]} />)
    await waitFor(() => expect(screen.getByText('AL')).toBeTruthy())
    expect(screen.getByText('CM')).toBeTruthy()
  })

  it('limita a maxAvatars y muestra "+N" cuando hay más', async () => {
    const rows = [row('u1'), row('u2'), row('u3'), row('u4'), row('u5')]
    render(<PresenceIndicator others={rows} maxAvatars={3} />)
    await waitFor(() => expect(screen.getByText('AL')).toBeTruthy())
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('tiene role=status con aria-label descriptivo', async () => {
    render(<PresenceIndicator others={[row('u1'), row('u2')]} />)
    const status = await screen.findByRole('status')
    expect(status.getAttribute('aria-label')).toContain('2 personas')
  })

  it('aria-label en singular para 1 persona', async () => {
    render(<PresenceIndicator others={[row('u1')]} />)
    const status = await screen.findByRole('status')
    expect(status.getAttribute('aria-label')).toContain('1 persona viendo')
  })
})
