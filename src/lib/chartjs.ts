// Centralized Chart.js setup: register only what the app actually uses.
// Importing this module once guarantees the controllers/elements/scales/plugins
// are available; subsequent imports are no-ops.
import {
  Chart,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Title, Filler,
} from 'chart.js'

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Title, Filler,
)

export { Chart }
export type { ChartConfiguration, ChartData, ChartOptions } from 'chart.js'
