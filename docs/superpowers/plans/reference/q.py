exec(open('en.py').read().split('# ---- Simple')[0])
l,h='methanol','water'; xF=0.5
mix=lambda f,x,T: x*f(l,T)+(1-x)*f(h,T)
Tb,_=bubT(l,xF)
def dewT(y):
    lo,hi=250,420
    for _ in range(90):
        T=(lo+hi)/2; x=y
        for _ in range(80):
            g1,g2=gam(l,x,T); K1=g1*ps(l,T)/P0; K2=g2*ps(h,T)/P0
            a=y/K1; b=(1-y)/K2; x=a/(a+b)
        if y/K1+(1-y)/K2>1: lo=T
        else: hi=T
    return T
Td=dewT(xF)
HL=mix(hL,xF,Tb); HV=mix(hV,xF,Td)
cpV=xF*C[l][5]/1000+(1-xF)*C[h][5]/1000
print(f"Tbub={Tb-273.15:.3f} Tdew={Td-273.15:.3f}")
def q_at(TC):
    T=TC+273.15
    if T<=Tb: HF=mix(hL,xF,T)
    elif T>=Td: HF=HV+cpV*(T-Td)
    else:
        # flash by bisection on x such that bubble(x) at P equals T  -> liquid x, vapour y
        lo,hi=0.0,xF
        for _ in range(100):
            m=(lo+hi)/2
            if bubT(l,m)[0]>T: lo=m
            else: hi=m
        x=(lo+hi)/2; Tbx,y=bubT(l,x); beta=(xF-x)/(y-x)
        HF=(1-beta)*mix(hL,x,T)+beta*mix(hV,y,T)
    return (HV-HF)/(HV-HL)
for TC in (40.0,80.0,90.0,110.0):
    print(f"feedT={TC}: q={q_at(TC):.6f}")
