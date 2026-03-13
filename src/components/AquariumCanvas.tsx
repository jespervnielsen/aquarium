import { useEffect, useRef } from 'react';
import { Application, Graphics, Container, Ticker } from 'pixi.js';
import type { MetricFamily } from '../utils/prometheusParser';
import { deriveFishData, hashColor, type FishPattern } from '../utils/fishUtils';
import type { ContainerRecord } from '../hooks/useContainerTracker';

interface FishData {
  container: Container;
  body: Graphics;
  eye: Graphics;
  vx: number;
  vy: number;
  wobble: number;
  wobbleSpeed: number;
  color: number;
  pattern: FishPattern;
  facingRight: boolean;
  speedScale: number;
  isPredator?: boolean;
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

/** Key used in the fish map for the predator shark, managed separately from metric-driven fish. */
const PREDATOR_KEY = '__predator__';

interface AquariumCanvasProps {
  families: MetricFamily[];
  width?: number;
  height?: number;
  /** Global speed multiplier applied to all fish (e.g. 3.0 during a traffic spike). */
  speedMultiplier?: number;
  /** Tracked container instances to display as status indicators. */
  containers?: ContainerRecord[];
  /** When true a predator fish appears to represent active errors. */
  hasErrors?: boolean;
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

// ─── Time-of-day helpers ──────────────────────────────────────────────────────

/**
 * Returns the water background gradient colours (top and bottom) for the
 * given time.  The aquarium lighting shifts from deep night blue through warm
 * dawn/dusk hues to a brighter daytime blue-green palette.
 */
function getSkyGradient(now: Date): { top: number; bottom: number } {
  const h = now.getHours() + now.getMinutes() / 60;

  if (h >= 7 && h < 18) {
    // Daytime — brighter cyan-blue water
    const peak = 1 - Math.abs((h - 12.5) / 5.5) * 0.4; // brightest around midday
    const topR = Math.round(0x0a + peak * 0x08);
    const topG = Math.round(0x30 + peak * 0x12);
    const topB = Math.round(0x52 + peak * 0x18);
    return { top: (topR << 16) | (topG << 8) | topB, bottom: 0x051828 };
  }
  if ((h >= 5 && h < 7) || (h >= 18 && h < 20)) {
    // Dawn / dusk — muted warm tones in the water
    return { top: 0x141022, bottom: 0x040a14 };
  }
  // Night — deep dark blue
  return { top: 0x060b18, bottom: 0x040814 };
}

/**
 * Draws the sun disc (daytime) or moon (night) at the correct position along
 * the top of the canvas, plus subtle animated light shafts during the day.
 */
function drawLight(gfx: Graphics, tick: number, width: number, height: number, now: Date): void {
  gfx.clear();
  const h = now.getHours() + now.getMinutes() / 60;
  const isDaytime = h >= 6 && h < 20;

  if (isDaytime) {
    // Sun moves from left (6 am) to right (8 pm) on a gentle arc
    const t = (h - 6) / 14; // 0 = sunrise, 1 = sunset
    const sunX = t * width;
    const arcY = 18 - Math.sin(t * Math.PI) * 22; // arc — lowest at midday

    // Animated light shafts (only during full daytime 7–19)
    if (h >= 7 && h < 19) {
      const intensity = Math.max(0, 1 - Math.abs((h - 13) / 6)) * 0.06;
      for (let i = 0; i < 5; i++) {
        const bx = (i + 0.5) / 5 * width + Math.sin(tick * 0.005 + i * 1.3) * 25;
        const sw = 38 + Math.sin(tick * 0.003 + i * 0.8) * 8;
        gfx.moveTo(bx - sw / 2, 0);
        gfx.lineTo(bx + sw / 2, 0);
        gfx.lineTo(bx + sw / 4, height * 0.55);
        gfx.lineTo(bx - sw / 4, height * 0.55);
        gfx.fill({ color: 0xffffff, alpha: intensity });
      }
    }

    // Glow halo
    gfx.circle(sunX, arcY, 24);
    gfx.fill({ color: 0xffee88, alpha: 0.18 });
    // Sun disc
    gfx.circle(sunX, arcY, 14);
    gfx.fill({ color: 0xffdd44, alpha: 0.85 });
    gfx.circle(sunX, arcY, 9);
    gfx.fill({ color: 0xffffff, alpha: 0.7 });
  } else {
    // Moon moves from right (8 pm) to left (6 am)
    const moonH = h < 6 ? h + 24 : h; // 20…30
    const t = (moonH - 20) / 10; // 0 = 8 pm, 1 = 6 am
    const moonX = width * (1 - t);
    const arcY = 18 - Math.sin(t * Math.PI) * 18;

    // Glow
    gfx.circle(moonX, arcY, 18);
    gfx.fill({ color: 0xaaccff, alpha: 0.12 });
    // Disc
    gfx.circle(moonX, arcY, 11);
    gfx.fill({ color: 0xddeeff, alpha: 0.78 });
    // Crescent shadow
    gfx.circle(moonX + 5, arcY - 3, 9);
    gfx.fill({ color: 0x060b18, alpha: 0.72 });
  }
}

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

// ─── Sandcastle helpers ────────────────────────────────────────────────────────

/**
 * Draws a sandcastle on the seabed representing one container instance.
 * Active containers render in warm sand tones with a coloured flag;
 * inactive/dead containers appear dark and crumbled (no flag).
 */
function drawSandcastle(gfx: Graphics, x: number, y: number, isActive: boolean): void {
  const baseColor = isActive ? 0xd4a853 : 0x4a3818;
  const wallColor = isActive ? 0xb8943d : 0x3a2808;

  // Base wall
  gfx.rect(x - 10, y - 18, 20, 18);
  gfx.fill({ color: baseColor, alpha: 0.88 });

  // Battlements along the top of the base wall
  for (let i = 0; i < 3; i++) {
    if (i % 2 === 0) {
      gfx.rect(x - 10 + i * 8, y - 23, 6, 6);
      gfx.fill({ color: wallColor, alpha: 0.9 });
    }
  }

  // Central tower
  gfx.rect(x - 5, y - 31, 10, 13);
  gfx.fill({ color: baseColor, alpha: 0.92 });

  // Tower battlements
  gfx.rect(x - 5, y - 36, 4, 5);
  gfx.fill({ color: wallColor, alpha: 0.9 });
  gfx.rect(x + 1, y - 36, 4, 5);
  gfx.fill({ color: wallColor, alpha: 0.9 });

  if (isActive) {
    // Flag pole
    gfx.moveTo(x, y - 36);
    gfx.lineTo(x, y - 47);
    gfx.stroke({ color: 0x888888, width: 1.2, alpha: 0.8 });
    // Flag pennant
    gfx.moveTo(x, y - 47);
    gfx.lineTo(x + 8, y - 43);
    gfx.lineTo(x, y - 39);
    gfx.fill({ color: 0xff4444, alpha: 0.88 });
  }
}

// ─── Fish helpers ──────────────────────────────────────────────────────────────

/**
 * Draws a predator shark silhouette onto the fish's Graphics objects.
 * Uses the same FishData container structure as a normal fish.
 */
function drawShark(fish: FishData, facingRight: boolean): void {
  fish.body.clear();
  fish.eye.clear();

  const bodyColor = 0x5a6a78; // steel blue-grey
  const bellyColor = 0xc8d8e8; // pale belly
  const finColor = 0x4a5a68;
  const dir = facingRight ? 1 : -1;

  // Torpedo body
  fish.body.ellipse(0, 0, 38, 13);
  fish.body.fill({ color: bodyColor });

  // Pale belly underside
  fish.body.ellipse(dir * 3, 4, 28, 7);
  fish.body.fill({ color: bellyColor, alpha: 0.55 });

  // Forked caudal (tail) — top lobe
  const tailX = facingRight ? -38 : 38;
  fish.body.moveTo(tailX, -3);
  fish.body.lineTo(facingRight ? tailX - 16 : tailX + 16, -16);
  fish.body.lineTo(facingRight ? tailX - 6 : tailX + 6, 0);
  fish.body.fill({ color: finColor });
  // Bottom lobe
  fish.body.moveTo(tailX, 3);
  fish.body.lineTo(facingRight ? tailX - 16 : tailX + 16, 16);
  fish.body.lineTo(facingRight ? tailX - 6 : tailX + 6, 0);
  fish.body.fill({ color: finColor });

  // Large dorsal fin — the iconic shark silhouette
  fish.body.moveTo(dir * 0, -13);
  fish.body.lineTo(dir * 14, -34);
  fish.body.lineTo(dir * 24, -13);
  fish.body.fill({ color: finColor, alpha: 0.92 });

  // Pectoral fin
  fish.body.moveTo(dir * -8, 4);
  fish.body.lineTo(dir * -22, 20);
  fish.body.lineTo(dir * 4, 10);
  fish.body.fill({ color: finColor, alpha: 0.78 });

  // Gill line
  const gillX = facingRight ? 10 : -10;
  fish.body.moveTo(gillX, -9);
  fish.body.lineTo(gillX, 6);
  fish.body.stroke({ color: finColor, width: 1.5, alpha: 0.6 });

  // Eye — dark with faint red highlight (menacing)
  const eyeX = facingRight ? 22 : -22;
  fish.eye.circle(eyeX, -3, 3.5);
  fish.eye.fill({ color: 0x111111 });
  fish.eye.circle(eyeX + (facingRight ? 0.3 : -0.3), -3.5, 1.5);
  fish.eye.fill({ color: 0xcc2222 });
}

function drawFish(fish: FishData, facingRight: boolean): void {
  if (fish.isPredator) {
    drawShark(fish, facingRight);
    return;
  }

  fish.body.clear();
  fish.eye.clear();

  const color = fish.color;
  const darkerColor = ((color >> 1) & 0x7f7f7f) | 0x080808;

  // Body
  fish.body.ellipse(0, 0, 22, 12);
  fish.body.fill({ color });

  // Pattern overlay (drawn on top of body, below tail/fin)
  const patternAlpha = 0.45;
  switch (fish.pattern) {
    case 'stripes': {
      // Two horizontal bands across the body (like a mackerel)
      fish.body.rect(-19, -5, 38, 3);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha });
      fish.body.rect(-19, 2, 38, 3);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha });
      break;
    }
    case 'spots': {
      // Three spots scattered within the body (like a trout)
      fish.body.circle(-9, -2, 3.5);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha + 0.1 });
      fish.body.circle(0, 4, 3);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha + 0.1 });
      fish.body.circle(8, -4, 3.5);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha + 0.1 });
      break;
    }
    case 'patch': {
      // Darker patch on the rear half — the half opposite the eye (like a damselfish)
      const patchX = facingRight ? -22 : 6;
      fish.body.rect(patchX, -11, 16, 22);
      fish.body.fill({ color: darkerColor, alpha: 0.35 });
      break;
    }
    case 'bands': {
      // Two vertical stripes crossing the body (like a clownfish)
      fish.body.rect(-9, -11, 5, 22);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha });
      fish.body.rect(3, -11, 5, 22);
      fish.body.fill({ color: darkerColor, alpha: patternAlpha });
      break;
    }
    case 'plain':
    default:
      break;
  }

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
  pattern: FishPattern,
  label: string,
  speedScale: number = 1.0,
  isPredator: boolean = false
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
    pattern,
    facingRight,
    speedScale,
    isPredator,
  };

  drawFish(fish, facingRight);
  stage.addChild(container);
  return fish;
}

