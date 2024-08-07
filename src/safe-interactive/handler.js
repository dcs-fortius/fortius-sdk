const { ethers } = require("ethers");
const TimelockModule = require("../abis/TimelockModule.json");
const GnosisSafe = require("../abis/GnosisSafe.json");
const { OperationType } = require("@safe-global/safe-core-sdk-types");

const SafeApiKit = require("@safe-global/api-kit").default;
const Safe = require("@safe-global/protocol-kit").default;
const {
  deleteTransaction,
} = require("@safe-global/safe-gateway-typescript-sdk");
const { signTypedData } = require("../utils/web3");
const {
  createSafeTransactionData,
  convertToChecksumAddress,
} = require("./utils");

class SafeHandler {
  constructor(chainId, provider, safeAddress, signerAddress, signer) {
    this.safeAddress = safeAddress;
    this.signerAddress = signerAddress;
    this.apiKit = new SafeApiKit({ chainId });
    this.chainId = chainId;
    this.provider = signer
      ? new ethers.JsonRpcProvider(provider, chainId)
      : new ethers.BrowserProvider(window.ethereum);

    this.protocolKit = Safe.init({
      provider,
      signer: signer || signerAddress,
      safeAddress,
    });

    this.signer = signer
      ? new ethers.Wallet(signer, this.provider)
      : this.provider;

    const TimelockContract = new ethers.Contract(
      TimelockModule.address,
      TimelockModule.abi
    );
    this.TimelockContract = TimelockContract.connect(this.signer);

    this.safeContract = new ethers.Contract(
      this.safeAddress,
      GnosisSafe.abi,
      ethers.getDefaultProvider()
    );
  }

