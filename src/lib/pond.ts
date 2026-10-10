/**
 * Sunlit water for the home brand band.
 *
 * A WebGL fragment shader refracts the studio's water photograph through a
 * calm, moving surface: slow swells, warm drifting caustics, sun glints and a
 * fine sparkle where the chop catches the light.
 *
 * Ripples come from a real simulation of the surface (see Ripples below):
 * scrolling past trails a fingertip through the water, the pointer drags
 * through it and a tap or click lets a drop fall. The first time the band
 * comes into view a single drop lands under a quiet "Touch the water" line.
 *
 * Runs only while the band is on screen. Without WebGL, or with reduced
 * motion, the still photograph stays as it is.
 */

// Steepest ripple slope the simulation texture can carry.
const SLOPE_RANGE = 1.4;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uSim;  // ripple slope from the wave simulation, 0.5 = flat
uniform vec2 uSize;      // band size in CSS px
uniform float uDpr;
uniform vec2 uCover;     // object-fit: cover scale for the photo
uniform float uTime;
uniform vec2 uSimSize; // area the simulation grid covers, CSS px

const float TAU = 6.2831853;
const vec3 SUN = vec3(1.0, 0.94, 0.82);
const float SLOPE_RANGE = ${SLOPE_RANGE.toFixed(2)};

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Gradient of the surface height (px per px): long slow swells.
vec2 surface(vec2 p, float t) {
  vec2 g = vec2(0.0);

  // Calm swell: four long waves at different headings and speeds.
  vec2 d0 = vec2(0.94, 0.34);  float k0 = TAU / 340.0;
  vec2 d1 = vec2(-0.55, 0.83); float k1 = TAU / 230.0;
  vec2 d2 = vec2(0.17, -0.98); float k2 = TAU / 170.0;
  vec2 d3 = vec2(-0.86, -0.5); float k3 = TAU / 120.0;
  g += 2.4 * k0 * cos(dot(p, d0) * k0 + t * 0.42) * d0;
  g += 1.8 * k1 * cos(dot(p, d1) * k1 - t * 0.55) * d1;
  g += 1.2 * k2 * cos(dot(p, d2) * k2 + t * 0.71) * d2;
  g += 0.8 * k3 * cos(dot(p, d3) * k3 - t * 0.93) * d3;

  // Slow drifting unevenness so the swell never looks mechanical.
  vec2 q = p * 0.006 + vec2(t * 0.03, -t * 0.02);
  float e = 0.5;
  g += vec2(noise(q + vec2(e, 0.0)) - noise(q - vec2(e, 0.0)), noise(q + vec2(0.0, e)) - noise(q - vec2(0.0, e))) * 0.035;

  return g;
}

// Fine wind chop. Too small to bend the photo, but it is what catches the sun.
vec2 chop(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d0 = vec2(0.8, 0.6);   float k0 = TAU / 23.0;
  vec2 d1 = vec2(-0.7, 0.71); float k1 = TAU / 17.0;
  vec2 d2 = vec2(0.28, -0.96); float k2 = TAU / 13.0;
  g += 0.9 * k0 * cos(dot(p, d0) * k0 + t * 1.9) * d0;
  g += 0.7 * k1 * cos(dot(p, d1) * k1 - t * 2.3) * d1;
  g += 0.5 * k2 * cos(dot(p, d2) * k2 + t * 2.9) * d2;
  return g * (0.6 + 0.8 * noise(p * 0.012 + t * 0.05));
}

// Soft moving light lines, as sunlight focuses through the surface.
float caustic(vec2 p, float t) {
  vec2 q = p * 0.018;
  q += vec2(noise(q * 0.6 + t * 0.06), noise(q * 0.6 - t * 0.05 + 7.3)) * 2.2;
  float a = sin(q.x * 1.6 + t * 0.32) + sin(q.y * 1.9 - t * 0.27) + sin((q.x + q.y) * 1.25 + t * 0.21);
  return pow(1.0 - abs(a) / 3.0, 7.0);
}

