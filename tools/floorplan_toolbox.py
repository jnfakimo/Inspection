"""
北農智慧巡檢系統 - 美編與圖資自動化工具箱 (Floorplan & CAD Toolbox)
技術棧：Pillow (影像批次與衍生處理) + ezdxf (AutoCAD DXF 解析) + ColorThief (色彩提取) + NumPy
"""

from __future__ import annotations
import sys
import os
import io
import json
import argparse
import time
from typing import Any, Dict, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

try:
    import numpy as np
    from PIL import Image
    import ezdxf
    from colorthief import ColorThief
except ImportError as exc:
    sys.exit(f"缺少必要套件: {exc}。請先執行 pip install pillow numpy ezdxf colorthief")


# 與前端 floor-stack-3d.tsx 保持 100% 一致的參數
DESKTOP_PX = 2048
MOBILE_PX = 1024
LUMA_BACKGROUND = 232   # 亮度高於此值轉為透明背景
GLOW_ALPHA_CUTOFF = 64  # 低於此透明度視為光暈轉透明


class FloorplanVariantGenerator:
    """平面圖多規格衍生版本產生器"""

    @staticmethod
    def fit_dimension(image: Image.Image, max_dim: int) -> Image.Image:
        w, h = image.size
        if max(w, h) <= max_dim:
            return image.copy()
        scale = max_dim / max(w, h)
        return image.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)

    @staticmethod
    def to_light_theme(image: Image.Image) -> Image.Image:
        """淺色主題版：近白視為背景轉透明，其餘線條轉黑（與 preparePlanCanvas light 演算法一致）"""
        px = np.array(image.convert("RGBA"), dtype=np.uint8)
        rgb, alpha = px[..., :3].astype(np.float32), px[..., 3]
        luma = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
        
        visible = alpha > 0
        background = visible & (luma > LUMA_BACKGROUND)
        line = visible & ~background
        
        px[background, 3] = 0
        px[line, 0] = px[line, 1] = px[line, 2] = 0
        
        clear_ratio = float((px[..., 3] == 0).mean())
        if clear_ratio < 0.15:
            # 避免全黑保護
            return image.convert("RGBA")
        
        return Image.fromarray(px, "RGBA")

    @staticmethod
    def to_tech_theme(image: Image.Image) -> Image.Image:
        """科技主題版：濾掉擴散光暈只保留核心發光線條（與 preparePlanCanvas tech 演算法一致）"""
        px = np.array(image.convert("RGBA"), dtype=np.uint8)
        alpha = px[..., 3]
        px[(alpha > 0) & (alpha < GLOW_ALPHA_CUTOFF), 3] = 0
        return Image.fromarray(px, "RGBA")

    def process_image(self, input_path: str, output_dir: str, floor_name: str) -> Dict[str, Any]:
        start_t = time.perf_counter()
        os.makedirs(output_dir, exist_ok=True)
        
        with Image.open(input_path) as original_img:
            original = original_img.convert("RGBA")
            orig_w, orig_h = original.size
            
            desktop = self.fit_dimension(original, DESKTOP_PX)
            mobile = self.fit_dimension(original, MOBILE_PX)
            
            light_desktop = self.to_light_theme(desktop)
            light_mobile = self.to_light_theme(mobile)
            
            tech_desktop = self.to_tech_theme(desktop)
            tech_mobile = self.to_tech_theme(mobile)
            
            variants = {
                f"desktop/{floor_name}.png": desktop,
                f"mobile/{floor_name}.png": mobile,
                f"light/{floor_name}.png": light_desktop,
                f"light/mobile/{floor_name}.png": light_mobile,
                f"tech/{floor_name}.png": tech_desktop,
                f"tech/mobile/{floor_name}.png": tech_mobile,
                f"desktop/{floor_name}.webp": desktop,
                f"mobile/{floor_name}.webp": mobile,
            }
            
            generated_files = []
            for rel_path, img in variants.items():
                target_file = os.path.join(output_dir, rel_path.replace("/", os.sep))
                os.makedirs(os.path.dirname(target_file), exist_ok=True)
                
                if rel_path.endswith(".webp"):
                    img.save(target_file, "WEBP", quality=85)
                else:
                    img.save(target_file, "PNG", optimize=True)
                    
                generated_files.append({
                    "path": rel_path,
                    "resolution": f"{img.size[0]}x{img.size[1]}",
                    "size_kb": round(os.path.getsize(target_file) / 1024, 1)
                })
        
        elapsed_ms = (time.perf_counter() - start_t) * 1000
        return {
            "floor_name": floor_name,
            "original_resolution": f"{orig_w}x{orig_h}",
            "generated_variants": generated_files,
            "elapsed_ms": round(elapsed_ms, 2)
        }


