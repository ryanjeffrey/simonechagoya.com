"""Turn a phone video into a short, graded, muted 4:5 loop for the product gallery.

  python -I video.py IN OUT.mp4 POSTER.jpg [--start S] [--dur S] [--x F] [--y F]

--start/--dur trim (default: 10 s from the start). --x/--y place the 4:5 crop
(0 = left/top, 0.5 = center, 1 = right/bottom). HDR (HLG/PQ) is tone-mapped to
SDR. White balance and exposure are measured on a middle frame with grade.py's
rules and applied in linear light, then the same contrast curve as the photos.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable  # the same venv that runs this script
CURVE = "curves=all='0/0 0.25/0.2406 0.5/0.5 0.75/0.7594 1/1'"  # grade.py CONTRAST = 0.10


def arg(name, default):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def probe(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=width,height,color_transfer:stream_side_data=rotation:format=duration', '-of', 'json', path],
        capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    s = info['streams'][0]
    rot = 0
    for sd in s.get('side_data_list', []) or []:
        rot = int(sd.get('rotation', 0) or 0)
    w, h = s['width'], s['height']
    if rot % 180:
        w, h = h, w
    return {'w': w, 'h': h, 'transfer': s.get('color_transfer', ''), 'duration': float(info['format']['duration'])}


def to_linear(transfer):
    # Input tags are spelled out: zscale refuses untagged sources.
    if transfer in ('arib-std-b67', 'smpte2084'):
        return (f'zscale=tin={transfer}:pin=bt2020:min=bt2020nc:rin=tv:t=linear:npl=100,format=gbrpf32le,'
                'zscale=p=bt709,tonemap=tonemap=hable:desat=0')
    return 'zscale=tin=bt709:pin=bt709:min=bt709:rin=tv:t=linear:p=bt709,format=gbrpf32le'


def crop(w, h, x, y):
    if h / w > 1.25:  # taller than 4:5
        return f'crop=w=iw:h=trunc(iw*5/4/2)*2:x=0:y=(ih-oh)*{y}'
    return f'crop=w=trunc(ih*4/5/2)*2:h=ih:x=(iw-ow)*{x}:y=0'


def main():
    src, out, poster = sys.argv[1:4]
    info = probe(src)
    start = arg('--start', 0.0)
    dur = min(arg('--dur', 10.0), max(info['duration'] - start, 1.0))
    x, y = arg('--x', 0.5), arg('--y', 0.5)
    lin = to_linear(info['transfer'])
    geom = f"{crop(info['w'], info['h'], x, y)},scale=864:1080:flags=lanczos"

    with tempfile.TemporaryDirectory() as tmp:
        frame = os.path.join(tmp, 'mid.png')
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-ss', str(start + dur / 2), '-i', src, '-frames:v', '1',
             '-vf', f'{lin},{geom},zscale=t=iec61966-2-1,format=rgb24', frame], check=True)
        stats = json.loads(subprocess.run([PY, '-I', os.path.join(HERE, 'grade.py'), 'stats', frame],
                                          capture_output=True, text=True, check=True).stdout)

    exposure = min(stats['exposure'], 1.4)
    r, g, b = (gain * exposure for gain in stats['gains'])
    vf = (f'{lin},colorchannelmixer=rr={r:.4f}:gg={g:.4f}:bb={b:.4f},{geom},'
          f'zscale=t=bt709,format=gbrp,{CURVE},zscale=m=bt709:r=tv,format=yuv420p')
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', src, '-vf', vf,
         '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-profile:v', 'high',
         '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
         '-map_metadata', '-1', '-movflags', '+faststart', out], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', out, '-frames:v', '1', '-q:v', '3', poster], check=True)
    print(json.dumps({'in': src, 'out': out, 'bytes': os.path.getsize(out), 'transfer': info['transfer'],
                      'start': start, 'dur': round(dur, 2), **stats, 'exposure_used': exposure}))


if __name__ == '__main__':
    main()
