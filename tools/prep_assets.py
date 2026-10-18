"""把 assets/source/ 里的原始素材裁切、缩放、拆分成短片用的 WebP：python3 tools/prep_assets.py

原图较大（约 90 MB）没有放进仓库；处理后的 src/assets/ 已提交，可以直接渲染。
"""
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source"
OUT = ROOT / "src" / "assets"


def load(name):
    return Image.open(SRC / f"{name}.png").convert("RGBA")


def clean(im):
    """去掉抠图边缘几乎透明的杂色。"""
    a = np.array(im)
    a[a[..., 3] < 10] = 0
    return Image.fromarray(a)


def save(im, name, q=90):
    OUT.mkdir(parents=True, exist_ok=True)
    if im.mode == "RGBA" and np.array(im)[..., 3].min() == 255:
        im = im.convert("RGB")
    im.save(OUT / f"{name}.webp", "WEBP", quality=q, method=4)
    print(f"{name:16s} {im.size[0]}x{im.size[1]}  {(OUT / f'{name}.webp').stat().st_size // 1024} KB")


def cover(im, w, h, y0=None, x0=None):
    """裁成 w:h 后缩放；y0/x0 指定裁切起点（原图像素），默认居中。"""
    W, H = im.size
    if W / H > w / h:
        cw, ch = round(H * w / h), H
    else:
        cw, ch = W, round(W * h / w)
    x = (W - cw) // 2 if x0 is None else x0
    y = (H - ch) // 2 if y0 is None else y0
    return im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)


def cut(im, box, pad=6, scale=1.0):
    x0, y0, x1, y1 = box
    c = clean(im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad))))
    if scale != 1.0:
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
    return c


def main():
    # ---- 整幅背景（16:9）
    paper = load("bg_paper_torn")
    save(cover(paper.crop((60, 60, 1431, 995)), 1920, 1080), "paper")
    save(cover(load("b3_plum_landscape"), 1920, 1080, y0=120), "home")
    save(cover(load("season_spring"), 1920, 1080, y0=150), "spring")
    save(cover(load("season_summer"), 1920, 1080, y0=40), "summer")
    save(cover(load("season_autumn"), 1920, 1080, y0=90), "autumn")
    save(cover(load("season_winter"), 1920, 1080, y0=70), "winter")
    save(cover(load("wash_pink"), 1920, 1080), "wash_pink")
    save(cover(load("wash_warm"), 1920, 1080), "wash_warm")
    # 信笺纸：取旧纸中间一块
    save(paper.crop((90, 80, 1400, 980)).resize((924, 920), Image.LANCZOS), "card")

    # ---- 信笺旁的竖幅画（每页一幅）
    PW, PH = 720, 1280
    save(cover(load("season_summer"), PW, PH, x0=830), "panel1")
    save(cover(load("b3_v_bridge_moon"), PW, PH), "panel2")
    save(cover(load("b3_v_waterfall"), PW, PH), "panel3")
    save(cover(load("b3_v_sea"), PW, PH), "panel4")
    save(cover(load("b3_v_plum_sun"), PW, PH), "panel5")
    p6 = cover(load("wash_pink"), PW, PH, x0=380)
    tree = load("plum_tree")
    tree = tree.resize((PW, round(tree.height * PW / tree.width)), Image.LANCZOS)
    p6.alpha_composite(clean(tree), (0, PH - tree.height))
    save(p6, "panel6")

    # ---- 场景元素（透明底）
    save(load("b3_scroll_open"), "scroll")
    save(cut(load("plum_branch"), (0, 0, 1440, 1015), pad=0), "plum")
    save(cut(load("mountains_gold"), (56, 170, 1658, 801)), "mountains")
    save(cut(load("moon_clouds"), (86, 191, 1189, 1106), scale=0.6), "moon")
    save(cut(load("b3_envelope"), (64, 33, 1623, 910)), "envelope")
    save(cut(load("b3_osmanthus"), (0, 34, 1560, 915), pad=0), "osmanthus")
    save(cut(load("b3_books"), (8, 84, 1672, 870), scale=0.6), "books")
    save(cut(load("b3_window"), (31, 85, 1647, 907), scale=0.7), "window")
    save(clean(load("b3_petal_swirl")), "swirl")
    save(cut(load("clouds_gold"), (3, 64, 1446, 1000), scale=0.7), "clouds")
    ink = load("b3_ink_clouds")
    save(cut(ink, (0, 50, 1672, 556), pad=0), "inkcloud1")
    save(cut(ink, (0, 493, 1672, 897), pad=0), "inkcloud2")

    # ---- 精灵：大雁、雪花、枫叶、挂饰、印、花角
    geese = load("geese")
    for i, b in enumerate([(52, 463, 234, 620), (200, 427, 475, 637), (431, 336, 718, 562), (661, 508, 925, 653),
                           (803, 629, 1028, 751), (1001, 535, 1244, 720), (1188, 682, 1428, 810)]):
        save(cut(geese, b, scale=0.8), f"goose{i}")
    snow = load("sheet_snow")
    for i, b in enumerate([(41, 109, 361, 467), (423, 108, 734, 465), (816, 149, 995, 333), (976, 246, 1090, 364), (849, 325, 1007, 465)]):
        save(cut(snow, b, scale=0.35), f"flake{i}")
    maple = load("sheet_maple")
    for i, b in enumerate([(13, 116, 380, 506), (380, 116, 746, 506), (747, 169, 1088, 483), (391, 629, 747, 970), (1117, 586, 1420, 981)]):
        save(cut(maple, b, pad=2, scale=0.3), f"maple{i}")
    orn = load("sheet_ornaments")
    save(cut(orn, (549, 24, 902, 700), scale=0.75), "knot")
    save(cut(orn, (135, 24, 430, 691), scale=0.75), "jade")
    save(cut(load("b3_seals"), (389, 213, 632, 458), scale=0.5), "plumseal")
    frames = load("sheet_frames")
    save(cut(frames, (859, 91, 1197, 413)), "corner_tl")
    save(cut(frames, (1081, 307, 1438, 626)), "corner_br")
    glows = load("sheet_glows")
    save(cut(glows, (171, 749, 427, 976)), "orbs")


if __name__ == "__main__":
    main()
