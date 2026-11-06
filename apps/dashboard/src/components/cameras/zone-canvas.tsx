'use client';

import type Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Circle, Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { closesPolygon, MAX_POINTS, normalise } from '@/lib/zones';
import type { Point } from '@/lib/types';

const ZONE = '#2563eb';
const ACTIVE = '#ea580c';

/**
 * Zone drawing on a calibration snapshot. Coordinates are normalised (0..1). While `drawingFor` is set, clicks add
 * vertices and a click on the first vertex closes the polygon; the active table's vertices can be dragged.
 * The table list next to it is the keyboard/screen-reader equivalent.
 */
export default function ZoneCanvas({
  imageUrl,
  zones,
  labels,
  activeTable,
  drawing,
  onDraw,
  onChange,
}: {
  imageUrl: string | null;
  zones: Record<string, Point[]>;
  labels: Record<string, string>;
  activeTable: string | null;
  drawing: boolean;
  onDraw: (tableId: string, polygon: Point[]) => void;
  onChange: (tableId: string, polygon: Point[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!imageUrl) return setImage(null);
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => setDraft([]), [activeTable, drawing]);

  const height = image ? (width * image.naturalHeight) / image.naturalWidth : (width * 9) / 16;
  const px = (p: Point) => [p[0] * width, p[1] * height];
  const flat = (poly: Point[]) => poly.flatMap(px);

  const click = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!drawing || !activeTable) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const p = normalise([pos.x / width, pos.y / height]);
    if (closesPolygon(draft, p, { w: width, h: height }) || draft.length + 1 >= MAX_POINTS) {
      const poly = draft.length + 1 >= MAX_POINTS ? [...draft, p] : draft;
      onDraw(activeTable, poly);
      setDraft([]);
    } else setDraft([...draft, p]);
  };

  return (
    <div ref={box} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-800">
      <Stage
        width={width}
        height={height}
        onClick={click}
        onTap={click}
        style={{ cursor: drawing ? 'crosshair' : 'default' }}
      >
        <Layer listening={false}>
          {image ? (
            <KImage image={image} width={width} height={height} />
          ) : (
            <Rect width={width} height={height} fill="#334155" />
          )}
        </Layer>
        <Layer>
          {Object.entries(zones).map(([tableId, poly]) => {
            const active = tableId === activeTable;
            return (
              <Line
                key={tableId}
                points={flat(poly)}
                closed
                stroke={active ? ACTIVE : ZONE}
                strokeWidth={active ? 3 : 2}
                fill={active ? 'rgba(234,88,12,0.18)' : 'rgba(37,99,235,0.15)'}
                listening={false}
              />
            );
          })}
          {Object.entries(zones).map(([tableId, poly]) => {
            const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
            const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
            return (
              <Text
                key={`l-${tableId}`}
                x={cx * width - 30}
                y={cy * height - 9}
                width={60}
                align="center"
                text={labels[tableId] ?? '?'}
                fontSize={16}
                fontStyle="bold"
                fill="#fff"
                shadowColor="#000"
                shadowBlur={4}
                listening={false}
              />
            );
          })}
          {!drawing && activeTable && zones[activeTable]
            ? zones[activeTable].map((p, i) => (
                <Circle
                  key={i}
                  x={p[0] * width}
                  y={p[1] * height}
                  radius={7}
                  fill="#fff"
                  stroke={ACTIVE}
                  strokeWidth={2}
                  draggable
                  onDragEnd={(e) => {
                    const poly = [...zones[activeTable]!];
                    poly[i] = normalise([e.target.x() / width, e.target.y() / height]);
                    onChange(activeTable, poly);
                  }}
                />
              ))
            : null}
          {drawing && draft.length ? (
            <>
              <Line points={flat(draft)} stroke={ACTIVE} strokeWidth={2} dash={[6, 4]} listening={false} />
              {draft.map((p, i) => (
                <Circle
                  key={i}
                  x={p[0] * width}
                  y={p[1] * height}
                  radius={i === 0 ? 9 : 5}
                  fill={i === 0 ? ACTIVE : '#fff'}
                  stroke={ACTIVE}
                  listening={false}
                />
              ))}
            </>
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}
