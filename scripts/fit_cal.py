"""Calibration driver for the cost model. Usage: python3 scripts/fit_cal.py ITERS [SEEDS] [FIXED,ids] [FIT_SIZE=1]

Each iteration runs `node scripts/balance.ts army SEEDS` with trial calibrations injected through the environment
(BAL_CAL = per-module table, BAL_SIZEK = size-class price factors), reads the per-design dump (BAL_OUT) and nudges
  - every weapon's calibration toward the mean win-rate logit of the designs that carry it,
  - every utility's calibration toward its win-rate delta against the same carrier without it,
  - the size-class factors (sizes 1,3,4,5; size 2 is the reference) toward the logit of neutral designs of that class
    (plain frames and starters; for giants/titans frames only, so G/T module fits are not mixed up with the class effect).
  - the mobility price factors (MOBILITY_CAL) toward the logit of plain frames of that drive relative to the other
    drives of the SAME chassis (within-chassis contrast, so hull outliers - fixed by hand in parts.ts - do not leak in).
State lives in $FIT_DIR (default /tmp/fit; pass FIT_DIR=/some/dir): cal.json, sizek.json, mobcal.json.
Env: BAL_FIELD_DIV=k makes each balance run k times faster (each design meets every k-th opponent).
Copy the final tables into MODULE_CAL / SIZE_K / MOBILITY_CAL in src/shared/stats.ts.
"""
import json, subprocess, math, sys, os, re, collections

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT = os.environ.get('FIT_DIR', '/tmp/fit')
os.makedirs(FIT, exist_ok=True)
MODS = {}
src = open(f'{REPO}/src/shared/parts.ts').read()
for m in re.finditer(r"(wpn|util)\(\{ id: '(\w+)'", src):
    MODS[m.group(2)] = m.group(1)
chf = f'{FIT}/chassis.json'
calf, szf, mbf = f'{FIT}/cal.json', f'{FIT}/sizek.json', f'{FIT}/mobcal.json'
cal = json.load(open(calf)) if os.path.exists(calf) else {}
sizek = json.load(open(szf)) if os.path.exists(szf) else [1, 1, 1, 1, 1]
chk = json.load(open(chf)) if os.path.exists(chf) else {}
mobcal = json.load(open(mbf)) if os.path.exists(mbf) else {}
iters = int(sys.argv[1])
seeds = sys.argv[2] if len(sys.argv) > 2 else '3'
fixed = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else set()
# [aura balance] aura calibrations are hand-set (see MODULE_CAL in stats.ts): the army test here fields armies where
# every unit carries the aura, and auras don't stack, so it would drive them toward zero.
fixed |= {'uplink', 'dome', 'domeG', 'jammer', 'sensor'}
fit_size = (sys.argv[4] if len(sys.argv) > 4 else '1') == '1'
# mixed AA/ground starters whose result mostly reflects the rock-paper-scissors of the field, not module value
IGNORE = {'starter-skyguard'}
BASE = json.load(open(os.environ.get('FIT_BASE', f'{FIT}/base_chassis.json')))  # untouched hull numbers
CHASSIS_MIN = 0.35
CGAIN = float(os.environ.get('FIT_CGAIN', '0.22'))
CSTEP = float(os.environ.get('FIT_CSTEP', '0.08'))
ONLY_CHASSIS = os.environ.get('FIT_ONLY_CHASSIS') == '1'  # frames-only run (filter f-): fit hulls + drives only
ETA = {'w': 0.3, 'u': 0.3, 's': 0.2, 'm': 0.25}
STEP_S = float(os.environ.get('FIT_STEP_S', '0.12'))


def lg(r):
    r = min(0.96, max(0.04, r))
    return math.log(r / (1 - r))


