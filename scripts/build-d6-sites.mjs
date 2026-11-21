import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { build } from 'vite';

const staticRoot = resolve('cloud-verify/dist');
const functionRoot = resolve('cloud-verify/functions');
const bundle = await rolldown({ input: resolve('server/sites-d6.ts'), platform: 'neutral' });
try {
  await bundle.write({ file: resolve(functionRoot, 'd6-shared.mjs'), format: 'esm' });
} finally {
  await bundle.close();
}

await build({
  define: {
    'import.meta.env.VITE_D5_SCENARIO_PATH': JSON.stringify('/functions/v1/app/api/d5/scenario'),
    'import.meta.env.VITE_D6_RUN_PATH': JSON.stringify('/functions/v1/app/api/d6/runs'),
  },
  build: { outDir: resolve(staticRoot, 'd6'), emptyOutDir: false },
});

console.log(`For the existing A site, use ${staticRoot} as the static root and ${functionRoot} as the Functions directory.`);

if (process.argv.includes('--verify-a-root')) {
  for (const entry of ['index.html', 'd2.html', 'd5/index.html', 'd6/index.html']) {
    const page = resolve(staticRoot, entry);
    const html = await readFile(page, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing ${entry}. Restore the preserved A site content before a full-root publication.`);
    });
    const assets = Array.from(html.matchAll(/(?:src|href)="\.\/(assets\/[\w.-]+)"/g), (match) => match[1]);
    if ((entry.startsWith('d5/') || entry.startsWith('d6/')) && !assets.some((name) => name.endsWith('.js'))) {
      throw new Error(`Missing script reference in ${entry}.`);
    }
    for (const file of [page, ...assets.map((name) => resolve(dirname(page), name))]) {
      const digest = createHash('sha256').update(await readFile(file)).digest('hex');
      console.log(`${digest}  ${relative(staticRoot, file).replaceAll('\\', '/')}`);
    }
  }
}
