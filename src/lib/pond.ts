/**
 * Koi pond for the home brand band.
 *
 * A WebGL fragment shader refracts the studio's water photograph through a
 * calm, moving surface: slow swells, drifting caustic light, and ripples from
 * the pointer. A few koi glide underneath with soft shadows on the sand. They
 * wander, startle away from the cursor, and now and then nose the surface.
 *
 * Runs only while the band is on screen. Without WebGL, or with reduced
 * motion, the still photograph stays as it is.
 */

const MAX_RIPPLES = 24;
const KOI_COUNT = 3;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

#define MAX_RIPPLES ${MAX_RIPPLES}
#define KOI ${KOI_COUNT}

uniform sampler2D uTex;
uniform vec2 uSize;      // band size in CSS px
uniform float uDpr;
uniform vec2 uCover;     // object-fit: cover scale for the photo
uniform float uTime;
uniform vec4 uRip[MAX_RIPPLES];  // x, y, born, strength
uniform vec4 uKoi[KOI];          // x, y, heading, swim phase
uniform vec4 uKoiB[KOI];         // length, bend, style, seed

const float TAU = 6.2831853;

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

// Soft moving light lines, as sunlight focuses through the surface.
float caustic(vec2 p, float t) {
  vec2 q = p * 0.018;
  q += vec2(noise(q * 0.6 + t * 0.06), noise(q * 0.6 - t * 0.05 + 7.3)) * 2.2;
  float a = sin(q.x * 1.6 + t * 0.32) + sin(q.y * 1.9 - t * 0.27) + sin((q.x + q.y) * 1.25 + t * 0.21);
  return pow(1.0 - abs(a) / 3.0, 7.0);
}