// Sun sparkle: tiny four-point stars that flash where a facet tilts toward the sun.
float sparkle(vec2 p, float facing, float t) {
  float cell = 14.0;
  vec2 c = floor(p / cell);
  float s = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = c + vec2(float(i), float(j));
      float r = hash(id);
      if (r < 0.4) continue;
      vec2 at = (id + vec2(hash(id + 3.1), hash(id + 7.7))) * cell;
      vec2 d = p - at;
      float tw = sin(t * (2.5 + 5.0 * hash(id + 1.3)) + r * TAU);
      tw = pow(max(tw, 0.0), 4.0);
      float size = 1.1 + 2.2 * hash(id + 5.9);
      float core = exp(-dot(d, d) / (size * size * 0.5));
      float rays = exp(-abs(d.x) / (size * 2.6)) * exp(-(d.y * d.y) / (size * size * 0.12)) + exp(-abs(d.y) / (size * 2.6)) * exp(-(d.x * d.x) / (size * size * 0.12));
      s += (core + rays * 0.55) * tw;
    }
  }
  return s * facing;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  float t = uTime;

  // Ripples from the wave simulation ride on the swell.
  vec2 rip = (texture2D(uSim, p / uSimSize).rg - 128.0 / 255.0) * (255.0 / 127.0) * SLOPE_RANGE;
  vec2 g = surface(p, t) + rip;
  vec2 refr = (g + rip * 0.6) * 26.0;

  vec2 uv = p / uSize;
  uv = (uv - 0.5) * uCover + 0.5;
  vec2 uvR = uv + refr / uSize * uCover;
  vec3 col = texture2D(uTex, uvR).rgb;

  // Sunny grade: a touch of lift, warm the whites toward linen.
  col = pow(col, vec3(0.97));
  col *= vec3(1.03, 1.0, 0.96);

  // Light: slopes facing the sun brighten, plus warm drifting caustics.
  vec2 sun = normalize(vec2(-0.15, -1.0));
  col *= clamp(1.0 + dot(g, sun) * 1.1, 0.88, 1.22);
  col += SUN * caustic(p + refr * 0.6, t) * 0.06;

  // Ripple faces tilted toward the sky mirror its light, the far faces fall
  // into shade, which is what draws each ring on real water.
  float tilt = clamp(dot(rip, sun), -0.7, 0.7);
  col *= 1.0 + tilt * 0.9;

  // Sunlight falling in from above, over the glare in the photograph.
  vec2 sp = p / max(uSize.x, uSize.y);
  float glow = exp(-length(sp - vec2(0.5, -0.08)) * 2.6);
  col += SUN * glow * 0.08;

  // Glints: the sun reflected in the swell and the fine chop.
  vec2 gf = g + chop(p, t);
  vec3 n = normalize(vec3(-gf * 6.0, 1.0));
  vec3 l = normalize(vec3(-0.08, -0.6, 0.8));
  float facet = max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0);
  col += SUN * pow(facet, 140.0) * (0.35 + glow);
  col += SUN * pow(max(tilt, 0.0), 1.5) * (0.3 + glow);

  float facing = smoothstep(0.55, 0.95, facet) * (0.6 + glow * 1.6);
  col += SUN * sparkle(p + refr * 0.3, facing, t) * 1.7;

  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

/**
 * Ripples: a small, real simulation of a water surface.
 *
 * The surface height h(x, y) follows the linear wave equation for shallow
 * water with the extra physics that gives a pond its look:
 *
 *   h_tt = c^2 lap(h) - s lap(lap(h)) + v lap(h_t) - d h_t
 *
 * c is the wave speed, the s term is surface tension (short waves run ahead of
 * long ones, so a drop spreads into a train of rings instead of one), the v
 * term is viscosity (fine ripples die out before broad ones) and d is a light
 * overall damping. It is stepped on a coarse grid with a fixed time step, so
 * waves travel at the same speed on every screen and frame rate. A soft
 * absorbing border lets waves leave the frame rather than bounce back.
 *
 * Plain JavaScript on a grid of about 20,000 cells: a fraction of a
 * millisecond per step, and it sleeps when the water is still.
 */
class Ripples {
  static readonly SPEED = 240; // CSS px per second
  static readonly COURANT = 0.5; // c dt / cell, keeps the scheme stable with the terms below
  static readonly TENSION = 0.008; // s dt^2 / cell^4
  static readonly VISCOSITY = 0.004; // v dt / cell^2
  static readonly DAMPING = 0.0015; // d dt
  static readonly BORDER = 10; // absorbing cells on each side

  cell = 6;
  cols = 0;
  rows = 0;
  dt = 0;
  h = new Float32Array(0);
  prev = new Float32Array(0);
  lap = new Float32Array(0);
  damp = new Float32Array(0);
  out = new Uint8Array(0);
  awake = 0;
  private acc = 0;

