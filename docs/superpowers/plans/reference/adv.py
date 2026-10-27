import math
exec(open('nrtl.py').read().split('data=')[0])
P0=1.01325
def bubT(c,x,P=P0):
    lo,hi=250,420
    for _ in range(90):
        T=(lo+hi)/2; g1,g2=gam(c,x,T)
        if x*g1*ps(c,T)+(1-x)*g2*ps('water',T)>P: hi=T
        else: lo=T
    g1,g2=gam(c,x,T); return T, x*g1*ps(c,T)/P
def yeq(c,x): return bubT(c,x)[1]
def xeq(c,y):  # invert monotone y(x) by bisection on x
    lo,hi=0.0,1.0
    for _ in range(80):
        m=(lo+hi)/2
        if yeq(c,m)<y: lo=m
        else: hi=m
    return (lo+hi)/2
def step(c,xF,xD,xB,R,q=1.0):
    rs,ri=R/(R+1),xD/(R+1); xi=xF; yi=rs*xi+ri; ss=(yi-xB)/(xi-xB)
    y=xD; xprev=xD; n=0; feed=None; stages=[]
    while n<200:
        x=xeq(c,y); n+=1; stages.append((n,x,y,bubT(c,x)[0]-273.15))
        if feed is None and x<=xi: feed=n
        if x<=xB: return n-1+(xprev-xB)/(xprev-x), n, feed, stages
        y= rs*x+ri if x>xi else ss*(x-xB)+xB; xprev=x
def rmin_pinch(c,xF,xD,xB,q=1.0):
    # smallest R s.t. both operating lines stay below eq curve on [xB,xD] (q=1)
    def ok(R):
        rs,ri=R/(R+1),xD/(R+1); yi=rs*xF+ri; ss=(yi-xB)/(xF-xB)
        if yi>=yeq(c,xF): return False
        for i in range(1,400):
            x=xB+(xD-xB)*i/400
            yo= rs*x+ri if x>=xF else ss*(x-xB)+xB
            if yo>=yeq(c,x)-1e-9: return False
        return True
    lo,hi=0.0,50.0
    for _ in range(50):
        m=(lo+hi)/2
        if ok(m): hi=m
        else: lo=m
    return hi
def nmin_total(c,xD,xB):
    y=xD; xprev=xD; n=0
    while n<200:
        x=xeq(c,y); n+=1
        if x<=xB: return n-1+(xprev-xB)/(xprev-x)
        y=x; xprev=x
Nf,N,fs,st=step('methanol',0.5,0.95,0.05,2.5)
print(f"MeOH-H2O adv xF.5 xD.95 xB.05 R2.5 q1: Nfrac={Nf:.3f} N={N} feed={fs}")
for s in st: print("   stage %d x=%.4f y=%.4f T=%.2f"%s)
print("  Rmin pinch=%.4f  Nmin(total reflux)=%.3f"%(rmin_pinch('methanol',0.5,0.95,0.05),nmin_total('methanol',0.95,0.05)))
# q-line-intersection-only Rmin vs true pinch for ethanol-water
xF,xD,xB=0.1,0.8,0.02
yi=yeq('ethanol',xF); s=(xD-yi)/(xD-xF); Rq=s/(1-s)
print("EtOH-H2O xF.1 xD.8: Rmin(q-line intersection only)=%.4f  Rmin(true pinch)=%.4f"%(Rq,rmin_pinch('ethanol',xF,xD,xB)))
print("EtOH-H2O Nmin total reflux xD.8 xB.02 = %.3f"%nmin_total('ethanol',0.8,0.02))
