const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const file of ['background', 'interactions', 'overviewMemory', 'batchActions', 'organizeTabs', 'titleKeywords', 'previewSearch']) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../tests/' + file + '.cjs')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
