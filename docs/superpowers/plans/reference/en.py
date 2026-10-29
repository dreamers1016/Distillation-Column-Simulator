import math
exec(open('adv.py').read().split('Nf,N,fs,st')[0])
# component data: MW, Tb K, Tc K, lam_Tb kJ/mol, cpL J/molK, cpV J/molK
C={'methanol':(32.042,337.8,512.6,35.21,81.1,44.1),'water':(18.015,373.15,647.1,40.66,75.3,33.6),
   'benzene':(78.11,353.2,562.0,30.72,136.0,82.4),'toluene':(92.14,383.8,591.8,33.18,157.0,103.6)}
Tref=298.15
def lam(c,T): MW,Tb,Tc,l,_,_=C[c]; return l*((1-T/Tc)/(1-Tb/Tc))**0.38   # Watson, kJ/mol
def hL(c,T): return C[c][4]*(T-Tref)/1000                                # kJ/mol
def hV(c,T): return hL(c,T)+lam(c,T)
# ---- Simple: benzene-toluene F=1000 kg/h xF.5 xD.95 xB.05 R2 q1
l,h='benzene','toluene'; xF,xD,xB,R,q=0.5,0.95,0.05,2.0,1.0
MWF=xF*C[l][0]+(1-xF)*C[h][0]; F=1000/MWF; D=F*(xF-xB)/(xD-xB); B=F-D
V=(R+1)*D; Vp=V-(1-q)*F; lamS=(C[l][3]+C[h][3])/2
print(f"SIMPLE BT: Fmol={F:.4f} D={D:.4f} B={B:.4f} V={V:.4f} lam={lamS:.3f} Qc={V*lamS/3.6:.3f} kW Qr={Vp*lamS/3.6:.3f} kW Dmass={D*(xD*C[l][0]+(1-xD)*C[h][0]):.3f} Bmass={B*(xB*C[l][0]+(1-xB)*C[h][0]):.3f}")
# ---- Advanced: methanol-water F=1000 kg/h xF.5 xD.95 xB.05 R2.5, feed at its bubble point (q=1), P=1 atm
l,h='methanol','water'; xF,xD,xB,R=0.5,0.95,0.05,2.5
MWF=xF*C[l][0]+(1-xF)*C[h][0]; F=1000/MWF; D=F*(xF-xB)/(xD-xB); B=F-D; V=(R+1)*D
TD,_=bubT(l,xD); TB,_=bubT(l,xB); TF,_=bubT(l,xF)
# dew point of xD vapour (top vapour y=xD)
def dewT(y):
    lo,hi=250,420
    for _ in range(90):
        T=(lo+hi)/2
        # x from y: iterate
        x=y
        for _ in range(60):
            g1,g2=gam(l,x,T); K1=g1*ps(l,T)/P0; K2=g2*ps(h,T)/P0
            xn=y/K1; x2=(1-y)/K2; x=xn/(xn+x2)
        s=y/K1+(1-y)/K2
        if s>1: lo=T
        else: hi=T
    return T
Ttop=dewT(xD)
mix=lambda f,x,T: x*f(l,T)+(1-x)*f(h,T)
Qc=V*(mix(hV,xD,Ttop)-mix(hL,xD,TD))/3.6
hD=mix(hL,xD,TD); hB=mix(hL,xB,TB); hF=mix(hL,xF,TF)
Qr=Qc+(D*hD+B*hB-F*hF)/3.6
Vp=V; CMO=Vp*mix(lam,xB,TB)/3.6
print(f"ADV MeOH: Fmol={F:.4f} D={D:.4f} V={V:.4f} TD={TD-273.15:.2f} Ttop_dew={Ttop-273.15:.2f} TB={TB-273.15:.2f} TF={TF-273.15:.2f}")
print(f"   Qc={Qc:.2f} kW  Qr={Qr:.2f} kW  V'*lam_bot={CMO:.2f} kW  CMO gap={(Qr-CMO)/Qr*100:.2f} %")
