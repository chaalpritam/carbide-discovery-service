import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';

import {
  decodeProviderAccount,
  priceFromBaseUnits,
  regionFromChain,
  stableProviderId,
  tierFromIndex,
} from '../../src/services/solana-indexer.js';
import { ProviderTier, Region } from '../../src/types/provider.js';

describe('solana-indexer helpers', () => {
  it('priceFromBaseUnits scales by 6 decimals and trims trailing zeros', () => {
    expect(priceFromBaseUnits(0n)).toBe('0');
    expect(priceFromBaseUnits(5_000n)).toBe('0.005');
    expect(priceFromBaseUnits(1_000_000n)).toBe('1');
    expect(priceFromBaseUnits(1_500_000n)).toBe('1.5');
  });

  it('tierFromIndex covers the whole enum', () => {
    expect(tierFromIndex(0)).toBe(ProviderTier.Home);
    expect(tierFromIndex(1)).toBe(ProviderTier.Professional);
    expect(tierFromIndex(2)).toBe(ProviderTier.Enterprise);
    expect(tierFromIndex(3)).toBe(ProviderTier.GlobalCDN);
    expect(() => tierFromIndex(4)).toThrow();
  });

  it('regionFromChain accepts forgiving spellings', () => {
    expect(regionFromChain('NorthAmerica')).toBe(Region.NorthAmerica);
    expect(regionFromChain('north_america')).toBe(Region.NorthAmerica);
    expect(regionFromChain('EU')).toBe(Region.Europe);
    expect(regionFromChain('asia')).toBe(Region.Asia);
    expect(() => regionFromChain('Mars')).toThrow();
  });

  it('stableProviderId is deterministic and a well-formed UUID v4', () => {
    const owner = Buffer.from('0102030405060708090a0b0c0d0e0f10' + '1112131415161718191a1b1c1d1e1f20', 'hex');
    const a = stableProviderId(owner);
    const b = stableProviderId(owner);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('decodeProviderAccount', () => {
  function encodeProvider(opts: {
    owner: Buffer;
    endpoint: string;
    region: string;
    pricePerGbMonth: bigint;
    capacityGb: bigint;
    registeredAt: bigint;
    updatedAt: bigint;
    tier: number;
    active: boolean;
    bump: number;
  }): Buffer {
    const disc = createHash('sha256')
      .update('account:ProviderAccount')
      .digest()
      .subarray(0, 8);
    const endpointBytes = Buffer.from(opts.endpoint, 'utf8');
    const regionBytes = Buffer.from(opts.region, 'utf8');
    const totalLen = 8 + 32 + 4 + endpointBytes.length + 4 + regionBytes.length + 8 + 8 + 8 + 8 + 1 + 1 + 1;
    const buf = Buffer.alloc(totalLen);
    let off = 0;
    disc.copy(buf, off);
    off += 8;
    opts.owner.copy(buf, off);
    off += 32;
    buf.writeUInt32LE(endpointBytes.length, off);
    off += 4;
    endpointBytes.copy(buf, off);
    off += endpointBytes.length;
    buf.writeUInt32LE(regionBytes.length, off);
    off += 4;
    regionBytes.copy(buf, off);
    off += regionBytes.length;
    buf.writeBigUInt64LE(opts.pricePerGbMonth, off);
    off += 8;
    buf.writeBigUInt64LE(opts.capacityGb, off);
    off += 8;
    buf.writeBigInt64LE(opts.registeredAt, off);
    off += 8;
    buf.writeBigInt64LE(opts.updatedAt, off);
    off += 8;
    buf.writeUInt8(opts.tier, off);
    off += 1;
    buf.writeUInt8(opts.active ? 1 : 0, off);
    off += 1;
    buf.writeUInt8(opts.bump, off);
    return buf;
  }

  it('decodes a synthetic on-chain account body', () => {
    const owner = Buffer.alloc(32, 0x07);
    const data = encodeProvider({
      owner,
      endpoint: 'https://provider.example:8080',
      region: 'NorthAmerica',
      pricePerGbMonth: 5_000n,
      capacityGb: 250n,
      registeredAt: 1_700_000_000n,
      updatedAt: 1_700_000_500n,
      tier: 1,
      active: true,
      bump: 254,
    });

    const decoded = decodeProviderAccount(data);
    expect(decoded.endpoint).toBe('https://provider.example:8080');
    expect(decoded.region).toBe('NorthAmerica');
    expect(decoded.pricePerGbMonth).toBe(5_000n);
    expect(decoded.capacityGb).toBe(250n);
    expect(decoded.tier).toBe(1);
    expect(decoded.active).toBe(true);
    expect(decoded.bump).toBe(254);
    expect(bs58.encode(decoded.owner)).toBe(bs58.encode(owner));
  });

  it('rejects buffers shorter than the discriminator', () => {
    expect(() => decodeProviderAccount(Buffer.alloc(4))).toThrow(/shorter/);
  });

  it('rejects buffers with the wrong discriminator', () => {
    const buf = Buffer.alloc(80);
    expect(() => decodeProviderAccount(buf)).toThrow(/discriminator/);
  });
});
