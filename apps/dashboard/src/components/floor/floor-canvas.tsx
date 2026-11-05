'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Ellipse, Group, Layer, Rect, Stage, Text } from 'react-konva';
import {
  elapsedSince,
  formatDuration,
  initials,
  SLA_COLORS,
  slaLevel,
  slaRemaining,
  STATUS_STYLE,
} from '@/lib/floor-style';
import type { FloorTable, Section } from '@/lib/types';

const PAD = 40;

export interface CanvasLabels {
  seats: (n: number) => string;
  guests: (n: number) => string;
}

/** Read-only live floor map. Coordinates: (x, y) is the top-left of the unrotated table box. */
export default function FloorCanvas({
  tables,
  sections,
  greetSlaSeconds,
  now,
  selectedId,
  onSelect,
  labels,
}: {
  tables: FloorTable[];
  sections: Section[];
  greetSlaSeconds: number;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  labels: CanvasLabels;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => {
    const xs = tables.flatMap((t) => [t.x, t.x + t.w]);
    const ys = tables.flatMap((t) => [t.y, t.y + t.h]);
    return {
      minX: Math.min(0, ...xs),
      minY: Math.min(0, ...ys),
      maxX: Math.max(400, ...xs),
      maxY: Math.max(300, ...ys),
    };
  }, [tables]);
  const contentW = bounds.maxX - bounds.minX + PAD * 2;
  const contentH = bounds.maxY - bounds.minY + PAD * 2;
  const scale = Math.min(width / contentW, 1.4);
  const sectionColor = new Map(sections.map((s) => [s.id, s.color ?? '#64748b']));

  return (
    <div ref={box} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white" aria-hidden>
      <Stage
        width={width}
        height={contentH * scale}
        scaleX={scale}
        scaleY={scale}
        x={(PAD - bounds.minX) * scale}
        y={(PAD - bounds.minY) * scale}
      >
        <Layer>
          {tables.map((t) => {
            const { live } = t;
            const style = STATUS_STYLE[live.status];
            const seating = live.seating;
            const level = slaLevel(
              live.status,
              seating?.seatedAt ?? null,
              seating?.greetedAt ?? null,
              greetSlaSeconds,
              now,
            );
            const selected = t.id === selectedId;
            const stroke =
              level === 'warn' || level === 'breach'
                ? SLA_COLORS[level]
                : selected
                  ? '#0f172a'
                  : style.stroke;
            const strokeWidth = level === 'breach' ? 5 : level === 'warn' || selected ? 4 : 2;
            const timer =
              seating && level !== 'none'
                ? formatDuration(slaRemaining(seating.seatedAt, greetSlaSeconds, now))
                : seating
                  ? formatDuration(elapsedSince(seating.seatedAt, now))
                  : '';
            const sub = seating?.partySize ? labels.guests(seating.partySize) : labels.seats(t.capacity);
            const select = () => onSelect(t.id);
            return (
              <Group
                key={t.id}
                x={t.x + t.w / 2}
                y={t.y + t.h / 2}
                offsetX={t.w / 2}
                offsetY={t.h / 2}
                rotation={t.rotation}
                onClick={select}
                onTap={select}
              >
                {t.shape === 'ROUND' ? (
                  <Ellipse
                    x={t.w / 2}
                    y={t.h / 2}
                    radiusX={t.w / 2}
                    radiusY={t.h / 2}
                    fill={style.fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                  />
                ) : (
                  <Rect
                    width={t.w}
                    height={t.h}
                    cornerRadius={t.shape === 'BOOTH' ? 18 : 8}
                    fill={style.fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                  />
                )}
                {/* Section colour bar */}
                <Rect
                  x={t.w * 0.2}
                  y={3}
                  width={t.w * 0.6}
                  height={4}
                  cornerRadius={2}
                  fill={sectionColor.get(t.sectionId)}
                />
                <Text
                  text={`${style.glyph} ${t.label}`}
                  width={t.w}
                  y={t.h / 2 - 22}
                  align="center"
                  fontStyle="bold"
                  fontSize={15}
                  fill={style.text}
                />
                <Text text={sub} width={t.w} y={t.h / 2 - 4} align="center" fontSize={11} fill={style.text} />
                {timer ? (
                  <Text
                    text={timer}
                    width={t.w}
                    y={t.h / 2 + 10}
                    align="center"
                    fontSize={12}
                    fontStyle="bold"
                    fill={level === 'none' || level === 'ok' ? style.text : SLA_COLORS[level]}
                  />
                ) : null}
                {seating?.servingWaiter ? (
                  <Group x={t.w - 6} y={6}>
                    <Circle radius={11} fill="#0f172a" />
                    <Text
                      text={initials(seating.servingWaiter.name)}
                      x={-11}
                      y={-6}
                      width={22}
                      align="center"
                      fontSize={10}
                      fill="#fff"
                    />
                  </Group>
                ) : null}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