for it in range(iters):
    env = dict(os.environ, BAL_CAL=json.dumps(cal), BAL_SIZEK=json.dumps(sizek), BAL_MOBCAL=json.dumps(mobcal), BAL_CHASSIS=json.dumps({c: {'hp': v['hp'], 'cost': v['cost']} for c, v in chk.items()}), BAL_OUT=f'{FIT}/r.json')
    subprocess.run(['node', 'scripts/balance.ts', 'army', seeds] + (['f-'] if ONLY_CHASSIS else []), cwd=REPO, env=env, stdout=open(f'{FIT}/b.txt', 'w'), check=True)
    rows = json.load(open(f'{FIT}/r.json'))
    if ONLY_CHASSIS:
        rows = [r for r in rows if r['id'].startswith('f-')]
    baserate = {r['carrier']: r['rate'] for r in rows if r['base']}
    cen = sum(lg(r['rate']) for r in rows) / len(rows)
    acc = collections.defaultdict(lambda: [0.0, 0.0])
    sacc = collections.defaultdict(lambda: [0.0, 0.0])
    for r in rows:
        l = lg(r['rate']) - cen
        ws = [m for m in set(x for x in r['mounts'] if x) if MODS.get(m) == 'wpn']
        if r['module'] and MODS.get(r['module']) == 'util' and not r['base']:
            if r['carrier'] in baserate:
                # half the delta against the bare carrier, half the absolute distance from 50% (the module-band goal)
                acc[r['module']][0] += 0.5 * (lg(r['rate']) - lg(baserate[r['carrier']])) + 0.5 * (lg(r['rate']) - cen)
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
        if k in fixed or w == 0 or ONLY_CHASSIS:
            continue
        t = 'u' if MODS.get(k) == 'util' else 'w'
        step = max(-0.15, min(0.15, ETA[t] * s / (w + 0.5)))
        v = cal.get(k, 1.0) * math.exp(step)
        v = v ** 0.99
        if t == 'u':
            v = min(4.0, max(0.1, v))
        cal[k] = v
    if fit_size and not ONLY_CHASSIS:
        # all five classes are fitted toward 50%; the mean log-step is removed (a common factor on every price is a
        # gauge freedom: it leaves equal-supply fights unchanged)
        steps = {}
        for z in (1, 2, 3, 4, 5):
            s, w = sacc[z]
            if w == 0:
                continue
            steps[z] = max(-STEP_S, min(STEP_S, ETA['s'] * s / (w + 1.0)))
        if steps:
            mean_step = sum(steps.values()) / len(steps)
            for z, st in steps.items():
                sizek[z - 1] = max(0.4, min(2.5, sizek[z - 1] * math.exp(st - mean_step)))
    # mobility: within-chassis contrast of plain frames
    fr = [r for r in rows if r['id'].startswith('f-')]
    chl = collections.defaultdict(list)
    for r in fr:
        chl[r['chassis']].append(lg(r['rate']))
    macc = collections.defaultdict(lambda: [0.0, 0.0])
    for r in fr:
        n = len(chl[r['chassis']])
        if n < 2:
            continue
        res = lg(r['rate']) - sum(chl[r['chassis']]) / n
        w = n / (n - 1.0) # un-shrink the leave-in mean
        macc[r['mobility']][0] += res * w
        macc[r['mobility']][1] += 1
    for k, (s, w) in macc.items():
        if w == 0:
            continue
        step = max(-0.1, min(0.1, ETA['m'] * s / (w + 1.0)))
        mobcal[k] = max(0.4, min(2.5, mobcal.get(k, 1.0) * math.exp(step)))
    # hull price pressure (FIT_CHASSIS=1): plain-frame mean logit of each chassis relative to the mean of its size
    # class -> ln-price pressure p (too strong -> dearer). Realised through the hull's `cost` (a flat parts term worth
    # 0.3x in the unit price); when a discount would push cost under CHASSIS_MIN the rest comes from extra hull hp
    # (a weak lever: strength per supply only moves ~q^0.3).  chk[c] = {'p': pressure, 'hp': hp, 'cost': cost}
    if os.environ.get('FIT_CHASSIS') == '1':
        bysize = collections.defaultdict(list)
        price = collections.defaultdict(list)
        for r in fr:
            price[r['chassis']].append(r['unitCost'])
        for c, ls in chl.items():
            sz = next(r['size'] for r in fr if r['chassis'] == c)
            bysize[sz].append(sum(ls) / len(ls))
        for c, ls in chl.items():
            sz = next(r['size'] for r in fr if r['chassis'] == c)
            res = sum(ls) / len(ls) - sum(bysize[sz]) / len(bysize[sz])
            res *= len(ls) / (len(ls) + 1.0)
            st = chk.setdefault(c, {'p': 0.0, 'hp': BASE[c]['hp'], 'cost': BASE[c]['cost']})
            if abs(res) < 0.1:
                continue
            st['p'] = max(-0.9, min(0.9, st['p'] + max(-CSTEP, min(CSTEP, CGAIN * res))))
            P = sum(price[c]) / len(price[c]) / math.exp(0.0)  # current mean unit price (already includes the current p)
            P0 = P  # price at the current realisation; Delta is relative to the base realisation below
            # price at base (p=0) is P / (1 + dprice/P0): recover it from the current cost delta
            dcost = st['cost'] - BASE[c]['cost']
            hpq = st['hp'] / BASE[c]['hp']
            Pbase = P0 - dcost * 0.3 * sizek[BASE[c]['size'] - 1]  # approx: ignores the (weak) hp contribution
            Pbase = max(Pbase, 0.4 * P0)
            want = Pbase * math.exp(st['p']) - Pbase  # desired absolute price delta
            dc = want / (0.3 * sizek[BASE[c]['size'] - 1])
            cost = BASE[c]['cost'] + dc
            hp = BASE[c]['hp']
            if cost < CHASSIS_MIN * BASE[c]['cost']:
                short = (CHASSIS_MIN * BASE[c]['cost'] - cost) * 0.3 * sizek[BASE[c]['size'] - 1]
                cost = CHASSIS_MIN * BASE[c]['cost']
                hp = BASE[c]['hp'] * min(1.8, math.exp(-math.log(max(0.3, 1 - short / Pbase)) / 0.15 * 0.5))
            st['cost'] = round(cost)
            st['hp'] = round(hp)
    mm = collections.defaultdict(list)
    for r in rows:
        if r['module'] and not r['base']:
            mm[r['module']].append(r['rate'])
    mr = math.sqrt(sum((sum(v) / len(v) - 0.5) ** 2 for v in mm.values()) / max(1, len(mm)))
    inb = sum(1 for v in mm.values() if 0.35 <= sum(v) / len(v) <= 0.65)
    print(it, 'modrms', round(mr * 100, 1), 'inband', f'{inb}/{len(mm)}', 'sizek', [round(x, 3) for x in sizek], flush=True)
    json.dump(cal, open(calf, 'w'))
    json.dump(sizek, open(szf, 'w'))
    json.dump(mobcal, open(mbf, 'w'))
    json.dump(chk, open(chf, 'w'))
