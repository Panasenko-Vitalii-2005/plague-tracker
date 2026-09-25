import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CollectorConfig {
  executablePath: string;
  intervalMilliseconds: number;
  debug: boolean;
}

const defaultExecutablePath = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', '..', '..', '..',
  'C# console collector', 'bin', 'Release', 'net8.0-windows', 'PlagueInc.MemoryCollector.exe',
);

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const rawInterval = env.PLAGUE_COLLECTOR_INTERVAL_MS?.trim();
  const intervalMilliseconds = rawInterval === undefined || rawInterval === '' ? 250 : Number(rawInterval);
  if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 250 || intervalMilliseconds > 60_000) {
    throw new Error('PLAGUE_COLLECTOR_INTERVAL_MS must be an integer from 250 to 60000');
  }

  return {
    executablePath: env.PLAGUE_COLLECTOR_PATH?.trim() || defaultExecutablePath,
    intervalMilliseconds,
    debug: env.PLAGUE_COLLECTOR_DEBUG?.trim().toLowerCase() === 'true',
  };
}
