export type Point = [number, number];
export type Segment = { kind: number; start: Point; end: Point; controls?: [Point, Point] };
export type Curve = { id: string; target: string; segments: Segment[]; first: Point };

export function decodeCurve(raw: { Id: string; Target: string; Segments: number[] }): Curve {
  const a = raw.Segments;
  let start: Point = [a[0], a[1]];
  const first = start;
  const segments: Segment[] = [];
  for (let i = 2; i < a.length;) {
    const kind = a[i];
    if (kind === 1) {
      const end: Point = [a[i + 5], a[i + 6]];
      segments.push({ kind, start, end, controls: [[a[i + 1], a[i + 2]], [a[i + 3], a[i + 4]]] });
      start = end;
      i += 7;
    } else if ([0, 2, 3].includes(kind)) {
      const end: Point = [a[i + 1], a[i + 2]];
      segments.push({ kind, start, end });
      start = end;
      i += 3;
    } else throw new Error(`Unsupported motion segment: ${kind}`);
  }
  return { id: raw.Id, target: raw.Target, segments, first };
}

const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

export function sampleCurve(curve: Curve, seconds: number): number {
  if (seconds < curve.first[0]) return curve.first[1];
  const segment = curve.segments.find(s => seconds < s.end[0]);
  if (!segment) return curve.segments.at(-1)?.end[1] ?? curve.first[1];
  const { start, end, kind } = segment;
  if (kind === 2) return start[1];
  if (kind === 3) return end[1];
  if (kind === 0) return start[1] + (end[1] - start[1]) * ((seconds - start[0]) / (end[0] - start[0]));
  // Unrestricted Beziers require inversion of the time coordinate, not t = elapsed/duration.
  let lo = 0, hi = 1;
  const [p1, p2] = segment.controls!;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (cubic(start[0], p1[0], p2[0], end[0], t) < seconds) lo = t;
    else hi = t;
  }
  return cubic(start[1], p1[1], p2[1], end[1], (lo + hi) / 2);
}
