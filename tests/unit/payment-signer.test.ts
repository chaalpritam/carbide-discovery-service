import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { PaymentSigner } from '../../src/services/payment-signer.js';

describe('PaymentSigner', () => {
  const chainId = 421614;
  const escrowContract = '0x' + 'ab'.repeat(20);
  let wallet: ethers.HDNodeWallet;
  let signer: PaymentSigner;

  beforeEach(() => {
    wallet = ethers.Wallet.createRandom();
    signer = new PaymentSigner(wallet.privateKey, chainId, escrowContract);
  });

  it('creates signer from private key', () => {
    expect(signer).toBeDefined();
  });

  it('returns correct address via getAddress()', () => {
    const address = signer.getAddress();
    expect(address).toBe(wallet.address);
  });

  it('produces valid EIP-712 signature', async () => {
    const signature = await signer.signRelease(
      1n,
      1,
      '0x' + 'cc'.repeat(20),
      1000000n,
      '0x' + 'dd'.repeat(32)
    );

    expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(signature.length).toBe(132); // 0x + 65 bytes hex = 132
  });

  it('recovers signer address from signature', async () => {
    const provider = '0x' + 'cc'.repeat(20);
    const proofHash = '0x' + 'dd'.repeat(32);
    const escrowId = 42n;
    const period = 3;
    const amount = 5000000n;

    const signature = await signer.signRelease(escrowId, period, provider, amount, proofHash);

    const domain = {
      name: 'CarbideEscrow',
      version: '1',
      chainId,
      verifyingContract: escrowContract,
    };
    const types = {
      PaymentRelease: [
        { name: 'escrowId', type: 'uint256' },
        { name: 'period', type: 'uint32' },
        { name: 'provider', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'proofHash', type: 'bytes32' },
      ],
    };
    const value = {
      escrowId,
      period,
      provider,
      amount,
      proofHash,
    };

    const recovered = ethers.verifyTypedData(domain, types, value, signature);
    expect(recovered).toBe(wallet.address);
  });

  it('different signatures for different escrowIds/periods', async () => {
    const provider = '0x' + 'cc'.repeat(20);
    const proofHash = '0x' + 'dd'.repeat(32);

    const sig1 = await signer.signRelease(1n, 1, provider, 1000000n, proofHash);
    const sig2 = await signer.signRelease(2n, 1, provider, 1000000n, proofHash);
    const sig3 = await signer.signRelease(1n, 2, provider, 1000000n, proofHash);

    expect(sig1).not.toBe(sig2);
    expect(sig1).not.toBe(sig3);
    expect(sig2).not.toBe(sig3);
  });
});
