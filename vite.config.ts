import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { generateMetricsText } from './src/dev/metricsSimulator.ts'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'metrics-simulator',
      configureServer(server) {
        server.middlewares.use('/dev/metrics', (_req, res) => {
          res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
          res.end(generateMetricsText())
        })
      },
    },
  ],
  base: '/aquarium/',
  test: {
    environment: 'node',
  },
})

