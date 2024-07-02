import { ethers } from "ethers";
import { OperationType } from "@safe-global/safe-core-sdk-types";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";

export const TimelockContract: ethers.Contract;

interface SafeAccountConfig {
  owners: string[];
  threshold: number;
}

interface FortiusOptions {
  name: string;
  nonce?: number;
  modules?: string[];
}

interface ProposeTimeLockModuleParams {
  tokenAddress: string;
  recipientAddresses: string[];
  values: string[];
  executionTime: number;
  escrow: boolean;
  cancellable: boolean;
  salt: string;
}

interface   ProposeTransactionParams {
  transactionsInfo: any;
  tokenAddress: string;
}

interface ProposeInviteMembersParams {
  ownerAddresses: string[];
  newThreshold: number;
}

export class SafeDeployer {
  constructor(signer: ethers.Signer);

  deploySafe(params: {
    safeAccountConfig: SafeAccountConfig;
    fortiusOptions: FortiusOptions;
  }): Promise<string>;
}

export class SafeHandler {
  constructor(
    chainId: number,
    provider: ethers.providers.Provider,
    safeAddress: string,
    signerAddress: string,
    signer?: ethers.Signer
  );

  proposeTimeLockModule(params: ProposeTimeLockModuleParams): Promise<{
    safeTxHash: string;
    safeAddress: string;
    scheduleId: string;
    executionTime: number;
  } | false>;

  proposeTransaction(params: ProposeTransactionParams): Promise<string | false>;

  static createSafeTransactionData(
    transactions: any[],
    tokenAddress?: string
  ): Promise<any[]>;

  proposeInviteMembers(params: ProposeInviteMembersParams): Promise<string | false>;

  confirmTransaction(safeTxHash: string): Promise<string | false>;

  executeTransaction(safeTxHash: string): Promise<string | false>;

  isSafeOwner(): Promise<boolean>;

  getOwners(): Promise<string[]>;
}
