import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export function loadEnv(file: string = '.env'): void {
  const envPath = resolve(process.cwd(), file);
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [rawKey, ...rest] = trimmed.split('=');
    if (!rawKey) {
      continue;
    }
    const key = rawKey.trim();
    if (key === '') {
      continue;
    }
    if (process.env[key] !== undefined) {
      continue;
    }
    const value = rest.join('=').trim();
    const unquoted = value.replace(/^"|"$/g, '');
    process.env[key] = unquoted;
  }
}
