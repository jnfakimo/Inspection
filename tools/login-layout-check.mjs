import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const responsiveCss = readFileSync('web/app/login/login-responsive.css', 'utf8');
const globalCss = readFileSync('web/app/globals.css', 'utf8');

assert.match(globalCss, /\.login-card\{max-width:430px;width:100%/,
  '桌面登入卡的共用基準寬度必須維持 430px');
assert.match(responsiveCss, /\.v1-login-page:has\(> \.v1-login-card:not\(\.account-apply-card\)\)[\s\S]*?height: 100svh;[\s\S]*?overflow: hidden;/,
  '桌面登入頁必須限制在單一可視高度且不產生捲軸');
assert.match(responsiveCss, /\.v1-login-card:not\(\.account-apply-card\)[\s\S]*?zoom: \.8;/,
  '登入白色圖卡必須整體縮放為 80%');

console.log('V2 登入頁版型檢查通過：桌面白色圖卡 430px × 80% = 344px，100svh 且無頁面溢出，帳號申請表已排除。');
