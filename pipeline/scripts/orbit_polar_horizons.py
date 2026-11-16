# Owner: Abhinav
# Precomputes the south-pole terrain horizon maps used by web/src/features/orbit (24 azimuths, 0.1° units).
# Usage: python orbit_polar_horizons.py <dir containing H768.npy>   (H768.npy = LOLA 80 m heights resampled to 768x768 over the 80S disc)
# Writes dem.png, hor.png (+ illum inputs) into that dir; copy results to web/public/content/orbit/ as polar_*.png.
import numpy as np, time
from PIL import Image
import sys
base=sys.argv[1].replace('\\','/').rstrip('/')+'/'
H=np.load(base+'H768.npy').astype(np.float64)
N=768; R=1737400.0; px=608000.0/N
# --- DEM png (16-bit in R,G)
v=np.clip((H+8000)/16000*65535,0,65535).astype(np.uint16)
rgb=np.zeros((N,N,3),np.uint8); rgb[...,0]=v>>8; rgb[...,1]=v&255
Image.fromarray(rgb).save(base+'dem.png',optimize=True)
ix,iy=np.meshgrid(np.arange(N),np.arange(N))
X=((ix+0.5-N/2)*px).ravel(); Y=((N/2-(iy+0.5))*px).ravel(); Hf=H.ravel()
def nvec(X,Y):
    r=np.hypot(X,Y); th=2*np.arctan(r/(2*R)); lat=-np.pi/2+th; lon=np.arctan2(X,Y)
    return np.stack([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)],1)
n0=nvec(X,Y); P0=n0*(R+Hf)[:,None]
def samp(Xq,Yq):
    fx=Xq/px+N/2-0.5; fy=N/2-Yq/px-0.5
    ok=(fx>=0)&(fx<=N-1.001)&(fy>=0)&(fy<=N-1.001)
    fx=np.clip(fx,0,N-1.001); fy=np.clip(fy,0,N-1.001)
    x0=fx.astype(int); y0=fy.astype(int); ax=fx-x0; ay=fy-y0
    h=(H[y0,x0]*(1-ax)*(1-ay)+H[y0,x0+1]*ax*(1-ay)+H[y0+1,x0]*(1-ax)*ay+H[y0+1,x0+1]*ax*ay)
    return h,ok
K=24; M=56
ds=700.0*1.105**np.arange(M)
hor=np.zeros((K,N*N),np.uint8)
t0=time.time()
for k in range(K):
    a=np.radians(k*360.0/K); dx=np.sin(a); dy=np.cos(a)
    best=np.zeros(N*N)
    for d in ds:
        Xq=X+d*dx; Yq=Y+d*dy
        hq,ok=samp(Xq,Yq)
        if not ok.any(): break
        nq=nvec(Xq,Yq); Pq=nq*(R+hq)[:,None]
        V=Pq-P0; L=np.sqrt((V*V).sum(1))
        ang=np.degrees(np.arcsin(np.clip((V*n0).sum(1)/np.maximum(L,1),-1,1)))
        ang[~ok]=0
        np.maximum(best,ang,out=best)
    hor[k]=np.clip(best*10,0,255).astype(np.uint8)
    print(k,time.time()-t0,flush=True)
np.save(base+'hor.npy',hor)
# mosaic: 8 tiles (4 cols x 2 rows), each RGB = 3 azimuths
mos=np.zeros((N*2,N*4,3),np.uint8)
for t in range(8):
    r,c=divmod(t,4)
    for ch in range(3):
        mos[r*N:(r+1)*N,c*N:(c+1)*N,ch]=hor[3*t+ch].reshape(N,N)
Image.fromarray(mos).save(base+'hor.png',optimize=True)
# illumination map: fraction lit over a lunar month at subsolar lat -1 deg ; PSR = never lit for |lat|<=1.54
def lit(lons,dlat):
    d=np.radians(dlat); res=np.zeros(N*N)
    out=np.zeros(N*N,bool)
    for ls in lons:
        l=np.radians(ls)
        sv=np.array([np.cos(d)*np.cos(l),np.cos(d)*np.sin(l),np.sin(d)])
        el=np.degrees(np.arcsin(np.clip(n0@sv,-1,1)))
        az=(ls%360)/(360.0/K); k0=int(np.floor(az))%K; k1=(k0+1)%K; f=az-np.floor(az)
        h=(hor[k0]*(1-f)+hor[k1]*f)/10.0
        L=el>h+0.0
        res+=L; out|=L
    return res/len(lons),out
lons=np.arange(0,360,5.0)
frac,_=lit(lons,-1.0)
ever=np.zeros(N*N,bool)
for dl in (-1.54,0.0,1.54):
    _,o=lit(lons,dl); ever|=o
il=np.zeros((N,N,3),np.uint8)
il[...,0]=(frac*255).reshape(N,N).astype(np.uint8)
il[...,1]=((~ever)*255).reshape(N,N).astype(np.uint8)
Image.fromarray(il).save(base+'illum.png',optimize=True)
print('done',time.time()-t0)
