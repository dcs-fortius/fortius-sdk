const axios = require("axios");

const decodeFormat = require("./decode/format");
const { ethers } = require("ethers");

async function getSafeHistory(chainUrl, safeAddress) {
  let baseData = await getHistoryBase(chainUrl, safeAddress);
  baseData = baseData.results;
  baseData = baseData.slice(0, -3);
  const listRemove = [];
  for (let i = 0; i < baseData.length; i++) {
    if (!baseData[i].safe) {
      listRemove.push(baseData[i]);
      continue;
    }
    let info = {};
    info.status = !baseData[i].transactionHash ? "Pending" : "Complete";
    const inputCode = baseData[i].data;
    if (!inputCode) {
      info.action = {
        type: "Transfer",
        data: [
          {
            to: baseData[i].to,
            value: baseData[i].value,
          },
        ],
      };
    } else {
      const decode = await decodeInputData(
        safeAddress,
        chainUrl,
        baseData[i].to,
        inputCode
      );
      info.action = decode;
    }
    //console.log(info);
    baseData[i].info = info;
  }
  console.log(baseData);
  return baseData;
}
async function decodeInputData(safeAddress, chainUrl, to, inputCode) {
  try {
    if (
      to == "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761" ||
      to == safeAddress
    ) {
      decode = await decodeUsingApi(chainUrl, to, inputCode);
      return decode;
    }
    let typeDecode = inputCode.slice(0, 10);
    const abi = getAbiByToAndTypeDecode(typeDecode);
    const contract = new ethers.Contract(to, abi);
    let value = contract.interface.decodeFunctionData(abi[0].name, inputCode);

    const actionType = getActionType(typeDecode);
    if (actionType == "schedule") {
      value = parseScheduleData(value);
    }
    return {
      actionType,
      value,
    };
  } catch (error) {
    console.log("error data", inputCode);
    console.log("error", error);
  }
}

function parseScheduleData(data) {
  const [token, recipients, values, timestamp, escrow, cancellable, salt] =
    data;

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
}

async function decodeUsingApi(chainUrl, to, inputCode) {
  try {
    const url = `${chainUrl}/api/v1/data-decoder/`;
    const headers = {
      accept: "application/json",
    };
    const body = {
      data: inputCode,
      to,
    };

    let response = await axios.post(url, body, {
      headers: headers,
    });
    const convertData = convertDataForFrontend(response.data);
    return convertData;
  } catch (error) {
    console.log("error data", inputCode);
    console.error("Error fetching history base:", error);
    return null;
  }
}

function convertDataForFrontend(data) {
  let type, actionData;
  if (data.parameters[0].valueDecoded) {
    const transactions = data.parameters.find(
      (param) =>
        param.name === "transactions" && Array.isArray(param.valueDecoded)
    );
    if (!transactions) {
      return [];
    }
    type = transactions.valueDecoded.find(
      (tx) => tx.dataDecoded && tx.dataDecoded.method
    )?.dataDecoded.method;
    actionData = transactions.valueDecoded
      .filter((tx) => tx.dataDecoded && tx.dataDecoded.method === type)
      .map((tx) => {
        const result = {};
        tx.dataDecoded.parameters.forEach((param) => {
          result[param.name] = param.value;
        });
        return result;
      });
    return actionData;
  } else {
    type = data.method;
    let result = {};
    data.parameters.forEach((param) => {
      result[param.name] = param.value;
    });
    return {
      type,
      data: result,
    };
  }
}

function getAbiByToAndTypeDecode(typeDecode) {
  const item = decodeFormat.find((entry) => entry.typeDecode === typeDecode);
  return item ? item.abi : undefined;
}

function getActionType(typeDecode) {
  const item = decodeFormat.find((entry) => entry.typeDecode === typeDecode);
  return item ? item.actionType : undefined;
}
async function getHistoryBase(chainUrl, safeAddress) {
  try {
    const url = `${chainUrl}/api/v1/safes/${safeAddress}/all-transactions/`;
    const headers = {
      accept: "application/json",
    };
    const params = {
      executed: "false",
      queued: "true",
      trusted: "true",
    };

    const response = await axios.get(url, { headers: headers, params: params });
    return response.data;
  } catch (error) {
    console.error("Error fetching history base:", error);
    return null;
  }
}


module.exports = {
  getSafeHistory,
};
