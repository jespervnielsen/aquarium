# 🐠 Aquarium

A static React application that polls a Prometheus `/metrics` endpoint and renders animated fish using PixiJS — one fish per monitored service.

**Live demo:** https://jespervnielsen.github.io/aquarium/

## Features

- **No backend required** — runs as a fully static site hosted on GitHub Pages
- **Prometheus polling** — configurable endpoint URL and poll interval, stored in `localStorage`
- **PixiJS animations** — animated fish swim around the canvas; services reporting `up=1` are bright, `up=0` fish are dimmed
- **Metrics sidebar** — real-time display of all scraped metric families and values
- **React + TypeScript** — built with Vite for fast development and optimised production bundles

## How the visualisation works

| Prometheus metric | Aquarium effect |
|---|---|
| `up{job="..."}` (one per service) | One fish per service; bright = up, dim = down |
| Any metric families (fallback) | One fish per unique metric family name |

## Getting started

### Local development

```bash
npm install
npm run dev
```

Open http://localhost:5173/aquarium/, click **⚙️ Configure**, and enter the URL of your Prometheus `/metrics` endpoint (e.g. `http://localhost:9090/metrics`).

> **Note:** The endpoint must return [CORS headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) that allow requests from your browser's origin.
> For Prometheus, start it with `--web.cors.origin=".*"` or set up a reverse proxy.

### Build for production

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build locally
```

## Deployment

Pushes to `main` automatically deploy to GitHub Pages via the [deploy workflow](.github/workflows/deploy.yml).

Enable GitHub Pages in your repository settings:
**Settings → Pages → Source: GitHub Actions**

## Tech stack

| Tool | Purpose |
|---|---|
| [React 19](https://react.dev) | UI framework |
| [TypeScript](https://www.typescriptlang.org) | Type safety |
| [Vite](https://vite.dev) | Build tooling & dev server |
| [PixiJS v8](https://pixijs.com) | WebGL-accelerated 2-D animations |
| [GitHub Pages](https://pages.github.com) | Static hosting |
| [GitHub Actions](https://github.com/features/actions) | CI/CD deploy pipeline |
