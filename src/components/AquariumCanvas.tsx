import { useEffect, useRef } from 'react';
import { Application, Graphics, Container, Ticker } from 'pixi.js';
import type { MetricFamily } from '../utils/prometheusParser';
import { deriveFishData, hashColor } from '../utils/fishUtils';

interface FishData {
  container: Container;
  body: Graphics;
  eye: Graphics;
  vx: number;
  vy: number;
  wobble: number;
  wobbleSpeed: number;
  color: number;
  facingRight: boolean;
  speedScale: number;
}

interface BubbleData {
  gfx: Graphics;
  x: number;
  y: number;
  speed: number;
  radius: number;
  alpha: number;
}

type CoralType = 'fan' | 'branch' | 'dome' | 'tube' | 'star';
const CORAL_TYPE_LIST: CoralType[] = ['fan', 'branch', 'dome', 'tube', 'star'];
const MAX_CORALS = 12;
const HTTP_DURATION_METRIC_PREFIX = 'http_request_duration_seconds';

interface AquariumCanvasProps {
  families: MetricFamily[];
  width?: number;
  height?: number;
}

const WATER_COLOR = 0x0a1628;

function hashCoralType(str: string): CoralType {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return CORAL_TYPE_LIST[Math.abs(hash) % CORAL_TYPE_LIST.length];
}