  async proposeTimeLockModule({
    tokenAddress,
    recipientAddresses,
    values,
    executionTime,
    escrow,
    cancellable,
    salt,
    nonce,
  }) {
    const transactions = [
      {
        to: TimelockModule.address,
        data: this.TimelockContract.interface.encodeFunctionData("schedule", [
          tokenAddress,
          recipientAddresses,
          values,
          executionTime,
          escrow,
          cancellable,
          salt,
        ]),
        value: "0",
        operation: OperationType.Call,
      },
    ];

    await this.initializeProtocolKit();
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions,
      options: { nonce },
    });
    const safeTxHash = await this.handlePropose(safeTransaction);
    const scheduleId = await this.TimelockContract.hashOperation(
      this.safeAddress,
      tokenAddress,
      recipientAddresses,
      values,
      executionTime,
      escrow,
      cancellable,
      salt
    );
    const amountTotal = values.reduce((acc, val) => acc + val, 0);
    return {
      safeTxHash,
      safeAddress: this.safeAddress,
      scheduleId,
      executionTime,
      tokenAddress,
      amountTotal,
    };
  }

  async executeScheduleOnContract({
    safeAddress,
    safeTxHash,
    scheduleId,
    chainId,
    tokenAddress,
    amountTotal,
  }) {
    let result = {
      msgError: null,
      executedTxHash: null,
      scheduleId,
      chainId,
    };
    try {
      if (!(await this.isBalanceSufficient(tokenAddress, amountTotal))) {
        result.msgError = "Insufficient balance to trade";
        return result;
      }
      if (!(await this.isEnoughApproval(safeTxHash))) {
        result.msgError = "Not enough approval";
        return result;
      }
      let tx = await this.TimelockContract.execute(
        convertToChecksumAddress(safeAddress),
        scheduleId
      );
      result.executedTxHash = tx.hash;
    } catch (error) {
      result.msgError = error.message;
    }
    return result;
  }

  async proposeTransaction(transactionsInfo, tokenAddress, nonce) {
    const transactions = await createSafeTransactionData(
      transactionsInfo,
      convertToChecksumAddress(tokenAddress)
    );

    await this.initializeProtocolKit();
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions,
      options: { nonce },
    });
    return this.handlePropose(safeTransaction);
  }

  async proposeInviteMembers(ownerAddresses, newThreshold, nonce) {
    const thresholdCurrent = await this.protocolKit.getThreshold();
    const transactions = ownerAddresses.map((owner, i) => ({
      to: this.safeAddress,
      data: this.safeContract.interface.encodeFunctionData(
        "addOwnerWithThreshold",
        [
          owner,
          i === ownerAddresses.length - 1 ? newThreshold : thresholdCurrent,
        ]
      ),
      value: "0",
      operation: OperationType.Call,
    }));

    await this.initializeProtocolKit();
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions,
      options: { nonce },
    });
    return this.handlePropose(safeTransaction);
  }

  async createOwnerTransaction(type, ownerAddress, newThreshold, nonce) {
    await this.initializeProtocolKit();
    const owner = convertToChecksumAddress(ownerAddress);
    const options = { nonce };

    let transaction;
    switch (type) {
      case "add":
        transaction = await this.protocolKit.createAddOwnerTx(
          { owner, threshold: newThreshold },
          options
        );
        break;
      case "remove":
        transaction = await this.protocolKit.createRemoveOwnerTx(
          { ownerRemoved: owner, threshold: newThreshold },
          options
        );
        break;
      default:
        throw new Error("Invalid transaction type");
    }

    return this.handlePropose(transaction);
  }

  async createRejectionTransaction(nonce) {
    await this.initializeProtocolKit();
    const transaction = await this.protocolKit.createRejectionTransaction(
      nonce
    );
    return this.handlePropose(transaction);
  }

  async createChangeThresholdTx(newThreshold, nonce) {
    await this.initializeProtocolKit();
    const transaction = await this.protocolKit.createChangeThresholdTx(
      newThreshold,
      { nonce }
    );
    return this.handlePropose(transaction);
  }

  async handlePropose(safeTransaction) {
    const signerAddress =
      (await this.protocolKit.getSafeProvider().getSignerAddress()) || "0x";
    const safeTxHash = await this.protocolKit.getTransactionHash(
      safeTransaction
    );
    const signature = await this.protocolKit.signHash(safeTxHash);
    await this.apiKit.proposeTransaction({
      safeAddress: this.safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: signerAddress,
      senderSignature: signature.data,
    });
    return safeTxHash;
  }

  async isBalanceSufficient(tokenAddress, amount) {
    const address = convertToChecksumAddress(tokenAddress);
    let balance = await this.provider.getBalance(this.safeAddress);

    if (address !== ethers.constants.AddressZero) {
      const erc20Contract = new ethers.Contract(
        address,
        ["function balanceOf(address owner) view returns (uint256)"],
        this.provider
      );
      balance = await erc20Contract.balanceOf(this.safeAddress);
    }
    return balance >= amount;
  }

  async isEnoughApproval(safeTxHash) {
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
    return (
      safeTransaction.confirmations.length >=
      safeTransaction.confirmationsRequired
    );
  }

  async executeTransaction(safeTxHash, tokenAddress, amountTotal) {
    try {
      if (!(await this.isBalanceSufficient(tokenAddress, amountTotal))) {
        return {
          isSuccess: false,
          txHash: "",
          message: "Safe account does not have enough money",
        };
      }
      return {
        isSuccess: true,
        txHash: await this.executeTransaction(safeTxHash),
      };
    } catch (error) {
      return { isSuccess: false, txHash: "", message: error.message };
    }
  }

  async confirmTransaction(safeTxHash) {
    await this.initializeProtocolKit();
    const transaction = await this.apiKit.getTransaction(safeTxHash);
    const signerAddress =
      (await this.protocolKit.getSafeProvider().getSignerAddress()) || "0x";
    const signature = await signTypedData(
      this.signer,
      this.chainId,
      this.safeAddress,
      transaction.data
    );
    return this.apiKit.confirmTransaction(safeTxHash, signature, signerAddress);
  }

  async rejectTransaction(safeTxHash) {
    const rejection = await this.apiKit.getTransaction(safeTxHash);
    return deleteTransaction(this.chainId, rejection.data.safeTxHash);
  }

  async getTransaction(safeTxHash) {
    return this.apiKit.getTransaction(safeTxHash);
  }

  async getBalances() {
    return this.apiKit.getBalances(this.safeAddress, { excludeSpam: true });
  }

  async initializeProtocolKit() {
    await this.protocolKit.init();
  }
}
module.exports = SafeHandler;
