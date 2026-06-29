/** Parsed mesh: flat triangle vertices (9 numbers per triangle), normalised to [-1,1]. */
export interface MeshData {
  tris: number[];
  name: string;
  count: number;
}

export function parseOBJ(text: string): number[] {
  const verts: number[] = [];
  const tris: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("f ")) {
      const toks = line.trim().split(/\s+/).slice(1);
      const idx = toks.map((t) => parseInt(t.split("/")[0], 10) - 1);
      for (let i = 1; i < idx.length - 1; i++) {
        for (const vi of [idx[0], idx[i], idx[i + 1]]) {
          tris.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
        }
      }
    }
  }
  return tris;
}

export function parseSTL(buffer: ArrayBuffer): number[] {
  const tris: number[] = [];
  // Detect binary STL: 84 + 50*count === byteLength.
  if (buffer.byteLength > 84) {
    const dv = new DataView(buffer);
    const count = dv.getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) {
      for (let i = 0; i < count; i++) {
        const o = 84 + i * 50 + 12; // skip the normal
        for (let v = 0; v < 3; v++) {
          tris.push(dv.getFloat32(o + v * 12, true), dv.getFloat32(o + v * 12 + 4, true), dv.getFloat32(o + v * 12 + 8, true));
        }
      }
      return tris;
    }
  }
  // ASCII STL
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tris.push(+m[1], +m[2], +m[3]);
  return tris;
}

/** Center and uniformly scale triangles so the largest dimension spans [-1, 1]. */
export function normalizeTris(tris: number[]): number[] {
  if (tris.length === 0) return tris;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    minX = Math.min(minX, tris[i]); maxX = Math.max(maxX, tris[i]);
    minY = Math.min(minY, tris[i + 1]); maxY = Math.max(maxY, tris[i + 1]);
    minZ = Math.min(minZ, tris[i + 2]); maxZ = Math.max(maxZ, tris[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const s = 2 / ext;
  const out = new Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    out[i] = (tris[i] - cx) * s;
    out[i + 1] = (tris[i + 1] - cy) * s;
    out[i + 2] = (tris[i + 2] - cz) * s;
  }
  return out;
}

export function loadMeshFromFile(name: string, data: string | ArrayBuffer): MeshData {
  const lower = name.toLowerCase();
  let tris: number[];
  if (lower.endsWith(".stl")) tris = parseSTL(data as ArrayBuffer);
  else tris = parseOBJ(typeof data === "string" ? data : new TextDecoder().decode(new Uint8Array(data as ArrayBuffer)));
  tris = normalizeTris(tris);
  return { tris, name, count: tris.length / 9 };
}
