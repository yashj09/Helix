// Minimal ABIs hand-extracted from helix/contracts/out/ after build.
// Only the functions + events we actually call from the web app.
// Regenerate with: forge inspect src/helix/HelixSoul.sol:HelixSoul abi --json

export const HelixSoulAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "iDatas",
        type: "tuple[]",
        components: [
          { name: "dataDescription", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "iMergeFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "parentA", type: "uint256" },
      { name: "parentB", type: "uint256" },
      { name: "to", type: "address" },
      { name: "parentAProofs", type: "tuple[]", components: transferValidityProofTuple() },
      { name: "parentBProofs", type: "tuple[]", components: transferValidityProofTuple() },
      { name: "childProofs", type: "tuple[]", components: transferValidityProofTuple() },
    ],
    outputs: [{ name: "childTokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "creatorOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Merged",
    inputs: [
      { name: "_parentA", type: "uint256", indexed: true },
      { name: "_parentB", type: "uint256", indexed: true },
      { name: "_childTokenId", type: "uint256", indexed: true },
      { name: "_to", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export const HelixLineageAbi = [
  {
    type: "function",
    name: "distributeInvocationRevenue",
    stateMutability: "payable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ancestorsOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "shareBps", type: "uint16" },
        ],
      },
    ],
  },
] as const;

export const HelixNamesAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setTextBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "keys", type: "string[]" },
      { name: "values", type: "string[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveFull",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "owner", type: "address" },
    ],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "nameOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function transferValidityProofTuple() {
  return [
    {
      name: "accessProof",
      type: "tuple",
      components: [
        { name: "dataHash", type: "bytes32" },
        { name: "targetPubkey", type: "bytes" },
        { name: "nonce", type: "bytes" },
        { name: "proof", type: "bytes" },
      ],
    },
    {
      name: "ownershipProof",
      type: "tuple",
      components: [
        { name: "oracleType", type: "uint8" },
        { name: "dataHash", type: "bytes32" },
        { name: "sealedKey", type: "bytes" },
        { name: "targetPubkey", type: "bytes" },
        { name: "nonce", type: "bytes" },
        { name: "proof", type: "bytes" },
      ],
    },
  ] as const;
}
