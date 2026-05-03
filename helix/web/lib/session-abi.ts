// Minimal ABI subset for HelixSessionRental — just what the web API routes + UI need.
//
// Regenerate with:
//   cd helix/contracts && forge inspect src/helix/HelixSessionRental.sol:HelixSessionRental abi --json

export const HelixSessionRentalAbi = [
  {
    type: "function",
    name: "rentSession",
    stateMutability: "payable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "renter", type: "address" },
      { name: "messageCount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "activeSessionOf",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "renter", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "SessionRented",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "renter", type: "address", indexed: true },
      { name: "messageCount", type: "uint256" },
      { name: "amountPaid", type: "uint256" },
      { name: "totalRemainingAfter", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "SessionConsumed",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "renter", type: "address", indexed: true },
      { name: "remaining", type: "uint256" },
    ],
  },
] as const;
