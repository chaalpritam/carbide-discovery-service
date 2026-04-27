/**
 * Ed25519 attestation signer for Carbide payment releases.
 *
 * The discovery service holds the verifier keypair (loaded from the
 * standard solana-keygen [u8; 64] JSON format). When a proof is
 * accepted, the service signs a deterministic message describing the
 * release — escrow PDA, period, provider, amount, proof hash — that
 * the provider can ship on-chain alongside their release_payment
 * instruction (or that anyone can verify off-chain for audit).
 *
 * Message layout (116 bytes, little-endian):
 *   bytes  0..  8 : ASCII tag "carbidev" (rejects accidental
 *                   cross-domain reuse of the verifier key)
 *   bytes  8.. 40 : escrow account pubkey       (32 bytes)
 *   bytes 40.. 44 : period                      (u32 LE)
 *   bytes 44.. 76 : provider pubkey             (32 bytes)
 *   bytes 76.. 84 : amount in token base units  (u64 LE)
 *   bytes 84..116 : proof_hash                  (32 bytes)
 */

import * as fs from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

const ATTESTATION_TAG = Buffer.from('carbidev', 'ascii');

export class SolanaPaymentSigner {
  private readonly secretKey: Uint8Array;
  private readonly publicKey: PublicKey;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 64) {
      throw new Error(
        `expected 64-byte Solana secret key (secret || pubkey), got ${secretKey.length}`,
      );
    }
    this.secretKey = secretKey;
    this.publicKey = new PublicKey(secretKey.slice(32));
  }

  /**
   * Load a verifier signer from the standard solana-keygen JSON file
   * (a JSON array of 64 bytes: secret_seed || public_key).
   */
  static fromKeypairFile(path: string): SolanaPaymentSigner {
    const json = fs.readFileSync(path, 'utf8');
    const arr = JSON.parse(json) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(
        `keypair file ${path} must be a 64-byte JSON array`,
      );
    }
    return new SolanaPaymentSigner(Uint8Array.from(arr));
  }

  /** Verifier address (base58). */
  getAddress(): string {
    return this.publicKey.toBase58();
  }

  /**
   * Sign a payment-release attestation. Returns the 64-byte Ed25519
   * signature, base58-encoded for callers that want a string handle.
   */
  signRelease(args: {
    escrow: PublicKey | string;
    period: number;
    provider: PublicKey | string;
    amount: bigint;
    /** 32-byte proof hash; accepts hex (with/without 0x) or a Buffer. */
    proofHash: Buffer | string;
  }): { signature: Uint8Array; signatureBase58: string; message: Buffer } {
    const escrow = toPublicKey(args.escrow);
    const provider = toPublicKey(args.provider);
    const proofHash = toProofHash(args.proofHash);
    if (args.period < 0 || !Number.isInteger(args.period)) {
      throw new Error('period must be a non-negative integer');
    }
    if (args.amount < 0n) {
      throw new Error('amount must be non-negative');
    }

    const message = Buffer.alloc(116);
    let off = 0;
    ATTESTATION_TAG.copy(message, off);
    off += 8;
    escrow.toBuffer().copy(message, off);
    off += 32;
    message.writeUInt32LE(args.period, off);
    off += 4;
    provider.toBuffer().copy(message, off);
    off += 32;
    message.writeBigUInt64LE(args.amount, off);
    off += 8;
    proofHash.copy(message, off);

    const signature = nacl.sign.detached(message, this.secretKey);
    return {
      signature,
      signatureBase58: bufferToBase58(Buffer.from(signature)),
      message,
    };
  }

  /**
   * Verify an attestation off-chain (e.g., for audit log replay). Caller
   * supplies the public key as base58; we re-derive the canonical message.
   */
  static verifyRelease(
    verifier: PublicKey | string,
    signature: Uint8Array,
    args: {
      escrow: PublicKey | string;
      period: number;
      provider: PublicKey | string;
      amount: bigint;
      proofHash: Buffer | string;
    },
  ): boolean {
    const verifierKey = toPublicKey(verifier);
    const escrow = toPublicKey(args.escrow);
    const provider = toPublicKey(args.provider);
    const proofHash = toProofHash(args.proofHash);

    const message = Buffer.alloc(116);
    let off = 0;
    ATTESTATION_TAG.copy(message, off);
    off += 8;
    escrow.toBuffer().copy(message, off);
    off += 32;
    message.writeUInt32LE(args.period, off);
    off += 4;
    provider.toBuffer().copy(message, off);
    off += 32;
    message.writeBigUInt64LE(args.amount, off);
    off += 8;
    proofHash.copy(message, off);

    return nacl.sign.detached.verify(message, signature, verifierKey.toBuffer());
  }
}

function toPublicKey(input: PublicKey | string): PublicKey {
  return input instanceof PublicKey ? input : new PublicKey(input);
}

function toProofHash(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length !== 32) {
      throw new Error(`proof hash must be 32 bytes, got ${input.length}`);
    }
    return input;
  }
  const hex = input.startsWith('0x') ? input.slice(2) : input;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(`proof hash hex must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

function bufferToBase58(buf: Buffer): string {
  // We only need this for display; bs58 is already in deps via the
  // indexer module, so import lazily to keep this file self-contained.
  const { default: bs58 } = require('bs58') as { default: { encode: (b: Uint8Array) => string } };
  return bs58.encode(buf);
}
