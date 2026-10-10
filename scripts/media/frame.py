"""Frame flat-lay product photos so every piece sits at the same size and place.

Each photo is a graded flat lay: the piece on a plain light background. For each one:
  1. the piece is found as everything that stands apart from the plain background,
  2. the background is modeled as a smooth surface fitted to everything clear of the piece,
  3. the photo is scaled so every piece has the same height, and centered on one shared
     point of a 4:5 canvas, so tops and bottoms line up in a grid,
  4. the background is evened out to one shared color, so the canvas edge never shows.

The piece itself is only scaled, never retouched. Stone colors are left as graded.

Output: sRGB JPEG, 1200x1500, no metadata.

  python -I frame.py photo IN OUT [--debug DEBUG.jpg]
  python -I frame.py batch JOBS.json       # [{"in": ..., "out": ...}]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageCms, ImageDraw

SRGB_BYTES = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()

CANVAS = (1200, 1500)
# Every piece is scaled to this height (a share of the canvas width), so its top and bottom
# land on the same lines as every other piece, whatever its shape.
BOX = 0.68
# Widest a piece may get, as a share of the canvas width. Only a very wide piece hits it,
# and then it comes out shorter than the rest.
MAX_W = 0.84
# Optical center: a touch above the middle reads as centered.
CENTER_Y = 0.485
# Shared background, the graded flat-lay white (see grade.py).
BG = np.array([239, 238, 234], dtype=np.float64)

# Piece detection, on a downsampled copy.
WORK = 480  # long edge of the working copy
DIFF = 14  # min distance from the background, in 8-bit levels
MIN_COUNT = 2  # a row or column needs this many piece pixels to count


def fit_background(a, where=None):
    """Fit a quadratic surface per channel to the background pixels (default: the outer border)."""
    h, w, _ = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    y, x = yy / h - 0.5, xx / w - 0.5
    if where is None:
        m = max(2, min(h, w) // 25)
        where = np.zeros((h, w), bool)
        where[:m] = where[-m:] = True
        where[:, :m] = where[:, -m:] = True
    terms = np.stack([np.ones_like(x), x, y, x * x, y * y, x * y], -1)
    A = terms[where]
    surface = np.empty_like(a)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, a[..., c][where], rcond=None)
        surface[..., c] = terms @ coef
    return surface


def box_mean(mask, r):
    """Mean over a (2r+1) square window, via an integral image."""
    p = np.pad(mask.astype(np.float64), r + 1, mode='edge')
    s = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    out = s[k:, k:] - s[:-k, k:] - s[k:, :-k] + s[:-k, :-k]
    return out[: mask.shape[0], : mask.shape[1]] / (k * k)


def find_piece(img):
    """Bounding box (x0, y0, x1, y1) of the piece in full-size pixels, and the background
    surface (fitted to every pixel away from the piece) on the working copy."""
    w, h = img.size
    scale = WORK / max(w, h)
    small = np.asarray(img.resize((round(w * scale), round(h * scale)), Image.LANCZOS), np.float64)
    bg = fit_background(small)
    diff = np.abs(small - bg).max(-1)
    mask = diff > DIFF
    # Drop dust and sensor noise: keep pixels whose neighborhood is mostly piece.
    mask = box_mean(mask, 1) > 0.5
    cols = np.flatnonzero(mask.sum(0) >= MIN_COUNT)
    rows = np.flatnonzero(mask.sum(1) >= MIN_COUNT)
    if not len(cols) or not len(rows):
        raise ValueError('no piece found')
    x0, x1, y0, y1 = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
    # Refit the background on everything clear of the piece and its shadow, not just the
    # border: the border of a cleaned photo can be a shade off from the surface under the piece.
    clear = box_mean(np.abs(small - bg).max(-1) > DIFF / 3, 6) == 0
    surface = fit_background(small, clear)
    return tuple(v / scale for v in (x0, y0, x1, y1)), surface


def frame(img):
    img = img.convert('RGB')
    (x0, y0, x1, y1), surface = find_piece(img)
    cw, ch = CANVAS
    box = BOX * cw
    # Every piece gets the same height, so tops and bottoms line up across a row. A wide piece
    # may run wider than the box, up to MAX_W.
    s = min(box / (y1 - y0), MAX_W * cw / (x1 - x0))
    # Where the source's top-left lands on the canvas.
    ox = cw / 2 - s * (x0 + x1) / 2
    oy = ch * CENTER_Y - s * (y0 + y1) / 2

    # Even the background out to BG before scaling, so the photo's edge disappears.
    a = np.asarray(img, np.float64)
    sw, sh = img.size
    surface = np.stack(
        [np.asarray(Image.fromarray(surface[..., c].astype(np.float32), 'F').resize((sw, sh), Image.BILINEAR)) for c in range(3)],
        -1,
    )
    a = np.clip(a * (BG / np.maximum(surface, 1)), 0, 255)
    src = Image.fromarray(a.round().astype(np.uint8))

    # Scale and place with one affine resample (canvas -> source mapping).
    fill = tuple(int(v) for v in BG)
    placed = np.asarray(
        src.transform(CANVAS, Image.AFFINE, (1 / s, 0, -ox / s, 0, 1 / s, -oy / s), Image.BICUBIC, fillcolor=fill),
        np.float64,
    )

    # Keep the photo around the piece and fade it into the flat background well before the
    # photo's own edge, so no rectangle shows where the photo ends.
    yy, xx = np.mgrid[0 : CANVAS[1], 0 : CANVAS[0]] + 0.5
    px0, py0, px1, py1 = ox + s * x0, oy + s * y0, ox + s * x1, oy + s * y1
    margin, fade = 0.06 * box, 0.10 * box
    out_x = np.maximum(np.maximum(px0 - margin - xx, xx - px1 - margin), 0)
    out_y = np.maximum(np.maximum(py0 - margin - yy, yy - py1 - margin), 0)
    piece_alpha = 1 - smoothstep(np.hypot(out_x, out_y) / fade)
    edge = 0.03 * box
    in_x = np.minimum(xx - ox, ox + s * sw - xx)
    in_y = np.minimum(yy - oy, oy + s * sh - yy)
    edge_alpha = smoothstep(np.minimum(in_x, in_y) / edge)
    alpha = np.minimum(piece_alpha, edge_alpha)[..., None]
    out = placed * alpha + BG * (1 - alpha)
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8)), (x0, y0, x1, y1), s


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def save(img, path):
    img.save(path, 'JPEG', quality=90, optimize=True, progressive=True, subsampling=0, icc_profile=SRGB_BYTES)


def run(src, dst, debug=None):
    img = Image.open(src)
    out, bbox, s = frame(img)
    save(out, dst)
    if debug:
        d = img.convert('RGB')
        ImageDraw.Draw(d).rectangle(bbox, outline=(220, 0, 0), width=4)
        d.save(debug, quality=80)
    print(json.dumps({'in': src, 'out': dst, 'bbox': [round(v) for v in bbox], 'scale': round(s, 3)}))


if __name__ == '__main__':
    cmd, *args = sys.argv[1:]
    if cmd == 'photo':
        debug = args[args.index('--debug') + 1] if '--debug' in args else None
        run(args[0], args[1], debug)
    elif cmd == 'batch':
        for job in json.load(open(args[0])):
            run(job['in'], job['out'], job.get('debug'))
    else:
        sys.exit(__doc__)
