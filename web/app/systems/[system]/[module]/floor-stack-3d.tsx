'use client';

// 共用的 3D 堆疊樓層場景。
//
// SYS-06 的「立體樓層模型」與 SYS-03 的「立體巡檢雲臺」都要同一套算繪，
// 差別只在餵進來的標記與著色規則，因此抽成單一元件，避免兩份 Three.js 程式碼
// 各自演化（V1 的 floor3d.html 與 guardpatrol3d.html 正是這樣分岔的）。
//
// three 以動態 import 載入，不會進入其他頁面的初始 bundle。

import { useEffect, useRef, useState } from 'react';

import { canonicalFloor } from '@/lib/floor';
import { perspectiveFitDistance } from '@/lib/perspective-fit';

// 樓層排序沿用全站唯一的 web/lib/floor.ts；此處再匯出，既有匯入端不必改寫。
export { floorOrder } from '@/lib/floor';

export type StackModel = {
  floor_id: string;
  name?: string | null;
  level?: number | null;
  /** 3D 與平面圖頁都只接受 GLB。 */
  glb_url: string;
  glb_bounds: { min: [number, number]; max: [number, number] };
};
export type StackMarker = { id: string; floor_id: string; x: number; y: number; color: string; kind?: string; label?: string };

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

// 編修工具既有匯入路徑仍由此轉送；FloorStack3D 本身不會讀取 PNG。
export { preparePlanCanvas, preparePlanObjectUrl } from '@/lib/floorplan-render';

