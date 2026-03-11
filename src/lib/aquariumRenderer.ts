import * as PIXI from 'pixi.js';
import { AquariumMetrics } from '../hooks/useMetrics';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Fish {
  container: PIXI.Container;
  body: PIXI.Graphics;
  tail: PIXI.Graphics;
  eye: PIXI.Graphics;
  vx: number;
  vy: number;
  speed: number;
  color: number;
  size: number;
  wobblePhase: number;
  /** true = heading right */
  facingRight: boolean;
}

interface Bubble {
  gfx: PIXI.Graphics;
  x: number;
  y: number;
  vy: number;
  radius: number;
  alpha: number;
}

interface Seaweed {
  segments: PIXI.Graphics[];
  x: number;
  phase: number;
  height: number;
  color: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WATER_TOP_COLOR = 0x0077be;
const WATER_BOT_COLOR = 0x003366;
const SAND_COLOR = 0xc2a020;
const BUBBLE_COLOR = 0xaaddff;
const SEAWEED_COLORS = [0x2d8a4e, 0x3aaf62, 0x22703e];

const MIN_FISH = 2;
const MAX_FISH = 20;
const MAX_BUBBLES = 60;

// ─── AquariumRenderer ─────────────────────────────────────────────────────────

export class AquariumRenderer {
  private app: PIXI.Application;
  private fishLayer: PIXI.Container;
  private bubbleLayer: PIXI.Container;
  private seaweedLayer: PIXI.Container;
  private bgLayer: PIXI.Graphics;
  private sandLayer: PIXI.Graphics;
  private causticLayer: PIXI.Container;

  private fish: Fish[] = [];
  private bubbles: Bubble[] = [];
  private seaweeds: Seaweed[] = [];

