import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync('web/app/layout.tsx', 'utf8');
const css = readFileSync('web/app/profile-modal-responsive.css', 'utf8');

assert.match(layout, /import '\.\/profile-modal-responsive\.css';/, '根版面必須載入個人資料彈窗的響應式修正');
assert.match(css, /\.profile-modal-bg\{overflow:auto\}/, '彈窗背景在小視窗必須允許整體捲動');
assert.match(css, /\.profile-modal-body\{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*grid-auto-rows:max-content;/, '彈窗內容區必須在 flex 版型中可收縮並保留內容高度');
assert.match(css, /\.profile-section\{[^}]*min-height:max-content;/, '每個資料區塊不得被 Grid 壓縮成只有標題');

console.log('個人資料彈窗版型檢查通過：100% 縮放與矮視窗仍保留表單內容並可在彈窗內捲動。');
