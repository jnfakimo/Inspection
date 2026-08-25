'use client';

// 共用的 3D 堆疊樓層場景。
//
// SYS-06 的「立體樓層模型」與 SYS-03 的「立體巡檢雲臺」都要同一套算繪，
// 差別只在餵進來的標記與著色規則，因此抽成單一元件，避免兩份 Three.js 程式碼
// 各自演化（V1 的 floor3d.html 與 guardpatrol3d.html 正是這樣分岔的）。
//
// three 以動態 import 載入，不會進入其他頁面的初始 bundle。

import { useEffect, useRef, useState } from 'react';

import { SUPABASE_URL } from '@/lib/config';
import { canonicalFloor } from '@/lib/floor';

// 樓層排序沿用全站唯一的 web/lib/floor.ts；此處再匯出，既有匯入端不必改寫。
export { floorOrder } from '@/lib/floor';

export type StackModel = { floor_id: string; name?: string | null; image_path?: string | null; level?: number | null };
export type StackMarker = { id: string; floor_id: string; x: number; y: number; color: string; kind?: string; label?: string };

export const floorTextureUrl = (imagePath: unknown) =>
  imagePath ? `${SUPABASE_URL}/storage/v1/object/public/floorplans/${String(imagePath)}` : '';


const PLANE_W = 10, PLANE_H = 7;

// 將亮色 hex 轉為深色版本（light theme 用，提高對比度）
function darkenColor(hex: string): string {
  const c = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((c >> 16) & 0xff) * 0.45);
  const g = Math.round(((c >> 8) & 0xff) * 0.45);
  const b = Math.round((c & 0xff) * 0.45);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/** 場景建立後交給呼叫端的相機操作介面（SYS-06 的 3D模型圖用來做「重置」與「俯視」）。 */
export type FloorStackApi = {
  /** 回到預設的四分之三視角。 */
  resetView: () => void;
  /** 從正上方俯視。 */
  topView: () => void;
  /** 把鏡頭拉到指定標記（供 ?marker= 深連結使用）。找不到時回傳 false。 */
  focusMarker: (markerId: string) => boolean;
};

/**
 * 把平面圖貼圖重畫成「黑線 + 透明底」。
 *
 * 線條顏色是烘在 PNG 裡的青色，用 material.color 相乘雖然能把青色壓成黑色，
 * 但只要圖檔是不透明白底，整片平面就會一起變黑。逐像素判斷才安全：
 * 亮度接近白的視為背景（轉全透明），其餘視為線條（塗黑並保留原本的濃淡）。
 */
function preparePlanTexture(THREE: typeof import('three'), texture: import('three').Texture, mode: 'light' | 'tech'): import('three').Texture {
  const image = texture.image as HTMLImageElement | undefined;
  if (!image?.width) return texture;
  const canvas = preparePlanCanvas(image, mode);
  if (!canvas) return texture;
  const recoloured = new THREE.CanvasTexture(canvas);
  recoloured.colorSpace = THREE.SRGBColorSpace;
  return recoloured;
}

/**
 * 貼圖預處理的實作本體，與 three.js 無關，平面模型圖也用同一份。
 * 取不到像素（跨網域讓 canvas 汙染）時回傳 null，由呼叫端決定退回原圖。
 *
 * - light：近白視為背景轉透明，其餘塗黑（線條顏色烘在圖檔裡，改不掉，只能重畫）。
 * - tech ：保留原色，但濾掉光暈。renderNeon 是三道疊出來的（blur 4／1.5／0），
 *   低透明度那兩道在深底上讓線看起來比一般版粗一截。實測 B1.png 的透明度分布：
 *   全透明 89.4%、1–15 的外圈光暈 3.4%、16–63 的內圈光暈 3.2%、核心線 2.5%——
 *   光暈是核心的兩倍多。等倍率目視比對後採門檻 64（濾掉整片光暈），此時與一般版
 *   的粗細最接近；門檻 32 仍明顯偏粗。
 */
const GLOW_ALPHA_CUTOFF = 64;

