//index.js
const { ethers } = require("ethers");
const FortiusSafeFactory = require("./abis/FortiusSafeFactory.json");
const TimelockModule = require("./abis/TimelockModule.json");
const GnosisSafe = require("./abis/GnosisSafe.json");
const { OperationType } = require("@safe-global/safe-core-sdk-types");

const SafeApiKit = require("@safe-global/api-kit").default;
const Safe = require("@safe-global/protocol-kit").default;

const ProxyCreation_TOPIC =
  "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235";

let TimelockContract = new ethers.Contract(
  TimelockModule.address,
  TimelockModule.abi
);

class SafeDeployer {
  constructor(signer) {
    this.factoryContract = new ethers.Contract(
      FortiusSafeFactory.address,
      FortiusSafeFactory.abi,
      signer
    );
    this.signer = signer;
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
      this.TimelockContract = TimelockContract.connect(
        new ethers.Wallet(
          signer,
          new ethers.JsonRpcProvider("https://polygon.meowrpc.com")
        )
      );
    } else {
      this.protocolKit = Safe.init({
        provider,
        signer: signerAddress,
        safeAddress,
      });
      this.TimelockContract = TimelockContract.connect(
        new ethers.BrowserProvider(window.ethereum)
      );
    }

    this.safeContract = new ethers.Contract(
      safeAddress,
      GnosisSafe.abi,
      ethers.getDefaultProvider()
    );
  }
  static async createApproveTransactionData(transactions, tokenAddress) {
    const safeTransactionData = [];

    if (tokenAddress != "0x") {
      const erc20Contract = new ethers.Contract(
        tokenAddress,
        [
          "function approve(address spender, uint256 value) public returns (bool)",
        ],
        ethers.getDefaultProvider()
      );

      for (const transaction of transactions) {
        safeTransactionData.push({
          to: tokenAddress,
          value: "0",
          data: erc20Contract.interface.encodeFunctionData("approve", [
            transaction.spender,
            transaction.value,
          ]),
          operation: OperationType.Call,
        });
      }
    }

    return safeTransactionData;
  }

  static async createInvestTransactionData(transactions, poolContractAddress) {
    const safeTransactionData = [];

    if (poolContractAddress != "0x") {
      const poolContract = new ethers.Contract(
        poolContractAddress,
        ["function invest(uint256 _poolId, uint256 _amount) public"],
        ethers.getDefaultProvider()
      );

      for (const transaction of transactions) {
        safeTransactionData.push({
          to: poolContractAddress,
          value: "0",
          data: poolContract.interface.encodeFunctionData("invest", [
            transaction.poolId,
            transaction.amount,
          ]),
          operation: OperationType.Call,
        });
      }
    }

    return safeTransactionData;
  }
  async proposeApproval(transactionsInfo, tokenAddress, nonce) {
    const transactions = await SafeHandler.createApproveTransactionData(
      transactionsInfo,
      tokenAddress
    );

    const safeTransaction = await (
      await this.protocolKit
    ).createTransaction({
      transactions,
      options: {
        nonce,
      },
    });
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }
  async proposeInvest(transactionsInfo, tokenAddress, nonce) {
    const transactions = await SafeHandler.createInvestTransactionData(
      transactionsInfo,
      tokenAddress
    );

    const safeTransaction = await (
      await this.protocolKit
    ).createTransaction({
      transactions,
      options: {
        nonce,
      },
    });
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }
  //for propose
  async proposeTimeLockModule(
    tokenAddress,
    recipientAddresses,
    values,
    executionTime, // time stamp
    escrow,
    cancellable,
    salt,
    nonce
  ) {
    const transactions = [
      {
        to: TimelockModule.address,
        data: TimelockContract.interface.encodeFunctionData("schedule", [
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
    this.protocolKit = await this.protocolKit;
    const safeTransaction = await this.protocolKit.createTransaction({
      transactions,
      options: {
        nonce,
      },
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

    return {
      safeTxHash,
      safeAddress: this.safeAddress,
      scheduleId,
      executionTime,
    };
  }

  async executeScheduleOnContract(
    safeAdrress,
    safeTxHash,
    scheduleId,
    chainId
  ) {
    const result = {
      msgError: null,
      excutedTxHash: null,
      scheduleId,
      chainId,
    };
    try {
      const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
      if (
        safeTransaction.confirmations.length <
        safeTransaction.confirmationsRequired
      ) {
        result.msgError = "Not enough approval";
        return result;
      }
      const tx = await this.TimelockContract.execute(safeAdrress, scheduleId);
      await tx.wait();
      result.excutedTxHash = tx.hash;
      return result;
    } catch (error) {
      result.msgError = error.message;
      return result;
    }
  }

  async proposeTransaction(transactionsInfo, tokenAddress, nonce) {
    const transactions = await SafeHandler.createSafeTransactionData(
      transactionsInfo,
      tokenAddress
    );

    const safeTransaction = await (
      await this.protocolKit
    ).createTransaction({
      transactions,
      options: {
        nonce,
      },
    });
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }

  async proposeInviteMembers(ownerAddresses, newThreshold, nonce) {
    let transactions = [];
    this.protocolKit = await this.protocolKit;
    const thresholdCurrent = await this.protocolKit.getThreshold();
    for (let i = 0; i < ownerAddresses.length; i++) {
      let threshold =
        i === ownerAddresses.length - 1 ? newThreshold : thresholdCurrent;
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
      options: {
        nonce,
      },
    });
    const safeTxHash = await this.handlePropose(safeTransaction);
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

  async createRejectionTransaction(nonce) {
    this.protocolKit = await this.protocolKit;
    const safeTransaction = await this.protocolKit.createRejectionTransaction(
      nonce
    );
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }

  async createRemoveOwnerTx(ownerAddress, newThreshold, nonce) {
    this.protocolKit = await this.protocolKit;
    const options = {
      nonce,
    };
    const safeTransaction = await this.protocolKit.createRemoveOwnerTx(
      {
        ownerAddress,
        threshold: newThreshold,
      },
      options
    );
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }

  async createAddOwnerTx(ownerAddress, newThreshold, nonce) {
    const options = {
      nonce,
    };
    this.protocolKit = await this.protocolKit;
    const safeTransaction = await this.protocolKit.createAddOwnerTx(
      {
        ownerAddress,
        threshold: newThreshold,
      },
      options
    );
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
  }

  async createChangeThresholdTx(newThreshold, nonce) {
    this.protocolKit = await this.protocolKit;
    const safeTransaction = await this.protocolKit.createChangeThresholdTx(
      newThreshold,
      { nonce }
    );
    const safeTxHash = await this.handlePropose(safeTransaction);
    return safeTxHash;
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

  //for confirm
  async confirmTransaction(safeTxHash) {
    const signature = await (await this.protocolKit).signHash(safeTxHash);
    await this.apiKit.confirmTransaction(safeTxHash, signature.data);
    return safeTxHash;
  }

  async executeTransaction(safeTxHash) {
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
  //for execute
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
  // for check and get
  async checkExecutable(safeTxHash) {
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
    this.protocolKit = await this.protocolKit;
    const isTxExecutable = await this.protocolKit.isValidTransaction(
      safeTransaction
    );
    return isTxExecutable;
  }
  async getNonce() {
    this.protocolKit = await this.protocolKit;
    const nonce = await this.protocolKit.getNonce();
    return nonce;
  }
  async getThreshold() {
    this.protocolKit = await this.protocolKit;
    const thresholdCurrent = await this.protocolKit.getThreshold();
    return thresholdCurrent;
  }
  async checkIsSafeOwner(address) {
    return await (await this.protocolKit).isOwner(address);
  }
  async getOwners() {
    return await (await this.protocolKit).getOwners(this.safeAddress);
  }
}

const decodeSchedule = (inputCode) => {
  let TimelockContract = new ethers.Contract(
    TimelockModule.address,
    TimelockModule.abi
  );
  let value = TimelockContract.interface.decodeFunctionData(
    "schedule",
    inputCode
  );
  const [token, recipients, values, timestamp, escrow, cancellable, salt] =
    value;

  const recipientsArray = Array.isArray(recipients) ? recipients : [recipients];
  const valuesArray = Array.isArray(values) ? values : [values];

  return {
    token,
    recipients: recipientsArray,
    values: valuesArray,
    timestamp,
    escrow,
    cancellable,
    salt,
  };
};

module.exports = {
  decodeSchedule,
  SafeDeployer,
  SafeHandler,
  TimelockContract,
  TimelockModule,
};

