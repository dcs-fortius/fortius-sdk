const format = [
  {
    typeDecode: "0x6673bff6",
    abi: [
      {
        inputs: [
          {
            internalType: "address",
            name: "token",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "recipients",
            type: "address[]",
          },
          {
            internalType: "uint256[]",
            name: "values",
            type: "uint256[]",
          },
          {
            internalType: "uint256",
            name: "timestamp",
            type: "uint256",
          },
          {
            internalType: "bool",
            name: "escrow",
            type: "bool",
          },
          {
            internalType: "bool",
            name: "cancellable",
            type: "bool",
          },
          {
            internalType: "bytes32",
            name: "salt",
            type: "bytes32",
          },
        ],
        name: "schedule",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
    ],
    actionType: "schedule",
  },
  {
    typeDecode: "0x8d80ff0a",
    abi: [
      {
        inputs: [
          { internalType: "bytes", name: "transactions", type: "bytes" },
        ],
        name: "multiSend",
        outputs: [],
        stateMutability: "payable",
        type: "function",
      },
    ],
    actionType: "MutiSend",
  },
];
module.exports = format;
