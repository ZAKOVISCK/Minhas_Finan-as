import { serializeBackup, parseBackup, MAX_BACKUP_BYTES } from "./finance.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const TAG_BYTES = 16;
const MAX_CIPHER_BYTES = MAX_BACKUP_BYTES + TAG_BYTES;
export const ITERATIONS = 600_000;
export const MAX_ENCRYPTED_BYTES = 48 * 1024 * 1024;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function b64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function unb64(text, max, min = 0) {
  const invalid = () => {
    throw new Error("Envelope de criptografia inválido.");
  };
  if (
    typeof text !== "string" ||
    !text.length ||
    text.length % 4 ||
    text.length > Math.ceil(max / 3) * 4
  )
    invalid();
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const length = (text.length / 4) * 3 - padding;
  // Check the decoded size before atob allocates a second copy of an untrusted file.
  if (length < min || length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    invalid();
  // RFC 4648 requires unused bits to be zero. Accept exactly the format we export.
  if (
    (padding === 2 && BASE64.indexOf(text.at(-3)) & 15) ||
    (padding === 1 && BASE64.indexOf(text.at(-2)) & 3)
  )
    invalid();
  let binary;
  try {
    binary = atob(text);
  } catch {
    invalid();
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function validateKdf(kdf) {
  const invalid = () => {
    throw new Error("Parâmetros de criptografia não suportados.");
  };
  if (
    !object(kdf) ||
    kdf.algorithm !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    kdf.iterations !== ITERATIONS
  )
    invalid();
  try {
    unb64(kdf.salt, 16, 16);
  } catch {
    invalid();
  }
  // Do not copy arbitrary metadata into an exported backup.
  return {
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
    salt: kdf.salt,
  };
}

export function newKdf() {
  return {
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
    salt: b64(crypto.getRandomValues(new Uint8Array(16))),
  };
}

export async function deriveKey(password, kdf) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  ) {
    throw new Error("Use uma senha com 12 a 256 caracteres.");
  }
  const safe = validateKdf(kdf);
  const bytes = encoder.encode(password);
  let material;
  try {
    material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, [
      "deriveKey",
    ]);
  } finally {
    bytes.fill(0);
  }
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: safe.iterations,
      salt: unb64(safe.salt, 16, 16),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(context) {
  if (typeof context !== "string" || !context || context.length > 256)
    throw new Error("Contexto de criptografia inválido.");
  return encoder.encode("minhas-financas/v3/" + context);
}

async function sealSerialized(text, key, context) {
  if (typeof text !== "string")
    throw new Error("Dados inválidos para criptografia.");
  if (text.length > MAX_BACKUP_BYTES) throw new Error("Dados excedem 33 MiB.");
  const plain = encoder.encode(text);
  try {
    if (plain.byteLength > MAX_BACKUP_BYTES)
      throw new Error("Dados excedem 33 MiB.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(context), tagLength: 128 },
      key,
      plain,
    );
    return { iv: b64(iv), cipher: b64(new Uint8Array(cipher)) };
  } finally {
    plain.fill(0);
  }
}

export async function seal(value, key, context = "backup") {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error("Dados inválidos para criptografia.");
  }
  return sealSerialized(text, key, context);
}

function readBox(box) {
  if (!object(box)) throw new Error("Envelope de criptografia inválido.");
  return {
    iv: unb64(box.iv, 12, 12),
    cipher: unb64(box.cipher, MAX_CIPHER_BYTES, TAG_BYTES),
  };
}

async function decryptBox(box, key, context) {
  const buffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: box.iv,
      additionalData: aad(context),
      tagLength: 128,
    },
    key,
    box.cipher,
  );
  const plain = new Uint8Array(buffer);
  try {
    if (plain.byteLength > MAX_BACKUP_BYTES)
      throw new Error("Dados excedem 33 MiB.");
    return JSON.parse(decoder.decode(plain));
  } finally {
    plain.fill(0);
  }
}

export async function unseal(box, key, context = "backup") {
  try {
    return await decryptBox(readBox(box), key, context);
  } catch {
    throw new Error(
      "Senha incorreta ou dados corrompidos. Os dados salvos foram preservados.",
    );
  }
}

async function makeBackup(text, key, kdf) {
  const safe = validateKdf(kdf);
  const box = await sealSerialized(text, key, "backup");
  const envelope = JSON.stringify({
    format: "minhas-financas-encrypted",
    version: 1,
    kdf: safe,
    ...box,
  });
  if (encoder.encode(envelope).byteLength > MAX_ENCRYPTED_BYTES)
    throw new Error("Backup excede 48 MiB.");
  return envelope;
}

export async function encryptedBackup(state, password) {
  const text = serializeBackup(state);
  const kdf = newKdf();
  const key = await deriveKey(password, kdf);
  return makeBackup(text, key, kdf);
}

export async function backupWithKey(state, key, kdf) {
  return makeBackup(serializeBackup(state), key, kdf);
}

export async function readBackup(text, password) {
  if (
    typeof text !== "string" ||
    text.length > MAX_ENCRYPTED_BYTES ||
    encoder.encode(text).byteLength > MAX_ENCRYPTED_BYTES
  ) {
    throw new Error("Arquivo excede 48 MiB.");
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Arquivo inválido.");
  }
  if (!object(raw)) throw new Error("Arquivo inválido.");
  if (raw.format !== "minhas-financas-encrypted") return parseBackup(text);
  if (raw.version !== 1) throw new Error("Versão do backup não suportada.");
  // Reject malformed/oversized envelopes before spending time on PBKDF2 or AES.
  const safe = validateKdf(raw.kdf);
  const box = readBox(raw);
  const key = await deriveKey(password, safe);
  let restored;
  try {
    restored = await decryptBox(box, key, "backup");
  } catch {
    throw new Error(
      "Senha incorreta ou dados corrompidos. Os dados salvos foram preservados.",
    );
  }
  return parseBackup(JSON.stringify(restored));
}
