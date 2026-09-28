"""Score + sound design for the reel. 120 BPM, 5 bars, every SFX driven by cues.json
(exported from the animation), so picture and sound can never drift apart."""
import json, sys
import numpy as np
import scipy.signal as sg

SR = 48000
DUR = 10.0
N = int(SR * DUR)
B = 0.5          # beat (s)
S = B / 4        # 16th
cues = json.load(open('cues.json'))
rng = np.random.default_rng(11)

def T(d): return np.arange(int(round(d * SR))) / SR
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def sos(kind, fc, order=2): return sg.butter(order, fc, kind, fs=SR, output='sos')
def hp(x, fc, o=2): return sg.sosfilt(sos('highpass', fc, o), x)
def lp(x, fc, o=2): return sg.sosfilt(sos('lowpass', fc, o), x)
def bp(x, lo, hi, o=2): return sg.sosfilt(sos('bandpass', [lo, hi], o), x)
def noise(d): return rng.standard_normal(int(round(d * SR)))

def nz(x):
    m = np.max(np.abs(x)); return x / m if m > 0 else x

class Bus:
    def __init__(self): self.x = np.zeros((2, N))
    def add(self, sig, t0, g=1.0, p=0.0, norm=True):
        sig = np.asarray(sig, dtype=float)
        if norm: sig = nz(sig)
        if sig.ndim == 1:
            a = (p + 1) * np.pi / 4
            sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
        i0 = int(round(t0 * SR))
        if i0 < 0: sig = sig[:, -i0:]; i0 = 0
        n = min(sig.shape[1], N - i0)
        if n > 0: self.x[:, i0:i0 + n] += g * sig[:, :n]

drums, bass, pad, music, sfx, verb_send = Bus(), Bus(), Bus(), Bus(), Bus(), Bus()

# ---------------------------------------------------------------- instruments
def kick(f0=160, f1=46, pd=0.032, decay=0.30, click=0.6):
    t = T(0.7)
    f = f1 + (f0 - f1) * np.exp(-t / pd)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay) * (1 - np.exp(-t / 0.001))
    c = hp(noise(0.7) * np.exp(-t / 0.0035), 2000) * click * 0.35
    return np.tanh(1.8 * (body + c)) / np.tanh(1.8)

def clap(tail=0.13):
    t = T(0.6); env = np.zeros_like(t)
    for off in (0.0, 0.010, 0.021):
        env += np.where(t >= off, np.exp(-np.clip(t - off, 0, None) / 0.005), 0)
    env += np.where(t >= 0.028, 0.7 * np.exp(-np.clip(t - 0.028, 0, None) / tail), 0)
    return bp(noise(0.6), 900, 3200) * env * 1.6

def hat(decay=0.035):
    t = T(0.4)
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (317, 450, 565, 731, 822, 1016)) / 6
    x = hp(0.6 * noise(0.4) + 0.4 * metal, 7200, 3)
    return x * np.exp(-t / decay)

def crash(d=1.8):
    t = T(d)
    return hp(noise(d), 5200, 2) * np.exp(-t / 0.32) * (1 - np.exp(-t / 0.002))

def fm(freq, d=0.6, ratio=2.0, index=2.2, idec=0.08, dec=0.35, att=0.0015):
    t = T(d)
    I = index * np.exp(-t / idec)
    y = np.sin(2 * np.pi * freq * t + I * np.sin(2 * np.pi * freq * ratio * t))
    return y * np.exp(-t / dec) * (1 - np.exp(-t / att))

def pop(f0=900, d=0.12):
    t = T(d)
    f = f0 * (1 + 1.2 * np.exp(-t / 0.012))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * (1 - np.exp(-t / 0.0008))

def thump(f0=140, f1=55, d=0.35, dec=0.09):
    t = T(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec) * (1 - np.exp(-t / 0.001))

def tick(fc=4200, d=0.03, dec=0.004):
    t = T(d)
    return bp(noise(d), fc * 0.7, min(fc * 1.4, 20000)) * np.exp(-t / dec)

