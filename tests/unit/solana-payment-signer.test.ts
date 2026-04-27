import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';

import { SolanaPaymentSigner } from '../../src/services/solana-payment-signer.js';

describe('SolanaPaymentSigner', () => {
  let signer: SolanaPaymentSigner;
  let tmp: string;
  let keypairPath: string;
  let kp: Keypair;

  beforeEach(() => {
    kp = Keypair.generate();
    tmp = mkdtempSync(join(tmpdir(), 'verifier-'));
    keypairPath = join(tmp, 'verifier.json');
    writeFileSync(keypairPath, JSON.stringify(Array.from(kp.secretKey)));
    signer = SolanaPaymentSigner.fromKeypairFile(keypairPath);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exposes the verifier public key', () => {
    expect(signer.getAddress()).toBe(kp.publicKey.toBase58());
  });

  it('signs and verifies a release attestation', () => {
    const escrow = Keypair.generate().publicKey;
    const provider = Keypair.generate().publicKey;
    const proofHash = Buffer.alloc(32, 0xab);

    const { signature, signatureBase58, message } = signer.signRelease({
      escrow,
      period: 3,
      provider,
      amount: 1_000_000n,
      proofHash,
    });

    expect(signature).toHaveLength(64);
    expect(signatureBase58.length).toBeGreaterThan(0);
    expect(message.length).toBe(116);

    expect(
      SolanaPaymentSigner.verifyRelease(kp.publicKey, signature, {
        escrow,
        period: 3,
        provider,
        amount: 1_000_000n,
        proofHash,
      }),
    ).toBe(true);
  });

  it('rejects a tampered message', () => {
    const escrow = Keypair.generate().publicKey;
    const provider = Keypair.generate().publicKey;
    const proofHash = Buffer.alloc(32, 0x01);

    const { signature } = signer.signRelease({
      escrow,
      period: 1,
      provider,
      amount: 500_000n,
      proofHash,
    });

    expect(
      SolanaPaymentSigner.verifyRelease(kp.publicKey, signature, {
        escrow,
        period: 2, // tampered
        provider,
        amount: 500_000n,
        proofHash,
      }),
    ).toBe(false);
  });

  it('rejects signatures from a different verifier', () => {
    const escrow = Keypair.generate().publicKey;
    const provider = Keypair.generate().publicKey;
    const proofHash = Buffer.alloc(32, 0x02);

    const { signature } = signer.signRelease({
      escrow,
      period: 1,
      provider,
      amount: 100n,
      proofHash,
    });

    const other = Keypair.generate().publicKey;
    expect(
      SolanaPaymentSigner.verifyRelease(other, signature, {
        escrow,
        period: 1,
        provider,
        amount: 100n,
        proofHash,
      }),
    ).toBe(false);
  });

  it('accepts hex-encoded proof hashes', () => {
    const escrow = Keypair.generate().publicKey;
    const provider = Keypair.generate().publicKey;
    const hex = 'aa'.repeat(32);

    const { signature } = signer.signRelease({
      escrow,
      period: 1,
      provider,
      amount: 1n,
      proofHash: hex,
    });

    expect(
      SolanaPaymentSigner.verifyRelease(kp.publicKey, signature, {
        escrow,
        period: 1,
        provider,
        amount: 1n,
        proofHash: `0x${hex}`,
      }),
    ).toBe(true);
  });

  it('rejects non-32-byte proof hashes', () => {
    const escrow = Keypair.generate().publicKey;
    const provider = Keypair.generate().publicKey;
    expect(() =>
      signer.signRelease({
        escrow,
        period: 1,
        provider,
        amount: 1n,
        proofHash: Buffer.alloc(16),
      }),
    ).toThrow(/32 bytes/);
  });

  it('rejects malformed keypair files', () => {
    const bogus = join(tmp, 'bogus.json');
    writeFileSync(bogus, JSON.stringify([1, 2, 3]));
    expect(() => SolanaPaymentSigner.fromKeypairFile(bogus)).toThrow(/64-byte/);
  });
});
