// Фоновые анимации. Каждая реагирует на «чувства» музыки (см. analysis.js):
// скорость и размах растут с intensity, удары (pulse) дают вспышки и толчки.
import { clamp, lerp, noise1, noise2, rand, rgbCss, mixRgb, smooth } from './util.js';

export const VISUALS = [
  { id: 'aurora', name: 'Аврора', kind: 'gl', preview: 'linear-gradient(135deg,#3a0f5a,#c2367a 45%,#ff9a4a 80%)' },
  { id: 'galaxy', name: 'Галактика', kind: '2d', preview: 'radial-gradient(circle at 50% 50%,#fff 0,#ffd27a 6%,#b84dff 22%,#120526 60%)' },
  { id: 'waves', name: 'Волны', kind: '2d', preview: 'linear-gradient(180deg,#05101f 30%,#1b6fd1 55%,#36e0c6 75%,#05101f)' },
  { id: 'portal', name: 'Портал', kind: 'gl', preview: 'repeating-radial-gradient(circle at 50% 50%,#0a0016 0 6px,#ff3bd4 8px,#0a0016 12px)' },
  { id: 'pulse', name: 'Пульс', kind: '2d', preview: 'radial-gradient(circle,#0b0420 28%,#ff4f8b 31%,#0b0420 34%,#0b0420 44%,#7b5bff 46%,#0b0420 49%)' },
  { id: 'lava', name: 'Лава', kind: '2d', preview: 'radial-gradient(circle at 30% 30%,#ff5e7e,transparent 50%),radial-gradient(circle at 70% 70%,#ffb347,transparent 50%),#1a0820' },
];