def bounce(v=1.0):
    t = T(0.25)
    f = 95 + 230 * np.exp(-t / 0.018)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.0007))
    return (body + 0.25 * tick(2500, 0.25, 0.003)) * v

def sweep(d, f0, f1, q=0.45, shape=None, seed_noise=None):
    """Band of noise whose centre glides f0 -> f1 (log). shape: amplitude envelope over [0,1]."""
    n = seed_noise if seed_noise is not None else noise(d)
    f, tt, Z = sg.stft(n, SR, nperseg=1024)
    u = np.clip(tt / d, 0, 1)
    fc = f0 * (f1 / f0) ** u
    ff = np.maximum(f[:, None], 1.0)
    Z = Z * np.exp(-0.5 * (np.log(ff / fc[None, :]) / q) ** 2)
    _, y = sg.istft(Z, SR, nperseg=1024)
    y = y[:len(n)]
    uu = np.linspace(0, 1, len(y))
    env = shape(uu) if shape else np.sin(np.pi * uu) ** 1.5
    return y * env / (np.max(np.abs(y)) + 1e-9)

def scribble(points):
    """Marker-on-paper texture following the pen speed curve [(t, px/frame)]."""
    ts = np.array([p[0] for p in points]); vs = np.array([p[1] for p in points])
    d = ts[-1] + 0.1; t = T(d)
    v = np.interp(t, ts, vs); v = np.clip(v / 60.0, 0, 1.4)
    grain = 0.6 + 0.4 * np.abs(lp(noise(d), 40)) / 0.2
    x = bp(noise(d), 2400, 6500, 2) * v * np.clip(grain, 0, 1.5)
    x += 0.4 * bp(noise(d), 700, 1500, 1) * v
    return x

def pad_voice(freqs, t0, t1, att=0.25, rel=0.5, fc=None, det=6.0):
    """Detuned additive saw stack with a time-varying spectral lowpass. Returns (2, n) from t0."""
    d = t1 - t0 + rel; t = T(d); n = len(t)
    out = np.zeros((2, n))
    fcv = fc(t0 + t) if fc else np.full(n, 1800.0)
    env = np.minimum(1, t / att) * np.where(t > t1 - t0, np.exp(-(t - (t1 - t0)) / (rel / 3)), 1)
    for ch, cs in enumerate((-1, 1)):
        for v, dv in enumerate((-1, 0, 1)):
            for fq in freqs:
                f = fq * 2 ** ((cs * det + dv * det * 0.7) / 1200)
                ph = rng.uniform(0, 2 * np.pi)
                for h in range(1, 40):
                    fh = f * h
                    if fh > 9000: break
                    amp = (1.0 / h) / (1 + (fh / fcv) ** 4)
                    out[ch] += amp * np.sin(2 * np.pi * fh * t + ph * h)
    return out * env / 6.0

# ---------------------------------------------------------------- harmony
CH = {
    'Fmaj9':  [53, 57, 60, 64, 67], 'Dm9': [50, 53, 57, 60, 64], 'Bbmaj9': [46, 53, 57, 60, 64, 69],
    'C9sus':  [48, 53, 58, 62, 67], 'C9': [48, 52, 58, 62, 67],
}
ROOT = {'Fmaj9': 41, 'Dm9': 38, 'Bbmaj9': 34, 'C9sus': 36, 'C9': 36}
PROG = [(0, 2, 'Fmaj9'), (2, 4, 'Dm9'), (4, 6, 'Bbmaj9'), (6, 7.5, 'C9sus'), (7.5, 8, 'C9'), (8, 10, 'Fmaj9')]

def brightness(t):
    t = np.asarray(t)
    return np.interp(t, [0, 1.9, 2.0, 4.0, 5.0, 5.2, 5.9, 6.0, 7.9, 8.0, 10], [500, 1200, 1500, 1900, 2000, 3600, 3800, 1100, 3000, 2600, 800])

