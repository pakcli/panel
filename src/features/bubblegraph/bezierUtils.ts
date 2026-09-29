export interface BezierHandle {
    x: number;
    y: number;
}

export interface BezierPreset {
    id: string;
    name: string;
    p1: BezierHandle;
    p2: BezierHandle;
}

export const BEZIER_PRESETS: BezierPreset[] = [
    {
        id: 'blender-s-curve',
        name: 'Blender S-Curve',
        p1: { x: 0.35, y: 0.0 },
        p2: { x: 0.65, y: 1.0 }
    },
    {
        id: 'snappy-ease',
        name: 'Snappy Ease',
        p1: { x: 0.25, y: 0.1 },
        p2: { x: 0.25, y: 1.0 }
    },
    {
        id: 'elastic-pop',
        name: 'Elastic Pop',
        p1: { x: 0.34, y: 1.56 },
        p2: { x: 0.64, y: 1.0 }
    },
    {
        id: 'linear',
        name: 'Linear',
        p1: { x: 0.0, y: 0.0 },
        p2: { x: 1.0, y: 1.0 }
    }
];

/**
 * Format total seconds into hh:mm:ss string (e.g. 125 -> "00:02:05")
 */
export function formatSecondsToHms(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Format total seconds into hh-mm-ss string (e.g. 125 -> "00-02-05")
 */
export function formatSecondsToHmsHyphen(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}-${pad(minutes)}-${pad(seconds)}`;
}

/**
 * High-performance UnitBezier Newton-Raphson solver.
 * Solves x(s) = t for s in [0, 1] given control points P1(x1, y1) and P2(x2, y2),
 * with P0=(0,0) and P3=(1,1), then evaluates y(s).
 */
export function evaluateCubicBezier(
    t: number,
    p1: BezierHandle,
    p2: BezierHandle,
    p0: BezierHandle = { x: 0, y: 0 },
    p3: BezierHandle = { x: 1, y: 1 }
): number {
    const clampedT = Math.max(0, Math.min(1, t));

    const x0 = p0.x;
    const y0 = p0.y;
    const x1 = p1.x;
    const y1 = p1.y;
    const x2 = p2.x;
    const y2 = p2.y;
    const x3 = p3.x;
    const y3 = p3.y;

    // Boundary clamps if t is outside [x0, x3]
    if (clampedT <= x0) return y0;
    if (clampedT >= x3) return y3;

    // Linear optimization
    if (x1 === y1 && x2 === y2 && x0 === y0 && x3 === y3) {
        return clampedT;
    }

    // Bezier polynomial coefficients for general endpoints:
    // B(s) = a*s^3 + b*s^2 + c*s + d
    const cx = 3.0 * (x1 - x0);
    const bx = 3.0 * (x2 - x1) - cx;
    const ax = x3 - x0 - cx - bx;

    const cy = 3.0 * (y1 - y0);
    const by = 3.0 * (y2 - y1) - cy;
    const ay = y3 - y0 - cy - by;

    const sampleCurveX = (s: number): number => ((ax * s + bx) * s + cx) * s + x0;
    const sampleCurveY = (s: number): number => ((ay * s + by) * s + cy) * s + y0;
    const sampleCurveDerivativeX = (s: number): number => (3.0 * ax * s + 2.0 * bx) * s + cx;

    const spanX = Math.max(1e-6, x3 - x0);
    let s = Math.max(0, Math.min(1, (clampedT - x0) / spanX));

    // Newton-Raphson iteration
    for (let i = 0; i < 8; i++) {
        const currentX = sampleCurveX(s) - clampedT;
        if (Math.abs(currentX) < 1e-5) {
            return sampleCurveY(s);
        }
        const dX = sampleCurveDerivativeX(s);
        if (Math.abs(dX) < 1e-6) {
            break;
        }
        s -= currentX / dX;
        s = Math.max(0, Math.min(1, s));
    }

    // Fallback binary bisection search
    let t0 = 0.0;
    let t1 = 1.0;
    s = Math.max(0, Math.min(1, (clampedT - x0) / spanX));

    while (t0 < t1) {
        const x = sampleCurveX(s);
        if (Math.abs(x - clampedT) < 1e-4) {
            return sampleCurveY(s);
        }
        if (clampedT > x) {
            t0 = s;
        } else {
            t1 = s;
        }
        s = (t1 + t0) * 0.5;
    }

    return sampleCurveY(s);
}
