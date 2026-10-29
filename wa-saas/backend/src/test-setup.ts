/**
 * Test-only env defaults so specs can import modules that read `config` at load time.
 * Real values always come from the environment; these are never used outside Jest.
 */
const defaults: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_STEPUP_SECRET: 'test-stepup-secret-at-least-32-characters',
  SECRETS_MASTER_KEY: Buffer.alloc(32).toString('base64'),
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