# ---------------------------------------------------------------- arrangement
# PAD
padlvl = {0: 0.55, 2: 0.7, 4: 0.75, 6: 0.6, 7.5: 0.7, 8: 1.0}
for t0, t1, name in PROG:
    v = pad_voice([mtof(m) for m in CH[name]], t0, t1, att=0.9 if t0 == 0 else 0.06, rel=1.6 if t0 == 8 else 0.25, fc=brightness)
    if t0 == 8:
        tt_ = np.arange(v.shape[1]) / SR
        v = v * (0.45 + 0.55 * np.exp(-tt_ / 0.9))
    pad.add(v, t0, padlvl[t0], norm=False)

# PLUCK ARPS
def arp(name, t0, t1, step, pattern, oct=12, vel=0.26, pan_w=0.5, dec=0.3):
    notes = [m + oct for m in CH[name]]
    k = 0; t = t0
    while t < t1 - 1e-6:
        m = notes[pattern[k % len(pattern)] % len(notes)] + (12 if pattern[k % len(pattern)] >= len(notes) else 0)
        acc = 1.0 if k % 4 == 0 else 0.7
        music.add(fm(mtof(m), 0.7, 2.0, 2.0, 0.06, dec), t, vel * acc, pan_w * np.sin(k * 1.3))
        verb_send.add(fm(mtof(m), 0.7, 2.0, 2.0, 0.06, dec), t, vel * acc * 0.35, pan_w * np.sin(k * 1.3))
        k += 1; t += step
arp('Fmaj9', 0.5, 1.75, B / 2, [0, 1, 2, 3, 4, 5, 6, 7], vel=0.16)          # rises as the pen writes
arp('Dm9', 2.0, 3.5, S, [0, 2, 4, 2, 1, 3, 5, 3], vel=0.09)
arp('Bbmaj9', 4.0, 4.75, S, [0, 2, 4, 5, 3, 4, 2, 1], vel=0.09)
arp('C9sus', 6.0, 7.5, B / 2, [0, 2, 4, 3], vel=0.08, oct=12)

# SPACE sparkle: lydian bells, blooming at 5.0
for k, m in enumerate([70, 72, 74, 76, 77, 81, 82, 84, 86, 88]):
    t = 5.0 + k * 0.035
    b = fm(mtof(m), 1.6, 3.5, 1.4, 0.25, 0.9)
    music.add(b, t, 0.07, np.sin(k * 2.1) * 0.8); verb_send.add(b, t, 0.12, np.sin(k * 2.1) * 0.8)
for k in range(14):
    t = 5.25 + k * 0.052 + rng.uniform(0, 0.02); m = [82, 84, 86, 88, 89, 93][k % 6]
    b = fm(mtof(m), 1.2, 3.5, 1.0, 0.2, 0.6)
    music.add(b, t, 0.035, rng.uniform(-0.9, 0.9)); verb_send.add(b, t, 0.06, rng.uniform(-0.9, 0.9))

# BASS: root with harmonics so it survives phone speakers
def bassnote(m, d, g=1.0):
    t = T(d + 0.08); f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    env = np.minimum(1, t / 0.006) * np.where(t > d, np.exp(-(t - d) / 0.02), 1) * np.exp(-t / (d * 2.5))
    return np.tanh(1.1 * x * env) * g
for i in range(8):                                  # bar 2: offbeat house bass
    t = 2.0 + i * B / 2 + B / 4
    bass.add(bassnote(ROOT['Dm9'] + (12 if i % 4 == 3 else 0), 0.16), t, 0.3)
for i in range(6):                                  # bar 3 up to the tilt
    t = 4.0 + i * B / 2 + (0 if i == 0 else B / 4)
    bass.add(bassnote(ROOT['Bbmaj9'] + (12 if i % 3 == 2 else 0), 0.16 if i else 0.3), t, 0.32)
