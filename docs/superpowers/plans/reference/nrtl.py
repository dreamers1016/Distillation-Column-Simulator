import math
ANT={'water':(5.08354,1663.125,-45.622),'methanol':(5.20409,1581.341,-33.50),'ethanol':(5.24677,1598.673,-46.424),
     'acetone':(4.42448,1312.253,-32.445),'ipa':(4.8610,1357.427,-75.814)}
def ps(c,TK): A,B,C=ANT[c]; return 10**(A-B/(TK+C))
# Aspen-style NRTL: tau_ij = a_ij + b_ij/T, alpha=c ; i = organic, j = water
P_={'methanol':(-0.693,2.7322,172.987,-617.269,0.3),'ethanol':(-0.8009,3.4578,246.18,-586.0809,0.3),
    'acetone':(0.0544,6.3981,419.972,-1808.99,0.3),'ipa':(-1.3115,6.8284,426.398,-1483.46,0.3)}
def gam(c,x1,T):
    a12,a21,b12,b21,al=P_[c]; t12=a12+b12/T; t21=a21+b21/T
    G12=math.exp(-al*t12); G21=math.exp(-al*t21); x2=1-x1
    g1=x2**2*(t21*(G21/(x1+x2*G21))**2+t12*G12/(x2+x1*G12)**2)
    g2=x1**2*(t12*(G12/(x2+x1*G12))**2+t21*G21/(x1+x2*G21)**2)
    return math.exp(g1),math.exp(g2)
def bub(c,x,P=1.01325):
    lo,hi=250,400
    for _ in range(80):
        T=(lo+hi)/2; g1,g2=gam(c,x,T); f=x*g1*ps(c,T)+(1-x)*g2*ps('water',T)
        if f>P: hi=T
        else: lo=T
    g1,g2=gam(c,x,T); y=x*g1*ps(c,T)/P
    return T-273.15,y
data={'methanol':[(0.1,87.7,.418),(0.2,81.7,.579),(0.3,78.0,.665),(0.4,75.3,.729),(0.5,73.1,.779),(0.6,71.2,.825),(0.7,69.3,.870),(0.8,67.5,.915),(0.9,66.0,.958)],
      'ethanol':[(.0721,89.0,.3891),(.1238,85.3,.4704),(.2337,82.7,.5445),(.3273,81.5,.5826),(.5079,79.8,.6564),(.6763,78.74,.7385),(.7472,78.41,.7815),(.8943,78.15,.8943)]}
for c,pts in data.items():
    errs=[]
    for x,T,y in pts:
        Tc,yc=bub(c,x); errs.append(abs(Tc-T)); print(f"{c:8} x={x:.4f} T={Tc:6.2f} (exp {T}) y={yc:.3f} (exp {y})")
    print(c,"MAE T =",round(sum(errs)/len(errs),2))
for c in ('ethanol','ipa','acetone'):
    best=None
    for i in range(1,999):
        x=i/1000; T,y=bub(c,x)
        if best is None or abs(y-x)<best[0]: best=(abs(y-x),x,T)
    print(c,"min|y-x| at x=%.3f T=%.2f gap=%.4f"%(best[1],best[2],best[0]))
for x in (0.05,0.1,0.2,0.5,0.8):
    print('acetone',x,[round(v,3) for v in bub('acetone',x)])