export function preparePlanCanvas(image: HTMLImageElement, mode: 'light' | 'tech'): HTMLCanvasElement | null {
  if (!image.width) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    let clear = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha === 0) { clear += 1; continue; } // 原本就透明，不動
      if (mode === 'tech') {
        if (alpha < GLOW_ALPHA_CUTOFF) pixels[i + 3] = 0;   // 濾掉光暈，只留核心線
        continue;                                            // 顏色不動
      }
      const luma = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      if (luma > 232) { pixels[i + 3] = 0; clear += 1; continue; } // 近白＝背景
      pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0;
    }
    // 保險絲：這套重畫的前提是貼圖為「線條＋透明（或近白）底」，也就是 3D建模系統
    // renderNeon 目前產出的樣子（實測 B1.png 約 89% 全透明）。若哪天建模端改成不透明
    // 深色底，逐像素塗黑會把整片平面變成一塊黑色——那比不重畫還糟，而且是靜默的。
    // 判定為底圖不透明時直接放棄重畫，沿用原圖並留下線索。
    const clearRatio = clear / (pixels.length / 4);
    if (mode === 'light' && clearRatio < 0.2) {
      console.warn(`平面圖底圖不透明（可視為背景的像素僅 ${(clearRatio * 100).toFixed(1)}%），`
        + '略過淺色主題的黑線重畫。請確認 3D建模系統 renderNeon 的產出格式是否變更。');
      return null;
    }
    ctx.putImageData(data, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}

/**
 * 載入平面圖、重畫成黑線，回傳可直接餵給 OpenSeadragon 的 blob 網址。
 * 失敗時回傳 null（呼叫端沿用原網址）。用 blob 而非 dataURL：長邊 2400px 的圖轉成
 * base64 會多出三分之一體積，而且無法釋放。呼叫端負責 revokeObjectURL。
 */
