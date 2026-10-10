"""Grade product photos to one white balance, exposure and finish.

Each photo is measured on its own background (the light, low-saturation surface
the piece sits on), then:
  1. white balance: the background is moved to one shared warm-neutral white,
  2. exposure: the background is brought to one shared brightness,
  3. finish: a soft highlight roll-off and one gentle contrast curve.
Stone colors are not pushed: only the global cast and exposure change.

Photos without a usable background (on the body, dark grounds) get a weaker,
gray-world white balance and only a light exposure nudge.

Output: sRGB JPEG with an embedded sRGB profile and no other metadata (iPhone
photos carry GPS). Display P3 sources are converted to sRGB first.

  python -I grade.py photo IN OUT [--max 2400]
  python -I grade.py batch JOBS.json         # [{"in": ..., "out": ..., "max": 2400}]
  python -I grade.py convert IN OUT [--max 2400]   # artwork: sRGB + strip metadata, no grading
  python -I grade.py stats FRAME.png          # prints linear gains + exposure as JSON (for video)
"""
import io
import json
import sys

import numpy as np
import pillow_heif
from PIL import Image, ImageCms, ImageOps

pillow_heif.register_heif_opener()

SRGB = ImageCms.createProfile('sRGB')
SRGB_BYTES = ImageCms.ImageCmsProfile(SRGB).tobytes()

# Shared targets. Every background lands on this warm off-white: a shade deeper than the
# site's linen (#f4efe7), so photos sit in their arch frames instead of vanishing into the page.
TARGET_WHITE = np.array([237, 232, 224]) / 255.0
CONTRAST = 0.10  # strength of the shared S-curve
SHOULDER = 0.9  # linear value where highlights roll off; above the target white, so backgrounds land on it exactly


def to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def luminance(lin):
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


TARGET_LIN = to_linear(TARGET_WHITE)
TARGET_CHROMA = TARGET_LIN / luminance(TARGET_LIN)


def load(path):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    icc = img.info.get('icc_profile')
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGBA' if 'A' in img.mode else 'RGB')
    if img.mode == 'RGBA':
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            img = ImageCms.profileToProfile(img, src, SRGB, outputMode='RGB')
        except Exception:
            pass  # Unreadable profile: treat as sRGB.
    return img


def measure(img):
    """Returns (gains, exposure, report) in linear light.

    Every product photo is moved so its background lands on TARGET_WHITE:
      white:   already edited onto (near) pure white; map that white to the target.
      surface: shot on paper, linen or stone; map the measured surface to the target.
      scene:   no usable background (worn, dark grounds); gentle gray-world balance only.
    """
    small = img.copy()
    small.thumbnail((640, 640))
    a = np.asarray(small, dtype=np.float64) / 255.0
    lin = to_linear(a)
    y = luminance(lin)
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)

    white_share = float((mn >= 0.96).mean())
    cand = (y >= np.percentile(y, 55)) & (sat < 0.15) & (mx < 0.985)
    surface_share = float(cand.mean())
    deviation = 0.0

    if white_share >= 0.25:
        mode, share = 'white', white_share
        ref = np.median(lin[mn >= 0.96], axis=0)
        gains = np.clip(TARGET_LIN / np.maximum(ref, 1e-6), 0.6, 1.6)
        exposure, strength = 1.0, 1.0
    elif surface_share >= 0.08:
        mode, share = 'surface', surface_share
        ref = np.median(lin[cand], axis=0)
        chroma = ref / max(float(luminance(ref)), 1e-6)
        # A strongly colored surface (wood, cardboard, water) is not a white under tinted light.
        deviation = float(chroma.max() / max(chroma.min(), 1e-6)) - 1
        strength = float(np.clip(1 - (deviation - 0.15) / 0.25, 0.3, 1.0))
        full = TARGET_LIN / np.maximum(ref, 1e-6)
        wb = full / float(luminance(full))
        wb = 1 + (np.clip(wb, 0.75, 1.35) - 1) * strength
        exposure = float(np.clip(float(luminance(TARGET_LIN)) / max(float(luminance(ref * wb)), 1e-6), 0.6, 1.8))
        gains = wb
    else:
        mode, share, strength = 'scene', surface_share, 0.5
        mid = (sat < 0.30) & (y > np.percentile(y, 20)) & (y < np.percentile(y, 95))
        ref = np.median(lin[mid], axis=0) if mid.any() else np.median(lin.reshape(-1, 3), axis=0)
        chroma = ref / max(float(luminance(ref)), 1e-6)
        wb = TARGET_CHROMA / np.maximum(chroma, 1e-6)
        wb = wb / float(luminance(wb))
        gains = 1 + (np.clip(wb, 0.75, 1.35) - 1) * strength
        med = float(np.median(y))
        exposure = float(np.clip((0.20 / max(med, 1e-6)) ** 0.5, 0.9, 1.2))

    report = {
        'mode': mode,
        'share': round(share, 3),
        'reference_srgb': [round(float(v) * 255) for v in to_srgb(ref)],
        'deviation': round(deviation, 3),
        'strength': round(strength, 3),
        'gains': [round(float(g), 4) for g in gains],
        'exposure': round(exposure, 4),
    }
    return gains, exposure, report


def finish(lin):
    # Highlight roll-off so brightened backgrounds do not clip flat.
    k = SHOULDER
    over = lin > k
    lin = np.where(over, k + (1 - k) * (1 - np.exp(-(lin - k) / (1 - k))), lin)
    s = to_srgb(lin)
    # One shared, gentle S-curve.
    return (1 - CONTRAST) * s + CONTRAST * (3 * s**2 - 2 * s**3)


def grade(img, gains=None, exposure=None):
    if gains is None:
        gains, exposure, report = measure(img)
    else:
        report = {'gains': list(gains), 'exposure': exposure}
    a = np.asarray(img, dtype=np.float64) / 255.0
    lin = to_linear(a) * gains * exposure
    out = finish(lin)
    return Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB'), report


def save(img, out, max_edge=2400):
    img = img.copy()
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    img.save(out, 'JPEG', quality=90, optimize=True, progressive=True, icc_profile=SRGB_BYTES)


def main(argv):
    cmd = argv[1]
    if cmd == 'photo':
        src, out = argv[2], argv[3]
        max_edge = int(argv[argv.index('--max') + 1]) if '--max' in argv else 2400
        graded, report = grade(load(src))
        save(graded, out, max_edge)
        print(json.dumps({'in': src, 'out': out, **report}))
    elif cmd == 'batch':
        jobs = json.load(open(argv[2]))
        for job in jobs:
            graded, report = grade(load(job['in']))
            save(graded, job['out'], job.get('max', 2400))
            print(json.dumps({'in': job['in'], 'out': job['out'], **report}), flush=True)
    elif cmd == 'convert':
        # Artwork: sRGB and metadata stripping only. Grading would change the painting's color.
        src, out = argv[2], argv[3]
        max_edge = int(argv[argv.index('--max') + 1]) if '--max' in argv else 2400
        save(load(src), out, max_edge)
        print(json.dumps({'in': src, 'out': out, 'mode': 'convert'}))
    elif cmd == 'stats':
        gains, exposure, report = measure(load(argv[2]))
        print(json.dumps(report))
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
