import math
exec(open('nrtl.py').read().split('data=')[0])
ANT.update({'benzene':(4.01814,1203.835,-53.226),'toluene':(4.07827,1343.943,-53.773),'hexane':(4.00266,1171.53,-48.784),'heptane':(4.02832,1268.636,-56.199)})
def bub_ideal(l,h,x,P=1.01325):
    lo,hi=200,450
    for _ in range(80):
        T=(lo+hi)/2
        if x*ps(l,T)+(1-x)*ps(h,T)>P: hi=T
        else: lo=T
    return T
def alpha_ideal(l,h,x): T=bub_ideal(l,h,x); return ps(l,T)/ps(h,T), T-273.15
def alpha_nrtl(c,x):
    lo,hi=250,400
    for _ in range(80):
        T=(lo+hi)/2; g1,g2=gam(c,x,T)
        if x*g1*ps(c,T)+(1-x)*g2*ps('water',T)>1.01325: hi=T
        else: lo=T
    g1,g2=gam(c,x,T); return g1*ps(c,T)/(g2*ps('water',T)), T-273.15
print("Simple-mode alpha = sqrt(a(xD=0.95)*a(xB=0.05)), 1 atm")
for nm,f in [('benzene-toluene',lambda x:alpha_ideal('benzene','toluene',x)),('hexane-heptane',lambda x:alpha_ideal('hexane','heptane',x)),
             ('methanol-ethanol',lambda x:alpha_ideal('methanol','ethanol',x)),('methanol-water',lambda x:alpha_nrtl('methanol',x))]:
    aD,TD=f(0.95); aB,TB=f(0.05); print(f"  {nm:17} aD={aD:.4f} aB={aB:.4f} alpha={math.sqrt(aD*aB):.4f}  Ttop={TD:.2f} Tbot={TB:.2f}")
# Constant-alpha McCabe-Thiele reference (independent implementation)
def mt(a,xF,xD,xB,R,q):
    eq_x=lambda y: y/(a-(a-1)*y)
    rs,ri=R/(R+1),xD/(R+1)
    if abs(q-1)<1e-12: xi=xF
    else:
        qs=q/(q-1); qi=-xF/(q-1); xi=(qi-ri)/(rs-qs)
    yi=rs*xi+ri; ss=(yi-xB)/(xi-xB)
    y=xD; xprev=xD; n=0; feed=None
    while True:
        x=eq_x(y); n+=1
        if feed is None and x<=xi: feed=n
        if x<=xB: return n-1+(xprev-xB)/(xprev-x), n, feed
        y = rs*x+ri if x>xi else ss*(x-xB)+xB
        xprev=x
for case in [(2.5,0.5,0.95,0.05,2.0,1.0),(2.5,0.5,0.95,0.05,2.0,0.5),(2.5,0.5,0.95,0.05,2.0,1.2),(2.5,0.4,0.98,0.02,3.0,1.0)]:
    Nf,N,fs=mt(*case); a,xF,xD,xB,R,q=case
    Rmin_U=(1/(a-1))*(xD/xF-a*(1-xD)/(1-xF))
    Nmin=math.log(xD/(1-xD)*(1-xB)/xB)/math.log(a)
    print(f"MT a={a} xF={xF} xD={xD} xB={xB} R={R} q={q}: Nfrac={Nf:.4f} Nint={N} feedStage={fs} Nmin={Nmin:.4f}" + (f" RminUnderwood={Rmin_U:.4f}" if q==1 else ""))
# Rmin by pinch for q != 1 (q-line intersection with eq curve)
def rmin_pinch(a,xF,xD,q):
    if abs(q-1)<1e-12: xp=xF
    else:
        f=lambda x: a*x/(1+(a-1)*x) - (q/(q-1)*x - xF/(q-1))
        lo,hi=1e-9,1-1e-9
        for _ in range(200):
            m=(lo+hi)/2
            if f(lo)*f(m)<=0: hi=m
            else: lo=m
        xp=m
    yp=a*xp/(1+(a-1)*xp); s=(xD-yp)/(xD-xp); return s/(1-s), xp, yp
for q in (1.0,0.5,1.2):
    print("Rmin pinch a=2.5 xF=0.5 xD=0.95 q=%s: Rmin=%.4f (xp=%.4f yp=%.4f)"%((q,)+rmin_pinch(2.5,0.5,0.95,q)))
