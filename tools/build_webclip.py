#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""建置巡檢系統的手機桌面捷徑資產。

輸入：一張方形（或會被置中裁切成方形）的來源圖，預設
      system/assets/app-icon-source.png

輸出：
  system/icons/app-icon-180.png    iOS apple-touch-icon / Web Clip
  system/icons/app-icon-192.png    Android PWA
  system/icons/app-icon-512.png    Android PWA / splash
  system/icons/app-icon-maskable-512.png  Android 自適應圖示（含安全邊距）
  system/beinong-patrol.mobileconfig      iOS Web Clip 描述檔（內嵌 base64 圖示）

用法：
  python tools/build_webclip.py
  python tools/build_webclip.py path/to/其他來源圖.png
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image

# Windows 主控台預設 cp950，訊息裡的中文與符號會炸掉。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
SYSTEM_DIR = ROOT / "system"
ICON_DIR = SYSTEM_DIR / "icons"
DEFAULT_SOURCE = SYSTEM_DIR / "assets" / "app-icon-source.png"
FALLBACK_SOURCE = SYSTEM_DIR / "assets" / "logo-title.png"

# 線上網址（GitHub Pages）。若日後換網域，只需改這裡再重跑本腳本。
SITE_BASE = "https://jnfakimo.github.io/word-cloud/system"
WEBCLIP_URL = f"{SITE_BASE}/login.html"

APP_LABEL = "北農巡檢"
APP_FULL_NAME = "第一果菜市場 設備巡檢維修系統"
ORGANIZATION = "臺北農產運銷股份有限公司"

# 固定 UUID：重複安裝時 iOS 會視為同一個描述檔而覆蓋，不會累積多個圖示。
PAYLOAD_UUID = "3F0C1E6A-8D42-4B77-9A15-2C6D0B4E7A31"
CONFIG_UUID = "B7A94D25-16C3-4E08-8F51-9D3A2E5C7B64"
# 背景色：與登入頁深色底一致，去背 PNG 疊上後不會出現黑框。
BACKDROP = (15, 23, 42, 255)  # #0f172a
# 裁切倍率：>1 會往中間再切一點，用來去掉來源圖的白邊與截圖殘留。
# 設 1.0 就是單純置中裁成正方形，完整保留原圖。
ZOOM = 1.15


def load_square(path: Path, zoom: float = ZOOM) -> Image.Image:
    """讀圖 → 攤平透明 → 置中裁成正方形（可再依 zoom 往內縮）。"""
    img = Image.open(path).convert("RGBA")
    flat = Image.new("RGBA", img.size, BACKDROP)
    flat.alpha_composite(img)
    img = flat

    w, h = img.size
    side = int(min(w, h) / max(zoom, 1.0))
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def write_png(img: Image.Image, size: int, out: Path, padding: float = 0.0) -> None:
    """輸出指定尺寸 PNG；padding 為四周留白比例（Android maskable 用）。"""
    canvas = Image.new("RGBA", (size, size), BACKDROP)
    inner = int(size * (1 - padding * 2))
    canvas.paste(img.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
    buf = io.BytesIO()
    canvas.convert("RGB").save(buf, "PNG", optimize=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    # 直接量 buffer；Google Drive 掛載的磁碟剛寫完 stat() 會回 0。
    out.write_bytes(buf.getvalue())
    print(f"  ✓ {out.relative_to(ROOT)}  ({len(buf.getvalue()) / 1024:.1f} KB)")


def build_mobileconfig(icon: Image.Image, out: Path) -> None:
    buf = io.BytesIO()
    # Web Clip 圖示用 180x180；base64 會讓體積膨脹 ~33%，先壓一輪再編碼。
    icon.convert("RGB").resize((180, 180), Image.LANCZOS).save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    wrapped = "\n".join(b64[i:i + 76] for i in range(0, len(b64), 76))

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>FullScreen</key>
            <true/>
            <key>Icon</key>
            <data>
{wrapped}
            </data>
            <key>IsRemovable</key>
            <true/>
            <key>Label</key>
            <string>{escape(APP_LABEL)}</string>
            <key>PayloadDescription</key>
            <string>{escape(f'將「{APP_FULL_NAME}」加入 iPhone 或 iPad 主畫面。')}</string>
            <key>PayloadDisplayName</key>
            <string>{escape(APP_LABEL)}</string>
            <key>PayloadIdentifier</key>
            <string>tw.com.tapmc.patrol.webclip</string>
            <key>PayloadType</key>
            <string>com.apple.webClip.managed</string>
            <key>PayloadUUID</key>
            <string>{PAYLOAD_UUID}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>Precomposed</key>
            <true/>
            <key>URL</key>
            <string>{escape(WEBCLIP_URL)}</string>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>{escape(f'安裝「{APP_FULL_NAME}」桌面圖示。這是網頁捷徑，不會存取裝置上的任何個人資料。')}</string>
    <key>PayloadDisplayName</key>
    <string>{escape(f'{APP_LABEL}．桌面捷徑')}</string>
    <key>PayloadIdentifier</key>
    <string>tw.com.tapmc.patrol.configuration</string>
    <key>PayloadOrganization</key>
    <string>{escape(ORGANIZATION)}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{CONFIG_UUID}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
"""
    out.write_text(plist, encoding="utf-8")
    print(f"  ✓ {out.relative_to(ROOT)}  ({len(plist.encode('utf-8')) / 1024:.1f} KB)")


def main() -> int:
    src = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not src.exists():
        if not FALLBACK_SOURCE.exists():
            print(f"找不到來源圖：{src}", file=sys.stderr)
            return 1
        print(f"⚠ 找不到 {src.relative_to(ROOT) if src.is_relative_to(ROOT) else src}，"
              f"暫時改用 {FALLBACK_SOURCE.relative_to(ROOT)} 產生佔位圖示。")
        print("  換成正式圖示：把圖存成 system/assets/app-icon-source.png 後重跑本腳本。\n")
        src = FALLBACK_SOURCE

    print(f"來源圖：{src}")
    icon = load_square(src)
    print(f"裁切後：{icon.size[0]}x{icon.size[1]}\n產出：")

    write_png(icon, 180, ICON_DIR / "app-icon-180.png")
    write_png(icon, 192, ICON_DIR / "app-icon-192.png")
    write_png(icon, 512, ICON_DIR / "app-icon-512.png")
    # Android 自適應圖示會被裁成圓形，四周各留 10% 安全邊距。
    write_png(icon, 512, ICON_DIR / "app-icon-maskable-512.png", padding=0.10)
    build_mobileconfig(icon, SYSTEM_DIR / "beinong-patrol.mobileconfig")

    print(f"\n完成。Web Clip 目標網址：{WEBCLIP_URL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
