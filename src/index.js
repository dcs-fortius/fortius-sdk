const { ethers } = require("ethers");
const FortiusSafeFactory = require("./abis/FortiusSafeFactory.json");
const TimelockModule = require("./abis/TimelockModule.json");
const GnosisSafe = require("./abis/GnosisSafe.json");
const { OperationType } = require("@safe-global/safe-core-sdk-types");

const SafeApiKit = require("@safe-global/api-kit").default;
const Safe = require("@safe-global/protocol-kit").default;

const ProxyCreation_TOPIC =
  "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235";

class SafeDeployer {
  constructor(signer) {
    this.factoryContract = new ethers.Contract(
      FortiusSafeFactory.address,
      FortiusSafeFactory.abi,
      signer
    );
  }

  async deploySafe({ safeAccountConfig, fortiusOptions }) {
    const txResponse = await this.factoryContract.deploy(
      fortiusOptions.name,
      safeAccountConfig.owners,
      safeAccountConfig.threshold,
      fortiusOptions.nonce || 2,
      fortiusOptions.modules
    );
    const txReceipt = await txResponse.wait();
    const events = txReceipt.logs || [];
    for (let event of events) {
      if (event.topics[0] == ProxyCreation_TOPIC) {
        const safeAddress = ethers.AbiCoder.defaultAbiCoder().decode(
          ["address", "address"],
          event.data
        )[0];
        return safeAddress;
      }
    }
    throw new Error("SafeProxy was not deployed correctly");
  }
}

class SafeHandler {
  constructor(chainId, provider, safeAddress, signerAddress, signer) {
    this.safeAddress = safeAddress;
    this.signerAddress = signerAddress;
    this.apiKit = new SafeApiKit({
      chainId,
    });
    if (signer) {
      this.protocolKit = Safe.init({
        provider,
        signer: signer,
        safeAddress,
      });
    } else {
      this.protocolKit = Safe.init({
        provider,
        signer: signerAddress,
        safeAddress,
      });
    }

    this.timelockContract = new ethers.Contract(
      TimelockModule.address,
      TimelockModule.abi
    );

    this.safeContract = new ethers.Contract(
      safeAddress,
      GnosisSafe.abi,
      ethers.getDefaultProvider()
    );
  }

  async proposeTimeLockModule(
    tokenAddress,
    recipientAddresses,
    values,
    executionTime, // time stamp
    escrow,
    cancellable,
    salt
  ) {
    if (!this.isSafeOwner()) return false;

    const transactions = [
      {
        to: TimelockModule.address,
        data: this.timelockContract.interface.encodeFunctionData("schedule", [
          tokenAddress,
          recipientAddresses,
          values,
          executionTime,
          escrow,
          cancellable,
          salt,
        ]),
        value: "0",
        operation: OperationType.Call, // Optional
      },
    ];
    const safeTransaction = await protocolKit.createTransaction({
      transactions,
    });
    const signerAddress =
      (await protocolKit.getSafeProvider().getSignerAddress()) || "0x";
    const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
    const signature = await protocolKit.signHash(safeTxHash);
    await apiKit.proposeTransaction({
      safeAddress: config.SAFE_ADDRESS,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: signerAddress,
      senderSignature: signature.data,
    });
    return safeTxHash;
  }

  async proposeTransaction(transactionsInfo, tokenAddress) {
    if (!(await this.isSafeOwner())) return false;
    const transactions = await SafeHandler.createSafeTransactionData(
      transactionsInfo,
      tokenAddress
    );

    const safeTransaction = await (
      await this.protocolKit
    ).createTransaction({
      transactions,
    });

    const safeTxHash = await (
      await this.protocolKit
    ).getTransactionHash(safeTransaction);
    const txt = await this.apiKit.getTransaction(safeTxHash).catch(() => null);
    if (txt) {
      console.log("Transaction already proposed");
      return false;
    }
    const signature = await (await this.protocolKit).signHash(safeTxHash);

    await this.apiKit.proposeTransaction({
      safeAddress: this.safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: this.signerAddress,
      senderSignature: signature.data,
    });
    return safeTxHash;
  }

