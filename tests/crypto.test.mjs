import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv, createDecipheriv, pbkdf2Sync} from 'node:crypto';
import {emptyState, MAX_BACKUP_BYTES, serializeBackup} from '../public/finance.mjs';
import {ITERATIONS, MAX_ENCRYPTED_BYTES, newKdf, validateKdf, deriveKey, seal, unseal, encryptedBackup, backupWithKey, readBackup} from '../public/crypto.mjs';

const password = 'senha de teste sintética';
const otherPassword = 'outra senha sintética';
const kdf = newKdf();
const keyPromise = deriveKey(password, kdf);
const otherKeyPromise = deriveKey(otherPassword, kdf);
const state = () => emptyState('Teste de segurança', '2026-10-19');
const aad = context => Buffer.from('minhas-financas/v3/' + context);

function independentKey(metadata, secret = password) {
  return pbkdf2Sync(secret, Buffer.from(metadata.salt, 'base64'), metadata.iterations, 32, 'sha256');
}
function independentEncrypt(value, metadata, context = 'backup') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = createCipheriv('aes-256-gcm', independentKey(metadata), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {iv: Buffer.from(iv).toString('base64'), cipher: ciphertext.toString('base64')};
}
function independentDecrypt(box, metadata, context = 'backup') {
  const bytes = Buffer.from(box.cipher, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', independentKey(metadata), Buffer.from(box.iv, 'base64'));
  decipher.setAAD(aad(context));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

await test('PBKDF2 usa 600 mil iterações, salt aleatório de 16 bytes e AES-256 não extraível', async () => {
  const next = newKdf();
  assert.equal(kdf.algorithm, 'PBKDF2');
  assert.equal(kdf.hash, 'SHA-256');
  assert.equal(kdf.iterations, 600_000);
  assert.equal(Buffer.from(kdf.salt, 'base64').byteLength, 16);
  assert.notEqual(next.salt, kdf.salt);
  const key = await keyPromise;
  assert.equal(key.extractable, false);
  assert.deepEqual(key.algorithm, {name: 'AES-GCM', length: 256});
  await assert.rejects(crypto.subtle.exportKey('raw', key));
});

await test('salt e parâmetros inválidos são rejeitados, sem aceitar custo controlado pelo arquivo', async () => {
  for (const invalid of [null, [], {...kdf, hash: 'SHA-1'}, {...kdf, algorithm: 'scrypt'}, {...kdf, iterations: 1}, {...kdf, iterations: Number.MAX_SAFE_INTEGER}, {...kdf, salt: 'A'.repeat(24)}, {...kdf, salt: kdf.salt.replace(/==$/, '')}, {...kdf, salt: 'AAAAAAAAAAAAAAAAAAAAAB=='}]) {
    assert.throws(() => validateKdf(invalid), /Parâmetros/);
  }
  assert.deepEqual(validateKdf({...kdf, password: 'não exportar', extra: {ignored: true}}), kdf);
  for (const secret of ['', 'curta', 'x'.repeat(257), undefined]) {
    await assert.rejects(deriveKey(secret, kdf), /12 a 256/);
  }
});

await test('AES-GCM tem IV aleatório, autentica o conteúdo e preserva Unicode', async () => {
  const key = await keyPromise;
  const value = {nome: 'João 🧾', descrição: 'Aspas " e \n linha', valor: 12345};
  const first = await seal(value, key);
  const second = await seal(value, key);
  assert.notEqual(first.iv, second.iv);
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.equal(Buffer.from(first.cipher, 'base64').length, Buffer.byteLength(JSON.stringify(value)) + 16);
  assert.deepEqual(await unseal(first, key), value);
  assert.deepEqual(independentDecrypt(first, kdf), value);
  assert.deepEqual(await unseal(independentEncrypt(value, kdf), key), value);
  const tampered = Buffer.from(first.cipher, 'base64');
  tampered[0] ^= 1;
  await assert.rejects(unseal({...first, cipher: tampered.toString('base64')}, key), /Senha incorreta ou dados corrompidos/);
  const badIv = Buffer.from(first.iv, 'base64');
  badIv[0] ^= 1;
  await assert.rejects(unseal({...first, iv: badIv.toString('base64')}, key), /Senha incorreta ou dados corrompidos/);
  await assert.rejects(unseal(first, await otherKeyPromise), /Senha incorreta ou dados corrompidos/);
});

await test('AAD impede trocar backup, raiz, registro ou rascunho entre contextos', async () => {
  const key = await keyPromise;
  const box = await seal({id: 'abc'}, key, 'entries:abc');
  assert.deepEqual(await unseal(box, key, 'entries:abc'), {id: 'abc'});
  for (const context of ['entries:def', 'root', 'backup', 'drafts']) {
    await assert.rejects(unseal(box, key, context), /dados corrompidos/);
  }
  await assert.rejects(seal({}, key, ''), /Contexto/);
});

await test('envelopes e base64 malformados são rejeitados antes da derivação da senha', async () => {
  const key = await keyPromise;
  const valid = JSON.parse(await backupWithKey(state(), key, kdf));
  for (const change of [
    {iv: null}, {iv: ''}, {iv: 'A'.repeat(15)}, {iv: 'A'.repeat(20)},
    {cipher: ''}, {cipher: 'AAAA'}, {cipher: 'A==A'},
    {cipher: 'AAAAAAAAAAAAAAAAAAAAAB=='},
    {cipher: valid.cipher + '\n'}, {cipher: valid.cipher.replace(/=+$/, '') + '-'},
  ]) {
    // An empty password would fail differently if PBKDF2 preflight were reached first.
    await assert.rejects(readBackup(JSON.stringify({...valid, ...change}), ''), /Envelope de criptografia inválido/);
  }
  await assert.rejects(readBackup(JSON.stringify({...valid, version: 2}), password), /Versão/);
  for (const text of ['null', '[]', 'false', '"texto"', '{incompleto']) {
    await assert.rejects(readBackup(text, password), /Arquivo inválido/);
  }
});

await test('backup usa envelope v1 compatível, sem nome legível ou metadados extras do KDF', async () => {
  const key = await keyPromise;
  const source = state();
  const text = await backupWithKey(source, key, {...kdf, password: 'valor que não deve sair'});
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'minhas-financas-encrypted');
  assert.equal(parsed.version, 1);
  assert.equal(text.includes(source.name), false);
  assert.equal(text.includes('valor que não deve sair'), false);
  assert.deepEqual(independentDecrypt(parsed, kdf), JSON.parse(serializeBackup(source)));
  assert.deepEqual(await readBackup(text, password), source);
  assert.deepEqual(await readBackup('\uFEFF' + text, password), source);
  const legacyCompatible = JSON.stringify({format: 'minhas-financas-encrypted', version: 1, kdf, ...independentEncrypt(source, kdf)});
  assert.deepEqual(await readBackup(legacyCompatible, password), source);
  await assert.rejects(readBackup(text, otherPassword), /dados corrompidos/);
});

await test('backup com senha nova é independente; chave/senha antiga continuam restritas à cópia antiga', async () => {
  const oldCopy = await backupWithKey(state(), await keyPromise, kdf);
  const newCopy = await encryptedBackup(state(), otherPassword);
  assert.deepEqual(await readBackup(oldCopy, password), state());
  assert.deepEqual(await readBackup(newCopy, otherPassword), state());
  await assert.rejects(readBackup(newCopy, password), /dados corrompidos/);
  await assert.rejects(readBackup(oldCopy, otherPassword), /dados corrompidos/);
});

await test('backup JSON sem senha permanece importável e validado', async () => {
  assert.deepEqual(await readBackup(serializeBackup(state())), state());
  await assert.rejects(readBackup(JSON.stringify({...state(), name: ''})), /nome|Nome/);
  await assert.rejects(backupWithKey({...state(), name: ''}, await keyPromise, kdf), /nome|Nome/);
});

await test('limites consideram bytes UTF-8 e barram ciphertext excessivo antes de PBKDF2', async () => {
  const key = await keyPromise;
  // Its UTF-16 length fits the cap, while its UTF-8 representation does not.
  await assert.rejects(seal('🧾'.repeat(Math.floor(MAX_BACKUP_BYTES / 4) + 1), key), /33 MiB/);
  await assert.rejects(seal(undefined, key), /Dados inválidos/);
  const cipher = 'A'.repeat(Math.ceil((MAX_BACKUP_BYTES + 17) / 3) * 4);
  const oversized = JSON.stringify({format: 'minhas-financas-encrypted', version: 1, kdf, iv: 'AAAAAAAAAAAAAAAA', cipher});
  assert.ok(Buffer.byteLength(oversized) < MAX_ENCRYPTED_BYTES);
  await assert.rejects(readBackup(oversized, ''), /Envelope de criptografia inválido/);
  await assert.rejects(readBackup(' '.repeat(MAX_ENCRYPTED_BYTES + 1), password), /48 MiB/);
});
