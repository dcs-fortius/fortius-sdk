//index.js
const { ethers } = require("ethers");
const FortiusSafeFactory = require("./abis/FortiusSafeFactory.json");
const TimelockModule = require("./abis/TimelockModule.json");
const GnosisSafe = require("./abis/GnosisSafe.json");
const { OperationType } = require("@safe-global/safe-core-sdk-types");

const SafeApiKit = require("@safe-global/api-kit").default;
const Safe = require("@safe-global/protocol-kit").default;
const {
  deleteTransaction,
} = require("@safe-global/safe-gateway-typescript-sdk");
const { signTypedData } = require("./utils/web3");

const ProxyCreation_TOPIC =
  "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235";

let TimelockContract = new ethers.Contract(
  TimelockModule.address,
  TimelockModule.abi
);

function convertToChecksumAddress(address) {
  try {
    return ethers.getAddress(address.toLowerCase());
  } catch (error) {
    throw new Error(address);
  }
}

function convertToChecksumAddresses(addresses) {
  const result = [];
  const invalidAddresses = [];

  addresses.forEach((address) => {
    try {
      const addressConvert = convertToChecksumAddress(address);
      result.push(addressConvert);
    } catch (error) {
      invalidAddresses.push(error.message);
    }
  });

  if (invalidAddresses.length > 0) {
    return invalidAddresses;
  }
  return result;
}
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
    this.safeAddress = convertToChecksumAddress(safeAddress);
    this.signerAddress = signerAddress;
    this.apiKit = new SafeApiKit({
      chainId,
    });
    this.chainId = chainId;
    if (signer) {
      this.protocolKit = Safe.init({
        provider,
        signer: signer,
        safeAddress: this.safeAddress,
      });
      this.signer = new ethers.Wallet(
        signer,
        new ethers.JsonRpcProvider(provider, chainId)
      );
      this.provider = new ethers.JsonRpcProvider(provider, chainId);
      this.TimelockContract = TimelockContract.connect(
        new ethers.Wallet(signer, new ethers.JsonRpcProvider(provider, chainId))
      );
    } else {
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.protocolKit = Safe.init({
        provider,
        signer: signerAddress,
        safeAddress: this.safeAddress,
      });
      this.signer = this.provider;
      this.TimelockContract = TimelockContract.connect(this.signer);
    }

    this.safeContract = new ethers.Contract(
      this.safeAddress,
      GnosisSafe.abi,
      ethers.getDefaultProvider()
    );
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
    const addresses = convertToChecksumAddresses(recipientAddresses);
    const transactions = [
      {
        to: TimelockModule.address,
        data: TimelockContract.interface.encodeFunctionData("schedule", [
          convertToChecksumAddress(tokenAddress),
          addresses,
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
      addresses,
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

  async isEnoughApproval(safeTxHash) {
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
    if (
      safeTransaction.confirmations.length <
      safeTransaction.confirmationsRequired
    ) {
      return false;
    }
    return true;
  }

  async executeScheduleOnContractV2(
    safeAdrress,
    safeTxHash,
    scheduleId,
    chainId,
    tokenAddress,
    amountTotal
  ) {
    const result = {
      msgError: null,
      excutedTxHash: null,
      scheduleId,
      chainId,
    };
    const isBalanceSufficient = await this.isBalanceSufficient(
      tokenAddress,
      amountTotal
    );
    if (!isBalanceSufficient) {
      result.msgError = "Insufficient balance to trade";
      return result;
    }
    try {
      const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
      if (
        safeTransaction.confirmations.length <
        safeTransaction.confirmationsRequired
      ) {
        result.msgError = "Not enough approval";
        return result;
      }
      let status = false;
      let count = 1;
      let tx;
      while (!status) {
        try {
          tx = await this.TimelockContract.execute(
            convertToChecksumAddress(safeAdrress),
            scheduleId
          );
          status = true;
        } catch (error) {
          const missingResponseRegex = /missing response for request/g;
          const mess = error.message;
          const messType = mess.match(missingResponseRegex);

          if (messType == "missing response for request") {
            if (count == 3) {
              result.msgError = mess;
              return result;
            }
            count++;
            await sleep(3000);
          } else {
            result.msgError = mess;
            return result;
          }
        }
      }
      result.excutedTxHash = tx.hash;
      return result;
    } catch (error) {
      result.msgError = error.message;
      return result;
    }
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
      let status = false;
      let count = 1;
      let tx;
      while (!status) {
        try {
          tx = await this.TimelockContract.execute(
            convertToChecksumAddress(safeAdrress),
            scheduleId
          );
          status = true;
        } catch (error) {
          const missingResponseRegex = /missing response for request/g;
          const mess = error.message;
          const messType = mess.match(missingResponseRegex);

          if (messType == "missing response for request") {
            if (count == 3) {
              result.msgError = mess;
              return result;
            }
            count++;
            await sleep(3000);
          } else {
            result.msgError = mess;
            return result;
          }
        }
      }
      result.excutedTxHash = tx.hash;
      return result;
    } catch (error) {
      result.msgError = error.message;
      return result;
    }
  }

  async proposeTransaction(transactionsInfo, tokenAddress, nonce) {
    const transactions = await this.createSafeTransactionData(
      transactionsInfo,
      convertToChecksumAddress(tokenAddress)
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
    ownerAddresses = convertToChecksumAddresses(ownerAddresses);
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
      if (convertToChecksumAddress(tokenAddress) != "0x") {
        const erc20Contract = new ethers.Contract(
          convertToChecksumAddress(tokenAddress),
          ["function transfer(address to, uint amount) public returns (bool)"],
          ethers.getDefaultProvider()
        );

        safeTransactionData.push({
          to: convertToChecksumAddress(tokenAddress),
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
    const ownerRemoved = convertToChecksumAddress(ownerAddress);
    const safeTransaction = await this.protocolKit.createRemoveOwnerTx(
      {
        ownerRemoved,
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
    const owner = convertToChecksumAddress(ownerAddress);
    const safeTransaction = await this.protocolKit.createAddOwnerTx(
      {
        owner,
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
  async executeTransactionV2(safeTxHash, tokenAddress, amountTotal) {
    try {
      const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
      this.protocolKit = await this.protocolKit;
      const isBalanceSufficient = await this.isBalanceSufficient(
        tokenAddress,
        amountTotal
      );
      if (!isBalanceSufficient) {
        return {
          isSucess: false,
          txHash: "",
          message: "Safe account does not have enough money",
        };
      }
      const isTxExecutable = await this.protocolKit.isValidTransaction(
        safeTransaction
      );
      const txResponse = await (
        await this.protocolKit
      ).executeTransaction(safeTransaction);
      const contractReceipt = await txResponse.transactionResponse?.wait();
      return {
        isSucess: false,
        txHash: contractReceipt?.hash,
        message: "Safe account does not have enough money",
      };
    } catch (error) {
      return {
        isSucess: false,
        txHash: "",
        message: error.message,
      };
    }
  }
  async confirmTransaction(safeTxHash) {
    const signature = await (await this.protocolKit).signHash(safeTxHash);
    await this.apiKit.confirmTransaction(safeTxHash, signature.data);
    return safeTxHash;
  }

  async checkEnoughApprove(safeTxHash) {
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash);
    if (
      safeTransaction.confirmations.length <
      safeTransaction.confirmationsRequired
    ) {
      return false;
    }
    return true;
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
  async deleteTxFromQueue(safeTxHash) {
    if (!this.checkSafeTxHashExist(safeTxHash)) {
      return {
        status: "false",
        mess: "hash does not exist",
      };
    }
    const signature = await this.signTxServiceMessage(
      this.chainId,
      this.safeAddress,
      safeTxHash,
      this.signer
    );
    try {
      await deleteTransaction(this.chainId.toString(), safeTxHash, signature);
      return {
        status: "success",
        mess: "",
      };
    } catch (error) {
      return {
        status: "false",
        mess: error.message,
      };
    }
  }

  async signTxServiceMessage(chainId, safeAddress, safeTxHash, signer) {
    return await signTypedData(signer, {
      types: {
        DeleteRequest: [
          { name: "safeTxHash", type: "bytes32" },
          { name: "totp", type: "uint256" },
        ],
      },
      domain: {
        name: "Safe Transaction Service",
        version: "1.0",
        chainId,
        verifyingContract: safeAddress,
      },
      message: {
        safeTxHash,
        totp: Math.floor(Date.now() / 3600e3),
      },
    });
  }

  async isBalanceSufficient(tokenAddess, amount) {
    // address(0) for base token in chain
    let tokenAmount =
      convertToChecksumAddress(tokenAddess) == ethers.ZeroAddress ||
      tokenAddess == null ||
      tokenAddress == ""
        ? await this.provider.getBalance(this.safeAddress)
        : null;
    if (tokenAmount == null) {
      const erc20Abi = [
        "function balanceOf(address owner) view returns (uint256)",
      ];

      const contract = new ethers.Contract(
        convertToChecksumAddress(tokenAddes),
        erc20Abi,
        this.provider
      );
      tokenAmount = await contract.balanceOf(this.safeAddress);
    }
    const isBalanceSufficient = tokenAmount > amount ? true : false;
    return isBalanceSufficient;
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

  async checkSafeTxHashExist(safeTxHash) {
    try {
      await this.apiKit.getTransaction(safeTxHash);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getBalance() {
    this.protocolKit = await this.protocolKit;
    const balance = await this.protocolKit.getBalance();
    return balance;
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
    return await (
      await this.protocolKit
    ).isOwner(convertToChecksumAddress(address));
  }
  async getOwners() {
    return await (await this.protocolKit).getOwners(this.safeAddress);
  }
}

const decodeSchedule = async (inputCode) => {
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
  convertToChecksumAddress,
};