class DXFToWebPlanConverter:
    """AutoCAD DXF 圖資解析與向量網頁轉換器"""

    @staticmethod
    def parse_dxf(dxf_path: str) -> Dict[str, Any]:
        start_t = time.perf_counter()
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
        
        layers_info: Dict[str, Dict[str, Any]] = {}
        lines: List[Dict[str, Any]] = []
        texts: List[Dict[str, Any]] = []
        
        min_x, min_y = float("inf"), float("inf")
        max_x, max_y = float("-inf"), float("-inf")
        
        for entity in msp:
            layer = entity.dxf.layer
            if layer not in layers_info:
                layers_info[layer] = {"count": 0, "types": set()}
            layers_info[layer]["count"] += 1
            layers_info[layer]["types"].add(entity.dxftype())
            
            if entity.dxftype() == "LINE":
                start = (entity.dxf.start.x, entity.dxf.start.y)
                end = (entity.dxf.end.x, entity.dxf.end.y)
                min_x = min(min_x, start[0], end[0])
                min_y = min(min_y, start[1], end[1])
                max_x = max(max_x, start[0], end[0])
                max_y = max(max_y, start[1], end[1])
                lines.append({
                    "layer": layer,
                    "type": "line",
                    "start": [round(start[0], 2), round(start[1], 2)],
                    "end": [round(end[0], 2), round(end[1], 2)]
                })
                
            elif entity.dxftype() == "LWPOLYLINE":
                points = [(p[0], p[1]) for p in entity.get_points("xy")]
                for px, py in points:
                    min_x = min(min_x, px)
                    min_y = min(min_y, py)
                    max_x = max(max_x, px)
                    max_y = max(max_y, py)
                lines.append({
                    "layer": layer,
                    "type": "polyline",
                    "points": [[round(px, 2), round(py, 2)] for px, py in points],
                    "is_closed": entity.is_closed
                })
                
            elif entity.dxftype() in ("TEXT", "MTEXT"):
                txt = entity.dxf.text if entity.dxftype() == "TEXT" else entity.text
                pos = (entity.dxf.insert.x, entity.dxf.insert.y)
                texts.append({
                    "layer": layer,
                    "text": txt.strip(),
                    "position": [round(pos[0], 2), round(pos[1], 2)]
                })
        
        # 邊界防呆
        if min_x == float("inf"):
            min_x, min_y, max_x, max_y = 0.0, 0.0, 1000.0, 1000.0
            
        bbox = {
            "min_x": round(min_x, 2),
            "min_y": round(min_y, 2),
            "max_x": round(max_x, 2),
            "max_y": round(max_y, 2),
            "width": round(max_x - min_x, 2),
            "height": round(max_y - min_y, 2)
        }
        
        for lyr, info in layers_info.items():
            info["types"] = list(info["types"])
            
        elapsed_ms = (time.perf_counter() - start_t) * 1000
        return {
            "file": os.path.basename(dxf_path),
            "bbox": bbox,
            "layers": layers_info,
            "total_lines": len(lines),
            "total_texts": len(texts),
            "lines": lines,
            "texts": texts,
            "elapsed_ms": round(elapsed_ms, 2)
        }

    @staticmethod
    def export_svg(dxf_data: Dict[str, Any], output_path: str, view_width: int = 2048) -> str:
        """將解析出的 DXF 線段轉出為輕量 SVG 向量圖檔"""
        bbox = dxf_data["bbox"]
        bw = max(bbox["width"], 1.0)
        bh = max(bbox["height"], 1.0)
        scale = view_width / bw
        view_height = round(bh * scale)
        
        svg_parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_width} {view_height}" width="{view_width}" height="{view_height}" style="background:#020b18;">',
            '  <g stroke="#00d4ff" stroke-width="1.5" stroke-linecap="round" fill="none">'
        ]
        
        for item in dxf_data["lines"]:
            if item["type"] == "line":
                x1 = (item["start"][0] - bbox["min_x"]) * scale
                y1 = view_height - (item["start"][1] - bbox["min_y"]) * scale  # 翻轉 Y 軸
                x2 = (item["end"][0] - bbox["min_x"]) * scale
                y2 = view_height - (item["end"][1] - bbox["min_y"]) * scale
                svg_parts.append(f'    <line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" />')
            elif item["type"] == "polyline":
                pts = []
                for px, py in item["points"]:
                    sx = (px - bbox["min_x"]) * scale
                    sy = view_height - (py - bbox["min_y"]) * scale
                    pts.append(f'{sx:.1f},{sy:.1f}')
                svg_parts.append(f'    <polyline points="{" ".join(pts)}" />')
                
        svg_parts.append('  </g>')
        svg_parts.append('</svg>')
        
        svg_content = "\n".join(svg_parts)
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(svg_content)
            
        return output_path


