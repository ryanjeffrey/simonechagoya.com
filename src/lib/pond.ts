/**
 * Sunlit water for the home brand band.
 *
 * A WebGL fragment shader refracts the studio's water photograph through a
 * calm, moving surface: slow swells, warm drifting caustics, sun glints and a
 * fine sparkle where the chop catches the light, plus ripples from the
 * pointer.
 *
 * Runs only while the band is on screen. Without WebGL, or with reduced
 * motion, the still photograph stays as it is.
 */

const MAX_RIPPLES = 24;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

#define MAX_RIPPLES ${MAX_RIPPLES}

uniform sampler2D uTex;
uniform vec2 uSize;      // band size in CSS px
uniform float uDpr;
uniform vec2 uCover;     // object-fit: cover scale for the photo
uniform float uTime;
uniform vec4 uRip[MAX_RIPPLES];  // x, y, born, strength

const float TAU = 6.2831853;
const vec3 SUN = vec3(1.0, 0.94, 0.82);

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

// Gradient of the surface height (px per px). Long slow swells plus pointer ripples.
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

  // Ripples: decaying rings travelling outward.
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = uRip[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 6.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 0.001;
    float R = 4.0 + 62.0 * age;
    float x = dist - R;
    float width = 14.0 + 16.0 * age;
    float env = r.w * exp(-age * 0.75) * smoothstep(0.0, 0.12, age) / (1.0 + R * 0.01);
    float gauss = exp(-(x * x) / (width * width));
    float ph = TAU * x / 30.0;
    float dh = env * gauss * (-2.0 * x / (width * width) * cos(ph) - sin(ph) * TAU / 30.0);
    g += dh * (d / dist) * 4.5;
  }
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

  vec2 g = surface(p, t);
  vec2 refr = g * 26.0;

  vec2 uv = p / uSize;
  uv = (uv - 0.5) * uCover + 0.5;
  vec2 uvR = uv + refr / uSize * uCover;
  vec3 col = texture2D(uTex, uvR).rgb;

  // Sunny grade: lift the shadows, warm the whites toward linen.
  col = pow(col, vec3(0.93));
  col *= vec3(1.05, 1.01, 0.93);

  // Light: slopes facing the sun brighten, plus warm drifting caustics.
  vec2 sun = normalize(vec2(-0.5, -0.8));
  col *= clamp(1.0 + dot(g, sun) * 1.1, 0.88, 1.22);
  col += SUN * caustic(p + refr * 0.6, t) * 0.16;

  // Sunlight falling in from the upper left.
  vec2 sp = p / max(uSize.x, uSize.y);
  float glow = exp(-length(sp - vec2(0.12, -0.15)) * 2.2);
  col += SUN * glow * 0.14;

  // Glints: the sun reflected in the swell and the fine chop.
  vec2 gf = g + chop(p, t);
  vec3 n = normalize(vec3(-gf * 6.0, 1.0));
  vec3 l = normalize(vec3(-0.35, -0.55, 0.76));
  float facet = max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0);
  col += SUN * pow(facet, 140.0) * (0.35 + glow);

  float facing = smoothstep(0.55, 0.95, facet) * (0.6 + glow * 1.6);
  col += SUN * sparkle(p + refr * 0.3, facing, t) * 1.7;

  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

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
  const uRip = loc('uRip');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let texReady = false;
  let imgAspect = 1600 / 840;
  // Non-power-of-two textures cannot repeat in WebGL1, so redraw the photo into a power-of-two canvas.
  const upload = () => {
    const src = document.createElement('canvas');
    src.width = 2048;
    src.height = 1024;
    src.getContext('2d')!.drawImage(img, 0, 0, src.width, src.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    imgAspect = img.naturalWidth / img.naturalHeight || imgAspect;
    texReady = true;
  };
  if (img.complete && img.naturalWidth) upload();
  else img.addEventListener('load', upload, { once: true });

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
  };
  resize();

  // Ripples -----------------------------------------------------------------
  const ripples = new Float32Array(MAX_RIPPLES * 4);
  let next = 0;
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;
  const drop = (x: number, y: number, strength: number) => {
    ripples.set([x, y, now(), strength], next * 4);
    next = (next + 1) % MAX_RIPPLES;
  };

  // Pointer -----------------------------------------------------------------
  let px = -9999;
  let py = -9999;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  const local = (e: PointerEvent) => {
    const rect = band.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };
  band.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    px = x;
    py = y;
    const t = now();
    const dist = Math.hypot(x - lastX, y - lastY);
    if (dist > 22 && t - lastT > 0.05) {
      const speed = dist / Math.max(t - lastT, 0.016);
      drop(x, y, Math.min(0.6, Math.max(0.22, speed / 1400)));
      lastX = x;
      lastY = y;
      lastT = t;
    }
  });
  band.addEventListener('pointerleave', () => {
    px = py = -9999;
  });
  band.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    drop(x, y, 1.25);
  });

  // Render loop ---------------------------------------------------------------
  let raf = 0;
  let shown = false;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!texReady) return;

    const boxAspect = w / h;
    const cover = boxAspect > imgAspect ? [1, imgAspect / boxAspect] : [boxAspect / imgAspect, 1];
    gl.uniform2f(uSize, w, h);
    gl.uniform1f(uDpr, dpr);
    gl.uniform2f(uCover, cover[0], cover[1]);
    gl.uniform1f(uTime, now());
    gl.uniform4fv(uRip, ripples);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!shown) {
      shown = true;
      canvas.classList.add('is-live');
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting) raf = requestAnimationFrame(frame);
  });
  io.observe(band);
  new ResizeObserver(resize).observe(band);
}

document.querySelectorAll<HTMLElement>('[data-pond-band]').forEach(initPond);