// ------------------------------------------------------------- WebGL ---
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const COMMON = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uI, uBass, uMid, uHigh, uPulse, uE;
uniform vec3 uA, uB, uC, uBg;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
`;
const FRAG_AURORA = COMMON + `
void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes) / uRes.y;
  float t = uTime;
  vec2 p = uv * (1.55 - .12*uBass);
  vec2 q = vec2(fbm(p + vec2(0., t*.6)), fbm(p + vec2(5.2, 1.3) - t*.4));
  float warp = 1.8 + 1.8*uI;
  vec2 r = vec2(fbm(p + warp*q + vec2(1.7, 9.2) + t*.3), fbm(p + warp*q + vec2(8.3, 2.8) - t*.25));
  float f = fbm(p + 2.4*r);
  vec3 col = mix(uBg*1.5, uA, smoothstep(.25, .95, f));
  col = mix(col, uB, smoothstep(.35, 1.05, length(q)) * .8);
  col = mix(col, uC, smoothstep(.5, 1.05, r.y) * .65);
  float band = smoothstep(.42, 0., abs(uv.y + .22*sin(uv.x*1.8 + t*1.1) + (f - .5)*.7));
  col += band * mix(uA, uC, .5) * (.12 + .55*uI);
  float d = length(uv);
  col += uPulse * (.12 + .25*uI) * smoothstep(.75, .0, d) * mix(uB, vec3(1.), .35);
  col *= (.32 + .85*uI) * (f*f*1.7 + .3);
  col = max(col, uBg);
  col *= 1. - .6*smoothstep(.45, 1.25, d);
  col += (hash(gl_FragCoord.xy + fract(t)*100.) - .5) * .035;
  gl_FragColor = vec4(col, 1.);
}`;
const FRAG_PORTAL = COMMON + `
void main(){
  vec2 uv = (gl_FragCoord.xy - .5*uRes) / uRes.y;
  uv *= 1. - .08*uBass;
  float r = length(uv) + 1e-3;
  float a = atan(uv.y, uv.x);
  float z = .32/r + uTime;
  float tw = a/6.2831 + uTime*.03 + .05/r;
  float rings = .5 + .5*sin(z*6.2831);
  float stripes = .5 + .5*sin(tw*6.2831*7. + z*1.3);
  float n = fbm(vec2(tw*10., z*1.2));
  vec3 col = mix(uA, uB, .5 + .5*sin(z*.9));
  col = mix(col, uC, stripes*.55);
  float glow = pow(rings, 7. - 4.5*uI) * (.35 + .9*uI) + n*n*(.3 + .5*uMid);
  col *= glow;
  col += uPulse * (.35 + .4*uI) * pow(rings, 14.) * mix(uA, vec3(1.), .6);
  col *= smoothstep(.0, .3, r) * smoothstep(1.6, .4, r);
  col += mix(uA, vec3(1.), .5) * exp(-r*9.) * (.35 + .9*uI + uPulse*.5);
  col = max(col, uBg);
  col += (hash(gl_FragCoord.xy + fract(uTime)*50.) - .5) * .03;
  gl_FragColor = vec4(col, 1.);
}`;

class GLStyle {
  constructor(canvas, frag, speed) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('webgl');
    this.gl = gl; this.canvas = canvas; this.speed = speed; this.time = rand(0, 100);
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.u = {};
    for (const n of ['uRes', 'uTime', 'uI', 'uBass', 'uMid', 'uHigh', 'uPulse', 'uE', 'uA', 'uB', 'uC', 'uBg']) this.u[n] = gl.getUniformLocation(prog, n);
    this.loc = gl.getAttribLocation(prog, 'p');
  }
  frame(F, pal, dt) {
    const { gl, u } = this;
    this.time += dt * this.speed(F);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this.loc);
    gl.vertexAttribPointer(this.loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uI, F.intensity);
    gl.uniform1f(u.uBass, F.bass);
    gl.uniform1f(u.uMid, F.mid);
    gl.uniform1f(u.uHigh, F.high);
    gl.uniform1f(u.uPulse, F.pulse);
    gl.uniform1f(u.uE, F.energy);
    gl.uniform3fv(u.uA, pal.a); gl.uniform3fv(u.uB, pal.b); gl.uniform3fv(u.uC, pal.c); gl.uniform3fv(u.uBg, pal.bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  destroy() {}
}

// --------------------------------------------------------------- 2D ---
function glowSprite(color, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgbCss(mixRgb(color, [1, 1, 1], 0.6), 1));
  g.addColorStop(0.2, rgbCss(color, 0.85));
  g.addColorStop(0.5, rgbCss(color, 0.18));
  g.addColorStop(1, rgbCss(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

class Galaxy {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.spin = 0;
    this.parts = Array.from({ length: 1100 }, () => {
      const arm = (Math.random() * 3) | 0;
      const r0 = Math.pow(Math.random(), 0.7);
      return {
        r0, r: r0, vr: 0, arm,
        a: arm * (Math.PI * 2 / 3) + r0 * 4.2 + rand(-0.35, 0.35) * (1.2 - r0),
        s: rand(0.4, 1.6) * (1.3 - r0 * 0.6), c: (Math.random() * 3) | 0, tw: rand(0, 10),
      };
    });
    this.stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.3, 1.3), tw: rand(0, 10) }));
  }
  frame(F, pal, dt, w, h, sprites) {
    const x = this.ctx, I = F.intensity;
    this.t += dt;
    this.spin += dt * (0.04 + 0.5 * I * I + 0.12 * F.bass);
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = rgbCss(pal.bg, clamp(0.32 - 0.22 * I, 0.08, 0.35));
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const a = 0.25 + 0.25 * Math.sin(this.t * 1.5 + s.tw);
      x.globalAlpha = a;
      x.drawImage(sprites[2], s.x * w - 3, s.y * h - 3, 6 * s.s, 6 * s.s);
    }
    const cx = w / 2, cy = h / 2, R = Math.max(w, h) * 0.55;
    const tilt = 0.55 + 0.1 * Math.sin(this.t * 0.1);
    const kick = F.beat ? (0.04 + 0.12 * I) : 0;
    for (const p of this.parts) {
      if (kick) p.vr += kick * rand(0.4, 1.2) * (1.1 - p.r0 * 0.5);
      p.vr += (p.r0 - p.r) * dt * 6;
      p.vr *= Math.exp(-dt * 3.5);
      p.r = Math.max(0.01, p.r + p.vr * dt * 8);
      const ang = p.a + this.spin / (0.25 + p.r0);
      const px = cx + Math.cos(ang) * p.r * R;
      const py = cy + Math.sin(ang) * p.r * R * tilt;
      const sz = (3 + 9 * p.s) * (0.7 + 0.5 * I + 0.4 * F.pulse * (1 - p.r0));
      x.globalAlpha = clamp((0.35 + 0.5 * I) * (0.6 + 0.4 * Math.sin(this.t * 2 + p.tw)) * (1.15 - p.r0 * 0.7));
      x.drawImage(sprites[p.c], px - sz / 2, py - sz / 2, sz, sz);
    }
    const core = Math.min(w, h) * (0.05 + 0.05 * F.bass + 0.04 * F.pulse);
    x.globalAlpha = 0.3 + 0.3 * I;
    x.drawImage(sprites[3], cx - core * 2, cy - core * 2 * tilt, core * 4, core * 4 * tilt);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
  }
}

class Waves {
  constructor(ctx) { this.ctx = ctx; this.t = 0; this.amp = 0.3; }
  frame(F, pal, dt, w, h) {
    const x = this.ctx, I = F.intensity;
    this.t += dt * (0.25 + 1.5 * I);
    this.amp = smooth(this.amp, 0.25 + 0.9 * I, dt, 0.6);
    const bg = x.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, rgbCss(pal.bg));
    bg.addColorStop(0.6, rgbCss(mixRgb(pal.bg, pal.b, 0.12)));
    bg.addColorStop(1, rgbCss(pal.bg));
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    const L = 6, cols = [pal.a, pal.b, pal.c];
    const step = Math.max(6, w / 140);
    for (let i = 0; i < L; i++) {
      const k = i / (L - 1);
      const band = F.spectrum[Math.floor(k * 40)] || 0;
      const base = h * (0.42 + k * 0.42);
      const A = h * (0.025 + 0.07 * this.amp * (0.6 + band) + 0.05 * F.pulse * (1 - k * 0.5));
      const col = cols[i % 3];
      x.beginPath();
      x.moveTo(0, h);
      let first = true;
      for (let px = -step; px <= w + step; px += step) {
        const u = px / w;
        const y = base +
          A * (Math.sin(u * (5 + i * 1.3) + this.t * (1 + i * 0.25) + i) * 0.55 +
            Math.sin(u * (11 - i) - this.t * (0.7 + i * 0.1)) * 0.25 +
            noise2(u * 3 + i * 7, this.t * 0.35 + i) * 0.7);
        if (first) { x.lineTo(px, y); first = false; } else x.lineTo(px, y);
      }
      x.lineTo(w + step, h);
      x.closePath();
      const g = x.createLinearGradient(0, base - A * 2, 0, h);
      g.addColorStop(0, rgbCss(col, 0.32 + 0.18 * I));
      g.addColorStop(0.5, rgbCss(col, 0.08));
      g.addColorStop(1, rgbCss(pal.bg, 0.0));
      x.fillStyle = g;
      x.fill();
      x.globalCompositeOperation = 'lighter';
      x.strokeStyle = rgbCss(mixRgb(col, [1, 1, 1], 0.3), 0.18 + 0.4 * I);
      x.lineWidth = 6 + 10 * F.pulse;
      x.stroke();
      x.strokeStyle = rgbCss(mixRgb(col, [1, 1, 1], 0.5), 0.6);
      x.lineWidth = 1.5;
      x.stroke();
      x.globalCompositeOperation = 'source-over';
    }
  }
}

class Pulse {
  constructor(ctx) { this.ctx = ctx; this.t = 0; this.rings = []; this.rot = 0; this.dust = Array.from({ length: 90 }, () => ({ a: rand(0, 6.28), r: rand(0.2, 1), s: rand(0.5, 2) })); }
  frame(F, pal, dt, w, h, sprites) {
    const x = this.ctx, I = F.intensity;
    this.t += dt;
    this.rot += dt * (0.05 + 0.6 * I);
    const cx = w / 2, cy = h / 2, M = Math.min(w, h);
    const R0 = M * (0.27 + 0.03 * F.bass);
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = rgbCss(pal.bg, 0.35);
    x.fillRect(0, 0, w, h);
    const bg = x.createRadialGradient(cx, cy, 0, cx, cy, M * 0.9);
    bg.addColorStop(0, rgbCss(mixRgb(pal.bg, pal.c, 0.18 + 0.15 * I), 0.5));
    bg.addColorStop(1, rgbCss(pal.bg, 0));
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);

    if (F.beat) this.rings.push({ r: R0, a: 0.5 + 0.5 * I, c: (Math.random() * 3) | 0, w: 2 + 6 * I });
    x.globalCompositeOperation = 'lighter';
    const cols = [pal.a, pal.b, pal.c];
    this.rings = this.rings.filter((r) => r.a > 0.01);
    for (const r of this.rings) {
      r.r += dt * M * (0.35 + 0.9 * I);
      r.a *= Math.exp(-dt * 1.6);
      x.strokeStyle = rgbCss(cols[r.c], r.a);
      x.lineWidth = r.w;
      x.beginPath(); x.arc(cx, cy, r.r, 0, Math.PI * 2); x.stroke();
    }
    for (const d of this.dust) {
      d.a += dt * (0.05 + 0.3 * I) * (1.2 - d.r);
      const rr = R0 * 0.6 + d.r * M * 0.7;
      x.globalAlpha = 0.4;
      x.drawImage(sprites[2], cx + Math.cos(d.a) * rr - 4, cy + Math.sin(d.a) * rr - 4, 8 * d.s, 8 * d.s);
    }
    x.globalAlpha = 1;
    // Круговой спектр (зеркальный).
    const N = 64, pts = [];
    for (let i = 0; i < N * 2; i++) {
      const b = i < N ? i : N * 2 - 1 - i;
      const v = F.spectrum[Math.min(b, 63)] || 0;
      const ang = (i / (N * 2)) * Math.PI * 2 + this.rot * 0.3 - Math.PI / 2;
      const len = R0 + v * M * (0.06 + 0.16 * I) + F.pulse * M * 0.02;
      pts.push([cx + Math.cos(ang) * len, cy + Math.sin(ang) * len]);
    }
    const g = x.createLinearGradient(cx - R0, cy - R0, cx + R0, cy + R0);
    g.addColorStop(0, rgbCss(pal.a, 0.9)); g.addColorStop(0.5, rgbCss(pal.b, 0.9)); g.addColorStop(1, rgbCss(pal.c, 0.9));
    x.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      if (i === 0) x.moveTo(mx, my); else x.quadraticCurveTo(p[0], p[1], mx, my);
    }
    x.closePath();
    x.strokeStyle = g;
    x.lineWidth = 3 + 4 * I;
    x.stroke();
    x.globalAlpha = 0.12 + 0.12 * I;
    x.fillStyle = g;
    x.fill();
    x.globalAlpha = 1;
    // Вращающаяся геометрия.
    for (let k = 0; k < 3; k++) {
      const sides = [3, 6, 4][k];
      const rr = R0 * (0.55 + k * 0.32) * (1 + 0.06 * F.pulse);
      const rot = this.rot * (k % 2 ? -1 : 1) * (0.6 + k * 0.3);
      x.beginPath();
      for (let s = 0; s <= sides; s++) {
        const a = rot + (s / sides) * Math.PI * 2;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        s ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.strokeStyle = rgbCss(cols[k], 0.12 + 0.25 * I);
      x.lineWidth = 1.5;
      x.stroke();
    }
    x.globalCompositeOperation = 'source-over';
  }
}

class Lava {
  constructor(ctx) {
    this.ctx = ctx; this.t = rand(0, 50);
    this.blobs = Array.from({ length: 7 }, (_, i) => ({ seed: i * 13.7 + rand(0, 5), c: i % 3, k: rand(0.7, 1.3) }));
  }
  frame(F, pal, dt, w, h) {
    const x = this.ctx, I = F.intensity;
    this.t += dt * (0.04 + 0.35 * I * I + 0.05 * F.bass);
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = rgbCss(pal.bg);
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'screen';
    const M = Math.max(w, h), cols = [pal.a, pal.b, pal.c];
    for (const b of this.blobs) {
      const bx = w * (0.5 + 0.45 * noise1(this.t * 0.8 + b.seed));
      const by = h * (0.5 + 0.45 * noise1(this.t * 0.7 + b.seed + 40));
      const r = M * (0.16 + 0.12 * I) * b.k * (1 + 0.18 * F.pulse + 0.1 * F.bass);
      const g = x.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, rgbCss(cols[b.c], 0.55 + 0.35 * I));
      g.addColorStop(0.55, rgbCss(cols[b.c], 0.18 + 0.12 * I));
      g.addColorStop(1, rgbCss(cols[b.c], 0));
      x.fillStyle = g;
      x.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    x.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------------ manager ---
export class Visuals {
  constructor(glCanvas, c2d) {
    this.glCanvas = glCanvas;
    this.c2d = c2d;
    this.ctx = c2d.getContext('2d', { alpha: false });
    this.styles = {};
    this.current = null;
    this.id = null;
    this.pal = null;
    this.target = null;
    this.sprites = null;
    this.spriteAge = 0;
    this.glScale = 0.6;
    this.frameTimes = [];
    addEventListener('resize', () => this.resize());
  }

  setPalette(p, instant = false) {
    const copy = { a: [...p.a], b: [...p.b], c: [...p.c], bg: [...p.bg] };
    this.target = copy;
    if (!this.pal || instant) this.pal = { a: [...p.a], b: [...p.b], c: [...p.c], bg: [...p.bg] };
    this.sprites = null;
  }

  setStyle(id) {
    const def = VISUALS.find((v) => v.id === id) || VISUALS[0];
    this.id = def.id;
    if (!this.styles[def.id]) {
      try {
        this.styles[def.id] = this.create(def);
      } catch (e) {
        console.warn('visual fallback', e);
        this.styles[def.id] = new Waves(this.ctx);
        def.kind = '2d';
      }
    }
    this.kind = def.kind;
    this.current = this.styles[def.id];
    this.glCanvas.hidden = def.kind !== 'gl';
    this.c2d.hidden = def.kind === 'gl';
    this.resize();
  }

  create(def) {
    switch (def.id) {
      case 'aurora': return new GLStyle(this.glCanvas, FRAG_AURORA, (F) => 0.06 + 0.32 * F.intensity + 0.1 * F.energy);
      case 'portal': return new GLStyle(this.glCanvas, FRAG_PORTAL, (F) => 0.15 + 1.6 * F.intensity * F.intensity + 0.5 * F.bass);
      case 'galaxy': return new Galaxy(this.ctx);
      case 'pulse': return new Pulse(this.ctx);
      case 'lava': return new Lava(this.ctx);
      default: return new Waves(this.ctx);
    }
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = innerWidth, H = innerHeight;
    if (this.kind === 'gl') {
      this.glCanvas.width = Math.max(2, Math.round(W * dpr * this.glScale));
      this.glCanvas.height = Math.max(2, Math.round(H * dpr * this.glScale));
    } else {
      const s = Math.min(dpr, 1.25);
      this.c2d.width = Math.round(W * s);
      this.c2d.height = Math.round(H * s);
      this.ctx.setTransform(s, 0, 0, s, 0, 0);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, W, H);
    }
  }

  // Подстраиваем качество шейдеров под мощность ноутбука.
  adapt(dt) {
    if (this.kind !== 'gl') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.024 && this.glScale > 0.3) { this.glScale *= 0.82; this.resize(); }
    else if (avg < 0.0175 && this.glScale < 0.75) { this.glScale = Math.min(0.75, this.glScale * 1.1); this.resize(); }
  }

  frame(F, dt) {
    if (!this.current || !this.pal) return;
    const k = 1 - Math.exp(-dt / 1.2);
    for (const key of ['a', 'b', 'c', 'bg']) {
      for (let i = 0; i < 3; i++) this.pal[key][i] = lerp(this.pal[key][i], this.target[key][i], k);
    }
    this.spriteAge += dt;
    if (!this.sprites || this.spriteAge > 0.4) {
      this.sprites = [glowSprite(this.pal.a), glowSprite(this.pal.b), glowSprite(this.pal.c), glowSprite(mixRgb(this.pal.a, [1, 1, 1], 0.4), 128)];
      this.spriteAge = 0;
    }
    if (this.kind === 'gl') this.current.frame(F, this.pal, dt);
    else this.current.frame(F, this.pal, dt, innerWidth, innerHeight, this.sprites);
    this.adapt(dt);
  }
}
