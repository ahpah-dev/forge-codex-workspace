import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readEncryptedProviderKeys, decryptProviderKey } from './provider-secrets.mjs';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const providerId = process.argv[2] || '';

try {
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(providerId)) throw new Error('Invalid provider identifier.');
  const dataRoot = process.env.FORGE_DATA_DIR || path.join(appRoot, 'data');
  const secrets = await readEncryptedProviderKeys(path.join(dataRoot, 'provider-secrets.json'));
  const encrypted = secrets[providerId];
  if (typeof encrypted !== 'string' || !encrypted) throw new Error('Provider key is not configured.');
  const key = await decryptProviderKey(encrypted);
  if (!key) throw new Error('Provider key is empty.');
  process.stdout.write(key);
} catch (error) {
  process.stderr.write(`Forge could not unlock this provider key: ${error.message}\n`);
  process.exitCode = 1;
}
