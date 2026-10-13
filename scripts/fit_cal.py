"""Calibration driver for the cost model. Usage: python3 scripts/fit_cal.py ITERS [SEEDS] [FIXED,ids] [FIT_SIZE=1]

Each iteration runs `node scripts/balance.ts army SEEDS` with trial calibrations injected through the environment
(BAL_CAL = per-module table, BAL_SIZEK = size-class price factors), reads the per-design dump (BAL_OUT) and nudges
  - every weapon's calibration toward the mean win-rate logit of the designs that carry it,
  - every utility's calibration toward its win-rate delta against the same carrier without it,
  - the size-class factors (sizes 1,3,4,5; size 2 is the reference) toward the logit of neutral designs of that class
    (plain frames and starters; for giants/titans frames only, so G/T module fits are not mixed up with the class effect).
State lives in $FIT_DIR (default: this repo's .fit/ is NOT used; pass FIT_DIR=/some/dir): cal.json, sizek.json.
Copy the final tables into MODULE_CAL / SIZE_K in src/shared/stats.ts.
"""
import json, subprocess, math, sys, os, re, collections

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT = os.environ.get('FIT_DIR', '/tmp/fit')
os.makedirs(FIT, exist_ok=True)
MODS = {}
src = open(f'{REPO}/src/shared/parts.ts').read()
for m in re.finditer(r"(wpn|util)\(\{ id: '(\w+)'", src):
    MODS[m.group(2)] = m.group(1)
calf, szf = f'{FIT}/cal.json', f'{FIT}/sizek.json'
cal = json.load(open(calf)) if os.path.exists(calf) else {}
sizek = json.load(open(szf)) if os.path.exists(szf) else [1, 1, 1, 1, 1]
iters = int(sys.argv[1])
seeds = sys.argv[2] if len(sys.argv) > 2 else '3'
fixed = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else set()
fit_size = (sys.argv[4] if len(sys.argv) > 4 else '1') == '1'
# mixed AA/ground starters whose result mostly reflects the rock-paper-scissors of the field, not module value
IGNORE = {'starter-skyguard'}
ETA = {'w': 0.3, 'u': 0.3, 's': 0.12}


def lg(r):
    r = min(0.96, max(0.04, r))
    return math.log(r / (1 - r))


for it in range(iters):
    env = dict(os.environ, BAL_CAL=json.dumps(cal), BAL_SIZEK=json.dumps(sizek), BAL_OUT=f'{FIT}/r.json')
    subprocess.run(['node', 'scripts/balance.ts', 'army', seeds], cwd=REPO, env=env, stdout=open(f'{FIT}/b.txt', 'w'), check=True)
    rows = json.load(open(f'{FIT}/r.json'))
    baserate = {r['carrier']: r['rate'] for r in rows if r['base']}
    cen = sum(lg(r['rate']) for r in rows) / len(rows)
    acc = collections.defaultdict(lambda: [0.0, 0.0])
    sacc = collections.defaultdict(lambda: [0.0, 0.0])
    for r in rows:
        l = lg(r['rate']) - cen
        ws = [m for m in set(x for x in r['mounts'] if x) if MODS.get(m) == 'wpn']
        if r['module'] and MODS.get(r['module']) == 'util' and not r['base']:
            if r['carrier'] in baserate:
                acc[r['module']][0] += lg(r['rate']) - lg(baserate[r['carrier']])
                acc[r['module']][1] += 1
            continue
        if r['base']:
            continue
        if r['id'] in IGNORE:
            continue
        starter = r['id'].startswith('starter-')
        for w in ws:
            wgt = (1.0 / max(1, len(ws))) * (3.0 if starter else 1.0)
            acc[w][0] += l * wgt
            acc[w][1] += wgt
        neutral = r['id'].startswith('f-') or (starter and r['size'] <= 3)
        if neutral or (r['size'] <= 3 and r['module'] is None):
            sacc[r['size']][0] += l * (3.0 if starter else 1.0)
            sacc[r['size']][1] += (3.0 if starter else 1.0)
    for k, (s, w) in acc.items():
        if k in fixed or w == 0:
            continue
        t = 'u' if MODS.get(k) == 'util' else 'w'
        step = max(-0.15, min(0.15, ETA[t] * s / (w + 0.5)))
        v = cal.get(k, 1.0) * math.exp(step)
        v = v ** 0.99
        if t == 'u':
            v = min(4.0, max(0.25, v))
        cal[k] = v
    if fit_size:
        for z in (1, 3, 4, 5):
            s, w = sacc[z]
            if w == 0:
                continue
            step = max(-0.08, min(0.08, ETA['s'] * s / (w + 1.0)))
            sizek[z - 1] = max(0.4, min(2.5, sizek[z - 1] * math.exp(step)))
    mm = collections.defaultdict(list)
    for r in rows:
        if r['module'] and not r['base']:
            mm[r['module']].append(r['rate'])
    mr = math.sqrt(sum((sum(v) / len(v) - 0.5) ** 2 for v in mm.values()) / len(mm))
    inb = sum(1 for v in mm.values() if 0.35 <= sum(v) / len(v) <= 0.65)
    print(it, 'modrms', round(mr * 100, 1), 'inband', f'{inb}/{len(mm)}', 'sizek', [round(x, 3) for x in sizek], flush=True)
    json.dump(cal, open(calf, 'w'))
    json.dump(sizek, open(szf, 'w'))
