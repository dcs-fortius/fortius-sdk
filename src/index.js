//index.js
const { ethers } = require("ethers");
const SafeDeployer = require("./safe-interactive/deployer");
const SafeHandler = require("./safe-interactive/handler");

const TimelockModule = require("./abis/TimelockModule.json");

function convertToChecksumAddress(address) {
  try {
    return ethers.getAddress(address.toLowerCase());
  } catch (error) {
    throw new Error(address);
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
  TimelockModule,
  convertToChecksumAddress,
};
