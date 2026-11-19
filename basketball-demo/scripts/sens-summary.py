"""汇总并行跑出来的敏感度结果：python scripts/sens-summary.py <轮次名>，读取 .sim/out-<轮次名>-*.txt，合并所有基线后给出每项净胜分。"""
import sys,re,glob,collections
rnd=sys.argv[1]
base=[];rows=collections.defaultdict(list);t=[]
for f in sorted(glob.glob(f'.sim/out-{rnd}-*.txt')):
    for line in open(f,encoding='utf-8'):
        m=re.match(r'基线.*?(\d+) 场：蓝 ([\d.]+) : ([\d.]+) 红，净胜 ([+-][\d.]+)',line)
        if m: base.append((float(m.group(2)),float(m.group(3)),float(m.group(4))))
        m=re.match(r'(篮下投篮|中距离投篮|三分投篮|篮板|助攻|禁区防守|外线防守|稳定性)\s+(.*)',line)
        if m: rows[m.group(1)].append([float(x) for x in m.group(2).split()])
        m=re.match(r'用时 (\d+)',line)
        if m: t.append(int(m.group(1)))
bm=sum(b[2] for b in base)/len(base)
print(f'基线 {len(base)} 份: 蓝 {sum(b[0] for b in base)/len(base):.1f} 红 {sum(b[1] for b in base)/len(base):.1f} 净胜 {bm:+.2f}  用时 {max(t) if t else 0}s')
for k in ['篮下投篮','中距离投篮','三分投篮','助攻','禁区防守','外线防守','篮板','稳定性']:
    v=rows[k]
    if not v: continue
    n=len(v)
    absm=sum(x[1] for x in v)/n
    bp=sum(x[2] for x in v)/n; rp=sum(x[3] for x in v)/n
    print(f'{k:6s} 净胜(合并基线) {absm-bm:+5.1f}   各份 {" ".join(f"{x[1]:+.1f}" for x in v)}   蓝得分 {bp:+.1f} 红得分 {rp:+.1f}')