  private metrics: AquariumMetrics | null = null;
  private ticker: PIXI.Ticker;
  private elapsed = 0;
  private bubbleTimer = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.app = new PIXI.Application({
      view: canvas,
      resizeTo: canvas.parentElement ?? window,
      backgroundColor: WATER_TOP_COLOR,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Layers — back to front
    this.bgLayer = new PIXI.Graphics();
    this.causticLayer = new PIXI.Container();
    this.sandLayer = new PIXI.Graphics();
    this.seaweedLayer = new PIXI.Container();
    this.bubbleLayer = new PIXI.Container();
    this.fishLayer = new PIXI.Container();

    this.app.stage.addChild(
      this.bgLayer,
      this.causticLayer,
      this.sandLayer,
      this.seaweedLayer,
      this.bubbleLayer,
      this.fishLayer,
    );

    this.ticker = this.app.ticker;
    this.ticker.add(this.update, this);

    this.drawBackground();
    this.drawSand();
    this.buildSeaweeds();
    this.syncFishCount(MIN_FISH);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  updateMetrics(metrics: AquariumMetrics): void {
    this.metrics = metrics;

    // Fish count scales with CPU usage: MIN_FISH … MAX_FISH
    const fishCount = Math.round(
      MIN_FISH + metrics.cpuUsage * (MAX_FISH - MIN_FISH),
    );
    this.syncFishCount(fishCount);

    // Fish speed scales with request rate
    const speedFactor = 0.5 + metrics.requestRate / 20;
    for (const fish of this.fish) {
      fish.speed = fish.size * 0.8 * speedFactor;
    }
  }

  destroy(): void {
    this.ticker.remove(this.update, this);
    this.app.destroy(false, { children: true });
  }

  // ─── Background & sand ──────────────────────────────────────────────────────

  private drawBackground(): void {
    const { width, height } = this.app.screen;
    this.bgLayer.clear();
    // Gradient-like effect using two overlapping rects with alpha
    this.bgLayer.beginFill(WATER_TOP_COLOR, 1);
    this.bgLayer.drawRect(0, 0, width, height);
    this.bgLayer.endFill();
    this.bgLayer.beginFill(WATER_BOT_COLOR, 0.6);
    this.bgLayer.drawRect(0, height * 0.3, width, height * 0.7);
    this.bgLayer.endFill();
  }

  private drawSand(): void {
    const { width, height } = this.app.screen;
    const sandH = height * 0.12;
    this.sandLayer.clear();
    this.sandLayer.beginFill(SAND_COLOR, 1);
    // Wavy top edge via bezier
    this.sandLayer.moveTo(0, height - sandH + 10);
    for (let x = 0; x <= width; x += 60) {
      const wave = Math.sin(x * 0.05) * 8;
      this.sandLayer.lineTo(x, height - sandH + wave);
    }
    this.sandLayer.lineTo(width, height);
    this.sandLayer.lineTo(0, height);
    this.sandLayer.closePath();
    this.sandLayer.endFill();

    // Darker strip at bottom
    this.sandLayer.beginFill(0x8b7520, 0.5);
    this.sandLayer.drawRect(0, height - sandH * 0.35, width, sandH * 0.35);
    this.sandLayer.endFill();
  }

  // ─── Seaweed ────────────────────────────────────────────────────────────────

  private buildSeaweeds(): void {
    const { width, height } = this.app.screen;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const x = (width / (count + 1)) * (i + 1) + (Math.random() - 0.5) * 60;
      const segCount = 5 + Math.floor(Math.random() * 4);
      const segHeight = 18 + Math.random() * 14;
      const color = SEAWEED_COLORS[i % SEAWEED_COLORS.length];
      const seaweed: Seaweed = {
        segments: [],
        x,
        phase: Math.random() * Math.PI * 2,
        height: segCount * segHeight,
        color,
      };

      for (let s = 0; s < segCount; s++) {
        const gfx = new PIXI.Graphics();
        const w = 7 - s * 0.4;
        gfx.beginFill(color, 1 - s * 0.04);
        gfx.drawEllipse(0, 0, w, segHeight / 2 + 2);
        gfx.endFill();
        gfx.y = height - height * 0.12 - s * segHeight;
        gfx.x = x;
        this.seaweedLayer.addChild(gfx);
        seaweed.segments.push(gfx);
      }
      this.seaweeds.push(seaweed);
    }
  }

  // ─── Fish ────────────────────────────────────────────────────────────────────

  private createFish(isErrorFish = false): Fish {
    const { width, height } = this.app.screen;
    const sandH = height * 0.12;
    const size = 12 + Math.random() * 18;
    const color = isErrorFish
      ? 0xff3333
      : [0xffaa00, 0xff6600, 0xffdd00, 0x00bbff, 0xaa44ff, 0xff88cc][
          Math.floor(Math.random() * 6)
        ];

    const container = new PIXI.Container();
    container.x = Math.random() * width;
    container.y = height * 0.1 + Math.random() * (height - sandH - height * 0.15);

    // Body
    const body = new PIXI.Graphics();
    body.beginFill(color);
    body.drawEllipse(0, 0, size, size * 0.55);
    body.endFill();
    // Highlight
    body.beginFill(0xffffff, 0.25);
    body.drawEllipse(-size * 0.15, -size * 0.2, size * 0.45, size * 0.28);
    body.endFill();

    // Tail
    const tail = new PIXI.Graphics();
    tail.beginFill(color, 0.85);
    tail.moveTo(size * 0.7, 0);
    tail.lineTo(size * 1.45, -size * 0.55);
    tail.lineTo(size * 1.45, size * 0.55);
    tail.closePath();
    tail.endFill();

    // Eye
    const eye = new PIXI.Graphics();
    eye.beginFill(0x000000);
    eye.drawCircle(-size * 0.4, -size * 0.1, size * 0.1);
    eye.endFill();
    eye.beginFill(0xffffff, 0.7);
    eye.drawCircle(-size * 0.42, -size * 0.13, size * 0.04);
    eye.endFill();

    container.addChild(tail, body, eye);
    this.fishLayer.addChild(container);

    const angle = Math.random() * Math.PI * 2;
    const speed = size * 0.8;

    return {
      container,
      body,
      tail,
      eye,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.4,
      speed,
      color,
      size,
      wobblePhase: Math.random() * Math.PI * 2,
      facingRight: true,
    };
  }

  private syncFishCount(target: number): void {
    const errorFishCount = this.metrics
      ? Math.round(this.metrics.errorRate * 3)
      : 0;

    while (this.fish.length > target) {
      const f = this.fish.pop()!;
      this.fishLayer.removeChild(f.container);
      f.container.destroy({ children: true });
    }
    while (this.fish.length < target) {
      const isError =
        this.fish.length >= target - errorFishCount && errorFishCount > 0;
      this.fish.push(this.createFish(isError));
    }
  }

  // ─── Bubbles ──────────────────────────────────────────────────────────────

  private spawnBubble(): void {
    const { width, height } = this.app.screen;
    const r = 2 + Math.random() * 5;
    const gfx = new PIXI.Graphics();
    gfx.lineStyle(1, BUBBLE_COLOR, 0.8);
    gfx.beginFill(BUBBLE_COLOR, 0.15);
    gfx.drawCircle(0, 0, r);
    gfx.endFill();
    this.bubbleLayer.addChild(gfx);

    const bubble: Bubble = {
      gfx,
      x: Math.random() * width,
      y: height - height * 0.12,
      vy: 0.4 + Math.random() * 0.8,
      radius: r,
      alpha: 0.6 + Math.random() * 0.4,
    };
    gfx.x = bubble.x;
    gfx.y = bubble.y;
    gfx.alpha = bubble.alpha;
    this.bubbles.push(bubble);
  }

  // ─── Main update loop ─────────────────────────────────────────────────────

  private update(delta: number): void {
    this.elapsed += delta * 0.016; // approx seconds
    const { width, height } = this.app.screen;
    const sandH = height * 0.12;

    // ── Animate seaweed
    for (const sw of this.seaweeds) {
      sw.phase += delta * 0.02;
      for (let s = 0; s < sw.segments.length; s++) {
        const seg = sw.segments[s];
        const bend = Math.sin(sw.phase + s * 0.4) * s * 3;
        seg.x = sw.x + bend;
        seg.rotation = bend * 0.04;
      }
    }

    // ── Animate fish
    for (const fish of this.fish) {
      fish.wobblePhase += delta * 0.08;

      fish.container.x += (fish.vx * delta) / 60;
      fish.container.y += (fish.vy * delta) / 60;

      // Gentle vertical drift
      fish.vy += Math.sin(fish.wobblePhase) * 0.08;
      fish.vy *= 0.98;

      // Bounce off walls
      if (fish.container.x < -fish.size * 2) {
        fish.container.x = width + fish.size;
      } else if (fish.container.x > width + fish.size * 2) {
        fish.container.x = -fish.size;
      }

      // Bounce off top/bottom
      if (fish.container.y < height * 0.05) {
        fish.vy = Math.abs(fish.vy) + 0.5;
      }
      if (fish.container.y > height - sandH - fish.size) {
        fish.vy = -(Math.abs(fish.vy) + 0.5);
        fish.container.y = height - sandH - fish.size;
      }

      // Tail wag
      fish.tail.rotation = Math.sin(fish.wobblePhase * 3) * 0.4;

      // Flip sprite when direction changes
      const goingRight = fish.vx >= 0;
      if (goingRight !== fish.facingRight) {
        fish.container.scale.x *= -1;
        fish.facingRight = goingRight;
      }

      // Body vertical tilt
      fish.container.rotation = Math.atan2(fish.vy, Math.abs(fish.vx)) * 0.3;
    }

    // ── Bubble spawning
    const memUsage = this.metrics?.memoryUsage ?? 0.3;
    const bubbleRate = 0.3 + memUsage * 3; // higher memory → more bubbles
    this.bubbleTimer += delta;
    if (this.bubbleTimer > 60 / bubbleRate / delta && this.bubbles.length < MAX_BUBBLES) {
      this.spawnBubble();
      this.bubbleTimer = 0;
    }

    // ── Animate bubbles
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.y -= (b.vy * delta) / 60 * 60;
      b.x += Math.sin(this.elapsed * 1.5 + i) * 0.3;
      b.gfx.x = b.x;
      b.gfx.y = b.y;
      b.gfx.alpha = b.alpha * Math.min(1, b.y / (height * 0.1));

      if (b.y < -b.radius * 2) {
        this.bubbleLayer.removeChild(b.gfx);
        b.gfx.destroy();
        this.bubbles.splice(i, 1);
      }
    }

    // ── Redraw background if resized
    const { width: sw, height: sh } = this.app.screen;
    if (
      this.bgLayer.width !== sw ||
      this.bgLayer.height !== sh
    ) {
      this.drawBackground();
      this.drawSand();
    }
  }
}