bass.add(bassnote(ROOT['C9sus'], 0.9), 6.0, 0.38)
bass.add(bassnote(ROOT['C9sus'], 0.4), 7.0, 0.32)
bass.add(bassnote(ROOT['C9'], 0.35), 7.5, 0.3)
bass.add(bassnote(ROOT['Fmaj9'], 1.1), 8.0, 0.4)

# DRUMS
kicks = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 6.0, 7.0, 8.0]
for t in kicks: drums.add(kick(), t, 0.8 if t in (2.0, 4.0, 6.0, 8.0) else 0.62)
for t in (2.5, 3.5, 4.5, 7.0): drums.add(clap(), t, 0.3, 0.05); verb_send.add(clap(), t, 0.12)
for i in range(16):                                 # bar 2 hats
    t = 2.0 + i * S
    drums.add(hat(0.09 if i % 4 == 2 else 0.03), t, (0.09 if i % 4 == 2 else 0.04), 0.25 * np.sin(i))
for i in range(12):                                 # bar 3 hats, until the tilt
    t = 4.0 + i * S
    drums.add(hat(0.03), t, 0.06 if i % 2 else 0.035, 0.3 * np.sin(i * 0.7))
for i in range(4): drums.add(hat(0.025), 1.5 + i * S, 0.015 + 0.012 * i, -0.2)   # pickup into bar 2
for i in range(4): drums.add(hat(0.04), 6.0 + i * B / 2 + B / 4, 0.05, 0.3)    # bar 4 offbeats
for i, t in enumerate(np.concatenate([np.arange(7.5, 7.75, S), np.arange(7.75, 7.875, S / 2)])):   # roll into the downbeat
    drums.add(clap(0.05), t, 0.05 + 0.025 * i, 0.1 * (-1) ** i)
drums.add(crash(1.2), 2.0, 0.07, -0.3)
drums.add(crash(1.6), 8.0, 0.09, 0.25)

# ---------------------------------------------------------------- sound design (all cue-driven)
# chapter 1
sfx.add(pop(880), 0.0, 0.3); sfx.add(thump(110, 50, 0.3, 0.1), 0.0, 0.4); verb_send.add(pop(880), 0.0, 0.12)
sfx.add(sweep(0.22, 600, 2600, 0.5), 0.30, 0.05, -0.3)                  # hop takeoff
sfx.add(fm(mtof(79), 0.25, 1.0, 3.0, 0.03, 0.08), 0.30, 0.07, -0.3)
sfx.add(thump(170, 70, 0.2, 0.05), 0.5, 0.25, -0.4); sfx.add(tick(3000), 0.5, 0.05, -0.4)   # lands on the baseline
sfx.add(sweep(0.3, 900, 5000, 0.45), 0.567, 0.05, -0.2)                 # launch
sfx.add(scribble(cues['pen']), 0.0, 0.022, 0.1)
sfx.add(fm(mtof(96), 0.6, 3.5, 1.5, 0.05, 0.25), 1.5, 0.08, -0.1); verb_send.add(fm(mtof(96), 0.6, 3.5, 1.5, 0.05, 0.25), 1.5, 0.08)   # i-dot
sfx.add(sweep(0.4, 400, 6000, 0.5, lambda u: u ** 2.2 * (u < 0.97)), 1.60, 0.09, 0.2)   # route whip
sfx.add(thump(90, 38, 0.8, 0.3), 2.0, 0.4); sfx.add(sweep(0.35, 5000, 700, 0.6, lambda u: (1 - u) ** 2), 2.0, 0.06)   # iris
# chapter 2
PENT = [74, 77, 79, 81, 84, 86, 89, 91]
for t, dd in cues['dots']:
    m = PENT[min(len(PENT) - 1, int(dd * 1.6))]
    sfx.add(pop(mtof(m) * 0.5, 0.08), t, 0.045, np.clip((rng.uniform(-1, 1)) * 0.7, -1, 1))
