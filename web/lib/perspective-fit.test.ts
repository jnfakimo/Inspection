import assert from 'node:assert/strict';
import test from 'node:test';
import { perspectiveFitDistance } from './perspective-fit.ts';

function projectPoint({ point, target, direction, distance, fov, aspect }: {
  point: readonly [number, number, number];
  target: readonly [number, number, number];
  direction: readonly [number, number, number];
  distance: number;
  fov: number;
  aspect: number;
}) {
  const dirLen = Math.hypot(...direction);
  const back = [direction[0] / dirLen, direction[1] / dirLen, direction[2] / dirLen];
  const horizontal = Math.hypot(back[0], back[2]);
  const right = horizontal > 0 ? [back[2] / horizontal, 0, -back[0] / horizontal] : [1, 0, 0];
  const up = [back[1] * right[2], back[2] * right[0] - back[0] * right[2], -back[1] * right[0]];

  const camPos = [
    target[0] + back[0] * distance,
    target[1] + back[1] * distance,
    target[2] + back[2] * distance,
  ];

  const rel = [point[0] - camPos[0], point[1] - camPos[1], point[2] - camPos[2]];
  const xCam = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
  const yCam = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
  const zCam = -(rel[0] * back[0] + rel[1] * back[1] + rel[2] * back[2]);

  const tanY = Math.tan((fov * Math.PI) / 360);
  const tanX = tanY * aspect;

  return {
    x: xCam / (zCam * tanX),
    y: yCam / (zCam * tanY),
    z: zCam,
  };
}

test('actual perspective projection keeps every floor corner inside portrait and landscape frames', () => {
  for (const [width, height] of [[320, 760], [375, 762], [812, 325], [1280, 720]]) {
    const aspect = width / height;
    for (const [minY, maxY] of [[0, 9.6], [0, 0], [-4, 22], [6, 6]]) {
      for (const direction of [[9, 9, 12], [0.001, 1, 0], [-5, 3, -12]] as const) {
        for (const pan of [0, 3]) {
          const target = [pan, (minY + maxY) / 2 + pan, 0] as const;
          const distance = perspectiveFitDistance({
            min: [-5, minY - 0.05, -3.5],
            max: [5, maxY + 0.3, 3.5],
            target,
            direction,
            fov: 45,
            aspect,
          });

          for (const x of [-5, 5]) {
            for (const y of [minY, maxY]) {
              for (const z of [-3.5, 3.5]) {
                const proj = projectPoint({
                  point: [x, y, z],
                  target,
                  direction,
                  distance,
                  fov: 45,
                  aspect,
                });
                assert.ok(
                  Math.abs(proj.x) < 0.92 && Math.abs(proj.y) < 0.92,
                  `clipped at ${width}x${height}: ${JSON.stringify(proj)}`
                );
                assert.ok(proj.z > 0, 'point must be in front of camera');
              }
            }
          }
        }
      }
    }
  }
});

test('portrait distance increases to account for the narrower horizontal field of view', () => {
  const box = { min: [-5, 0, -3.5] as const, max: [5, 9.6, 3.5] as const, target: [0, 4.8, 0] as const, direction: [9, 9, 12] as const, fov: 45 };
  assert.ok(perspectiveFitDistance({ ...box, aspect: 375 / 762 }) > perspectiveFitDistance({ ...box, aspect: 1280 / 720 }));
});
