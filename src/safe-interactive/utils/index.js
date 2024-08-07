// Utility function to sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function to convert an address to checksum format
function convertToChecksumAddress(address) {
  return ethers.getAddress(address.toLowerCase());
}
async function createSafeTransactionData(transactions, tokenAddress = "0x") {
  return transactions.map((transaction) => {
    if (convertToChecksumAddress(tokenAddress) !== "0x") {
      const erc20Contract = new ethers.Contract(
        convertToChecksumAddress(tokenAddress),
        ["function transfer(address to, uint amount) public returns (bool)"],
        ethers.getDefaultProvider()
      );

      return {
        to: convertToChecksumAddress(tokenAddress),
        value: "0",
        data: erc20Contract.interface.encodeFunctionData("transfer", [
          transaction.to,
          transaction.amount,
        ]),
        operation: OperationType.Call,
      };
    } else {
      return {
        to: transaction.to,
        value: transaction.amount,
        data: "0x",
        operation: OperationType.Call,
      };
    }
  });
}
module.exports = {
  sleep,
  convertToChecksumAddress,
  createSafeTransactionData,
};
