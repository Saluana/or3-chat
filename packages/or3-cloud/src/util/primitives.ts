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
  // Find all matches in the original text before replacing any. Secrets can
  // overlap without one being a prefix of the other; sequential replacements
  // would otherwise leave part of a second secret visible.
  const mask = new Uint8Array(text.length);
  for (const secret of secrets.filter(Boolean)) {
    for (let index = text.indexOf(secret); index !== -1; index = text.indexOf(secret, index + 1)) mask.fill(1, index, index + secret.length);
  }
  let output = '', cursor = 0;
  for (let index = 0; index < mask.length;) {
    if (!mask[index]) { index += 1; continue; }
    output += `${text.slice(cursor, index)}[REDACTED]`;
    while (index < mask.length && mask[index]) index += 1;
    cursor = index;
  }
  output += text.slice(cursor);
  output = output.replace(
    /((?:PASSWORD|SECRET|TOKEN|JWT)\s*[=:]\s*)(?!\[REDACTED\])([^\r\n]+)/gi,
    '$1[REDACTED]'
  );
  return output;
}