  static async createSafeTransactionData(transactions, tokenAddress = "0x") {
    const safeTransactionData = [];
    for (const transaction of transactions) {
      if (tokenAddress != "0x") {
        const erc20Contract = new ethers.Contract(
          tokenAddress,
          ["function transfer(address to, uint amount) public returns (bool)"],
          ethers.getDefaultProvider()
        );

        safeTransactionData.push({
          to: tokenAddress,
          value: "0",
          data: erc20Contract.interface.encodeFunctionData("transfer", [
            transaction.to,
            transaction.amount,
          ]),
          operation: OperationType.Call,
        });
      } else {
        safeTransactionData.push({
          to: transaction.to,
          value: transaction.amount,
          data: "0x",
          operation: OperationType.Call,
        });
      }
    }

    return safeTransactionData;
  }

  async proposeInviteMembers(ownerAddresses, newThreshold) {
    if (await !this.isSafeOwner()) return false;
    let transactions = [];
    this.protocolKit = await this.protocolKit;
    const thresholdCurrent = await this.protocolKit.getThreshold();
    for (let i = 0; i < ownerAddresses.length; i++) {
      let threshold =
        i === ownerAddresses.length - 1 ? newThreshold : thresholdCurrent;
      console.log(threshold);
      transactions.push({
        to: this.safeAddress,
        data: this.safeContract.interface.encodeFunctionData(
          "addOwnerWithThreshold",
          [ownerAddresses[i], threshold]
        ),
        value: "0",
        operation: OperationType.Call, // Optional
      });
    }
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions,
    });
    const signerAddress =
      (await this.protocolKit.getSafeProvider().getSignerAddress()) || "0x";
    const safeTxHash = await this.protocolKit.getTransactionHash(
      safeTransaction
    );
    const signature = await this.protocolKit.signHash(safeTxHash);

    // Propose transaction to the service
    await this.apiKit.proposeTransaction({
      safeAddress: this.safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: signerAddress,
      senderSignature: signature.data,
    });
    return safeTxHash;
  }

  async createSafeTransactionData(transactions, tokenAddress = "0x") {
    const safeTransactionData = [];
    for (const transaction of transactions) {
      if (tokenAddress != "0x") {
        const erc20Contract = new ethers.Contract(
          tokenAddress,
          ["function transfer(address to, uint amount) public returns (bool)"],
          ethers.getDefaultProvider()
        );

        safeTransactionData.push({
          to: tokenAddress,
          value: "0",
          data: erc20Contract.interface.encodeFunctionData("transfer", [
            transaction.to,
            transaction.amount,
          ]),
          operation: OperationType.Call,
        });
      } else {
        safeTransactionData.push({
          to: transaction.to,
          value: transaction.amount,
          data: "0x",
          operation: OperationType.Call,
        });
      }
    }

    return safeTransactionData;
  }

  async confirmTransaction(safeTxHash) {
    if (!this.isSafeOwner()) return false;
    const signature = await (await this.protocolKit).signHash(safeTxHash);
    await this.apiKit.confirmTransaction(safeTxHash, signature.data);
    return safeTxHash;
  }

  async executeTransaction(safeTxHash) {
    if (!this.isSafeOwner()) return false;
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
    this.protocolKit = await this.protocolKit;
    const isTxExecutable = await this.protocolKit.isValidTransaction(
      safeTransaction
    );

    if (isTxExecutable) {
      const txResponse = await (
        await this.protocolKit
      ).executeTransaction(safeTransaction);
      const contractReceipt = await txResponse.transactionResponse?.wait();
      return contractReceipt?.hash;
    } else {
      console.log("Safe account does not have enough money");
      return false;
    }
  }
  async isSafeOwner() {
    return await (await this.protocolKit).isOwner(this.safeAddress);
  }
  async getOwners() {
    return await (await this.protocolKit).getOwners(this.safeAddress);
  }
}

module.exports = { SafeDeployer, SafeHandler };
