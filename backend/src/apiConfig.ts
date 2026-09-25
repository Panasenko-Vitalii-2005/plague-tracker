export interface ApiConfig {
  host: string;
  port: number;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const host = env.PLAGUE_API_HOST?.trim() || '127.0.0.1';
  if (/[\s\u0000-\u001f/\\]/.test(host)) {
    throw new Error('PLAGUE_API_HOST must be a hostname or IP address');
  }
  const rawPort = env.PLAGUE_API_PORT?.trim();
  const port = rawPort === undefined || rawPort === '' ? 3001 : Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error('PLAGUE_API_PORT must be an integer from 0 to 65535');
  }
  return { host, port };
}
