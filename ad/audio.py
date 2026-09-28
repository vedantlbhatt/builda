"""Builda demo score: 120 BPM, warm minor-to-major lift. Pixel plucks where the creatures print,
a groove under the flythrough, chimes on the pushes, a resolved chord on the end card."""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
cues0 = json.load(open('cues.json'))
DURS = cues0['beats']['total']
src = open(os.path.join(HERE, 'lib', 'synth.py')).read()
src = src[:src.index('# ---------------------------------------------------------------- arrangement')].replace('DUR = 10.0', f'DUR = {DURS:.4f}')
exec(src)
bt = cues['beats']
SCN = {n: t for n, t in bt['scenes']}
def q(t): return round(t / B) * B
def bassnote(m, d, g=1.0):
    t = T(d + 0.08); f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    env = np.minimum(1, t / 0.006) * np.where(t > d, np.exp(-(t - d) / 0.02), 1) * np.exp(-t / (d * 2.5))
    return np.tanh(1.1 * x * env) * g
def square(f, d, duty=0.5, dec=0.12):
    t = T(d); ph = (f * t) % 1.0
    return np.where(ph < duty, 1.0, -1.0) * np.exp(-t / dec) * np.minimum(1, t / 0.002) * 0.5

CHB = {'Am9': [57, 60, 64, 67, 71], 'Fmaj9': [53, 57, 60, 64, 67], 'Cmaj9': [48, 55, 59, 62, 64], 'G6': [55, 59, 62, 64, 67], 'Dm9': [50, 53, 57, 60, 64]}
RT = {'Am9': 33, 'Fmaj9': 29, 'Cmaj9': 36, 'G6': 31, 'Dm9': 38}
LOOPA = ['Am9', 'Fmaj9', 'Cmaj9', 'G6']
SCN.setdefault('session', SCN.get('phone', 0))
FLY, LOCK, NOW, SESS, CARD, GRAPH, WRAP, END = [SCN[k] for k in ('fly', 'lock', 'now', 'session', 'card', 'graph', 'wrapped', 'end')]
FINAL = q(END + 0.3)
for i in range(int(np.ceil(DUR / 2))):
    t0 = i * 2.0
    if t0 >= FINAL: break
    name = LOOPA[i % 4]; t1 = min(t0 + 2, FINAL)
    bright = 1200 if t0 < FLY else (2800 if t0 < CARD else 2200)
    v = pad_voice([mtof(m) for m in CHB[name]], t0, t1, att=0.9 if i == 0 else 0.06, rel=0.3, fc=lambda t, b=bright: np.full_like(t, b))
    pad.add(v, t0, 0.8, norm=False)
v = pad_voice([mtof(m) for m in CHB['Cmaj9']], FINAL, DUR, att=0.06, rel=1.4, fc=lambda t: np.interp(t, [FINAL, DUR], [3000, 900]))
tt_ = np.arange(v.shape[1]) / SR; pad.add(v * (0.45 + 0.55 * np.exp(-tt_ / 0.9)), FINAL, 1.0, norm=False)

