// Utility function to sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function to convert an address to checksum format

async function createSafeTransactionData(transactions, tokenAddress = "0x") {
  return transactions.map((transaction) => {
    const erc20Contract = new ethers.Contract(
      tokenAddress,
      ["function transfer(address to, uint amount) public returns (bool)"],
      ethers.getDefaultProvider()
    );

    return {
      to: tokenAddress,
      value: "0",
      data: erc20Contract.interface.encodeFunctionData("transfer", [
        transaction.to,
        transaction.amount,
      ]),
      operation: OperationType.Call,
    };
  });
}
module.exports = {
  sleep,
  createSafeTransactionData,
};
