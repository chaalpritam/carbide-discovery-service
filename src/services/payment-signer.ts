import { ethers } from 'ethers';

export class PaymentSigner {
  private wallet: ethers.Wallet;
  private domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };

  constructor(privateKey: string, chainId: number, escrowContract: string) {
    this.wallet = new ethers.Wallet(privateKey);
    this.domain = {
      name: 'CarbideEscrow',
      version: '1',
      chainId,
      verifyingContract: escrowContract,
    };
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async signRelease(
    escrowId: bigint,
    period: number,
    provider: string,
    amount: bigint,
    proofHash: string
  ): Promise<string> {
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

    return this.wallet.signTypedData(this.domain, types, value);
  }
}
