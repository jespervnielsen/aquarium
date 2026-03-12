import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { generateMetricsText, type SimulatorOptions } from './src/dev/metricsSimulator.ts'

const base = '/aquarium/'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'metrics-simulator',
      configureServer(server) {
        server.middlewares.use(`${base}dev/metrics`, (req, res) => {
          const qs = (req.url ?? '').split('?')[1] ?? ''
          const params = new URLSearchParams(qs)
          // Query param presence controls which scenarios are forced active;
          // the value itself is ignored (any value activates the scenario).
          const options: SimulatorOptions = {
            trafficSpike: params.has('trafficSpike'),
            breakingNewsSpike: params.has('breakingNewsSpike'),
            dependencySlowdown: params.has('dependencySlowdown'),
            errorSpike: params.has('errorSpike'),
          }
          res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
          res.end(generateMetricsText(options))
        })
      },
      generateBundle() {
        // Emit a static snapshot of the simulator output so the test endpoint
        // works on GitHub Pages (a fully static host with no server middleware).
        this.emitFile({
          type: 'asset',
          fileName: 'dev/metrics',
          source: generateMetricsText(),
        })
      },
    },
  ],
  base,
  test: {
    environment: 'node',
  },
})