function updateFish(fish: FishData, width: number, height: number, speedMultiplier: number = 1.0): void {
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

  // Predators are more erratic; regular fish drift gently
  const driftX = fish.isPredator ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 0.05;
  const driftY = fish.isPredator ? (Math.random() - 0.5) * 0.06 : (Math.random() - 0.5) * 0.02;
  fish.vx += driftX;
  fish.vy += driftY;

  // Predators get a 1.5× speed bonus on top of the global multiplier
  const effectiveMultiplier = fish.isPredator ? speedMultiplier * 1.5 : speedMultiplier;
  const maxSpeed = fish.speedScale * 3.0 * effectiveMultiplier;
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

function drawBackground(bg: Graphics, width: number, height: number, now: Date): void {
  bg.clear();
  const { top, bottom } = getSkyGradient(now);
  // Water gradient via layered fills — lighter near the surface, deeper at the seabed
  for (let i = 0; i < 8; i++) {
    const ratio = i / 7;
    const color = blendColor(top, bottom, ratio);
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

export function AquariumCanvas({
  families,
  width = 900,
  height = 600,
  speedMultiplier = 1.0,
  containers = [],
  hasErrors = false,
}: AquariumCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const fishRef = useRef<Map<string, FishData>>(new Map());
  const bubblesRef = useRef<BubbleData[]>([]);
  const tickRef = useRef(0);
  const coralGfxRef = useRef<Graphics | null>(null);
  const castleGfxRef = useRef<Graphics | null>(null);
  const containerGfxRef = useRef<Graphics | null>(null);
  const speedMultiplierRef = useRef<number>(speedMultiplier);
  speedMultiplierRef.current = speedMultiplier;

  // Initialise PixiJS once
  useEffect(() => {
    let destroyed = false;
    const app = new Application();
    const fishMap = fishRef.current;
    const lastMinute = { value: -1 };

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

      // ── Layer stack (bottom → top) ──────────────────────────────────────────
      // 1. Background gradient (time-of-day colours)
      const bgLayer = new Container();
      const bg = new Graphics();
      bgLayer.addChild(bg);
      app.stage.addChild(bgLayer);

      // 2. Light layer: sun/moon disc + daytime light shafts
      const lightGfx = new Graphics();
      app.stage.addChild(lightGfx);

      // 3. Fish + bubbles layer (behind seabed structures)
      const fishLayer = new Container();
      app.stage.addChild(fishLayer);

      // 4. Seabed: sand floor + rocks + sandcastles + corals
      const seabedLayer = new Container();
      const seabed = new Graphics();
      seabedLayer.addChild(seabed);

      const castleGfx = new Graphics();
      seabedLayer.addChild(castleGfx);
      castleGfxRef.current = castleGfx;

      const coralGfx = new Graphics();
      seabedLayer.addChild(coralGfx);
      coralGfxRef.current = coralGfx;

      app.stage.addChild(seabedLayer);

      // 5. Seaweed layer
      const weedLayer = new Container();
      const seaweed = new Graphics();
      weedLayer.addChild(seaweed);
      app.stage.addChild(weedLayer);

      // 6. Surface water line
      const surfaceLayer = new Container();
      const surface = new Graphics();
      surfaceLayer.addChild(surface);
      app.stage.addChild(surfaceLayer);

      // 7. Container status indicators sit above the surface layer
      const containerGfx = new Graphics();
      containerGfxRef.current = containerGfx;
      app.stage.addChild(containerGfx);

      // Initial draw
      const now = new Date();
      drawBackground(bg, app.canvas.width, app.canvas.height, now);
      drawLight(lightGfx, 0, app.canvas.width, app.canvas.height, now);
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
        const tickNow = new Date();

        // Redraw background once per minute (time-of-day colours change slowly)
        const currentMinute = tickNow.getMinutes();
        if (currentMinute !== lastMinute.value) {
          lastMinute.value = currentMinute;
          drawBackground(bg, w, h, tickNow);
        }

        // Redraw light layer every frame (animated light shafts + sun/moon arc)
        drawLight(lightGfx, tick, w, h, tickNow);

        drawSeaweed(seaweed, tick, w, h);
        drawSurface(surface, tick, w);

        // Update fish
        for (const fish of fishRef.current.values()) {
          updateFish(fish, w, h, speedMultiplierRef.current);
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
      castleGfxRef.current = null;
      containerGfxRef.current = null;
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

    // Remove fish that are no longer needed.  The predator is managed separately.
    for (const key of existingKeys) {
      if (key === PREDATOR_KEY) continue;
      if (!desiredKeys.has(key)) {
        const fish = fishRef.current.get(key)!;
        fishLayer.removeChild(fish.container);
        fish.container.destroy();
        fishRef.current.delete(key);
      }
    }

    // Add new fish
    for (const { label, color, pattern, isUp, speedScale } of desired) {
      if (!fishRef.current.has(label)) {
        const fish = createFish(app, fishLayer, color, pattern, label, speedScale);
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

  // Draw sandcastles on the seabed — one per tracked container instance
  useEffect(() => {
    const app = appRef.current;
    const castleGfx = castleGfxRef.current;
    if (!app || !castleGfx) return;

    castleGfx.clear();
    if (containers.length === 0) return;

    const w = app.canvas.width;
    const h = app.canvas.height;

    // Cap to avoid severe overlap on small canvases
    const maxCastles = Math.min(containers.length, 20);
    for (let i = 0; i < maxCastles; i++) {
      const cx = ((i + 0.5) / maxCastles) * w;
      drawSandcastle(castleGfx, cx, h - 40, containers[i].isUp);
    }
  }, [containers]);

  // Draw container status indicator dots in the top-left corner
  useEffect(() => {
    const containerGfx = containerGfxRef.current;
    if (!containerGfx) return;

    containerGfx.clear();
    if (containers.length === 0) return;

    const dotR = 5;
    const gap = 3;
    const startX = 10;
    const startY = 10;

    containers.forEach((c, i) => {
      const cx = startX + i * (dotR * 2 + gap) + dotR;
      const cy = startY + dotR;
      containerGfx.circle(cx, cy, dotR);
      if (c.isUp) {
        containerGfx.fill({ color: 0x44cc88, alpha: 0.9 });
      } else {
        containerGfx.fill({ color: 0x555555, alpha: 0.5 });
      }
    });
  }, [containers]);

  // Add or remove the predator shark based on the hasErrors flag
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const fishLayer = (app as unknown as { fishLayer?: Container }).fishLayer;
    if (!fishLayer) return;

    if (hasErrors) {
      if (!fishRef.current.has(PREDATOR_KEY)) {
        // Dark grey, plain pattern, elevated speed scale
        const shark = createFish(app, fishLayer, 0x5a6a78, 'plain', PREDATOR_KEY, 2.2, true);
        fishRef.current.set(PREDATOR_KEY, shark);
      }
    } else {
      const predator = fishRef.current.get(PREDATOR_KEY);
      if (predator) {
        fishLayer.removeChild(predator.container);
        predator.container.destroy();
        fishRef.current.delete(PREDATOR_KEY);
      }
    }
  }, [hasErrors]);

  return (
    <div
      ref={canvasRef}
      style={{ width, height, borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.6)' }}
    />
  );
}