def arp(t0, t1, step, vel):
    k = 0; t = q(t0)
    while t < t1 - 1e-6:
        notes = [m + 12 for m in CHB[LOOPA[int(t // 2) % 4]]]
        m = notes[[0, 2, 4, 3, 1, 4, 2, 3][k % 8] % len(notes)]
        b = square(mtof(m + 12), 0.14, 0.25, 0.05) if k % 2 == 0 else fm(mtof(m), 0.7, 2.0, 2.0, 0.06, 0.3)
        music.add(b, t, vel * (1.0 if k % 4 == 0 else 0.7), 0.4 * np.sin(k * 1.3)); verb_send.add(b, t, vel * 0.25)
        k += 1; t += step
arp(0.6, FLY, B / 2, 0.06); arp(FLY, LOCK, S, 0.06); arp(NOW, CARD, B / 2, 0.055); arp(CARD, END, S, 0.05)

def groove(t0, t1, full=True):
    t0, t1 = q(t0), q(t1); ks = []
    for t in np.arange(t0, t1 - 1e-6, B): drums.add(kick(), t, 0.7); ks.append(t)
    for t in np.arange(t0 + B, t1 - 1e-6, 2 * B): drums.add(clap(), t, 0.22 if full else 0.13, 0.05); verb_send.add(clap(), t, 0.08)
    for i, t in enumerate(np.arange(t0, t1 - 1e-6, S if full else B / 2)):
        op = full and i % 4 == 2; drums.add(hat(0.09 if op else 0.03), t, 0.06 if op else 0.033, 0.25 * np.sin(i))
    return ks
kicks = []
for i, t in enumerate(np.arange(q(SCN['term']), FLY, S * 2)): drums.add(hat(0.025), t, 0.022, 0.2 * np.sin(i))
kicks += groove(FLY, LOCK)
kicks += groove(NOW, CARD, full=False)
kicks += groove(CARD, END)
for t in (FLY, NOW, CARD): drums.add(crash(1.4), t, 0.07, 0.2)
drums.add(kick(), FINAL, 0.75); kicks.append(FINAL)
def bassline(t0, t1):
    for t in np.arange(q(t0), q(t1) - 1e-6, B / 2):
        root = RT[LOOPA[int(t // 2) % 4]]
        bass.add(bassnote(root + (12 if int(t / (B / 2)) % 4 == 3 else 0), 0.16), t + B / 4, 0.3)
bassline(FLY, LOCK); bassline(CARD, END)
for t in np.arange(q(LOCK), q(CARD), 2.0): bass.add(bassnote(RT[LOOPA[int(t // 2) % 4]], 1.2), t, 0.24)
bass.add(bassnote(RT['Cmaj9'], 1.4), FINAL, 0.4)

# ---- sound design
for k in range(14): sfx.add(square(mtof(72 + (k * 5) % 24), 0.06, 0.5, 0.03), 0.23 + k * 0.035, 0.03, np.sin(k))   # Bit prints
sfx.add(sweep(1.2, 400, 3000, 0.6, lambda u: np.sin(np.pi * u) ** 1.2), 0.5, 0.05)
for i in range(28): sfx.add(tick(3600, 0.03, 0.0035), SCN['term'] + 0.27 + i * 0.021, 0.05, 0.1)             # typing
sfx.add(pop(880, 0.1), SCN['term'] + 1.0, 0.1)
sfx.add(sweep(FLY - SCN['term'] + 0.2, 300, 7000, 0.4, lambda u: u ** 2.2 * (u < 0.985)), SCN['term'] + 1.2, 0.14)
sfx.add(thump(90, 36, 0.9, 0.3), FLY, 0.45)
for k in range(7): b = fm(mtof([79, 84, 88, 91, 84, 88, 96][k]), 0.9, 3.5, 1.2, 0.1, 0.45); t = FLY + 1.2 + k * 0.95; sfx.add(b, t, 0.07, 0.3 * np.sin(k)); verb_send.add(b, t, 0.08)
sfx.add(sweep(0.8, 300, 5000, 0.45, lambda u: u ** 1.5 * (1 - u) ** 0.3), LOCK - 0.3, 0.1)
for t in bt['pushes']:
    for k, m in enumerate([84, 79, 88]): sfx.add(fm(mtof(m), 0.6, 1.0, 1.0, 0.1, 0.25), t + k * 0.11, 0.1, 0.2)
for k in range(5): sfx.add(square(mtof(76 + k * 3), 0.08, 0.5, 0.04), NOW + 0.5 + k * 0.13, 0.035, np.sin(k))      # tiles print
for k in range(4): sfx.add(pop([880, 988, 1175, 1319][k], 0.09), SESS + 1.4 + k * 0.17, 0.07, -0.3 + 0.2 * k)
sfx.add(sweep(0.5, 800, 5000, 0.5), CARD + 0.1, 0.08)
for k in range(12): sfx.add(tick(2400 + k * 120, 0.02, 0.004), GRAPH + 0.4 + k * 0.06, 0.05, np.sin(k))
for k in range(16): sfx.add(tick(5200, 0.015, 0.002), WRAP + 0.6 + k * 0.037, 0.05, np.sin(k * 2))          # split-flap
b = sum(fm(mtof(m), 1.4, 2.0, 1.5, 0.1, 0.6) for m in (72, 76, 79, 83)); sfx.add(b, WRAP + 1.35, 0.1); verb_send.add(b, WRAP + 1.35, 0.12)
for k in range(10): sfx.add(square(mtof(84 + (k * 7) % 12), 0.07, 0.5, 0.04), END + 0.05 + k * 0.05, 0.03, np.sin(k))
if 'picker' in SCN:
    for k in range(5): sfx.add(square(mtof([72, 76, 79, 83, 88][k]), 0.1, 0.5, 0.06), SCN['picker'] + 0.5 + k * 0.37, 0.05, np.sin(k))
    b = sum(fm(mtof(m), 1.2, 2.0, 1.5, 0.1, 0.5) for m in (76, 79, 84)); sfx.add(b, SCN['picker'] + 2.4, 0.08); verb_send.add(b, SCN['picker'] + 2.4, 0.1)
if 'pair' in SCN:
    t = SCN['pair'] + 80 / 60
    for k, m in enumerate([84, 88, 91, 96]): sfx.add(fm(mtof(m), 0.7, 3.5, 1.2, 0.1, 0.4), t + k * 0.07, 0.07, 0.2 * k)
    for k in range(8): sfx.add(square(mtof(84 + (k * 5) % 12), 0.05, 0.5, 0.03), t + 0.1 + k * 0.04, 0.03, np.sin(k))
if 'feed' in SCN:
    t = SCN['feed'] + 96 / 60; sfx.add(pop(1175, 0.1), t, 0.12); b = sum(fm(mtof(m), 0.8, 2.0, 1.2, 0.08, 0.4) for m in (79, 84)); sfx.add(b, t + 0.05, 0.08); verb_send.add(b, t, 0.08)
if 'board' in SCN:
    for k in range(18): sfx.add(tick(1800 + k * 90, 0.02, 0.004), SCN['board'] + 1.0 + k * 0.083, 0.045, np.sin(k))
    b = sum(fm(mtof(m), 1.2, 2.0, 1.5, 0.1, 0.6) for m in (76, 79, 84, 88)); sfx.add(b, SCN['board'] + 2.55, 0.09); verb_send.add(b, SCN['board'] + 2.55, 0.1)
if 'money' in SCN:
    for k in range(20): sfx.add(tick(3000 + (k % 5) * 300, 0.015, 0.003), SCN['money'] + 0.25 + k * 0.045, 0.04, np.sin(k * 1.7))
    sfx.add(pop(988, 0.1), SCN['money'] + 1.2, 0.09)
for k in range(8): sfx.add(square(mtof([72, 74, 76, 79, 81, 84, 86, 88][k]), 0.07, 0.5, 0.04), END + 0.85 + k * 0.085, 0.035, -0.6 + 0.17 * k)   # the parade
sfx.add(thump(80, 34, 1.4, 0.45), FINAL, 0.35)

# ---- mix
tt = np.arange(N) / SR
duck = np.ones(N)
for k in kicks:
    m = tt >= k; duck[m] -= 0.5 * np.exp(-(tt[m] - k) / 0.11) * np.minimum(1, (tt[m] - k) / 0.004 + 0.3)
duck = np.clip(duck, 0.35, 1)
def reverb(x, rt=1.7, pre=0.014, damp=4500):
    n = int(rt * SR); t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-6.9 * t / rt)
    f_, tt2, Z = sg.stft(ir, SR, nperseg=512)
    Z = Z * np.exp(-(f_[None, :, None] / damp) * (tt2[None, None, :] / rt) * 3)
    _, ir = sg.istft(Z, SR, nperseg=512); ir = ir[:, :n]
    ir = np.pad(ir, ((0, 0), (int(pre * SR), 0))); ir /= np.sqrt(np.sum(ir ** 2) / 2)
    return np.vstack([sg.fftconvolve(x[0], ir[0])[:N], sg.fftconvolve(x[1], ir[1])[:N]])
pad.x *= 10 ** (-28 / 20) / np.sqrt(np.mean(pad.x ** 2))
wet = reverb(hp(verb_send.x + 0.25 * pad.x, 250))
mix = drums.x + bass.x * duck + pad.x * duck + music.x * (0.4 + 0.6 * duck) + sfx.x + wet * 0.35
mix = hp(mix, 28, 2); mix = np.tanh(mix * 1.1) / 1.1
from scipy.ndimage import maximum_filter1d
peak = maximum_filter1d(np.max(np.abs(mix), axis=0), size=int(0.004 * SR))
gain = np.minimum(1.0, 0.89 / np.maximum(peak, 1e-9)); win = np.hanning(int(0.006 * SR)); win /= win.sum()
mix = mix * np.minimum(gain, np.convolve(gain, win, mode='same'))
mix = mix * np.clip((DUR - tt) / 0.8, 0, 1) ** 1.5
import scipy.io.wavfile as wf
wf.write(sys.argv[1], SR, (np.clip(mix, -1, 1).T * 32767).astype(np.int16))
print('ok', DUR, float(np.sqrt(np.mean(mix ** 2))))
