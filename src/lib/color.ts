/** Cor — conversões puras. O app trabalha com RGBA 0-255 (o formato do
 *  ImageData, onde o balde e o conta-gotas operam) e expõe hex pro usuário. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..255 (como no ImageData, NÃO 0..1) */
  a: number;
}

export function hexToRgba(hex: string): Rgba | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return {
    r: (v >> 16) & 0xff,
    g: (v >> 8) & 0xff,
    b: v & 0xff,
    a: m[2] ? parseInt(m[2], 16) : 255,
  };
}

export function rgbaToHex({ r, g, b }: Rgba): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbaToCss({ r, g, b, a }: Rgba): string {
  return a >= 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** Distância² entre duas cores RGBA — a métrica da tolerância do balde.
 *  Quadrática de propósito: evita sqrt num loop de milhões de pixels; quem
 *  compara é `withinTolerance`, que eleva a tolerância ao quadrado uma vez. */
export function dist2(r1: number, g1: number, b1: number, a1: number, r2: number, g2: number, b2: number, a2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const da = a1 - a2;
  return dr * dr + dg * dg + db * db + da * da;
}
