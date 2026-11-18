import { color } from '../shared/tokens';

// The mark from the canvas: a 2 x 2 grid of squares, the top-left filled with the accent and
// the other three outlined. Drawn as raw BGRA pixels for nativeImage.createFromBitmap, so the
// app ships no icon file and the mark always follows the tokens.

export interface Bitmap {
  width: number;
  height: number;
  pixels: Buffer;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function trayIconBitmap(size: number): Bitmap {
  if (!Number.isInteger(size) || size < 8)
    throw new Error(`Icon size must be an integer of 8 or more: ${size}`);
  const pixels = Buffer.alloc(size * size * 4);
  const unit = size / 28; // the mark's viewBox is 28 wide
  const stroke = Math.max(1, Math.round(2 * unit));
  const squares = [
    { x: 2, y: 2, filled: true },
    { x: 16, y: 2, filled: false },
    { x: 2, y: 16, filled: false },
    { x: 16, y: 16, filled: false },
  ];
  const fill = rgb(color.accent);
  const outline = rgb(color.text);

  for (const square of squares) {
    const x0 = Math.round(square.x * unit);
    const y0 = Math.round(square.y * unit);
    const x1 = Math.round((square.x + 10) * unit);
    const y1 = Math.round((square.y + 10) * unit);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const onEdge = x < x0 + stroke || x >= x1 - stroke || y < y0 + stroke || y >= y1 - stroke;
        if (!square.filled && !onEdge) continue;
        const [r, g, b] = square.filled ? fill : outline;
        const at = (y * size + x) * 4;
        pixels[at] = b;
        pixels[at + 1] = g;
        pixels[at + 2] = r;
        pixels[at + 3] = 255;
      }
    }
  }
  return { width: size, height: size, pixels };
}