// Koi in local space. Returns premultiplied color, and alpha for the shadow pass.
vec4 koi(vec2 p, vec4 A, vec4 B, float soft, bool shadowOnly) {
  vec2 d = p - A.xy;
  float c = cos(A.z);
  float s = sin(A.z);
  vec2 q = vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
  float L = B.x;
  if (abs(q.y) > L * 0.5 || q.x < -L * 0.95 || q.x > L * 0.6) return vec4(0.0);

  float u = q.x / L;               // -0.5 tail base .. 0.5 nose
  float tb = 0.5 - u;              // 0 at nose, grows toward tail
  float spine = L * (0.07 * tb * tb * sin(A.w - 5.0 * u) + B.y * tb * tb * 0.45);
  float y = q.y - spine;
  float t1 = u + 0.5;              // 0 tail base .. 1 nose

  // Body: full shoulders, tapering to a slim tail stem, rounded nose.
  float a = (t1 - 0.64) / (t1 < 0.64 ? 0.68 : 0.36);
  float w = L * 0.125 * sqrt(max(0.0, 1.0 - a * a));
  w = max(w, L * 0.03 * step(0.0, t1) * step(t1, 0.35));
  float body = smoothstep(soft, -soft, abs(y) - w) * step(-0.01, t1) * step(t1, 1.0);

  // Tail fin: a soft forked fan that follows the spine.
  float ft = clamp(-t1 / 0.34, 0.0, 1.0);
  float fw = L * (0.035 + 0.17 * ft);
  float fork = 1.0 - smoothstep(0.55, 1.0, ft) * smoothstep(fw * 0.65, 0.0, abs(y)) ;
  float tail = smoothstep(soft, -soft, abs(y) - fw) * step(t1, 0.02) * smoothstep(-0.36, -0.3, t1) * fork;

  // Pectoral fins, sweeping back and paddling slowly.
  float flap = sin(A.w * 0.55) * 0.25;
  float fins = 0.0;
  for (int side = 0; side < 2; side++) {
    float sg = side == 0 ? 1.0 : -1.0;
    vec2 fc = vec2(L * 0.15, sg * L * 0.135);
    float ang = sg * (0.75 + flap);
    vec2 fq = q - vec2(0.0, spine) - fc;
    fq = vec2(fq.x * cos(ang) + fq.y * sin(ang), -fq.x * sin(ang) + fq.y * cos(ang));
    float e = length(fq / vec2(L * 0.1, L * 0.042));
    fins = max(fins, smoothstep(1.0 + soft / (L * 0.03), 1.0 - soft / (L * 0.03), e));
  }

  float finA = max(tail, fins) * 0.78;
  float alpha = max(body, finA);
  if (shadowOnly) return vec4(alpha);
  if (alpha <= 0.001) return vec4(0.0);

  // Pattern, painted in body space so it bends with the fish.
  vec2 pc = vec2(u * 5.0, (y / (L * 0.1)) * 0.9) + B.w * 17.0;
  float n1 = noise(pc * 1.1) * 0.65 + noise(pc * 2.3) * 0.35;
  float n2 = noise(pc * 3.1 + 9.1);
  vec3 white = vec3(0.97, 0.95, 0.91);
  vec3 red = vec3(0.86, 0.3, 0.13);
  vec3 gold = vec3(0.95, 0.72, 0.33);
  vec3 ink = vec3(0.09, 0.08, 0.08);
  vec3 col = white;
  if (B.z < 0.5) {
    col = mix(white, red, smoothstep(0.47, 0.53, n1));                 // kohaku
  } else if (B.z < 1.5) {
    col = mix(gold, vec3(1.0, 0.86, 0.55), smoothstep(0.3, 0.9, n1));   // ogon
  } else {
    col = mix(white, red, smoothstep(0.5, 0.56, n1));                  // sanke
    col = mix(col, ink, smoothstep(0.72, 0.76, n2) * 0.95);
  }

  // Round the body with light from above, and a soft sheen along the spine.
  float across = clamp(abs(y) / max(w, 0.001), 0.0, 1.0);
  float shade = sqrt(1.0 - across * across);
  col *= 0.7 + 0.34 * shade;
  col += vec3(0.07) * smoothstep(0.3, 0.0, across) * body;

  // Dorsal fin as a fine line down the back, and two small eyes.
  float dorsal = smoothstep(1.6, 0.0, abs(y)) * smoothstep(0.22, 0.3, t1) * smoothstep(0.62, 0.52, t1);
  col *= 1.0 - 0.22 * dorsal;
  vec2 eye = vec2((t1 - 0.88) * L, abs(y) - w * 0.62);
  col = mix(col, ink, smoothstep(L * 0.016 + soft, L * 0.016 - soft, length(eye)) * 0.85);

  vec3 finCol = mix(col, white, 0.2) * vec3(0.93, 0.9, 0.87);
  finCol *= 0.9 + 0.1 * sin(atan(y, q.x - L * 0.1) * 40.0);
  vec3 outCol = mix(finCol, col, body);
  return vec4(outCol * alpha, alpha);
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

  // Light: slopes facing the sun brighten, plus drifting caustics.
  vec2 sun = normalize(vec2(-0.5, -0.8));
  col *= clamp(1.0 + dot(g, sun) * 0.9, 0.86, 1.16);
  col += vec3(1.0, 0.98, 0.93) * caustic(p + refr * 0.6, t) * 0.09;

  // Koi swim a little below the surface, so they bend with it too.
  vec2 pk = p + refr * 0.7;
  float shadow = 0.0;
  vec4 fish = vec4(0.0);
  for (int i = 0; i < KOI; i++) {
    if (uKoiB[i].x <= 0.0) continue;
    shadow = max(shadow, koi(pk - vec2(12.0, 18.0), uKoi[i], uKoiB[i], 6.0, true).a);
    vec4 f = koi(pk, uKoi[i], uKoiB[i], 1.4, false);
    fish = f + fish * (1.0 - f.a);
  }
  col *= 1.0 - shadow * 0.32;
  vec3 tint = col;
  fish.rgb = mix(fish.rgb, tint * fish.a, 0.16);
  col = col * (1.0 - fish.a * 0.94) + fish.rgb * 0.94;

  // Surface glints on top of everything.
  vec3 n = normalize(vec3(-g * 9.0, 1.0));
  vec3 l = normalize(vec3(-0.35, -0.55, 0.76));
  float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 120.0);
  col += vec3(1.0) * spec * 0.22;

  gl_FragColor = vec4(col, 1.0);
}
`;

type Koi = {
  x: number;
  y: number;
  a: number;
  v: number;
  phase: number;
  bend: number;
  style: number;
  seed: number;
  len: number;
  scare: number;
};

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

function angleTo(from: number, to: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
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
  const uKoi = loc('uKoi');
  const uKoiB = loc('uKoiB');

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
    for (const k of koi) {
      k.len = Math.max(80, Math.min(190, h * 0.38));
      k.x = Math.min(Math.max(k.x, 0), w);
      k.y = Math.min(Math.max(k.y, 0), h);
    }
  };

  // Koi ---------------------------------------------------------------------
  const koi: Koi[] = Array.from({ length: KOI_COUNT }, (_, i) => ({
    x: 0,
    y: 0,
    a: Math.random() * Math.PI * 2,
    v: 20,
    phase: Math.random() * 10,
    bend: 0,
    style: i % 3,
    seed: Math.random(),
    len: 140,
    scare: 0,
  }));
  resize();
  koi.forEach((k, i) => {
    k.x = w * (0.2 + 0.6 * ((i + 0.5) / KOI_COUNT)) + (Math.random() - 0.5) * 60;
    k.y = h * (0.3 + Math.random() * 0.4);
  });

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
    for (const k of koi) if (Math.hypot(k.x - x, k.y - y) < 260) k.scare = 1;
  });

  // Simulation ----------------------------------------------------------------
  let nextNibble = 4 + Math.random() * 4;
  const step = (t: number, dt: number) => {
    for (const k of koi) {
      // Wander: a slow, irregular meander.
      let turn = Math.sin(t * 0.17 + k.seed * 40) * 0.22 + Math.sin(t * 0.083 + k.seed * 13) * 0.18;
      let target = 16 + k.seed * 10;

      // Stay in the pond: turn back toward the middle near the edges.
      const m = k.len * 0.7;
      const edge = Math.max(0, m - k.x, k.x - (w - m), m - k.y, k.y - (h - m)) / m;
      if (edge > 0) turn += angleTo(k.a, Math.atan2(h / 2 - k.y, w / 2 - k.x)) * 1.6 * Math.min(edge, 1.5);

      // Keep a little distance from each other.
      for (const o of koi) {
        if (o === k) continue;
        const dd = Math.hypot(o.x - k.x, o.y - k.y);
        if (dd < k.len * 0.9) turn += angleTo(k.a, Math.atan2(k.y - o.y, k.x - o.x)) * 0.6 * (1 - dd / (k.len * 0.9));
      }

      // Startle away from the pointer.
      const pd = Math.hypot(px - k.x, py - k.y);
      if (pd < 170) {
        k.scare = Math.max(k.scare, 1 - pd / 170);
        turn += angleTo(k.a, Math.atan2(k.y - py, k.x - px)) * 2.4 * (1 - pd / 170);
      }
      k.scare = Math.max(0, k.scare - dt * 0.45);
      target += k.scare * 95;

      k.a += turn * dt;
      k.v += (target - k.v) * Math.min(1, dt * 1.6);
      k.x += Math.cos(k.a) * k.v * dt;
      k.y += Math.sin(k.a) * k.v * dt;
      k.phase += dt * (2.2 + k.v * 0.07);
      k.bend += (-turn * 0.32 - k.bend) * Math.min(1, dt * 3);
    }

    // Now and then a koi noses the surface.
    if (t > nextNibble) {
      const k = koi[Math.floor(Math.random() * koi.length)];
      drop(k.x + Math.cos(k.a) * k.len * 0.48, k.y + Math.sin(k.a) * k.len * 0.48, 0.32);
      nextNibble = t + 5 + Math.random() * 7;
    }
  };

  // Render loop ---------------------------------------------------------------
  const koiA = new Float32Array(KOI_COUNT * 4);
  const koiB = new Float32Array(KOI_COUNT * 4);
  let raf = 0;
  let last = now();
  let shown = false;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const t = now();
    const dt = Math.min(0.05, t - last);
    last = t;
    step(t, dt);
    if (!texReady) return;

    // Two koi on narrow screens, three on wide ones.
    const active = w < 700 ? 2 : KOI_COUNT;
    koi.forEach((k, i) => {
      koiA.set([k.x, k.y, k.a, k.phase], i * 4);
      koiB.set([i < active ? k.len : 0, k.bend, k.style, k.seed], i * 4);
    });
    const boxAspect = w / h;
    const cover = boxAspect > imgAspect ? [1, imgAspect / boxAspect] : [boxAspect / imgAspect, 1];
    gl.uniform2f(uSize, w, h);
    gl.uniform1f(uDpr, dpr);
    gl.uniform2f(uCover, cover[0], cover[1]);
    gl.uniform1f(uTime, t);
    gl.uniform4fv(uRip, ripples);
    gl.uniform4fv(uKoi, koiA);
    gl.uniform4fv(uKoiB, koiB);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!shown) {
      shown = true;
      canvas.classList.add('is-live');
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting) {
      last = now();
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(band);
  new ResizeObserver(resize).observe(band);
}

document.querySelectorAll<HTMLElement>('[data-pond-band]').forEach(initPond);