  resize(w: number, h: number) {
    const cell = Math.max(4, w / 240, Math.sqrt((w * h) / 22000));
    const cols = Math.ceil(w / cell) + 2 * Ripples.BORDER;
    const rows = Math.ceil(h / cell) + 2 * Ripples.BORDER;
    if (cols === this.cols && rows === this.rows && Math.abs(cell - this.cell) < 0.01) return;
    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.dt = (Ripples.COURANT * cell) / Ripples.SPEED;
    const n = cols * rows;
    this.h = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.lap = new Float32Array(n);
    this.out = new Uint8Array((cols - 2 * Ripples.BORDER) * (rows - 2 * Ripples.BORDER) * 4);
    this.damp = new Float32Array(n);
    const B = Ripples.BORDER;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
        const k = Math.max(0, (B - edge) / B);
        this.damp[y * cols + x] = Ripples.DAMPING + 0.25 * k * k;
      }
    }
  }

  /**
   * Push the surface down by `depth` px at (x, y) in band px. The water moved
   * aside rises in a rim around the dent, so no water is added or lost.
   */
  press(x: number, y: number, depth: number, radius: number, impulse: boolean) {
    const { cols, rows, cell } = this;
    if (!cols) return;
    const B = Ripples.BORDER;
    const r = Math.max(radius, cell * 1.6) / cell;
    const cx = x / cell - 0.5 + B;
    const cy = y / cell - 0.5 + B;
    const x0 = Math.max(2, Math.floor(cx - r * 2.5));
    const x1 = Math.min(cols - 3, Math.ceil(cx + r * 2.5));
    const y0 = Math.max(2, Math.floor(cy - r * 2.5));
    const y1 = Math.min(rows - 3, Math.ceil(cy + r * 2.5));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d2 = ((i - cx) ** 2 + (j - cy) ** 2) / (r * r);
        if (d2 > 6.25) continue;
        const v = depth * (1 - d2) * Math.exp(-d2);
        const k = j * cols + i;
        this.h[k] -= v;
        // A drop moves the surface without giving it speed; a moving finger pushes it.
        if (impulse) this.prev[k] -= v;
      }
    }
    this.awake = 4;
  }

  /** Advance by `seconds`, calling `force` before each fixed step with the step's time offset. */
  advance(seconds: number, force: (t: number, dt: number) => void) {
    if (!this.cols || this.awake <= 0) return false;
    this.acc = Math.min(this.acc + seconds, this.dt * 10);
    let stepped = false;
    let t = 0;
    while (this.acc >= this.dt) {
      force(t, this.dt);
      this.step();
      this.acc -= this.dt;
      t += this.dt;
      stepped = true;
    }
    return stepped;
  }

  private step() {
    const { cols, rows, h, prev, lap, damp } = this;
    const a = Ripples.COURANT * Ripples.COURANT;
    const s = Ripples.TENSION;
    const nu = Ripples.VISCOSITY;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1, k = y * cols + 1; x < cols - 1; x++, k++) {
        lap[k] = h[k - 1] + h[k + 1] + h[k - cols] + h[k + cols] - 4 * h[k];
      }
    }
    // prev becomes next in place.
    for (let y = 2; y < rows - 2; y++) {
      for (let x = 2, k = y * cols + 2; x < cols - 2; x++, k++) {
        const l = lap[k];
        const bi = lap[k - 1] + lap[k + 1] + lap[k - cols] + lap[k + cols] - 4 * l;
        const vel = h[k] - prev[k];
        const velLap = vel * -4 + (h[k - 1] - prev[k - 1]) + (h[k + 1] - prev[k + 1]) + (h[k - cols] - prev[k - cols]) + (h[k + cols] - prev[k + cols]);
        prev[k] = h[k] + vel * (1 - damp[k]) + a * l - s * bi + nu * velLap;
      }
    }
    this.prev = h;
    this.h = prev;
  }

  /** Write the surface slope into `out` as RG bytes. Returns the steepest slope found. */
  slopes(range: number) {
    const { cols, rows, h, out, cell } = this;
    const B = Ripples.BORDER;
    const scale = 127 / (range * 2 * cell);
    let max = 0;
    let o = 0;
    for (let y = B; y < rows - B; y++) {
      for (let x = B, k = y * cols + B; x < cols - B; x++, k++) {
        const gx = (h[k + 1] - h[k - 1]) * scale;
        const gy = (h[k + cols] - h[k - cols]) * scale;
        max = Math.max(max, Math.abs(gx), Math.abs(gy));
        out[o] = 128 + Math.max(-127, Math.min(127, gx));
        out[o + 1] = 128 + Math.max(-127, Math.min(127, gy));
        out[o + 2] = 128;
        out[o + 3] = 255;
        o += 4;
      }
    }
    // Asleep once every slope rounds to flat for a while.
    if (max < 0.5) this.awake--;
    else this.awake = 4;
    if (this.awake <= 0) {
      this.h.fill(0);
      this.prev.fill(0);
    }
    return max;
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('pond shader', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function initPond(band: HTMLElement) {
  const canvas = band.querySelector<HTMLCanvasElement>('[data-pond]');
  const img = band.querySelector<HTMLImageElement>('img');
  if (!canvas || !img) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const loc = (n: string) => gl.getUniformLocation(prog, n);
  const uSize = loc('uSize');
  const uDpr = loc('uDpr');
  const uCover = loc('uCover');
  const uTime = loc('uTime');
  const uSim = loc('uSim');
  const uSimSize = loc('uSimSize');

  gl.uniform1i(loc('uTex'), 0);
  gl.uniform1i(uSim, 1);

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let texReady = false;
  let imgAspect = 2400 / 960;
  // Non-power-of-two textures cannot repeat in WebGL1, so redraw the photo into a power-of-two canvas.
  const upload = () => {
    const src = document.createElement('canvas');
    src.width = 2048;
    src.height = 1024;
    src.getContext('2d')!.drawImage(img, 0, 0, src.width, src.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    imgAspect = img.naturalWidth / img.naturalHeight || imgAspect;
    texReady = true;
  };
  if (img.complete && img.naturalWidth) upload();
  else img.addEventListener('load', upload, { once: true });

  const simTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, simTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  let simCols = 0;
  let simRows = 0;
  const water = new Ripples();

  // Sizing -------------------------------------------------------------------
  let w = 0;
  let h = 0;
  let dpr = 1;
  const resize = () => {
    const rect = band.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w * h * dpr * dpr > 2_400_000) dpr = Math.sqrt(2_400_000 / (w * h));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    water.resize(w, h);
  };
  resize();

  // Ripples ------------------------------------------------------------------
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;

  // A fingertip trailing through the water: dents the surface along its path
  // each step, deeper the faster it moves. Fast enough, it leaves a V wake.
  type Finger = { x: number; y: number; tx: number; ty: number; speed: number };
  const trail = (f: Finger, t: number, dt: number, frameDt: number) => {
    const k = frameDt > 0 ? Math.min(1, (t + dt) / frameDt) : 1;
    const x = f.x + (f.tx - f.x) * k;
    const y = f.y + (f.ty - f.y) * k;
    const depth = Math.min(1.6, f.speed / 1500) * dt * 60;
    if (depth > 0.004) water.press(x, y, depth, 9, false);
  };

  // Pointer: drag through the water, tap or click for a drop.
  const pointer: Finger = { x: 0, y: 0, tx: 0, ty: 0, speed: 0 };
  let pointerIn = false;
  let pointerT = 0;
  let touched = false;
  const local = (e: PointerEvent) => {
    const rect = band.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };
  band.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    const t = now();
    if (pointerIn) {
      const dist = Math.hypot(x - pointer.tx, y - pointer.ty);
      pointer.speed = Math.max(pointer.speed * 0.5, dist / Math.max(t - pointerT, 1 / 120));
    } else {
      pointer.x = pointer.tx = x;
      pointer.y = pointer.ty = y;
    }
    pointer.tx = x;
    pointer.ty = y;
    pointerT = t;
    pointerIn = true;
    water.awake = 4;
  });
  const leave = () => {
    pointerIn = false;
    pointer.speed = 0;
  };
  band.addEventListener('pointerleave', leave);
  band.addEventListener('pointercancel', leave);
  band.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    water.press(x, y, 22, 16, true);
    touched = true;
    hideHint();
  });

  // Scrolling past: a fingertip held at the middle of the screen, trailing
  // through the band as the page moves under it.
  const scroller: Finger = { x: 0, y: 0, tx: 0, ty: 0, speed: 0 };
  let lastScroll = window.scrollY;
  let scrollSpeed = 0;
  const lockup = band.querySelector<HTMLElement>('.lockup');
  const scrollFinger = (rect: DOMRect, frameDt: number) => {
    const sy = window.scrollY;
    const v = frameDt > 0 ? Math.abs(sy - lastScroll) / frameDt : 0;
    lastScroll = sy;
    scrollSpeed = v > scrollSpeed ? v : scrollSpeed * Math.exp(-frameDt * 10);
    // Sit in the open water beside the lockup when there is room, otherwise left of centre.
    const card = lockup?.getBoundingClientRect();
    const margin = card ? card.left - rect.left : 0;
    const y = window.innerHeight / 2 - rect.top;
    const x = (margin > 90 ? margin * 0.5 : rect.width * 0.28) + 16 * Math.sin(y / 70);
    scroller.x = scroller.tx;
    scroller.y = scroller.ty;
    scroller.tx = x;
    scroller.ty = y;
    if (Math.abs(scroller.y - y) > 200) {
      scroller.x = x;
      scroller.y = y;
    }
    scroller.speed = y > -20 && y < rect.height + 20 ? scrollSpeed : 0;
    if (scroller.speed > 30) water.awake = 4;
  };

  // A quiet invitation: the first time the band is well in view, one drop
  // lands and a short line appears beneath it, then fades.
  const hint = band.querySelector<HTMLElement>('[data-pond-hint]');
  let invited = false;
  let hintTimer = 0;
  function hideHint() {
    hint?.classList.remove('is-shown');
    clearTimeout(hintTimer);
  }
  const invite = () => {
    invited = true;
    if (touched) return;
    const rect = band.getBoundingClientRect();
    const hr = hint?.getBoundingClientRect();
    const x = hr ? hr.left + hr.width / 2 - rect.left : rect.width / 2;
    const y = hr ? hr.top - rect.top - 18 : rect.height * 0.85;
    water.press(x, y, 22, 16, true);
    hint?.classList.add('is-shown');
    hintTimer = window.setTimeout(hideHint, 6500);
  };
  const seen = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting || invited) return;
      seen.disconnect();
      window.setTimeout(invite, 450);
    },
    { threshold: 0.75 },
  );

  // Render loop ---------------------------------------------------------------
  let raf = 0;
  let shown = false;
  let last = 0;
  let flat = false;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!texReady) return;

    const t = now();
    const frameDt = last ? Math.min(t - last, 0.1) : 0;
    last = t;

    const rect = band.getBoundingClientRect();
    scrollFinger(rect, frameDt);
    if (pointerIn && t - pointerT > 0.05) pointer.speed *= Math.exp(-frameDt * 14);

    const moved = water.advance(frameDt, (st, sdt) => {
      if (pointerIn) trail(pointer, st, sdt, frameDt);
      trail(scroller, st, sdt, frameDt);
    });
    pointer.x = pointer.tx;
    pointer.y = pointer.ty;

    const cols = water.cols - 2 * Ripples.BORDER;
    const rows = water.rows - 2 * Ripples.BORDER;
    gl.activeTexture(gl.TEXTURE1);
    if (cols !== simCols || rows !== simRows) {
      simCols = cols;
      simRows = rows;
      water.slopes(SLOPE_RANGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, water.out);
      flat = false;
    } else if (moved) {
      water.slopes(SLOPE_RANGE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, water.out);
      flat = false;
    } else if (water.awake <= 0 && !flat) {
      water.out.fill(128);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, water.out);
      flat = true;
    }

    const boxAspect = w / h;
    const cover = boxAspect > imgAspect ? [1, imgAspect / boxAspect] : [boxAspect / imgAspect, 1];
    gl.uniform2f(uSize, w, h);
    gl.uniform1f(uDpr, dpr);
    gl.uniform2f(uCover, cover[0], cover[1]);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uSimSize, cols * water.cell, rows * water.cell);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!shown) {
      shown = true;
      canvas.classList.add('is-live');
      seen.observe(band);
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    last = 0;
    lastScroll = window.scrollY;
    if (entry.isIntersecting) raf = requestAnimationFrame(frame);
  });
  io.observe(band);
  new ResizeObserver(resize).observe(band);
}

document.querySelectorAll<HTMLElement>('[data-pond-band]').forEach(initPond);
