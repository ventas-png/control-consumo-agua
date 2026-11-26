# Capturas para manuales

Genera capturas de pantalla de los componentes REALES del sistema con una empresa de demostración
(«Condominio Demo», `demo.ts`): nada viene de producción y no hace falta red ni base de datos.

```bash
npx vitest run --config scripts/capturas/vitest.config.ts   # monta cada pantalla y vuelca su HTML
node scripts/capturas/fotografiar.mjs                         # fotografía cada HTML con los estilos del sistema
```

Las imágenes quedan en `scripts/capturas/salida/png/` (ignorada por git). `CAPTURAS_OUT=<carpeta>` cambia el destino y
`CAPTURAS_SOLO=<texto>` fotografía solo los archivos que lo contengan.

| Archivo | Qué es |
|---|---|
| `demo.ts` | Datos de la empresa demo: áreas, actividades, jornadas, reglas, personal, rutinas, turnos de noviembre de 2026, tareas y novedades. «Hoy» es el miércoles 25. |
| `limpieza.captura.tsx` | Una escena por captura del manual de Limpieza (calendario, ＋ varias, detalle, rutinas, editor, ruta del día, preparación, tarea, fin, novedades) y de sus requisitos (áreas, actividades, jornadas, reglas, generar turnos). |
| `fotografiar.mjs` | Sirve el HTML con `src/index.css` y las fuentes de `public/fonts`, y lo fotografía con Chromium a 2x. |
| `vitest.config.ts` | Configuración propia (sufijo `*.captura.tsx`): no corre con `npm test`. |

Para otro manual: un archivo `<modulo>.captura.tsx` nuevo con sus escenas, reutilizando `demo.ts`.
