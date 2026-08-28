#!/usr/bin/env python
"""樓層平面圖的衍生版本產生器（下載 → 產生 → 上傳 floorplans 儲存桶）。

背景
----
V2 的平面樓層圖／3D 樓層圖目前是「下載原圖 → 在瀏覽器逐像素重畫 → 重新編碼 PNG →
交給 OpenSeadragon」。實測 4096×4015（1,640 萬像素）的原圖，光是客戶端這段就要
250～450ms（桌機 Chrome），手機約 3～6 倍，而且每次切換樓層都重跑。

這支腳本把那段工作搬到上傳時做一次：直接產生「已經重畫好」的成品圖，
客戶端只要下載對應主題的檔案，零像素處理。

會產生的檔案（都放在同一個 floorplans 儲存桶）
------------------------------------------------
  mobile/<F>.png        1024px 原色（手機用；目前 RF 缺這一版）
  desktop/<F>.png       2048px 原色（桌機用；比 4096 原圖少約四分之三的下載與處理）
  light/<F>.png         2048px 已重畫成黑線、近白底轉透明（淺色主題直接用）
  light/mobile/<F>.png  1024px 同上
  tech/<F>.png          2048px 已濾掉光暈、保留原色（科技版直接用）
  tech/mobile/<F>.png   1024px 同上

light／tech 的演算法必須與 web/app/systems/[system]/[module]/floor-stack-3d.tsx
的 preparePlanCanvas 完全一致，否則換到成品圖之後畫面會和現在不一樣：
  light：alpha=0 略過；luma>232 視為背景轉透明；其餘 RGB 塗黑
  tech ：alpha<64 的光暈轉透明，顏色不動

用法
----
  # 1) 取得 service_role key（Supabase 主控台 → Project Settings → API）
  #    只在自己的終端機設定，不要寫進任何檔案、不要進版控
  export SUPABASE_URL=https://qztffronusdhgxhjjubt.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=<你的 service_role key>

  # 2) 先試跑（只下載與產生，不上傳），輸出在 .floorplan-build/
  python tools/build-floorplan-variants.py --dry-run

  # 3) 確認 .floorplan-build/ 裡的圖沒問題後再上傳
  python tools/build-floorplan-variants.py

  # 只處理某幾層
  python tools/build-floorplan-variants.py --floors B1 1F

需求：Python 3 加 Pillow、numpy、requests（pip install pillow numpy requests）
"""

from __future__ import annotations

import argparse
import io
import os
import sys

try:
    import numpy as np
    import requests
    from PIL import Image
except ImportError as exc:  # pragma: no cover - 只是給人看的提示
    sys.exit(f'缺少套件：{exc}。請先安裝：pip install pillow numpy requests')

BUCKET = 'floorplans'
FLOORS = ['B1', '1F', '2F', '3F', '4F', '5F', 'RF']
DESKTOP_PX = 2048
MOBILE_PX = 1024
LUMA_BACKGROUND = 232   # 與 preparePlanCanvas 相同：亮度高於此值視為背景
GLOW_ALPHA_CUTOFF = 64  # 與 preparePlanCanvas 相同：低於此透明度的是光暈


def api(url: str, key: str, path: str) -> str:
    return f'{url.rstrip("/")}/storage/v1/object/{path}'


def download(url: str, key: str, name: str) -> Image.Image:
    res = requests.get(api(url, key, f'{BUCKET}/{name}'),
                       headers={'Authorization': f'Bearer {key}'}, timeout=120)
    res.raise_for_status()
    return Image.open(io.BytesIO(res.content)).convert('RGBA')


def upload(url: str, key: str, name: str, image: Image.Image) -> int:
    buf = io.BytesIO()
    image.save(buf, 'PNG', optimize=True)
    body = buf.getvalue()
    res = requests.post(api(url, key, f'{BUCKET}/{name}'), data=body,
                        headers={'Authorization': f'Bearer {key}',
                                 'Content-Type': 'image/png',
                                 'x-upsert': 'true'}, timeout=300)
    res.raise_for_status()
    return len(body)


def fit(image: Image.Image, longest: int) -> Image.Image:
    w, h = image.size
    if max(w, h) <= longest:
        return image.copy()
    scale = longest / max(w, h)
    return image.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def to_light(image: Image.Image) -> Image.Image:
    """近白視為背景轉透明，其餘塗黑。與 preparePlanCanvas 的 light 模式一致。"""
    px = np.array(image, dtype=np.uint8)
    rgb, alpha = px[..., :3].astype(np.float32), px[..., 3]
    luma = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    visible = alpha > 0
    background = visible & (luma > LUMA_BACKGROUND)
    line = visible & ~background
    px[background, 3] = 0
    px[line, 0] = px[line, 1] = px[line, 2] = 0
    # 與客戶端相同的保險絲：底圖若不透明，重畫會把整層塗成黑色，寧可不做。
    clear_ratio = float((px[..., 3] == 0).mean())
    if clear_ratio < 0.2:
        raise ValueError(f'底圖不透明（可視為背景的像素僅 {clear_ratio * 100:.1f}%），'
                         '請確認 3D建模系統 renderNeon 的產出格式是否變更')
    return Image.fromarray(px, 'RGBA')


def to_tech(image: Image.Image) -> Image.Image:
    """濾掉光暈只留核心線，顏色不動。與 preparePlanCanvas 的 tech 模式一致。"""
    px = np.array(image, dtype=np.uint8)
    alpha = px[..., 3]
    px[(alpha > 0) & (alpha < GLOW_ALPHA_CUTOFF), 3] = 0
    return Image.fromarray(px, 'RGBA')


def main() -> int:
    parser = argparse.ArgumentParser(description='產生並上傳樓層平面圖的衍生版本')
    parser.add_argument('--floors', nargs='*', default=FLOORS, help='要處理的樓層（預設全部）')
    parser.add_argument('--dry-run', action='store_true', help='只產生檔案到 .floorplan-build/，不上傳')
    parser.add_argument('--out', default='.floorplan-build', help='試跑時的輸出目錄')
    args = parser.parse_args()

    url = os.environ.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        return int(bool(sys.stderr.write(
            '請先設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 環境變數\n')) or 1)

    total_before = total_after = 0
    for floor in args.floors:
        name = f'{floor}.png'
        print(f'── {name}')
        try:
            original = download(url, key, name)
        except Exception as exc:
            print(f'   下載失敗，跳過：{exc}')
            continue
        print(f'   原圖 {original.size[0]}x{original.size[1]}')

        desktop, mobile = fit(original, DESKTOP_PX), fit(original, MOBILE_PX)
        variants = {
            f'desktop/{name}': desktop,
            f'mobile/{name}': mobile,
            f'light/{name}': to_light(desktop),
            f'light/mobile/{name}': to_light(mobile),
            f'tech/{name}': to_tech(desktop),
            f'tech/mobile/{name}': to_tech(mobile),
        }
        for target, image in variants.items():
            if args.dry_run:
                out = os.path.join(args.out, target.replace('/', os.sep))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                image.save(out, 'PNG', optimize=True)
                size = os.path.getsize(out)
            else:
                size = upload(url, key, target, image)
            total_after += size
            print(f'   {target:26s} {image.size[0]}x{image.size[1]}  {size / 1024:7.1f} KB')

    print(f'\n完成。{"（試跑，未上傳）" if args.dry_run else "已上傳至 floorplans 儲存桶"}')
    print(f'產生的檔案合計 {total_after / 1024 / 1024:.2f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
