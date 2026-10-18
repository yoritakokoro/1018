"""《梅香寄北堂》配乐：用加法合成模拟古筝，D 宫五声调式（古筝的标准定弦）。

读取 build/timeline.json（由画面引擎导出），让段落与画面对齐，输出 build/music.wav。
用法：python3 tools/music.py
"""
import json
import pathlib
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
rng = np.random.default_rng(1018)

# 简谱：1=D
DEG = {"1": 0, "2": 2, "3": 4, "4": 5, "5": 7, "6": 9, "7": 11}
PENTA = {0, 2, 4, 7, 9}


def jp(tok, base=62):
    """简谱音名 -> MIDI。' 升八度，, 降八度，# 升半音。基准 1 = D4。"""
    acc = 0
    if tok[0] == "#":
        acc, tok = 1, tok[1:]
    return base + DEG[tok[0]] + acc + 12 * (tok.count("'") - tok.count(","))


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ------------------------------------------------------------------ 音色
def zheng(midi, vel=0.7, vib=0.0, bend=0.0, ring=None, bright=1.0):
    """古筝单音：加法合成，高次泛音衰减更快，轻微非谐性；可选揉弦与上滑音。"""
    f0 = hz(midi)
    t60 = float(np.interp(midi, [38, 60, 84, 96], [7.5, 4.6, 2.3, 1.4]))
    dur = ring if ring else min(t60 * 1.15, 8.0)
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = np.full(n, f0)
    if bend:
        # 上滑音：从低 bend 个半音处按弦滑到本音
        k = np.clip(1 - t / 0.16, 0, 1) ** 2
        f = f0 * 2 ** (-bend * k / 12)
    if vib:
        depth = vib * np.clip((t - 0.28) / 0.5, 0, 1)
        f = f * (1 + depth * np.sin(2 * np.pi * 5.0 * t + 0.3 * np.sin(2 * np.pi * 0.7 * t)))
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros(n)
    B = 0.00008
    pos = 0.12  # 拨弦点靠近岳山，音色明亮
    for k in range(1, 30):
        mult = k * np.sqrt(1 + B * k * k)
        if mult * f0 > SR * 0.42:
            break
        amp = abs(np.sin(np.pi * k * pos)) / (k ** (1.25 - 0.25 * bright))
        tk = t60 / (1 + 0.42 * (k - 1) ** 1.15)
        out += amp * np.exp(-6.91 * t / tk) * np.sin(phase * mult + rng.uniform(0, 6.28))
    out *= np.clip(t / 0.003, 0, 1)
    # 义甲触弦的噪声
    m = int(0.018 * SR)
    nz = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.003 * SR))
    nz = np.diff(nz, prepend=0)
    out[:m] += 0.06 * nz
    if ring:
        fade = int(0.25 * SR)
        out[-fade:] *= np.linspace(1, 0, fade)
    return out / 3.0 * vel


def pad(midis, dur, gain=0.08, attack=1.6, release=2.0):
    """柔和的弦乐铺底。"""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    for m in midis:
        f = hz(m)
        for det, side in ((-4, L), (4, R), (0, None)):
            ff = f * 2 ** (det / 1200)
            ph = rng.uniform(0, 6.28)
            s = np.sin(2 * np.pi * ff * t + ph) + 0.25 * np.sin(4 * np.pi * ff * t + ph) + 0.08 * np.sin(6 * np.pi * ff * t)
            if side is None:
                L += 0.5 * s
                R += 0.5 * s
            else:
                side += s
    env = np.clip(t / attack, 0, 1) * np.clip((dur + release - t) / release, 0, 1)
    env *= 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)
    k = gain / max(1, len(midis))
    return L * env * k, R * env * k


def thud():
    """盖印时的一声闷响。"""
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 55 + 70 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.09)
    nz = rng.standard_normal(n) * np.exp(-t / 0.012)
    sos = butter(2, 900, "low", fs=SR, output="sos")
    return 0.55 * s + 0.25 * sosfilt(sos, nz)


