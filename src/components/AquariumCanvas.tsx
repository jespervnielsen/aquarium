import { useEffect, useRef } from 'react';
import { AquariumRenderer } from '../lib/aquariumRenderer';
import { AquariumMetrics } from '../hooks/useMetrics';

interface AquariumCanvasProps {
  metrics: AquariumMetrics | null;
}

export function AquariumCanvas({ metrics }: AquariumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AquariumRenderer | null>(null);

  // Initialise renderer once
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new AquariumRenderer(canvasRef.current);
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Push metrics updates into renderer
  useEffect(() => {
    if (metrics && rendererRef.current) {
      rendererRef.current.updateMetrics(metrics);
    }
  }, [metrics]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
