const { TypedDataEncoder } = require("ethers");
const {
  adjustVInSignature,
} = require("@safe-global/protocol-kit/dist/src/utils/signatures");
const { SigningMethod } = require("@safe-global/protocol-kit");

const hashTypedData = (typedData) => {
  // `ethers` doesn't require `EIP712Domain` and otherwise throws
  const { EIP712Domain: _, ...types } = typedData.types;
  return TypedDataEncoder.hash(typedData.domain, types, typedData.message);
};

const normalizeTypedData = (typedData) => {
  const { EIP712Domain: _, ...types } = typedData.types;
  const payload = TypedDataEncoder.getPayload(
    typedData.domain,
    types,
    typedData.message
  );

  // ethers v6 converts the chainId to a hex value:
  // https://github.com/ethers-io/ethers.js/blob/50b74b8806ef2064f2764b09f89c7ac75fda3a3c/src.ts/hash/typed-data.ts#L75
  // Our SDK expects a number, that's why we convert it here
  // If this gets fixed here: https://github.com/safe-global/safe-eth-py/issues/748
  // we can remove this workaround
  if (payload.domain.chainId) {
    payload.domain.chainId = Number(BigInt(payload.domain.chainId));
  }

  return payload;
};

// Fall back to `eth_signTypedData` for Ledger that doesn't support `eth_signTypedData_v4`
const signTypedDataFallback = async (signer, typedData) => {
  return await signer.provider.send("eth_signTypedData", [
    signer.address.toLowerCase(),
    TypedDataEncoder.getPayload(
      typedData.domain,
      typedData.types,
      typedData.message
    ),
  ]);
};

const signTypedData = async (signer, typedData) => {
  const UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION";
  let signature = "";
  try {
    const { domain, types, message } = typedData;
    signature = await signer.signTypedData(domain, types, message);
  } catch (e) {
    if (e.code === UNSUPPORTED_OPERATION) {
      signature = await signTypedDataFallback(signer, typedData);
    } else {
      throw e;
    }
  }
  return adjustVInSignature(SigningMethod.ETH_SIGN_TYPED_DATA, signature);
};

module.exports = {
  signTypedData,
  normalizeTypedData,
  hashTypedData,
};