export function preparePlanObjectUrl(url: string, mode: 'light' | 'tech'): Promise<string | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = preparePlanCanvas(image, mode);
      if (!canvas) return resolve(null);
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function FloorStack3D({ models, markers, showMarkers = true, gap = 1.6, xPan = 0, yPan = 0, visibleKinds, showLabels, visibleFloors, apiRef }: {
  models: StackModel[]; markers: StackMarker[]; showMarkers?: boolean; gap?: number;
  xPan?: number; yPan?: number;
  visibleKinds?: Record<string, boolean>;
  showLabels?: boolean;
  visibleFloors?: Record<string, boolean>;
  /** 可選。ref 物件的識別碼是穩定的，列入相依也不會多觸發場景重建。 */
  apiRef?: { current: FloorStackApi | null };
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  // 主題會影響場景底色、樓層板顏色、邊線顏色與貼圖重畫，而這些全在建場景時就決定。
  // 必須跟著 data-theme 變動重建，否則切換主題後畫面停在舊主題直到重新整理——
  // 這個缺口一直存在，只是全螢幕工具頁先前沒有切換入口，切不了也就看不出來。
  const [theme, setTheme] = useState(() =>
    (typeof document === 'undefined' ? 'light' : document.documentElement.getAttribute('data-theme')) || 'light');
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute('data-theme') || 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    const normalizedModels = models.map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
    const normalizedMarkers = markers.map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
    if (!hostRef.current || !normalizedModels.length) return;
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      host.innerHTML = '';

      const width = host.clientWidth || 900, height = host.clientHeight || 560;
      const scene = new THREE.Scene();
      const isLight = theme === 'light';
      // 與 .f3-stage 的 var(--bg) 對齊：兩者一旦有色差，畫布邊緣就會露出一條異色線。
      scene.background = new THREE.Color(isLight ? 0xf4f6fa : 0x020b18);
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.position.set(9, 9, 12);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(xPan, normalizedModels.length * gap / 2 + yPan, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const dir = new THREE.DirectionalLight(0xffffff, 0.7);
      dir.position.set(8, 14, 6);
      scene.add(dir);

      // 標籤沿用 depthTest:false，會全部疊著畫；收集起來在每次算繪時做螢幕空間剔除。
      const labelSprites: Array<import('three').Sprite> = [];
      const leaderLines: Array<{ leader: import('three').Line; sprite: import('three').Sprite }> = [];
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      // level 目前資料皆為 0，故以清單順序乘間距堆疊；日後 level 有值則優先採用。
      const useLevel = normalizedModels.some(m => Number(m.level) !== 0);

      normalizedModels.forEach((row, index) => {
        const y = useLevel ? Number(row.level) || 0 : index * gap;
        
        const isVisible = visibleFloors ? visibleFloors[String(row.floor_id)] !== false : true;
        if (!isVisible) return;
        
        const material = new THREE.MeshBasicMaterial({ color: isLight ? 0xe0e0e0 : 0x0a2036, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        scene.add(mesh);

        const url = floorTextureUrl(row.image_path);
        if (url) {
          loader.load(url, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            // 平面圖的線條顏色烘在圖檔裡（青色）。淺色主題要黑線，但不能用
            // material.color 相乘——若圖檔是不透明白底，整片平面會變黑。
            // 改為逐像素重畫：近白視為背景轉全透明，其餘一律塗黑。
            // 這同時讓堆疊的樓層彼此看得穿，不再互相遮擋。
            material.map = preparePlanTexture(THREE, texture, isLight ? 'light' : 'tech');
            material.color.set(0xffffff);
            material.needsUpdate = true;
          }, undefined, () => { /* 貼圖載入失敗時保留底色，不中斷場景 */ });
        }

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLANE_W, PLANE_H)),
          new THREE.LineBasicMaterial({ color: isLight ? 0x000000 : 0x1a4a70 }));
        edges.rotation.x = -Math.PI / 2; edges.position.y = y + 0.002;
        scene.add(edges);

        if (showMarkers) {
          for (const marker of normalizedMarkers.filter(m => m.floor_id === String(row.floor_id))) {
            const isKindVisible = visibleKinds ? visibleKinds[marker.kind || ''] !== false : true;
            if (!isKindVisible) continue;
            
            const dot = new THREE.Mesh(
              // 原點再縮 50%（0.045 → 0.0225）：密集區才看得出每一顆的位置。
              new THREE.SphereGeometry(0.0225, 12, 12),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(isLight ? darkenColor(marker.color) : marker.color) }));
            // 標記的 x／y 為 0–1 相對座標，換算到平面尺寸並置中。
            dot.position.set(marker.x * PLANE_W - PLANE_W / 2, y + 0.12, marker.y * PLANE_H - PLANE_H / 2);
            scene.add(dot);
            
            if (showLabels && marker.label) {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d')!;
              // 字級縮為 80%（14 → 11.2，取 11）。
              const FONT = '11px sans-serif';
              ctx.font = FONT;
              const textWidth = ctx.measureText(marker.label).width;
              canvas.width = Math.max(textWidth + 14, 56);
              canvas.height = 20;
              // 底色板：描邊只能救單一字元的邊緣，標籤疊在密集的圖面線條上仍然難讀。
              // 鋪一塊半透明底再寫字，字才會從圖面裡跳出來。
              const radius = 5;
              ctx.beginPath();
              ctx.moveTo(radius, 0);
              ctx.lineTo(canvas.width - radius, 0);
              ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
              ctx.lineTo(canvas.width, canvas.height - radius);
              ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
              ctx.lineTo(radius, canvas.height);
              ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
              ctx.lineTo(0, radius);
              ctx.quadraticCurveTo(0, 0, radius, 0);
              ctx.closePath();
              // 螢光青底：在黑白線稿的圖面上對比最強，深淺兩個主題都跳得出來。
              ctx.fillStyle = 'rgba(0, 245, 212, 0.92)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(0, 90, 82, 0.85)';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.font = FONT;
              // 底色是亮螢光，文字一律用純黑才有足夠對比，不隨主題改變。
              ctx.fillStyle = '#000000';
              ctx.fillText(marker.label, 7, 14);
              
              const tex = new THREE.CanvasTexture(canvas);
              const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
              const sprite = new THREE.Sprite(mat);
              // 標籤抬高並拉一條引線回到原點：貼在原點上會蓋住標記本身，抬高之後
              // 密集區的文字彼此錯開，靠引線仍看得出對應哪一顆。
              const px = marker.x * PLANE_W - PLANE_W / 2;
              const pz = marker.y * PLANE_H - PLANE_H / 2;
              const LEADER = 0.24;
              sprite.position.set(px, y + 0.12 + LEADER, pz);
              // 縮小 50% 用 sprite 縮放而不是縮小畫布字級：畫布字級是貼圖的解析度，
              // 調到 5～6px 會糊掉；維持 11px 再把貼圖縮小顯示，字反而更銳利。
              sprite.scale.set(canvas.width / 104, canvas.height / 104, 1);
              scene.add(sprite);
              labelSprites.push(sprite);

              const leader = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(px, y + 0.12, pz),
                  new THREE.Vector3(px, y + 0.12 + LEADER, pz),
                ]),
                new THREE.LineBasicMaterial({ color: 0x00b39c, transparent: true, opacity: 0.85, depthTest: false }));
              scene.add(leader);
              // 標籤被剔除時引線也要跟著消失，否則會留下一堆指向空白的線。
              leaderLines.push({ leader, sprite });
            }
          }
        }
      });

      let raf = 0;
      // 螢幕空間網格剔除：把畫面切成格子，每格只留離鏡頭最近的一個標籤。
      // 不做精確的矩形碰撞是刻意的——標籤的螢幕尺寸隨距離變動，用固定格子既穩定
      // 又便宜，密集區會自動只顯示代表性的幾個，轉動視角時即時重算。
      // 標籤縮小一半後占用的螢幕空間也減半，格子跟著縮才不會白白剔掉還放得下的標籤。
      const LABEL_CELL_W = 58;
      const LABEL_CELL_H = 14;
      const occupied = new Set<string>();
      const projected = new THREE.Vector3();
      const cullLabels = () => {
        if (!labelSprites.length) return;
        const { clientWidth: vw, clientHeight: vh } = host;
        occupied.clear();
        const ordered = labelSprites
          .map(sprite => ({ sprite, distance: camera.position.distanceTo(sprite.position) }))
          .sort((a, b) => a.distance - b.distance);
        for (const { sprite } of ordered) {
          projected.copy(sprite.position).project(camera);
          if (projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) {
            sprite.visible = false;
            continue;
          }
          const sx = (projected.x + 1) / 2 * vw;
          const sy = (1 - projected.y) / 2 * vh;
          const key = `${Math.floor(sx / LABEL_CELL_W)}:${Math.floor(sy / LABEL_CELL_H)}`;
          if (occupied.has(key)) { sprite.visible = false; continue; }
          occupied.add(key);
          sprite.visible = true;
        }
        for (const { leader, sprite } of leaderLines) leader.visible = sprite.visible;
      };
      let frame = 0;
      const tick = () => {
        controls.update();
        // 每四格畫面重算一次即可，肉眼看不出延遲，卻省下大部分計算。
        if (frame % 4 === 0) cullLabels();
        frame += 1;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      // V1 的 resetView／topView 是直接設定自製球座標的 theta／phi／r；這裡場景尺度不同
      // （V1 以公尺計、本元件的平面固定為 10×7 單位），因此改以等效視角表達：
      // 重置＝預設的四分之三視角，俯視＝正上方。
      const stackTop = normalizedModels.length * gap;
      if (apiRef) {
        apiRef.current = {
          resetView: () => {
            controls.target.set(xPan, stackTop / 2 + yPan, 0);
            camera.position.set(9, 9, 12);
            controls.update();
          },
          topView: () => {
            controls.target.set(xPan, stackTop / 2 + yPan, 0);
            camera.position.set(xPan + 0.001, stackTop / 2 + yPan + 18, 0);
            controls.update();
          },
          focusMarker: markerId => {
            const marker = normalizedMarkers.find(item => item.id === markerId);
            if (!marker) return false;
            const index = normalizedModels.findIndex(row => String(row.floor_id) === marker.floor_id);
            if (index < 0) return false;
            const y = (useLevel ? Number(normalizedModels[index].level) || 0 : index * gap) + 0.12;
            const px = marker.x * PLANE_W - PLANE_W / 2;
            const pz = marker.y * PLANE_H - PLANE_H / 2;
            controls.target.set(px, y, pz);
            camera.position.set(px + 3, y + 3, pz + 4);
            controls.update();
            return true;
          },
        };
      }
      const onResize = () => {
        const w = host.clientWidth || width, h = host.clientHeight || height;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      cleanupRef.current = () => {
        if (apiRef) apiRef.current = null;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        scene.traverse(obj => {
          const mesh = obj as unknown as { geometry?: { dispose?: () => void }; material?: unknown };
          mesh.geometry?.dispose?.();
          const mat = mesh.material as { map?: { dispose?: () => void }; dispose?: () => void } | Array<{ map?: { dispose?: () => void }; dispose?: () => void }> | undefined;
          if (Array.isArray(mat)) mat.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
          else if (mat) { mat.map?.dispose?.(); mat.dispose?.(); }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();
    return () => { disposed = true; cleanupRef.current(); cleanupRef.current = () => {}; };
  }, [models, markers, showMarkers, gap, xPan, yPan, visibleKinds, showLabels, visibleFloors, apiRef, theme]);

  return <div ref={hostRef} className="plan-stage" style={{ width: '100%', height: '100%' }} />;
}