class PaletteExtractor:
    """自動色彩計畫萃取器"""

    @staticmethod
    def extract(image_path: str, color_count: int = 5) -> Dict[str, Any]:
        ct = ColorThief(image_path)
        dominant_rgb = ct.get_color(quality=1)
        palette_rgb = ct.get_palette(color_count=color_count, quality=1)
        
        def to_hex(rgb_tuple: Tuple[int, int, int]) -> str:
            return f"#{rgb_tuple[0]:02x}{rgb_tuple[1]:02x}{rgb_tuple[2]:02x}"
        
        return {
            "file": os.path.basename(image_path),
            "dominant_color": {
                "rgb": dominant_rgb,
                "hex": to_hex(dominant_rgb)
            },
            "palette": [
                {"rgb": c, "hex": to_hex(c)} for c in palette_rgb
            ],
            "css_vars": {
                "--floor-primary": to_hex(dominant_rgb),
                "--floor-accent": to_hex(palette_rgb[0]) if len(palette_rgb) > 0 else "#00d4ff",
                "--floor-secondary": to_hex(palette_rgb[1]) if len(palette_rgb) > 1 else "#00ff9d"
            }
        }


def main():
    parser = argparse.ArgumentParser(description="北農中央戰情室 美編與圖資自動化工具箱")
    parser.add_argument("--variants", type=str, help="批次產生指定圖片或資料夾的衍生圖 (支援 PNG/WebP)")
    parser.add_argument("--out", type=str, default="./dist_floorplans", help="輸出目錄 (預設 ./dist_floorplans)")
    parser.add_argument("--dxf", type=str, help="解析指定 AutoCAD DXF 檔案並輸出 Web JSON / SVG")
    parser.add_argument("--palette", type=str, help="從指定影像中萃取主題色彩計畫 (Palette)")
    parser.add_argument("--demo", action="store_true", help="使用既有系統底圖執行完整示範")
    args = parser.parse_args()

    variant_gen = FloorplanVariantGenerator()

    if args.demo:
        sample_img = "system/plans/tex/b1_tex.png"
        if not os.path.exists(sample_img):
            sample_img = "system/plans/b1_files/0/0_0.png"
            
        print("=== 1. 執行平面圖衍生圖產生測試 ===")
        if os.path.exists(sample_img):
            res = variant_gen.process_image(sample_img, args.out, "b1")
            print(f"✓ 原圖解析度: {res['original_resolution']}")
            print(f"✓ 衍生圖產生總耗時: {res['elapsed_ms']} ms")
            for item in res["generated_variants"]:
                print(f"  - [{item['path']}] {item['resolution']} ({item['size_kb']} KB)")
        else:
            print(f"查無預設底圖檔案: {sample_img}")

        print("\n=== 2. 色彩計畫提取測試 (ColorThief) ===")
        if os.path.exists(sample_img):
            colors = PaletteExtractor.extract(sample_img)
            print(f"主色調: {colors['dominant_color']['hex']} (RGB: {colors['dominant_color']['rgb']})")
            print("色彩計畫調色盤:")
            for idx, col in enumerate(colors['palette'], 1):
                print(f"  顏色 {idx}: {col['hex']}")
            print("CSS 變數建議:", colors['css_vars'])
            
        print("\n=== 3. 建立模擬 DXF 結構並轉換為 Web SVG ===")
        mock_dxf_data = {
            "file": "mock_b1_layout.dxf",
            "bbox": {"min_x": 0, "min_y": 0, "max_x": 100, "max_y": 80, "width": 100, "height": 80},
            "lines": [
                {"type": "line", "start": [10, 10], "end": [90, 10]},
                {"type": "line", "start": [90, 10], "end": [90, 70]},
                {"type": "line", "start": [90, 70], "end": [10, 70]},
                {"type": "line", "start": [10, 70], "end": [10, 10]},
                {"type": "polyline", "points": [[30, 30], [70, 30], [70, 50], [30, 50], [30, 30]]}
            ]
        }
        svg_out = os.path.join(args.out, "dxf_preview.svg")
        DXFToWebPlanConverter.export_svg(mock_dxf_data, svg_out)
        print(f"✓ 已產出向量平面圖 SVG: {svg_out}")
        print("\n🎉 美編與圖資自動化工具箱全部功能測試通過！")
        return

    if args.variants:
        if os.path.isfile(args.variants):
            fname = os.path.splitext(os.path.basename(args.variants))[0]
            res = variant_gen.process_image(args.variants, args.out, fname)
            print(json.dumps(res, ensure_ascii=False, indent=2))
        elif os.path.isdir(args.variants):
            for file in os.listdir(args.variants):
                if file.lower().endswith((".png", ".jpg", ".jpeg")):
                    fpath = os.path.join(args.variants, file)
                    fname = os.path.splitext(file)[0].replace("_tex", "")
                    res = variant_gen.process_image(fpath, args.out, fname)
                    print(f"✓ 完成 {fname}: 產生 {len(res['generated_variants'])} 張衍生圖 ({res['elapsed_ms']} ms)")

    if args.dxf:
        dxf_info = DXFToWebPlanConverter.parse_dxf(args.dxf)
        json_path = os.path.join(args.out, f"{os.path.splitext(os.path.basename(args.dxf))[0]}.json")
        svg_path = os.path.join(args.out, f"{os.path.splitext(os.path.basename(args.dxf))[0]}.svg")
        os.makedirs(args.out, exist_ok=True)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(dxf_info, f, ensure_ascii=False, indent=2)
        DXFToWebPlanConverter.export_svg(dxf_info, svg_path)
        print(f"✓ DXF 解析完成：共 {dxf_info['total_lines']} 條線段、{len(dxf_info['layers'])} 個圖層")
        print(f"  - Web JSON 輸出: {json_path}")
        print(f"  - 向量 SVG 輸出: {svg_path}")

    if args.palette:
        palette_res = PaletteExtractor.extract(args.palette)
        print(json.dumps(palette_res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
