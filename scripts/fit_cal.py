import json,subprocess,math,sys,os,collections
sys.path.insert(0,'/tmp/claude-0')
MODS={}
import re
src=open('/home/user/autobattler-2/src/shared/parts.ts').read()
for m in re.finditer(r"(wpn|util)\(\{ id: '(\w+)'",src): MODS[m.group(2)]=m.group(1)
cal=json.load(open('/tmp/claude-0/cal2.json')) if os.path.exists('/tmp/claude-0/cal2.json') else {}
iters=int(sys.argv[1]); seeds=sys.argv[2] if len(sys.argv)>2 else '3'
fixed=set(sys.argv[3].split(',')) if len(sys.argv)>3 and sys.argv[3] else set()
ETA={'w':0.3,'c':0.07,'m':0.07,'u':0.3}
def lg(r):
    r=min(0.96,max(0.04,r)); return math.log(r/(1-r))
for it in range(iters):
    env=dict(os.environ,BAL_CAL=json.dumps(cal),BAL_OUT='/tmp/claude-0/r.json')
    subprocess.run(['node','scripts/balance.ts','army',seeds],cwd='/home/user/autobattler-2',env=env,stdout=open('/tmp/claude-0/b.txt','w'),check=True)
    rows=json.load(open('/tmp/claude-0/r.json'))
    baserate={r['carrier']:r['rate'] for r in rows if r['base']}
    acc=collections.defaultdict(lambda:[0.0,0.0]); 
    allp=[lg(r['rate']) for r in rows]; cen=sum(allp)/len(allp)
    dev=0;n=0
    for r in rows:
        l=lg(r['rate'])-cen; dev+=(r['rate']-0.5)**2;n+=1
        comps=[]
        ws=[m for m in set(x for x in r['mounts'] if x) if MODS.get(m)=='wpn' and m not in ('plateL',)]
        us=[m for m in set(x for x in r['mounts'] if x) if MODS.get(m)=='util']
        if r['module'] and MODS.get(r['module'])=='util' and not r['base']:
            if r['carrier'] in baserate:
                acc[r['module']][0]+=l+cen-lg(baserate[r['carrier']]); acc[r['module']][1]+=1
            continue
        comps=[(w,'w') for w in ws]+[('c:'+r['chassis'],'c'),('m:'+r['mobility'],'m')]
        # utility already in design (starters): ignore
        for (k,t) in comps:
            wgt=(1.0/ max(1,len(ws)) if t=='w' else 1.0)*(3.0 if r['id'].startswith('starter-') else 1.0)
            acc[k][0]+=l*wgt; acc[k][1]+=wgt
    for k,(s,w) in acc.items():
        if k in fixed or w==0 or k[:2] in ('c:','m:'): continue
        t='u' if k in MODS and MODS[k]=='util' else ('c' if k.startswith('c:') else 'm' if k.startswith('m:') else 'w')
        step=ETA[t]*s/(w+0.5)
        step=max(-0.15,min(0.15,step))
        v=cal.get(k,1.0)*math.exp(step)
        v=v**(0.97 if t in 'cm' else 0.99)
        if t=='u': v=min(4.0,max(0.25,v))
        cal[k]=v
    mm=collections.defaultdict(list)
    for r in rows:
        if r['module'] and not r['base']: mm[r['module']].append(r['rate'])
    mr=math.sqrt(sum((sum(v)/len(v)-0.5)**2 for v in mm.values())/len(mm))
    print(it,'modrms',round(mr*100,1),'rms',round(math.sqrt(dev/n)*100,1),flush=True)
    json.dump(cal,open('/tmp/claude-0/cal2.json','w'))
