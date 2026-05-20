import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'auto' | 'light' | 'dark'

const KEY = 'at-theme'

function readPref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

/** Applies the preference to <html>. 'auto' removes the attribute so the
 *  prefers-color-scheme media query decides. */
function apply(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref)

  useEffect(() => {
    apply(pref)
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  }, [pref])

  // Cycle auto → light → dark → auto
  const cycle = useCallback(() => {
    setPref(p => (p === 'auto' ? 'light' : p === 'light' ? 'dark' : 'auto'))
  }, [])

  return { pref, setPref, cycle }
}
