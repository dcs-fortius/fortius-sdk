const { OperationType } = require("@safe-global/safe-core-sdk-types");
const { ethers } = require("ethers");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSafeTransactionData(transactions, tokenAddress) {
  const safeTransactionData = [];
  for (const transaction of transactions) {
    if (tokenAddress != ethers.ZeroAddress) {
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
module.exports = {
  sleep,
  createSafeTransactionData,
};
