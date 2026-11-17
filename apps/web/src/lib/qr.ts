/**
 * Générateur de code QR (mode octets, correction d'erreur M, versions 1 à 10 : jusqu'à 213 octets).
 * Écrit pour ne dépendre d'aucune bibliothèque : le code public d'un animal (« CI-BOV-00431 ») tient dans la version 1 ou 2.
 */
// version -> [mots de correction par bloc, [[nombre de blocs, mots de données par bloc], ...]]
const EC_M: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]],
};
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const dataCapacity = (v: number): number => EC_M[v]![1].reduce((s, [n, d]) => s + n * d, 0);

// ---- corps de Galois GF(256), polynôme 0x11D ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!; })();
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]!; next[j + 1] ^= gmul(poly[j]!, EXP[i]!); }
    poly = next;
  }
  return poly; // coefficient de plus fort degré en premier
}
function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1]!, factor);
  }
  return rem;
}

function bchFormat(data: number): number { // 5 bits de format -> 15 bits
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function bchVersion(v: number): number { // 6 bits -> 18 bits
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | rem;
}

export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  const need = (v: number) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (version <= 10 && need(version) > dataCapacity(version) * 8) version++;
  if (version > 10) throw new Error('Texte trop long pour le code QR.');

  // ---- bits de données ----
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const cap = dataCapacity(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // ---- blocs, correction d'erreur, entrelacement ----
  const [ecLen, groups] = EC_M[version]!;
  const blocks: { data: number[]; ec: number[] }[] = [];
  let pos = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) {
    const d = data.slice(pos, pos + size); pos += size;
    blocks.push({ data: d, ec: rsRemainder(d, ecLen) });
  }
  const codewords: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) codewords.push(b.ec[i]!);

  // ---- matrice ----
  const size = version * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => { mod[y]![x] = dark; fn[y]![x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); } // lignes de synchronisation
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[version]!;
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i]! + dx, al[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  const drawFormat = (mask: number) => {
    const f = bchFormat((0 << 3) | mask); // niveau M = 00
    const bit = (i: number) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // réserve la place
  if (version >= 7) {
    const v = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, dark); setFn(b, a, dark);
    }
  }

  // ---- placement des mots de code en zigzag ----
  let k = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y]![x] && k < total) { mod[y]![x] = ((codewords[k >>> 3]! >>> (7 - (k & 7))) & 1) !== 0; k++; }
    }
  }

  // ---- masque : on garde celui qui donne la pénalité la plus faible ----
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0, (_x: number, y: number) => y % 2 === 0, (x: number) => x % 3 === 0, (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && maskFn[m]!(x, y)) mod[y]![x] = !mod[y]![x]; };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    if (forceMask !== undefined && m !== forceMask) continue;
    applyMask(m); drawFormat(m);
    const s = penalty(mod);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m); // annule (XOR)
  }
  applyMask(best); drawFormat(best);
  return mod;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      const hist: number[] = [];
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); hist.push(run); run = 1; }
      }
      // motif 1:1:3:1:1 encadré de blancs
      const line = Array.from({ length: n }, (_, j) => (get(i, j) ? 1 : 0)).join('');
      for (const pat of ['10111010000', '00001011101']) { let at = line.indexOf(pat); while (at !== -1) { score += 40; at = line.indexOf(pat, at + 1); } }
    }
  };
  runs((i, j) => m[i]![j]!);
  runs((i, j) => m[j]![i]!);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y]![x]; if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3; }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** Code QR en SVG (avec la zone blanche réglementaire de 4 modules). */
export function qrSvg(text: string, px = 160): string {
  const m = qrMatrix(text), n = m.length, q = 4;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y]![x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  const s = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Code QR ${text}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
