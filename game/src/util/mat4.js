// 极简 4x4 矩阵 / 向量运算（列主序，与 WebGL 一致）

export function identity(o = new Float32Array(16)) {
  o.fill(0);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}

export function perspective(fovy, aspect, near, far, o = new Float32Array(16)) {
  const f = 1 / Math.tan(fovy / 2);
  o.fill(0);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function ortho(l, r, b, t, n, f, o = new Float32Array(16)) {
  o.fill(0);
  o[0] = 2 / (r - l);
  o[5] = 2 / (t - b);
  o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l);
  o[13] = -(t + b) / (t - b);
  o[14] = -(f + n) / (f - n);
  o[15] = 1;
  return o;
}

export function multiply(a, b, o = new Float32Array(16)) {
  const t = o === a || o === b ? new Float32Array(16) : o;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      t[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  if (t !== o) o.set(t);
  return o;
}

export function translate(m, x, y, z, o = new Float32Array(16)) {
  o.set(m);
  o[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
  o[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
  o[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
  o[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return o;
}

export function fromTranslation(x, y, z, o = new Float32Array(16)) {
  identity(o);
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}

export function scale(m, x, y, z, o = new Float32Array(16)) {
  o.set(m);
  for (let i = 0; i < 4; i++) {
    o[i] *= x;
    o[4 + i] *= y;
    o[8 + i] *= z;
  }
  return o;
}

export function rotateX(m, a, o = new Float32Array(16)) {
  const s = Math.sin(a), c = Math.cos(a);
  const r = identity(new Float32Array(16));
  r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
  return multiply(m, r, o);
}

export function rotateY(m, a, o = new Float32Array(16)) {
  const s = Math.sin(a), c = Math.cos(a);
  const r = identity(new Float32Array(16));
  r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
  return multiply(m, r, o);
}

export function rotateZ(m, a, o = new Float32Array(16)) {
  const s = Math.sin(a), c = Math.cos(a);
  const r = identity(new Float32Array(16));
  r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
  return multiply(m, r, o);
}

/** 由偏航/俯仰构造视图矩阵（相机位于 eye） */
export function lookRotation(eye, yaw, pitch, o = new Float32Array(16)) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // 前向量
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  // 右向量 = normalize(cross(f, worldUp))
  const rx = cy, ry = 0, rz = -sy;
  // 上向量 = cross(r, f)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  o[0] = rx; o[4] = ry; o[8] = rz; o[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  o[2] = -fx; o[6] = -fy; o[10] = -fz; o[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
}

export function invert(m, o = new Float32Array(16)) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity(o);
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

/** 从投影×视图矩阵提取 6 个视锥平面（用于剔除） */
export function frustumPlanes(m, out = []) {
  const p = [];
  for (let i = 0; i < 6; i++) p.push(out[i] || new Float32Array(4));
  const rows = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3);
  const set = (dst, a, b, sign) => {
    for (let i = 0; i < 4; i++) dst[i] = a[i] + sign * b[i];
    const len = Math.hypot(dst[0], dst[1], dst[2]) || 1;
    for (let i = 0; i < 4; i++) dst[i] /= len;
  };
  set(p[0], r3, r0, 1);
  set(p[1], r3, r0, -1);
  set(p[2], r3, r1, 1);
  set(p[3], r3, r1, -1);
  set(p[4], r3, r2, 1);
  set(p[5], r3, r2, -1);
  return p;
}

export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (const pl of planes) {
    const px = pl[0] > 0 ? maxX : minX;
    const py = pl[1] > 0 ? maxY : minY;
    const pz = pl[2] > 0 ? maxZ : minZ;
    if (pl[0] * px + pl[1] * py + pl[2] * pz + pl[3] < 0) return false;
  }
  return true;
}
