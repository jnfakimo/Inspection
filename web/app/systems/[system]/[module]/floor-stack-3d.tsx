'use client';

// 共用的 3D 堆疊樓層場景。
//
// SYS-06 的「立體樓層模型」與 SYS-03 的「立體巡檢雲臺」都要同一套算繪，
// 差別只在餵進來的標記與著色規則，因此抽成單一元件，避免兩份 Three.js 程式碼
// 各自演化（V1 的 floor3d.html 與 guardpatrol3d.html 正是這樣分岔的）。
//
// three 以動態 import 載入，不會進入其他頁面的初始 bundle。

import { useEffect, useRef } from 'react';
import { SUPABASE_URL } from '@/lib/config';

export type StackModel = { floor_id: string; name?: string | null; image_path?: string | null; level?: number | null };
export type StackMarker = { id: string; floor_id: string; x: number; y: number; color: string; kind?: string; label?: string };

export const floorTextureUrl = (imagePath: unknown) =>
  imagePath ? `${SUPABASE_URL}/storage/v1/object/public/floorplans/${String(imagePath)}` : '';

export function floorOrder(floor: string) {
  const basement = floor.match(/^B(\d+)$/); if (basement) return -Number(basement[1]);
  if (floor === 'RF') return 999;
  const above = floor.match(/^(\d+)F$/); if (above) return Number(above[1]);
  return 500;
}

const PLANE_W = 10, PLANE_H = 7;

export function FloorStack3D({ models, markers, showMarkers = true, gap = 1.6, xPan = 0, yPan = 0, visibleKinds, showLabels, visibleFloors }: {
  models: StackModel[]; markers: StackMarker[]; showMarkers?: boolean; gap?: number;
  xPan?: number; yPan?: number;
  visibleKinds?: Record<string, boolean>;
  showLabels?: boolean;
  visibleFloors?: Record<string, boolean>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    if (!hostRef.current || !models.length) return;
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      host.innerHTML = '';

      const width = host.clientWidth || 900, height = host.clientHeight || 560;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x04101f);
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
      camera.position.set(9, 9, 12);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(xPan, models.length * gap / 2 + yPan, 0);

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const dir = new THREE.DirectionalLight(0xffffff, 0.7);
      dir.position.set(8, 14, 6);
      scene.add(dir);

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      // level 目前資料皆為 0，故以清單順序乘間距堆疊；日後 level 有值則優先採用。
      const useLevel = models.some(m => Number(m.level) !== 0);

      models.forEach((row, index) => {
        const y = useLevel ? Number(row.level) || 0 : index * gap;
        
        const isVisible = visibleFloors ? visibleFloors[String(row.floor_id)] !== false : true;
        if (!isVisible) return;
        
        const material = new THREE.MeshBasicMaterial({ color: 0x0a2036, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        scene.add(mesh);

        const url = floorTextureUrl(row.image_path);
        if (url) {
          loader.load(url, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
          }, undefined, () => { /* 貼圖載入失敗時保留底色，不中斷場景 */ });
        }

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLANE_W, PLANE_H)),
          new THREE.LineBasicMaterial({ color: 0x1a4a70 }));
        edges.rotation.x = -Math.PI / 2; edges.position.y = y + 0.002;
        scene.add(edges);

        if (showMarkers) {
          for (const marker of markers.filter(m => m.floor_id === String(row.floor_id))) {
            const isKindVisible = visibleKinds ? visibleKinds[marker.kind || ''] !== false : true;
            if (!isKindVisible) continue;
            
            const dot = new THREE.Mesh(
              new THREE.SphereGeometry(0.075, 12, 12),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(marker.color) }));
            // 標記的 x／y 為 0–1 相對座標，換算到平面尺寸並置中。
            dot.position.set(marker.x * PLANE_W - PLANE_W / 2, y + 0.12, marker.y * PLANE_H - PLANE_H / 2);
            scene.add(dot);
            
            if (showLabels && marker.label) {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d')!;
              ctx.font = 'bold 24px sans-serif';
              const textWidth = ctx.measureText(marker.label).width;
              canvas.width = Math.max(textWidth + 10, 64);
              canvas.height = 32;
              ctx.font = 'bold 24px sans-serif';
              ctx.fillStyle = '#ffffff';
              ctx.fillText(marker.label, 5, 24);
              
              const tex = new THREE.CanvasTexture(canvas);
              const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
              const sprite = new THREE.Sprite(mat);
              sprite.position.set(marker.x * PLANE_W - PLANE_W / 2, y + 0.35, marker.y * PLANE_H - PLANE_H / 2);
              sprite.scale.set(canvas.width / 40, canvas.height / 40, 1);
              scene.add(sprite);
            }
          }
        }
      });

      let raf = 0;
      const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
      tick();
      const onResize = () => {
        const w = host.clientWidth || width, h = host.clientHeight || height;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      cleanupRef.current = () => {
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
  }, [models, markers, showMarkers, gap, xPan, yPan, visibleKinds, showLabels, visibleFloors]);

  return <div ref={hostRef} className="plan-stage" style={{ width: '100%', height: '100%' }} />;
}