export function FloorStack3D({ models, markers, showMarkers = true, gap = 1.6, xPan = 0, yPan = 0, visibleKinds, showLabels, visibleFloors, markerScale = 1, apiRef, planMode = false, onMarkerClick, onPlanClick }: {
  models: StackModel[]; markers: StackMarker[]; showMarkers?: boolean; gap?: number;
  xPan?: number; yPan?: number;
  visibleKinds?: Record<string, boolean>;
  showLabels?: boolean;
  visibleFloors?: Record<string, boolean>;
  /** 標記圓點的放大倍率（1 為原始大小）。拉桿即時生效，不重建場景。 */
  markerScale?: number;
  /** 可選。ref 物件的識別碼是穩定的，列入相依也不會多觸發場景重建。 */
  apiRef?: { current: FloorStackApi | null };
  /** 平面圖模式：固定正上方俯角，可平面旋轉、平移與縮放。 */
  planMode?: boolean;
  onMarkerClick?: (markerId: string) => void;
  onPlanClick?: (point: { x: number; y: number }) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  // 圓點大小用 ref＋獨立 effect 調整：拉桿每動一格都重建整個場景會嚴重卡頓。
  const markerScaleRef = useRef(markerScale);
  const dotsRef = useRef<Array<{ scale: { setScalar: (value: number) => void } }>>([]);
  const [modelErrors, setModelErrors] = useState<string[]>([]);

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
    markerScaleRef.current = markerScale;
    for (const dot of dotsRef.current) dot.scale.setScalar(markerScale);
  }, [markerScale]);

  useEffect(() => {
    let disposed = false;
    setModelErrors([]);
    const normalizedModels = models.map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
    const normalizedMarkers = markers.map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
    if (!hostRef.current || !normalizedModels.length) return;
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      host.innerHTML = '';

      const width = host.clientWidth || 900, height = host.clientHeight || 560;
      const scene = new THREE.Scene();
      const isLight = theme === 'light';
      // 與 .f3-stage 的 var(--bg) 對齊：兩者一旦有色差，畫布邊緣就會露出一條異色線。
      scene.background = new THREE.Color(isLight ? 0xf4f6fa : 0x020b18);
      const camera = planMode
        ? new THREE.OrthographicCamera(-4 * width / height, 4 * width / height, 4, -4, 0.1, 2000)
        : new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      if (planMode) {
        // 鎖定俯角、保留方位角，讓平面圖可以旋轉但不會被傾斜成透視視角。
        controls.minPolarAngle = 0.001;
        controls.maxPolarAngle = 0.001;
      }

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const dir = new THREE.DirectionalLight(0xffffff, 0.7);
      dir.position.set(8, 14, 6);
      scene.add(dir);

      // 圓點收集起來，讓大小拉桿可以直接改 scale，不必重建場景。
      const dots: Array<import('three').Mesh> = [];
      // 標籤沿用 depthTest:false，會全部疊著畫；收集起來在每次算繪時做螢幕空間剔除。
      const labelSprites: Array<import('three').Sprite> = [];
      const leaderLines: Array<{ leader: import('three').Line; sprite: import('three').Sprite }> = [];
      const gltfLoader = new GLTFLoader();
      // level 目前資料皆為 0，故以清單順序乘間距堆疊；日後 level 有值則優先採用。
      const explicitLevels = normalizedModels.map(row => Number.isFinite(Number(row.level)) ? Number(row.level) : 0);
      const useLevel = explicitLevels.some(level => level !== 0);
      const levels = explicitLevels.map((level, index) => useLevel ? level : index * gap);
      const visibleLevels = levels.filter((_, index) => visibleFloors?.[normalizedModels[index].floor_id] !== false);
      const framedLevels = visibleLevels.length ? visibleLevels : levels;
      const minY = Math.min(...framedLevels), maxY = Math.max(...framedLevels);
      let autoFit = true;
      const fitView = (direction: import('three').Vector3) => {
        controls.target.set(xPan, (minY + maxY) / 2 + yPan, 0);
        direction.normalize();
        if (camera instanceof THREE.OrthographicCamera) {
          const viewportWidth = host.clientWidth || width;
          const viewportHeight = host.clientHeight || height;
          camera.zoom = Math.min((8 * viewportWidth / viewportHeight) / PLANE_W, 8 / PLANE_H) * 0.9;
          camera.position.copy(controls.target).addScaledVector(direction, 20);
          camera.updateProjectionMatrix();
          controls.update();
          return;
        }
        const distance = perspectiveFitDistance({
          min: [-PLANE_W / 2, minY - 0.05, -PLANE_H / 2],
          max: [PLANE_W / 2, maxY + 0.3, PLANE_H / 2],
          target: [controls.target.x, controls.target.y, controls.target.z],
          direction: [direction.x, direction.y, direction.z], fov: camera.fov, aspect: camera.aspect,
        });
        camera.position.copy(controls.target).addScaledVector(direction, distance);
        camera.far = Math.max(2000, distance * 4);
        camera.updateProjectionMatrix();
        controls.update();
      };
      // Fit both horizontal and vertical fields of view; portrait screens are narrower.
      fitView(planMode ? new THREE.Vector3(0.001, 1, 0) : new THREE.Vector3(9, 9, 12));
      const stopAutoFit = () => { autoFit = false; };
      controls.addEventListener('start', stopAutoFit);

      normalizedModels.forEach((row, index) => {
        const y = levels[index];
        
        const isVisible = visibleFloors ? visibleFloors[String(row.floor_id)] !== false : true;
        if (!isVisible) return;
        
        {
          const bounds = row.glb_bounds;
          const spanX = Math.max(bounds.max[0] - bounds.min[0], 0.001);
          const spanZ = Math.max(bounds.max[1] - bounds.min[1], 0.001);
          const scaleX = PLANE_W / spanX;
          const scaleZ = PLANE_H / spanZ;
          const scaleY = Math.min(scaleX, scaleZ);
          const centreX = (bounds.min[0] + bounds.max[0]) / 2;
          const centreMapY = (bounds.min[1] + bounds.max[1]) / 2;
          gltfLoader.load(String(row.glb_url), gltf => {
            if (disposed) return;
            gltf.scene.scale.set(scaleX, scaleY, scaleZ);
            // GLB 以 [x, 高度, -mapY] 儲存；縮放後對齊原本 10×7 的標記座標平面。
            gltf.scene.position.set(-centreX * scaleX, y, centreMapY * scaleZ);
            gltf.scene.traverse(object => {
              if (!(object as import('three').Mesh).isMesh) return;
              const source = object as import('three').Mesh;
              const category = source.name.replace(/_\d+$/, '');
              const common = { roughness: .9, metalness: .02, flatShading: true };
              if (category === 'glass') source.material = new THREE.MeshStandardMaterial({
                ...common, color: 0x5faab5, transparent: true, opacity: .36, depthWrite: false, side: THREE.DoubleSide,
              });
              else source.material = new THREE.MeshStandardMaterial({
                ...common,
                color: category === 'slab' ? (isLight ? 0xcfd8d5 : 0x26383a)
                  : category === 'wall' ? (isLight ? 0xe1e7e4 : 0x354a4b)
                    : category === 'column' ? (isLight ? 0x96a7a7 : 0x6f8585)
                      : category === 'ramp' ? (isLight ? 0xc8bda9 : 0x766d5d)
                        : (isLight ? 0xa9b9b6 : 0x657b78),
                side: category === 'wall' ? THREE.DoubleSide : THREE.FrontSide,
              });
              const outline = new THREE.LineSegments(
                new THREE.EdgesGeometry(source.geometry, 32),
                new THREE.LineBasicMaterial({
                  color: 0x21fff0, transparent: true, opacity: isLight ? .72 : .88,
                  blending: isLight ? THREE.NormalBlending : THREE.AdditiveBlending,
                  depthWrite: false, toneMapped: false,
                }));
              outline.renderOrder = 4;
              source.add(outline);
            });
            scene.add(gltf.scene);
          }, undefined, error => {
            console.error(`GLB 樓層模型載入失敗：${row.floor_id}`, error);
            if (!disposed) setModelErrors(current => current.includes(row.floor_id) ? current : [...current, row.floor_id]);
          });
        }

        if (showMarkers) {
          for (const marker of normalizedMarkers.filter(m => m.floor_id === String(row.floor_id))) {
            const isKindVisible = visibleKinds ? visibleKinds[marker.kind || ''] !== false : true;
            if (!isKindVisible) continue;
            
            const dot = new THREE.Mesh(
              // 原點再縮 50%（0.045 → 0.0225）：密集區才看得出每一顆的位置。
              // 實際大小再乘上使用者拉桿的倍率。
              new THREE.SphereGeometry(0.0225, 12, 12),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(isLight ? darkenColor(marker.color) : marker.color) }));
            dot.scale.setScalar(markerScaleRef.current);
            dot.userData.markerId = marker.id;
            dots.push(dot);
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

      // 平面圖以同一份 GLB 場景做點選與重新定位，不再依賴 PNG／OpenSeadragon。
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerStart: { x: number; y: number } | null = null;
      const onPointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
      const onPointerUp = (event: PointerEvent) => {
        if (!planMode || !pointerStart) return;
        const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
        pointerStart = null;
        if (moved > 6) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const markerHit = raycaster.intersectObjects(dots, false)[0]?.object;
        const markerId = markerHit?.userData.markerId;
        if (markerId && onMarkerClick) { onMarkerClick(String(markerId)); return; }
        if (!onPlanClick) return;
        const floorY = levels[0] ?? 0;
        const world = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), new THREE.Vector3());
        if (!world) return;
        onPlanClick({
          x: Math.max(0, Math.min(1, (world.x + PLANE_W / 2) / PLANE_W)),
          y: Math.max(0, Math.min(1, (world.z + PLANE_H / 2) / PLANE_H)),
        });
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

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
      if (apiRef) {
        apiRef.current = {
          resetView: () => {
            autoFit = true;
            fitView(planMode ? new THREE.Vector3(0.001, 1, 0) : new THREE.Vector3(9, 9, 12));
          },
          topView: () => {
            autoFit = true;
            fitView(new THREE.Vector3(0.001, 1, 0));
          },
          focusMarker: markerId => {
            const marker = normalizedMarkers.find(item => item.id === markerId);
            if (!marker) return false;
            const index = normalizedModels.findIndex(row => String(row.floor_id) === marker.floor_id);
            if (index < 0) return false;
            autoFit = false;
            const y = levels[index] + 0.12;
            const px = marker.x * PLANE_W - PLANE_W / 2;
            const pz = marker.y * PLANE_H - PLANE_H / 2;
            controls.target.set(px, y, pz);
            camera.position.set(px + 3, y + 3, pz + 4);
            controls.update();
            return true;
          },
        };
      }
      dotsRef.current = dots;

      const onResize = () => {
        const w = host.clientWidth || width, h = host.clientHeight || height;
        if (camera instanceof THREE.OrthographicCamera) {
          camera.left = -4 * w / h; camera.right = 4 * w / h;
          camera.top = 4; camera.bottom = -4;
        } else camera.aspect = w / h;
        camera.updateProjectionMatrix(); renderer.setSize(w, h);
        if (autoFit) fitView(camera.position.clone().sub(controls.target));
      };
      window.addEventListener('resize', onResize);

      cleanupRef.current = () => {
        if (apiRef) apiRef.current = null;
        dotsRef.current = [];
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        controls.removeEventListener('start', stopAutoFit);
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
  }, [models, markers, showMarkers, gap, xPan, yPan, visibleKinds, showLabels, visibleFloors, apiRef, theme, planMode, onMarkerClick, onPlanClick]);

  return <div className="plan-stage" style={{ width: '100%', height: '100%', position: 'relative' }}>
    <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    {modelErrors.length > 0 && <div role="alert" style={{
      position: 'absolute', left: 16, bottom: 16, zIndex: 8, padding: '8px 12px',
      border: '1px solid #ff5470', borderRadius: 8, background: 'rgba(22, 5, 12, .9)', color: '#fff',
    }}>GLB 載入失敗：{modelErrors.join('、')}</div>}
  </div>;
}
