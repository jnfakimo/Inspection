#!/usr/bin/env python3
"""
Staging Test Server - 持久啟動器
臺北農產巡檢系統 - Staging 環境測試服務器
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# 配置
HOST = '0.0.0.0'
PORT = 8765
PROJECT_DIR = Path(__file__).parent

class RequestHandler(SimpleHTTPRequestHandler):
    """自定義請求處理器"""

    def end_headers(self):
        # 添加 CORS 頭
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        """自定義日誌格式"""
        print(f"[{self.log_date_time_string()}] {format % args}")

def main():
    os.chdir(PROJECT_DIR)

    print("\n" + "="*60)
    print("  🧪 Staging Test Server - 啟動器")
    print("  臺北農產巡檢系統")
    print("="*60 + "\n")

    print(f"📁 工作目錄: {PROJECT_DIR}")
    print(f"🌐 服務器地址: http://localhost:{PORT}")
    print(f"🧪 測試控制台: http://localhost:{PORT}/system/staging-test.html")
    print(f"📄 首頁: http://localhost:{PORT}/system/index.html")
    print(f"⚙️  管理頁面: http://localhost:{PORT}/system/admin.html")
    print(f"\n⏹️  停止服務器: 按 Ctrl+C")
    print("="*60 + "\n")

    server = HTTPServer((HOST, PORT), RequestHandler)

    print(f"✅ 服務器已啟動在 {HOST}:{PORT}")
    print("⏳ 等待請求...\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n❌ 服務器已停止")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 錯誤: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
