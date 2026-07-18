/** Filtros de imagem — funções PURAS sobre os bytes do ImageData.
 *
 *  Tudo aqui roda em Node no vitest: entra Uint8ClampedArray, sai mutação
 *  em-lugar (o chamador captura before/after pro undo). Nada de canvas, nada
 *  de UI — a UI é um modal com sliders que chama isto.
 *
 *  O alpha NUNCA é tocado pelos ajustes de cor: filtro de cor que altera
 *  transparência corrói a borda anti-aliased de tudo que foi pintado.
 */

export interface Adjust {
  /** -100..100 (0 = neutro) */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -100..100 */
  saturation: number;
  /** -180..180 graus */
  hue: number;
}

export const NEUTRAL_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0 };

export function isNeutral(a: Adjust): boolean {
  return a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && a.hue === 0;
}

/** Brilho/contraste/saturação/matiz numa passada só (uma matriz 3x3 + offset
 *  por canal, pré-computada UMA vez — o loop de pixels só multiplica). */
export function applyAdjust(data: Uint8ClampedArray, a: Adjust): void {
  if (isNeutral(a)) return;

  // Brilho: offset linear. Contraste: ganho em torno de 128.
  const bOff = (a.brightness / 100) * 255 * 0.5;
  const cGain = a.contrast >= 0 ? 1 + (a.contrast / 100) * 1.5 : 1 + a.contrast / 100;

  // Saturação: interpola entre luma (s=0) e a cor (s=1), extrapola acima.
  const s = 1 + a.saturation / 100;
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;

  // Matiz: rotação no eixo da luma (matriz clássica de hue-rotate do SVG).
  const rad = (a.hue * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Matriz combinada: primeiro saturação, depois hue (ordem fixa, documentada
  // — trocar a ordem muda o resultado e o teste pregaria a diferença).
  const sat = [
    lr + s * (1 - lr), lg - s * lg, lb - s * lb,
    lr - s * lr, lg + s * (1 - lg), lb - s * lb,
    lr - s * lr, lg - s * lg, lb + s * (1 - lb),
  ];
  const hue = [
    lr + cosA * (1 - lr) + sinA * -lr, lg + cosA * -lg + sinA * -lg, lb + cosA * -lb + sinA * (1 - lb),
    lr + cosA * -lr + sinA * 0.143, lg + cosA * (1 - lg) + sinA * 0.14, lb + cosA * -lb + sinA * -0.283,
    lr + cosA * -lr + sinA * -(1 - lr), lg + cosA * -lg + sinA * lg, lb + cosA * (1 - lb) + sinA * lb,
  ];
  // m = hue · sat
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] =
        hue[r * 3] * sat[c] + hue[r * 3 + 1] * sat[3 + c] + hue[r * 3 + 2] * sat[6 + c];
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let nr = m[0] * r + m[1] * g + m[2] * b;
    let ng = m[3] * r + m[4] * g + m[5] * b;
    let nb = m[6] * r + m[7] * g + m[8] * b;
    // Contraste em torno do meio, depois brilho.
    nr = (nr - 128) * cGain + 128 + bOff;
    ng = (ng - 128) * cGain + 128 + bOff;
    nb = (nb - 128) * cGain + 128 + bOff;
    // Uint8ClampedArray clampa e arredonda sozinho na atribuição.
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
}

/** Escala de cinza (luma) — atalho comum que não merece três sliders. */
export function grayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
}

export function invert(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

/** Box blur SEPARÁVEL (horizontal + vertical) com 3 passadas ≈ gaussiano.
 *  Radius em px. Separável porque O(r) por pixel vira O(1) com soma corrida —
 *  blur de raio 20 num doc 4096² sem congelar a UI.
 *
 *  Alpha É borrado junto (blur de verdade espalha a borda); os canais de cor
 *  são pré-multiplicados antes e des-multiplicados depois — sem isso, pixels
 *  transparentes (que costumam ser PRETOS no buffer) sangram escuro na borda.
 */
export function boxBlur(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return;

  const n = w * h;
  // Pré-multiplica em float (evita quantizar 3 vezes nas 3 passadas).
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const A = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    R[i] = data[i * 4] * a;
    G[i] = data[i * 4 + 1] * a;
    B[i] = data[i * 4 + 2] * a;
    A[i] = a;
  }

  const tmp = new Float32Array(n);
  const passes = 3; // 3 boxes ≈ gaussiano (teorema central do limite em ação)
  const boxR = Math.max(1, Math.round(r / Math.sqrt(passes)));

  const blurAxis = (src: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const stride = horizontal ? 1 : w;
    const lineStride = horizontal ? w : 1;
    const win = 2 * boxR + 1;
    for (let li = 0; li < lines; li++) {
      const base = li * lineStride;
      let sum = 0;
      // janela inicial (borda estendida: repete o pixel da ponta)
      for (let k = -boxR; k <= boxR; k++) {
        const idx = Math.min(len - 1, Math.max(0, k));
        sum += src[base + idx * stride];
      }
      for (let x = 0; x < len; x++) {
        tmp[base + x * stride] = sum / win;
        const outIdx = Math.max(0, x - boxR);
        const inIdx = Math.min(len - 1, x + boxR + 1);
        sum += src[base + inIdx * stride] - src[base + outIdx * stride];
      }
    }
    src.set(tmp.subarray(0, n));
  };

  for (const ch of [R, G, B, A]) {
    for (let p = 0; p < passes; p++) {
      blurAxis(ch, true);
      blurAxis(ch, false);
    }
  }

  // Des-multiplica de volta.
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (a < 1 / 512) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    } else {
      data[i * 4] = R[i] / a;
      data[i * 4 + 1] = G[i] / a;
      data[i * 4 + 2] = B[i] / a;
      data[i * 4 + 3] = a * 255;
    }
  }
}

/** Unsharp mask: original + amount·(original − borrado). `amount` 0..2. */
export function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (amount <= 0) return;
  const blurred = new Uint8ClampedArray(data);
  boxBlur(blurred, w, h, 2);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] + amount * (data[i] - blurred[i]);
    data[i + 1] = data[i + 1] + amount * (data[i + 1] - blurred[i + 1]);
    data[i + 2] = data[i + 2] + amount * (data[i + 2] - blurred[i + 2]);
    // alpha fica — sharpen não mexe em transparência
  }
}