# ------------------------------------------------------------------ 混音台
class Mix:
    def __init__(self, dur):
        self.n = int((dur + 9) * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def put(self, sig, t, pan=0.0, gain=1.0, right=None):
        """单声道信号按 pan 声像放置；给出 right 时 sig/right 分别是左右声道。"""
        i = int(round(t * SR))
        if i < 0 or i >= self.n:
            return
        if right is None:
            left, right = sig * np.cos((pan + 1) * np.pi / 4), sig * np.sin((pan + 1) * np.pi / 4)
        else:
            left = sig
        m = min(len(left), self.n - i)
        self.L[i:i + m] += left[:m] * gain
        self.R[i:i + m] += right[:m] * gain

    def note(self, midi, t, vel=0.7, **kw):
        t += rng.normal(0, 0.006)
        vel *= 1 + rng.normal(0, 0.06)
        pan = float(np.clip((midi - 62) / 40, -0.55, 0.55))
        self.put(zheng(midi, vel, **kw), t, pan)

    def pad(self, midis, t, dur, gain=0.08, **kw):
        L, R = pad(midis, dur, gain, **kw)
        self.put(L, t, right=R)


def play(mix, score, t0, beat, vel=0.72, tempo=None, shift=0):
    """按简谱序列演奏。记号：5:1（音:拍）  0 休止  ~ 揉弦  ^ 上滑音。返回结束时间。"""
    t = t0
    i = 0
    for tok in score.split():
        if tok == "|":
            continue
        note, d = tok.split(":")
        d = float(d)
        b = beat * (tempo(i) if tempo else 1.0)
        if note != "0":
            vib = 0.007 if "~" in note else (0.003 if d >= 1.5 else 0.0)
            bend = 2.0 if "^" in note else 0.0
            m = jp(note.replace("~", "").replace("^", "")) + shift
            mix.note(m, t, vel * (1.08 if d >= 2 else 1.0), vib=vib, bend=bend)
        t += d * b
        i += 1
    return t


# 和弦：低音 + 分解音（尽量只用五声音）
CH = {
    "D": (38, [45, 50, 54, 57, 62]),
    "Bm": (47, [54, 59, 62, 66, 71]),
    "Em": (40, [47, 52, 54, 59, 64]),
    "A": (45, [52, 57, 59, 64, 69]),
    "A7": (45, [52, 57, 61, 64, 67]),
    "G": (43, [50, 55, 59, 62, 67]),
}
PAD = {
    "D": [50, 54, 57, 62], "Bm": [47, 54, 59, 62], "Em": [52, 59, 64, 66], "A": [45, 52, 57, 59],
    "A7": [45, 52, 57, 61], "G": [43, 50, 55, 59],
}


def accomp(mix, chords, t0, bar, beats=4, vel=0.3, half=False, padgain=0.07):
    """分解和弦伴奏 + 铺底。chords 每小节一个。"""
    pat4 = [None, 0, 1, 2, 3, 2, 1, 2]
    pat3 = [None, 1, 2, 3, 2, 1]
    for k, name in enumerate(chords):
        bass, arp = CH[name]
        tb = t0 + k * bar
        pat = pat4 if beats == 4 else pat3
        step = bar / len(pat)
        for j, idx in enumerate(pat):
            if half and j % 2:
                continue
            if idx is None:
                mix.note(bass, tb, vel * 1.5, ring=min(7.0, bar * 1.6))
            else:
                mix.note(arp[idx], tb + j * step, vel * (0.9 if j % 2 else 1.0))
        mix.pad(PAD[name], tb, bar * 1.02, gain=padgain, attack=min(1.2, bar * 0.4), release=bar * 0.6)


def gliss(mix, t0, lo, hi, span, v0=0.2, v1=0.55, down=False):
    """刮奏：在五声音阶上快速划过。"""
    notes = [m for m in range(lo, hi + 1) if (m - 62) % 12 in PENTA]
    if down:
        notes = notes[::-1]
    n = len(notes)
    for i, m in enumerate(notes):
        u = i / max(1, n - 1)
        t = t0 + span * (u ** 0.85)
        last = i == n - 1
        mix.note(m, t, v0 + (v1 - v0) * (1 - u if down else u), ring=5.0 if last else 1.6)


# ------------------------------------------------------------------ 乐谱
LETTER_A = ("5:1 6:.5 1':.5 6:1 5:1 | 3:1.5 5:.5 2~:2 | 3:1 5:1 6:1 1':1 | 5~:4 | "
            "6:1 1':.5 2':.5 1':1 6:1 | 5:1.5 6:.5 3~:2 | 2:1 3:.5 5:.5 3:1 2:1 | 1~:4")
LETTER_A2 = ("5:1 6:.5 1':.5 6:1 5:1 | 3:1.5 5:.5 ^2'~:2 | 3':1 2':1 1':1 6:1 | 5~:4 | "
             "6:1 1':.5 2':.5 3':1 2':1 | 1':1.5 6:.5 5~:2 | 6:1 5:.5 3:.5 2:1 3:1 | ^5~:4")
LETTER_B = ("1':1.5 2':.5 ^3'~:2 | 2':1 1':1 6~:2 | 5:1 6:1 1':1 2':1 | 3'~:3 2':1 | "
            "1':1.5 6:.5 5~:2 | 6:1 5:1 3:1 2:1 | 3:1.5 5:.5 2:1 3:1 | 1~:4")
CH_A = ["D", "A", "Bm", "D", "Em", "Bm", "A", "D"]
CH_B = ["D", "Em", "D", "Bm", "Bm", "A", "Em", "D"]

POEM = ["6:1 1':1 2':1 3':1 | ^2'~:2 1':1 6:1",
        "5:1 6:1 1'~:2 | 6:1 5:1 3~:2",
        "1':1 2':1 3':1 5':1 | 3'~:2 2'~:2",
        "1':1 6:1 5:1 6:1 | 1'~:4"]
CH_POEM = [["D", "Bm"], ["Em", "A"], ["D", "Em"], ["Bm", "D"]]

# 《生日快乐》（1=D，3/4 拍，弱起）
HAPPY = ("5:.75 5:.25 | 6:1 5:1 1':1 | 7:2 5:.75 5:.25 | 6:1 5:1 2':1 | 1':2 5:.75 5:.25 | "
         "5':1 3':1 1':1 | 7:1 6:1 4':.75 4':.25 | 3':1 1':1 2':1 | 1'~:3")
CH_HAPPY = ["D", "A7", "A7", "D", "D", "G", "A7", "D"]


def compose(tl):
    dur = tl["duration"]
    mix = Mix(dur)
    O, L, P, E = tl["opening"], tl["letter"], tl["poem"], tl["ending"]

    # ---- 开场：散板。卷轴展开时一串刮奏，题字每落一笔一个音
    mix.pad([38, 45, 50], 0.3, O["end"] - 0.3, gain=0.10, attack=3.0, release=3.0)
    u0, u1 = O["unroll"]
    gliss(mix, u0 + 0.1, 50, 86, (u1 - u0) * 0.8, 0.16, 0.48)
    g0 = O["growStart"]
    mix.note(jp("1'"), g0, 0.6, vib=0.007)
    mix.note(jp("5"), g0 + 1.3, 0.45)
    mix.note(jp("3"), g0 + 2.6, 0.4, vib=0.004)
    for k, (tok, tt) in enumerate(zip(["5", "6", "1'", "2'", "3'"], O["titleTimes"])):
        mix.note(jp(tok), tt, 0.5 + 0.04 * k, vib=0.004 if k == 4 else 0)
    mix.note(38, O["titleSeal"], 0.7)
    mix.note(jp("5'"), O["titleSeal"] + 0.05, 0.35)
    for k, tok in enumerate(["5'", "3'", "2'", "1'"]):
        mix.note(jp(tok), O["dedStart"] + k * 0.3, 0.32)
    mix.note(jp("1"), O["dedStart"] + 1.7, 0.4)
    mix.note(jp("5"), O["dedStart"] + 1.75, 0.35, vib=0.004)
    # 题字随风而去：轻轻一道下行刮奏
    gliss(mix, O["fadeOut"][0], 62, 88, 1.3, 0.3, 0.1, down=True)
    # 信封随花雨落下
    ev = O["envelope"]
    mix.note(jp("3'"), ev - 0.3, 0.3)
    mix.note(jp("6"), ev, 0.34, vib=0.004)
    # 雁阵飞过月亮
    gm = O["geeseMoon"]
    for k, tok in enumerate(["6'", "5'", "3'", "5'", "2'"]):
        mix.note(jp(tok), gm - 1.2 + k * 0.45, 0.3 - 0.02 * k, vib=0.005 if k == 4 else 0)

    # ---- 信：28 小节，4/4
    l0, l1 = O["end"], L["end"]
    bar = (l1 - l0) / 28
    beat = bar / 4
    accomp(mix, ["D", "Bm", "Em", "A"], l0, bar, vel=0.26, half=True, padgain=0.08)
    accomp(mix, CH_A, l0 + 4 * bar, bar, vel=0.26)
    play(mix, LETTER_A, l0 + 4 * bar, beat, 0.72)
    accomp(mix, CH_A, l0 + 12 * bar, bar, vel=0.27)
    play(mix, LETTER_A2, l0 + 12 * bar, beat, 0.74)
    accomp(mix, CH_B, l0 + 20 * bar, bar, vel=0.28, padgain=0.085)
    play(mix, LETTER_B, l0 + 20 * bar, beat, 0.76)

    # ---- 诗：每联两小节
    cps = P["couplets"]
    pbar = (cps[1] - cps[0]) / 2
    for k, c0 in enumerate(cps):
        accomp(mix, CH_POEM[k], c0, pbar, vel=0.27, padgain=0.10 if k != 1 else 0.12)
        play(mix, POEM[k], c0, pbar / 4, 0.78)
        if k == 1:  # 映雪：几点高音如雪落
            for j, tok in enumerate(["5''", "3''", "1''", "6'", "5''", "2''"]):
                mix.note(jp(tok), c0 + 0.4 + j * pbar / 3, 0.16, bright=0.6)
        if k == 2:  # 万里光：铺底更亮
            mix.pad([62, 66, 69, 74], c0, pbar * 2, gain=0.05, attack=2.0)
    c_end = cps[3] + 2 * pbar
    accomp(mix, ["D", "D"], c_end, pbar, vel=0.22, half=True, padgain=0.09)
    for j, tok in enumerate(["1'", "3'", "5'", "1''"]):
        mix.note(jp(tok), c_end + 0.2 + j * 0.35, 0.3)
    mix.put(thud(), P["seal"], gain=0.5)
    mix.put(thud(), O["titleSeal"], gain=0.45)

    # ---- 结尾：刮奏 + 《生日快乐》
    e0 = E["start"]
    gliss(mix, e0, 50, 93, 1.3, 0.2, 0.55)
    mix.note(38, e0 + 1.3, 0.7)
    mix.pad([38, 45, 50, 54], e0, E["hbStart"] - e0 + 0.5, gain=0.09, attack=1.0)
    hb0 = E["hbStart"]
    hbeat = 0.86

    def hb_tempo(i):
        # 第 6 小节（"dear ..."）和结尾渐慢
        return {17: 1.3, 18: 1.35, 19: 1.1, 20: 1.1, 21: 1.08, 22: 1.12, 23: 1.2, 24: 1.5}.get(i, 1.0)
    # 计算各小节起点（考虑弱起和渐慢）
    durs = [float(tok.split(":")[1]) for tok in HAPPY.split() if tok != "|"]
    times, t = [], hb0
    for i, d in enumerate(durs):
        times.append(t)
        t += d * hbeat * hb_tempo(i)
    hb_end = t
    # 小节起点：弱起后每 3 拍
    acc, bar_starts = 0.0, []
    for i, d in enumerate(durs):
        if abs((acc - 1.0) % 3) < 1e-6 and acc >= 1.0:
            bar_starts.append(times[i])
        acc += d
    bar_starts.append(hb_end)
    for k, name in enumerate(CH_HAPPY):
        accomp(mix, [name], bar_starts[k], bar_starts[k + 1] - bar_starts[k], beats=3, vel=0.24, padgain=0.085)
    play(mix, HAPPY, hb0, hbeat, 0.8, tempo=hb_tempo)
    # 尾声
    gliss(mix, hb_end + 0.6, 62, 98, 1.6, 0.12, 0.35)
    mix.note(38, hb_end + 0.1, 0.6)
    mix.note(jp("1'"), hb_end + 2.6, 0.4, vib=0.005)
    mix.pad([38, 50, 57, 62, 66], hb_end - 0.5, dur - hb_end + 1.5, gain=0.09, attack=1.5, release=3.0)
    # 卷轴合上
    c0, c1, c2 = E["close"]
    mix.note(38, c1, 0.5)
    mix.note(jp("5"), c1 + 0.05, 0.3)
    mix.note(jp("1''"), c2 - 0.4, 0.22)
    return mix


def reverb(L, R, rt60=2.6, wet=0.28):
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    env = np.exp(-6.91 * t / rt60)
    irs = []
    for s in (1, 2):
        ir = rng.standard_normal(n) * env
        # 越往后越暗
        lo = sosfilt(butter(1, 2500, "low", fs=SR, output="sos"), ir)
        mixk = np.clip(t / 0.8, 0, 1)
        ir = ir * (1 - mixk) + lo * mixk
        ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        irs.append(ir / np.sqrt(np.sum(ir ** 2)))
    wl = fftconvolve(L, irs[0])[: len(L)]
    wr = fftconvolve(R, irs[1])[: len(R)]
    return L * (1 - wet) + wl * wet * 2.2, R * (1 - wet) + wr * wet * 2.2


def main():
    tl = json.loads((BUILD / "timeline.json").read_text())
    mix = compose(tl)
    L, R = reverb(mix.L, mix.R)
    hp = butter(2, 35, "high", fs=SR, output="sos")
    L, R = sosfilt(hp, L), sosfilt(hp, R)
    n = int((tl["duration"] + 0.5) * SR)
    L, R = L[:n], R[:n]
    # 收尾淡出与画面同步
    fade_from = tl["ending"]["close"][2] - 0.5
    f = np.clip((tl["duration"] - np.arange(n) / SR) / (tl["duration"] - fade_from), 0, 1) ** 1.5
    L, R = L * f, R * f
    # 响度：RMS 约 -19 dBFS，柔和限幅，峰值 -1 dBFS
    rms = np.sqrt(np.mean((L ** 2 + R ** 2) / 2))
    g = 10 ** (-19 / 20) / rms
    L, R = L * g, R * g
    lim = 10 ** (-1 / 20)
    L = np.tanh(L / lim) * lim
    R = np.tanh(R / lim) * lim
    pk = max(np.abs(L).max(), np.abs(R).max())
    print(f"rms {20*np.log10(np.sqrt(np.mean((L**2+R**2)/2))):.1f} dBFS, peak {20*np.log10(pk):.1f} dBFS, {n/SR:.1f}s")
    pcm = (np.stack([L, R], 1) * 32767).astype("<i2")
    with wave.open(str(BUILD / "music.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