/** Linear blend of two hex colors. factor=0 → base, factor=1 → target. */
function blendColor(base: number, target: number, factor: number): number {
  const r = Math.round(((base >> 16) & 0xff) * (1 - factor) + ((target >> 16) & 0xff) * factor);
  const g = Math.round(((base >> 8) & 0xff) * (1 - factor) + ((target >> 8) & 0xff) * factor);
  const b = Math.round((base & 0xff) * (1 - factor) + (target & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Warm orange-red used to tint slow corals. */
const SLOW_CORAL_COLOR = 0xff4400;

function drawCoralAt(gfx: Graphics, type: CoralType, color: number, x: number, y: number, avgLatency: number = 0): void {
  // Tint toward orange-red for high avg latency (≥ 2 s = fully tinted)
  const latencyFactor = Math.min(avgLatency / 2.0, 1.0);
  const c = latencyFactor > 0 ? blendColor(color, SLOW_CORAL_COLOR, latencyFactor) : color;
  switch (type) {
    case 'fan': {
      // Stem
      gfx.moveTo(x, y);
      gfx.lineTo(x, y - 30);
      gfx.stroke({ color: c, width: 3, alpha: 0.9 });
      // Fan ribs fanning upward in a semicircle
      for (let i = 0; i < 7; i++) {
        const angle = -Math.PI + (i / 6) * Math.PI;
        gfx.moveTo(x, y - 30);
        gfx.lineTo(x + Math.cos(angle) * 20, y - 30 + Math.sin(angle) * 20);
        gfx.stroke({ color: c, width: 1.5, alpha: 0.65 });
      }
      break;
    }
    case 'branch': {
      const drawBranch = (bx: number, by: number, angle: number, length: number, depth: number): void => {
        if (depth <= 0 || length < 5) return;
        const ex = bx + Math.cos(angle) * length;
        const ey = by + Math.sin(angle) * length;
        gfx.moveTo(bx, by);
        gfx.lineTo(ex, ey);
        gfx.stroke({ color: c, width: depth * 0.8 + 0.5, alpha: 0.85 });
        drawBranch(ex, ey, angle - 0.5, length * 0.65, depth - 1);
        drawBranch(ex, ey, angle + 0.5, length * 0.65, depth - 1);
      };
      drawBranch(x, y, -Math.PI / 2, 22, 3);
      break;
    }
    case 'dome': {
      // Base platform
      gfx.rect(x - 16, y - 6, 32, 6);
      gfx.fill({ color: c, alpha: 0.7 });
      // Dome
      gfx.ellipse(x, y - 14, 16, 12);
      gfx.fill({ color: c, alpha: 0.85 });
      break;
    }
    case 'tube': {
      const offsets = [-9, -3, 3, 9];
      for (let ti = 0; ti < offsets.length; ti++) {
        const ox = offsets[ti];
        const th = 22 + (ti % 2) * 6;
        gfx.rect(x + ox - 2.5, y - th, 5, th);
        gfx.fill({ color: c, alpha: 0.85 });
        // Opening at tube top
        gfx.ellipse(x + ox, y - th, 3.5, 2);
        gfx.fill({ color: 0xffffff, alpha: 0.3 });
      }
      break;
    }
    case 'star': {
      // Short stem
      gfx.moveTo(x, y);
      gfx.lineTo(x, y - 10);
      gfx.stroke({ color: c, width: 3, alpha: 0.8 });
      // Star/flower shape with alternating outer and inner radii
      const spikes = 6;
      const outerR = 16;
      const innerR = 7;
      const cx = x;
      const cy = y - 10;
      const firstAngle = -Math.PI / 2;
      gfx.moveTo(cx + Math.cos(firstAngle) * outerR, cy + Math.sin(firstAngle) * outerR);
      for (let si = 1; si < spikes * 2; si++) {
        const angle = (si * Math.PI) / spikes - Math.PI / 2;
        const r = si % 2 === 0 ? outerR : innerR;
        gfx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      gfx.lineTo(cx + Math.cos(firstAngle) * outerR, cy + Math.sin(firstAngle) * outerR);
      gfx.fill({ color: c, alpha: 0.9 });
      break;
    }
  }
}

function deriveCoralData(families: MetricFamily[]): { name: string; type: CoralType; color: number; avgLatency: number }[] {
  const seen = new Set<string>();
  const sumMap: Record<string, number> = {};
  const countMap: Record<string, number> = {};
  for (const family of families) {
    if (!family.name.startsWith(HTTP_DURATION_METRIC_PREFIX)) continue;
    for (const sample of family.samples) {
      const component = sample.labels['component'];
      if (!component) continue;
      seen.add(component);
      if (sample.name.endsWith('_sum')) sumMap[component] = sample.value;
      else if (sample.name.endsWith('_count')) countMap[component] = sample.value;
    }
  }
  return Array.from(seen).slice(0, MAX_CORALS).map((name) => {
    const avgLatency =
      sumMap[name] !== undefined && countMap[name] !== undefined && countMap[name] > 0
        ? sumMap[name] / countMap[name]
        : 0;
    return { name, type: hashCoralType(name), color: hashColor(name), avgLatency };
  });
}

function drawFish(fish: FishData, facingRight: boolean): void {
  fish.body.clear();
  fish.eye.clear();

  const color = fish.color;
  const darkerColor = ((color >> 1) & 0x7f7f7f) | 0x080808;

  // Body
  fish.body.ellipse(0, 0, 22, 12);
  fish.body.fill({ color });

  // Tail (triangle)
  const tailX = facingRight ? -22 : 22;
  fish.body.moveTo(tailX, 0);
  fish.body.lineTo(facingRight ? tailX - 14 : tailX + 14, -10);
  fish.body.lineTo(facingRight ? tailX - 14 : tailX + 14, 10);
  fish.body.fill({ color: darkerColor });

  // Dorsal fin
  fish.body.moveTo(facingRight ? 5 : -5, -12);
  fish.body.lineTo(facingRight ? 12 : -12, -20);
  fish.body.lineTo(facingRight ? 18 : -18, -12);
  fish.body.fill({ color: darkerColor, alpha: 0.7 });

  // Eye
  const eyeX = facingRight ? 10 : -10;
  fish.eye.circle(eyeX, -2, 4);
  fish.eye.fill({ color: 0xffffff });
  fish.eye.circle(eyeX + (facingRight ? 1 : -1), -2, 2);
  fish.eye.fill({ color: 0x111111 });
}

function createFish(
  app: Application,
  stage: Container,
  color: number,
  label: string,
  speedScale: number = 1.0
): FishData {
  const container = new Container();
  container.label = label;

  const body = new Graphics();
  const eye = new Graphics();
  container.addChild(body);
  container.addChild(eye);

  const width = app.canvas.width;
  const height = app.canvas.height;

  const x = Math.random() * width;
  const y = 80 + Math.random() * (height - 160);
  container.position.set(x, y);

  const speed = speedScale * (1.0 + Math.random() * 1.5);
  const angle = Math.random() * Math.PI * 2;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed * 0.4;
  const facingRight = vx > 0;

  const fish: FishData = {
    container,
    body,
    eye,
    vx,
    vy,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.05 + Math.random() * 0.04,
    color,
    facingRight,
    speedScale,
  };

  drawFish(fish, facingRight);
  stage.addChild(container);
  return fish;
}

function updateFish(fish: FishData, width: number, height: number): void {
  fish.wobble += fish.wobbleSpeed;
  const wobbleY = Math.sin(fish.wobble) * 0.5;

  fish.container.x += fish.vx;
  fish.container.y += fish.vy + wobbleY;

  // Bounce off edges
  const margin = 40;
  let facingRight = fish.facingRight;

  if (fish.container.x < margin && fish.vx < 0) {
    fish.vx = Math.abs(fish.vx);
    facingRight = true;
  }
  if (fish.container.x > width - margin && fish.vx > 0) {
    fish.vx = -Math.abs(fish.vx);
    facingRight = false;
  }
  if (fish.container.y < 80) {
    fish.vy = Math.abs(fish.vy) * 0.5;
    fish.container.y = 80;
  }
  if (fish.container.y > height - 80) {
    fish.vy = -Math.abs(fish.vy) * 0.5;
    fish.container.y = height - 80;
  }

  // Slight random drift
  fish.vx += (Math.random() - 0.5) * 0.05;
  fish.vy += (Math.random() - 0.5) * 0.02;

  // Clamp speed
  const maxSpeed = fish.speedScale * 3.0;
  const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
  if (speed > maxSpeed) {
    fish.vx = (fish.vx / speed) * maxSpeed;
    fish.vy = (fish.vy / speed) * maxSpeed;
  }

  if (facingRight !== fish.facingRight) {
    fish.facingRight = facingRight;
    drawFish(fish, facingRight);
  }
}

function createBubble(app: Application, x?: number): BubbleData {
  const gfx = new Graphics();
  const width = app.canvas.width;
  const height = app.canvas.height;
  const rx = x ?? Math.random() * width;
  const radius = 2 + Math.random() * 5;
  gfx.circle(0, 0, radius);
  gfx.stroke({ color: 0x88bbff, alpha: 0.6, width: 1 });
  gfx.position.set(rx, height - 20);
  return {
    gfx,
    x: rx,
    y: height - 20,
    speed: 0.5 + Math.random() * 1.0,
    radius,
    alpha: 0.3 + Math.random() * 0.4,
  };
}

function drawBackground(bg: Graphics, width: number, height: number): void {
  bg.clear();
  // Water gradient via layered fills
  for (let i = 0; i < 8; i++) {
    const ratio = i / 7;
    const r = Math.round(0x0a + (0x05 - 0x0a) * ratio);
    const g = Math.round(0x16 + (0x30 - 0x16) * ratio);
    const b = Math.round(0x28 + (0x50 - 0x28) * ratio);
    const color = (r << 16) | (g << 8) | b;
    const bandH = height / 8;
    bg.rect(0, i * bandH, width, bandH + 1);
    bg.fill({ color });
  }
}

function drawSeabed(bed: Graphics, width: number, height: number): void {
  bed.clear();
  bed.rect(0, height - 40, width, 40);
  bed.fill({ color: 0x1a0e05 });
  // Rocks
  const rockColors = [0x2a1e0f, 0x3a2a18, 0x4a3a28];
  for (let i = 0; i < 18; i++) {
    const rx = (i / 18) * width + (Math.sin(i * 7.3) * 40);
    const rw = 20 + Math.abs(Math.sin(i * 3.7)) * 40;
    const rh = 15 + Math.abs(Math.cos(i * 2.1)) * 20;
    bed.ellipse(rx, height - 35, rw, rh);
    bed.fill({ color: rockColors[i % 3] });
  }
}

function drawSeaweed(weed: Graphics, tick: number, width: number, height: number): void {
  weed.clear();
  const weedPositions = [0.08, 0.18, 0.32, 0.47, 0.55, 0.68, 0.79, 0.91];
  for (const pos of weedPositions) {
    const bx = pos * width;
    const segments = 6;
    const segH = 18;
    const weedColor = 0x1a5c2a;
    for (let s = 0; s < segments; s++) {
      const sway = Math.sin(tick * 0.02 + pos * 12 + s * 0.8) * (s * 3);
      const sx = bx + sway;
      const sy = height - 40 - s * segH;
      const nextSway = Math.sin(tick * 0.02 + pos * 12 + (s + 1) * 0.8) * ((s + 1) * 3);
      const nx = bx + nextSway;
      const ny = sy - segH;
      weed.moveTo(sx, sy);
      weed.lineTo(nx, ny);
      const alpha = 0.6 + (s / segments) * 0.4;
      weed.stroke({ color: weedColor, alpha, width: 3 - s * 0.3 });
    }
  }
}

function drawSurface(surf: Graphics, tick: number, width: number): void {
  surf.clear();
  surf.moveTo(0, 0);
  for (let x = 0; x <= width; x += 8) {
    const y = 5 + Math.sin(x * 0.02 + tick * 0.03) * 4 + Math.sin(x * 0.05 + tick * 0.015) * 2;
    surf.lineTo(x, y);
  }
  surf.lineTo(width, 0);
  surf.lineTo(0, 0);
  surf.fill({ color: 0x1a8ccc, alpha: 0.25 });
}

export function AquariumCanvas({ families, width = 900, height = 600 }: AquariumCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const fishRef = useRef<Map<string, FishData>>(new Map());
  const bubblesRef = useRef<BubbleData[]>([]);
  const tickRef = useRef(0);
  const coralGfxRef = useRef<Graphics | null>(null);

  // Initialise PixiJS once
  useEffect(() => {
    let destroyed = false;
    const app = new Application();
    const fishMap = fishRef.current;

    (async () => {
      await app.init({
        width,
        height,
        backgroundColor: WATER_COLOR,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      appRef.current = app;
      if (canvasRef.current) {
        canvasRef.current.appendChild(app.canvas);
      }

      // Background layers
      const bgLayer = new Container();
      const bg = new Graphics();
      bgLayer.addChild(bg);
      app.stage.addChild(bgLayer);

      const seabedLayer = new Container();
      const seabed = new Graphics();
      seabedLayer.addChild(seabed);

      const coralGfx = new Graphics();
      seabedLayer.addChild(coralGfx);
      coralGfxRef.current = coralGfx;

      const weedLayer = new Container();
      const seaweed = new Graphics();
      weedLayer.addChild(seaweed);

      const fishLayer = new Container();
      app.stage.addChild(fishLayer);

      app.stage.addChild(seabedLayer);
      app.stage.addChild(weedLayer);

      const surfaceLayer = new Container();
      const surface = new Graphics();
      surfaceLayer.addChild(surface);
      app.stage.addChild(surfaceLayer);

      // Initial draw
      drawBackground(bg, app.canvas.width, app.canvas.height);
      drawSeabed(seabed, app.canvas.width, app.canvas.height);

      // Pre-populate some bubbles
      for (let i = 0; i < 12; i++) {
        const b = createBubble(app);
        b.y = Math.random() * app.canvas.height;
        b.gfx.position.set(b.x, b.y);
        bubblesRef.current.push(b);
        fishLayer.addChild(b.gfx);
      }

      // Expose fishLayer so metrics effect can add fish to it
      (app as unknown as { fishLayer: Container }).fishLayer = fishLayer;

      app.ticker.add((ticker: Ticker) => {
        if (destroyed) return;
        tickRef.current += ticker.deltaTime;
        const tick = tickRef.current;
        const w = app.canvas.width;
        const h = app.canvas.height;

        drawSeaweed(seaweed, tick, w, h);
        drawSurface(surface, tick, w);

        // Update fish
        for (const fish of fishRef.current.values()) {
          updateFish(fish, w, h);
        }

        // Update bubbles
        const bubbles = bubblesRef.current;
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          b.y -= b.speed;
          b.gfx.position.set(b.x + Math.sin(tick * 0.03 + i) * 0.5, b.y);
          if (b.y < -20) {
            fishLayer.removeChild(b.gfx);
            b.gfx.destroy();
            bubbles.splice(i, 1);
          }
        }

        // Spawn new bubble occasionally
        if (Math.random() < 0.04 && bubbles.length < 25) {
          const nb = createBubble(app);
          bubbles.push(nb);
          fishLayer.addChild(nb.gfx);
        }
      });
    })();

    return () => {
      destroyed = true;
      coralGfxRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      fishMap.clear();
      bubblesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync fish with metrics
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const fishLayer = (app as unknown as { fishLayer?: Container }).fishLayer;
    if (!fishLayer) return;

    const desired = deriveFishData(families);
    const desiredKeys = new Set(desired.map((d) => d.label));
    const existingKeys = new Set(fishRef.current.keys());

    // Remove fish that are no longer needed
    for (const key of existingKeys) {
      if (!desiredKeys.has(key)) {
        const fish = fishRef.current.get(key)!;
        fishLayer.removeChild(fish.container);
        fish.container.destroy();
        fishRef.current.delete(key);
      }
    }

    // Add new fish
    for (const { label, color, isUp, speedScale } of desired) {
      if (!fishRef.current.has(label)) {
        const fish = createFish(app, fishLayer, color, label, speedScale);
        if (!isUp) {
          fish.container.alpha = 0.35;
        }
        fishRef.current.set(label, fish);
      } else {
        // Update alive/dead state
        const fish = fishRef.current.get(label)!;
        fish.container.alpha = isUp ? 1.0 : 0.35;
      }
    }
  }, [families]);

  // Sync corals with metrics
  useEffect(() => {
    const app = appRef.current;
    const coralGfx = coralGfxRef.current;
    if (!app || !coralGfx) return;

    const corals = deriveCoralData(families);
    const w = app.canvas.width;
    const h = app.canvas.height;

    coralGfx.clear();
    corals.forEach(({ type, color, avgLatency }, i) => {
      const x = ((i + 0.5) / corals.length) * w;
      drawCoralAt(coralGfx, type, color, x, h - 40, avgLatency);
    });
  }, [families]);

  return (
    <div
      ref={canvasRef}
      style={{ width, height, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.6)' }}
    />
  );
}
