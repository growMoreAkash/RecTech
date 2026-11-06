'use client';

import type Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import { type DraftTable, GRID, snap } from '@/lib/editor';
import type { Section } from '@/lib/types';

const WORLD = { w: 1400, h: 1000 };

/**
 * Editable floor plan. (x, y) is the top-left of the unrotated box; groups rotate about their centre.
 * Resizing goes through Konva's scale, which we fold back into w/h on transform end.
 */
export default function EditorCanvas({
  tables,
  sections,
  selectedKey,
  onSelect,
  onChange,
}: {
  tables: DraftTable[];
  sections: Section[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onChange: (key: string, patch: Partial<DraftTable>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tr = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const node = selectedKey ? nodes.current.get(selectedKey) : undefined;
    tr.current?.nodes(node ? [node] : []);
    tr.current?.getLayer()?.batchDraw();
  }, [selectedKey, tables]);

  const scale = Math.min(width / WORLD.w, 1);
  const color = new Map(sections.map((s) => [s.id, s.color ?? '#64748b']));
  const gridLines: number[][] = [];
  for (let x = 0; x <= WORLD.w; x += GRID * 4) gridLines.push([x, 0, x, WORLD.h]);
  for (let y = 0; y <= WORLD.h; y += GRID * 4) gridLines.push([0, y, WORLD.w, y]);

  return (
    <div ref={box} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Stage
        width={width}
        height={WORLD.h * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => e.target === e.target.getStage() && onSelect(null)}
        onTouchStart={(e) => e.target === e.target.getStage() && onSelect(null)}
      >
        <Layer listening={false}>
          {gridLines.map((p, i) => (
            <Line key={i} points={p} stroke="#f1f5f9" strokeWidth={1} />
          ))}
        </Layer>
        <Layer>
          {tables.map((t) => (
            <Group
              key={t.key}
              ref={(n) => {
                if (n) nodes.current.set(t.key, n);
                else nodes.current.delete(t.key);
              }}
              x={t.x + t.w / 2}
              y={t.y + t.h / 2}
              offsetX={t.w / 2}
              offsetY={t.h / 2}
              rotation={t.rotation}
              draggable
              onMouseDown={() => onSelect(t.key)}
              onTap={() => onSelect(t.key)}
              onDragEnd={(e) =>
                onChange(t.key, { x: snap(e.target.x() - t.w / 2), y: snap(e.target.y() - t.h / 2) })
              }
              onTransformEnd={(e) => {
                const n = e.target;
                const w = Math.max(40, snap(t.w * n.scaleX()));
                const h = Math.max(40, snap(t.h * n.scaleY()));
                n.scale({ x: 1, y: 1 });
                onChange(t.key, {
                  w,
                  h,
                  x: snap(n.x() - w / 2),
                  y: snap(n.y() - h / 2),
                  rotation: Math.round(n.rotation()),
                });
              }}
            >
              {t.shape === 'ROUND' ? (
                <Ellipse
                  x={t.w / 2}
                  y={t.h / 2}
                  radiusX={t.w / 2}
                  radiusY={t.h / 2}
                  fill="#f8fafc"
                  stroke={color.get(t.sectionId)}
                  strokeWidth={3}
                />
              ) : (
                <Rect
                  width={t.w}
                  height={t.h}
                  cornerRadius={t.shape === 'BOOTH' ? 18 : 8}
                  fill="#f8fafc"
                  stroke={color.get(t.sectionId)}
                  strokeWidth={3}
                />
              )}
              <Text
                text={t.label}
                width={t.w}
                y={t.h / 2 - 16}
                align="center"
                fontStyle="bold"
                fontSize={15}
                fill="#0f172a"
              />
              <Text
                text={`${t.minCapacity}–${t.capacity}`}
                width={t.w}
                y={t.h / 2 + 2}
                align="center"
                fontSize={12}
                fill="#475569"
              />
            </Group>
          ))}
          <Transformer
            ref={tr}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            flipEnabled={false}
            keepRatio={false}
          />
        </Layer>
      </Stage>
    </div>
  );
}
