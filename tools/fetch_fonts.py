"""Download Google Fonts subsets that contain exactly the characters used in src/content.js."""
import json
import pathlib
import re
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "src" / "fonts"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# 文件名 -> Google Fonts family 名
FAMILIES = {
    "mashanzheng": "Ma Shan Zheng",   # 标题、诗
    "zhimangxing": "Zhi Mang Xing",   # 落款、结尾
    "wenkai": "LXGW WenKai TC",       # 信
}


def used_chars() -> str:
    src = (ROOT / "src" / "content.js").read_text(encoding="utf-8")
    # 取出所有字符串字面量里的字符
    chars = set("".join(re.findall(r'"([^"]*)"', src)))
    chars |= set("妈妈生日快乐欣宜敬上，。！：、· 福")  # 福：灯笼上的字
    return "".join(sorted(c for c in chars if c.strip() and ord(c) > 127))


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    text = used_chars()
    print(f"{len(text)} distinct characters")
    for name, family in FAMILIES.items():
        q = urllib.parse.urlencode({"family": family, "text": text})
        css = fetch(f"https://fonts.googleapis.com/css2?{q}").decode()
        urls = re.findall(r"url\((https://[^)]+)\)", css)
        if not urls:
            print(f"!! {family}: no font url")
            continue
        data = fetch(urls[0])
        (FONT_DIR / f"{name}.woff2").write_bytes(data)
        print(f"{family:16s} -> {name}.woff2 ({len(data)//1024} KB)")


if __name__ == "__main__":
    main()
