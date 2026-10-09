// Shared by the deployment scripts: the component list (deploy/components.json) and registry helpers
// (docker buildx imagetools; the caller is logged in to the registry).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Components of this repository in deployment order, with environment overrides applied. */
export function components() {
  const config = JSON.parse(readFileSync(new URL('./components.json', import.meta.url), 'utf8'));
  return config.components.map(c => {
    const key = c.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return { ...c, app: process.env[`CAPROVER_APP_${key}`] || c.app, token: process.env[`CAPROVER_TOKEN_${key}`], envKey: key };
  });
}

/** Revision and version recorded on an image (OCI labels), or null when the reference does not exist. */
export function labels(reference) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Image}}'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    const image = JSON.parse(result.stdout);
    // Single-platform images print one config; multi-platform indexes print one per platform.
    const config = image.config ?? Object.values(image)[0]?.config ?? {};
    const l = config.Labels ?? {};
    return { commit: l['org.opencontainers.image.revision'], version: l['org.opencontainers.image.version'] };
  } catch {
    return null;
  }
}

/** Points `tag` of `repository` at the image `from` (no pull, no rebuild). */
export function retag(repository, from, tag) {
  return spawnSync('docker', ['buildx', 'imagetools', 'create', '--tag', `${repository}:${tag}`, `${repository}:${from}`], { encoding: 'utf8' }).status === 0;
}
