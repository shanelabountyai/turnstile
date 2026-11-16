"""WCAG contrast of the design system's token pairs, in both schemes, parsed from src/app/turnstile.css.
Stdlib only. `python3 -I tools/contrast.py` exits 1 if any pair is under its floor (4.5 text, 3.0 UI border).
Not a product file and not an engine oracle: it is the evidence behind docs/DESIGN_SYSTEM.md."""
import math, re, sys

css = open('src/app/turnstile.css').read()

def oklch_to_rgb(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l_, m_, s_ = L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return [min(1, max(0, v)) for v in (r, g, bl)]  # linear sRGB

def lum(rgb): return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)

def oklch(expr):
    m = re.match(r'oklch\(([\d.]+) ([\d.]+) ([\d.]+)', expr.strip())
    return oklch_to_rgb(float(m[1]), float(m[2]), float(m[3]))

def block(start):  # the text of the first {...} after `start`
    i = css.index('{', css.index(start)); d, j = 1, i + 1
    while d: d += {'{': 1, '}': -1}.get(css[j], 0); j += 1
    return css[i + 1:j - 1]

def tokens(text):
    return dict(re.findall(r'(--[\w-]+):\s*([^;]+);', text))

def resolve(name, env, depth=0):
    v = env[name].strip()
    m = re.fullmatch(r'var\((--[\w-]+)\)', v)
    return resolve(m[1], env, depth + 1) if m else v

light = tokens(block(':root {\n  /* neutral')) | tokens(block('/* ============ 2. semantic'))
sem = tokens(block('/* ============ 2. semantic'))
dark_over = tokens(block('@media (prefers-color-scheme: dark)').split('}')[0])
envs = {'light': {**tokens(block(':root {\n  /* neutral')), **sem}}
envs['dark'] = {**envs['light'], **dark_over}

HUES = {'good': 155, 'risk': 28, 'hold': 80, 'info': 245, 'done': 60}
CM = {'done': 0.15}
bad = 0
for scheme, env in envs.items():
    g = lambda n: oklch(resolve(n, env))
    pairs = [('ink on bg', 'ink', 'bg', 4.5), ('ink on sf', 'ink', 'sf', 4.5), ('ink on sf-2', 'ink', 'sf-2', 4.5),
             ('muted on bg', 'mu', 'bg', 4.5), ('muted on sf', 'mu', 'sf', 4.5), ('muted on sf-2', 'mu', 'sf-2', 4.5),
             ('link/action on bg', 'ac', 'bg', 4.5), ('link/action on sf', 'ac', 'sf', 4.5), ('button text on action', 'acf', 'ac', 4.5),
             ('control border on sf (UI 3:1)', 'ln-strong', 'sf', 3.0)]
    for label, f, b, floor in pairs:
        r = ratio(g('--' + f), g('--' + b)); ok = r >= floor; bad += not ok
        print(f'{scheme:5} {"ok " if ok else "LOW"} {r:5.2f}  {label}')
    for k, h in HUES.items():
        cm = CM.get(k, 1)
        def kv(prefix): return oklch_to_rgb(float(env[f'--k-{prefix}-l']), float(env[f'--k-{prefix}-c']) * cm, h)
        for label, fg, bg in (('pill text on pill bg', kv('fg'), kv('bg')),):
            r = ratio(fg, bg); ok = r >= 4.5; bad += not ok
            print(f'{scheme:5} {"ok " if ok else "LOW"} {r:5.2f}  {k}: {label}')
        for label, bgc in (('sf', g('--sf')),):  # a status-coloured card edge/dot against the card is UI, 3:1
            r = ratio(kv('dot'), bgc); ok = r >= 3.0; bad += not ok
            print(f'{scheme:5} {"ok " if ok else "LOW"} {r:5.2f}  {k}: edge/border on {label} (UI 3:1)')
print('FAIL' if bad else 'OK', bad, 'pairs under floor')
sys.exit(1 if bad else 0)
