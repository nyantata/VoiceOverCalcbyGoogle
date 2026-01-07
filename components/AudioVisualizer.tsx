import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !analyser || !isActive) {
      // Clear canvas if inactive
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Draw mirrored visualization from center
      const centerX = canvas.width / 2;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        const r = barHeight + 25 * (i / bufferLength);
        const g = 250 * (i / bufferLength);
        const b = 50;

        ctx.fillStyle = `rgb(${r},${g},${b})`;

        // Right side
        ctx.fillRect(centerX + x, canvas.height - barHeight, barWidth, barHeight);
        // Left side
        ctx.fillRect(centerX - x - barWidth, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
        if (x > centerX) break;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={100}
      className="w-full h-24 rounded-lg bg-gray-900/50 backdrop-blur-sm"
    />
  );
};

export default AudioVisualizer;
