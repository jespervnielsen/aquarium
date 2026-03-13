# Copilot Instructions for Aquarium

## Project overview

**Aquarium** is a static React application that polls a Prometheus `/metrics` endpoint and renders animated fish using PixiJS — one fish per monitored service. It is deployed to GitHub Pages and requires no backend.

- Live demo: https://jespervnielsen.github.io/aquarium/
- Tech stack: React 19, TypeScript, Vite, PixiJS v8, Vitest, ESLint

## Repository structure

```
src/
  App.tsx                      # Root component; wires metrics polling, canvas, and sidebar
  components/
    AquariumCanvas.tsx         # PixiJS canvas; renders fish and animations
    MetricsConfig.tsx          # Settings dialog (endpoint URL, poll interval)
    MetricsPanel.tsx           # Sidebar showing raw metric families and values
    TestMetricsControls.tsx    # Dev-only controls for test scenario toggles
  hooks/
    usePrometheusMetrics.ts    # Custom hook: fetches and parses Prometheus text format
    useContainerTracker.ts     # Tracks container instances via process_start_time_seconds; 5-min default timeout
    useTestMetrics.ts          # Runs the metrics simulator in-browser for static hosting (GitHub Pages)
  utils/
    prometheusParser.ts        # Parses Prometheus exposition text into MetricFamily/MetricSample objects
    fishUtils.ts               # Fish colour hashing, MAX_FISH constant, and display helpers
  metrics/
    types.ts                   # Shared MetricSample and DerivedMetrics TypeScript types
    prometheusParser.ts        # Low-level parser producing MetricSample[]
    metricsService.ts          # Stateful service: polls endpoint, computes deltas between snapshots
  config/
    queries.json               # Manual overrides for GraphQL query → fish species
    components.json            # Manual overrides for HTTP component → coral type
  discovery.ts                 # Core logic: metric parsing, species/coral registry
  discovery.test.ts            # Vitest unit tests for discovery.ts
  dev/                         # Dev-server mock metrics endpoint and metricsSimulator
```

## Development workflow

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server at http://localhost:5173/aquarium/
npm run build        # Type-check + production build (outputs to dist/)
npm run preview      # Preview the production build locally
npm run lint         # Run ESLint
npm run test         # Run Vitest (single pass)
npm run test:watch   # Run Vitest in watch mode
```

Always run `npm run lint` and `npm run test` before opening or updating a pull request.

## Coding conventions

- **Language**: TypeScript throughout; strict mode via `tsconfig.app.json`.
- **Style**: Single quotes for strings, no semicolons inside config files (JSON); follow the patterns in existing `.ts`/`.tsx` files.
- **Exports**: Named exports preferred; default export only for React components (one per file).
- **React**: Functional components with hooks only — no class components.
- **Immutability**: Prefer `const` over `let`; avoid mutation of existing arrays/objects.
- **Comments**: JSDoc for exported functions and classes (see `discovery.ts`); inline comments only for non-obvious logic.
- **Tests**: Place tests in `*.test.ts` files next to the module they test. Use `vitest` (`describe`/`it`/`expect`). Do not mock modules unless unavoidable.
- **No external state management**: State lives in React hooks or `localStorage`; no Redux/Zustand/etc.

## Key architectural decisions

- **Species registry** (`SpeciesRegistry` in `discovery.ts`): maps Prometheus metric names to fish/coral visual properties. Auto-generates deterministic colors and shapes via `hashName`. Manual overrides live in `src/config/queries.json` and `src/config/components.json`.
- **Prometheus parsing** (`parseMetrics` in `discovery.ts`): parses raw Prometheus text format lines; looks for `graphql_query_counter{queryName="..."}` and `http_request_duration_seconds_*{component="..."}` patterns.
- **Container tracking** (`useContainerTracker` in `src/hooks/useContainerTracker.ts`): identifies individual container instances via the `process_start_time_seconds` gauge; marks a container as down after 5 minutes of inactivity.
- **Test mode**: Setting the endpoint URL to the special `TEST_ENDPOINT_URL` constant activates a local mock that serves synthetic metric data; `TestMetricsControls` lets you toggle named scenarios. On static hosts (GitHub Pages), `useTestMetrics` runs the simulator directly in the browser so no dev-server middleware is needed.
- **Responsive canvas**: Canvas size is computed from `window.innerWidth` minus the sidebar width; recalculated on every `resize` event.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the app and publishes the `dist/` folder to GitHub Pages. Enable Pages in **Settings → Pages → Source: GitHub Actions**.
