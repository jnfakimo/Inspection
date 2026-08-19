import { build } from 'esbuild';

await build({
  entryPoints: ['backend/node-api/server.ts'],
  outfile: 'backend/node-api/dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  plugins: [{
    name: 'supabase-edge-import',
    setup(builder) {
      builder.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@/ }, () => ({
        path: '@supabase/supabase-js',
        external: true,
      }));
    },
  }],
});