for t, dd in cues['morph'][::3]: sfx.add(tick(5000, 0.03, 0.006), t + 0.01, 0.02, rng.uniform(-0.7, 0.7))
sfx.add(sweep(0.4, 3000, 500, 0.5), 2.43, 0.05, 0.3)                    # morph swish
for k in range(7): sfx.add(tick(2200 + 300 * k, 0.03, 0.005), 2.67 + k * 0.045, 0.035, -0.5 + k * 0.16)   # rotation ratchet
sfx.add(sweep(0.32, 300, 3500, 0.55, lambda u: u ** 2.5), 2.83, 0.08)     # zoom-out
sfx.add(thump(120, 42, 0.5, 0.16), 3.133, 0.3); sfx.add(tick(6000, 0.04, 0.008), 3.133, 0.04)
sfx.add(sweep(0.2, 4000, 800, 0.5, lambda u: u ** 1.5), cues['collapse'], 0.06)       # collapse
sfx.add(pop(1175, 0.1), cues['dotpop'], 0.12)
sfx.add(sweep(0.12, 2000, 6000, 0.5), cues['caret'], 0.03)   # dot stretches into a caret
for t in cues['keys']:                                                    # key presses
    sfx.add(tick(3600, 0.03, 0.0035), t, 0.08, 0.1); sfx.add(thump(260, 150, 0.08, 0.018), t, 0.14, 0.1)
# chapter 3
sfx.add(bp(noise(0.12), 400, 6000) * np.exp(-T(0.12) / 0.03), 4.0, 0.12)  # stack snap thwack
for k in range(4): sfx.add(bp(noise(0.05), 1500, 9000) * np.exp(-T(0.05) / 0.01), 4.5 + k * S / 2, 0.06, (-0.5, 0.5)[k % 2])   # flash glitch
sfx.add(sweep(0.4, 5000, 250, 0.5, lambda u: np.sin(np.pi * u) ** 0.7), 4.6, 0.08)                    # fall back into depth
sfx.add(pop(700, 0.12), 4.93, 0.14)
# chapter 4: bloom + air
t = T(0.5); sfx.add(np.sin(2 * np.pi * (40 + 25 * t) * t) * np.sin(np.pi * t / 0.5) ** 2, 4.85, 0.25)
air = sweep(1.0, 500, 1400, 0.8, lambda u: np.sin(np.pi * u) ** 0.8)
sfx.add(np.vstack([air * np.linspace(1, 0.3, len(air)), air * np.linspace(0.3, 1, len(air))]), 5.0, 0.035)
sfx.add(sweep(0.25, 800, 6000, 0.5, lambda u: u ** 3), 5.75, 0.06)       # pre-drop lift
# chapter 5: gravity
t = T(0.45); f = 1400 * np.exp(-t / 0.18) + 180
sfx.add(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2) * 0.4, 6.0, 0.05)   # falling whistle
sfx.add(thump(80, 32, 0.9, 0.35), 6.0, 0.35)
for t0, r, h in cues['particles']:
    sfx.add(tick(1800 + h * 6000, 0.02, 0.0025), t0, 0.007 + 0.005 * r, (h - 0.5) * 1.6)
for t0, v in cues['contacts']: sfx.add(bounce(), t0, 0.42 * min(1.0, v / 50), -0.15)
sfx.add(lp(noise(0.3), 300) * np.exp(-T(0.3) / 0.06) * 3, 6.433, 0.12)   # curtain lands
for k, t0 in enumerate(cues['letters']): sfx.add(fm(mtof([72, 74, 77, 79][k]), 0.3, 1.0, 1.4, 0.02, 0.07), t0, 0.1, -0.3 + 0.2 * k)
t = T(0.22); sfx.add(np.sin(2 * np.pi * np.cumsum(220 + 500 * (t / 0.22) ** 2) / SR) * (t / 0.22) * 0.5, 7.35, 0.035)   # crouch tension
sfx.add(fm(mtof(67), 0.35, 1.0, 2.5, 0.05, 0.12) * 0.8, 7.567, 0.14); sfx.add(sweep(0.4, 500, 4000, 0.5, lambda u: np.sin(np.pi * u)), 7.567, 0.06)   # jump
riser = sweep(0.43, 600, 9000, 0.35, lambda u: u ** 2.5 * (u < 0.985))
sfx.add(riser, 7.44, 0.11)
# END
sfx.add(thump(70, 30, 1.8, 0.6), 8.0, 0.5); sfx.add(pop(698, 0.12), 8.0, 0.12)
for k, t0 in enumerate(cues['reveal']):
    m = [79, 76, 72, 69, 67, 65][k]; b = fm(mtof(m), 1.4, 3.5, 1.3, 0.12, 0.7)
    sfx.add(b, t0, 0.08, 0.6 - 0.24 * k); verb_send.add(b, t0, 0.1, 0.6 - 0.24 * k)
