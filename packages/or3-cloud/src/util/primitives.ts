import { randomBytes } from 'node:crypto';

export function now() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}-${now().replaceAll(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
}

export function randomSecret() {
  return `or3-${randomBytes(32).toString('base64url')}`;
}

export function randomPassword() {
  return `A${randomBytes(20).toString('base64url')}a1`;
}

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function redact(text: string, secrets: string[] = []) {
  let output = text;
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, '[REDACTED]');
  output = output.replace(
    /((?:PASSWORD|SECRET|TOKEN|JWT)\s*[=:]\s*)(?!\[REDACTED\])([^\r\n]+)/gi,
    '$1[REDACTED]'
  );
  return output;
}
