import { describe, it, expect } from 'vitest'
import { describeUserAgent } from '../userAgent'

// plat:P9 — Parser puro de user-agent para el listado de sesiones activas.
// UAs reales (recortados) de cada combinación navegador/SO común.

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
}

describe('describeUserAgent — navegador', () => {
  it('detecta Chrome en escritorio (no lo confunde con Safari)', () => {
    expect(describeUserAgent(UA.chromeWin).navegador).toBe('Chrome')
  })
  it('detecta Edge antes que Chrome', () => {
    expect(describeUserAgent(UA.edgeWin).navegador).toBe('Edge')
  })
  it('detecta Opera antes que Chrome', () => {
    expect(describeUserAgent(UA.operaWin).navegador).toBe('Opera')
  })
  it('detecta Samsung Internet antes que Chrome', () => {
    expect(describeUserAgent(UA.samsung).navegador).toBe('Samsung Internet')
  })
  it('detecta Firefox', () => {
    expect(describeUserAgent(UA.firefoxLinux).navegador).toBe('Firefox')
  })
  it('detecta Safari real (con Version/) y no en UAs de Chrome', () => {
    expect(describeUserAgent(UA.safariMac).navegador).toBe('Safari')
    expect(describeUserAgent(UA.safariIphone).navegador).toBe('Safari')
  })
  it('detecta Chrome iOS (CriOS) como Chrome', () => {
    expect(describeUserAgent(UA.chromeIos).navegador).toBe('Chrome')
  })
})

describe('describeUserAgent — sistema', () => {
  it('Windows / macOS / Linux', () => {
    expect(describeUserAgent(UA.chromeWin).sistema).toBe('Windows')
    expect(describeUserAgent(UA.safariMac).sistema).toBe('macOS')
    expect(describeUserAgent(UA.firefoxLinux).sistema).toBe('Linux')
  })
  it('iOS gana a "Mac OS X" (los iPhone lo incluyen)', () => {
    expect(describeUserAgent(UA.safariIphone).sistema).toBe('iOS')
    expect(describeUserAgent(UA.chromeIos).sistema).toBe('iOS')
  })
  it('Android gana a "Linux" (lo incluye)', () => {
    expect(describeUserAgent(UA.chromeAndroid).sistema).toBe('Android')
    expect(describeUserAgent(UA.samsung).sistema).toBe('Android')
  })
})

describe('describeUserAgent — etiqueta y degradación', () => {
  it('compone "Navegador · Sistema"', () => {
    expect(describeUserAgent(UA.chromeWin).etiqueta).toBe('Chrome · Windows')
    expect(describeUserAgent(UA.safariIphone).etiqueta).toBe('Safari · iOS')
  })
  it('vacío/nulo/undefined → "Dispositivo desconocido"', () => {
    expect(describeUserAgent('').etiqueta).toBe('Dispositivo desconocido')
    expect(describeUserAgent(null).etiqueta).toBe('Dispositivo desconocido')
    expect(describeUserAgent(undefined).etiqueta).toBe('Dispositivo desconocido')
  })
  it('UA irreconocible → ambos Desconocido y etiqueta de dispositivo desconocido', () => {
    const r = describeUserAgent('curl/8.4.0')
    expect(r.navegador).toBe('Desconocido')
    expect(r.sistema).toBe('Desconocido')
    expect(r.etiqueta).toBe('Dispositivo desconocido')
  })
  it('reconoce solo el SO si el navegador es atípico', () => {
    const r = describeUserAgent('SomeBot/1.0 (Windows NT 10.0)')
    expect(r.sistema).toBe('Windows')
    expect(r.navegador).toBe('Desconocido')
    expect(r.etiqueta).toBe('Desconocido · Windows')
  })
})