for k, t0 in enumerate(cues['tl']): sfx.add(tick(5200 + 900 * (k % 3), 0.02, 0.002), t0, 0.012, -0.4 + 0.8 * k / max(1, len(cues['tl']) - 1))
b = fm(mtof(89), 2.0, 3.5, 1.0, 0.3, 1.0); sfx.add(b, 9.27, 0.04); verb_send.add(b, 9.27, 0.07)

# ---------------------------------------------------------------- mix
tt = np.arange(N) / SR
duck = np.ones(N)
for k in kicks:
    m = tt >= k; duck[m] -= 0.55 * np.exp(-(tt[m] - k) / 0.11) * np.minimum(1, (tt[m] - k) / 0.004 + 0.3)
duck = np.clip(duck, 0.35, 1)

def reverb(x, rt=1.7, pre=0.014, damp=4500):
    n = int(rt * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-6.9 * t / rt)
    f, tt2, Z = sg.stft(ir, SR, nperseg=512)
    Z = Z * np.exp(-(f[None, :, None] / damp) * (tt2[None, None, :] / rt) * 3)
    _, ir = sg.istft(Z, SR, nperseg=512); ir = ir[:, :n]
    ir = np.pad(ir, ((0, 0), (int(pre * SR), 0)))
    ir /= np.sqrt(np.sum(ir ** 2) / 2)
    y = np.vstack([sg.fftconvolve(x[0], ir[0])[:N], sg.fftconvolve(x[1], ir[1])[:N]])
    return y

seg_ = slice(int(2 * SR), int(8 * SR))
pad.x *= 10 ** (-27 / 20) / np.sqrt(np.mean(pad.x[:, seg_] ** 2))
wet = reverb(hp(verb_send.x + 0.25 * pad.x, 250))
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
for name, b in (('drums', drums.x), ('bass', bass.x), ('pad', pad.x), ('music', music.x), ('sfx', sfx.x), ('wet', wet)):
    print(f'{name:6s} rms {rms_db(b):6.1f} dB  peak {20*np.log10(np.max(np.abs(b))+1e-12):6.1f} dB')
mix = drums.x + bass.x * duck + pad.x * duck + music.x * (0.4 + 0.6 * duck) + sfx.x + wet * 0.35
mix = hp(mix, 28, 2)
# glue: gentle soft clip, then a lookahead limiter
mix = np.tanh(mix * 1.1) / 1.1
from scipy.ndimage import maximum_filter1d
peak = maximum_filter1d(np.max(np.abs(mix), axis=0), size=int(0.004 * SR))
gain = np.minimum(1.0, 0.89 / np.maximum(peak, 1e-9))
win = np.hanning(int(0.006 * SR)); win /= win.sum()
gain = np.minimum(gain, np.convolve(gain, win, mode='same'))
mix = mix * gain
fade = np.clip((10.0 - tt) / 0.6, 0, 1) ** 1.5
mix = mix * fade
mix[:, :int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
out = np.clip(mix, -1, 1)
import scipy.io.wavfile as wf
wf.write(sys.argv[1] if len(sys.argv) > 1 else 'reel_audio.wav', SR, (out.T * 32767).astype(np.int16))
print('peak', float(np.max(np.abs(out))), 'rms', float(np.sqrt(np.mean(out ** 2))))
