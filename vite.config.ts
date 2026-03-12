import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { generateMetricsText, type SimulatorOptions } from './src/dev/metricsSimulator.ts'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'metrics-simulator',
      configureServer(server) {
        server.middlewares.use('/dev/metrics', (req, res) => {
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
    },
  ],
  base: '/aquarium/',
  test: {
    environment: 'node',
  },
})

