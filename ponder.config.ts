import { createConfig } from "ponder";
import { http } from "viem";
import PoidhV2ABI from "./abis/PoidhV2Abi";
import PoidhV2NFTABI from "./abis/PoidhV2NFTAbi";
import { PoidhV3Abi } from "./abis/PoidhV3";
import { PoidhClaimNFTAbi } from "./abis/PoidhClaimNFT";

export default createConfig({
  ordering: "multichain",
  database: {
    kind: "postgres",
  },
  chains: {
    base: {
      id: 8453,
      rpc: http(process.env.BASE_RPC_URL),
    },
    degen: {
      id: 666666666,
      rpc: http(process.env.DEGEN_RPC_URL),
    },
    arbitrum: {
      id: 42161,
      rpc: http(process.env.ARBITRUM_RPC_URL),
    },
  },
  contracts: {
    PoidhContract: {
      abi: PoidhV3Abi,
      chain: {
        base: {
          address: "0xF3872201171A0fF0a6e789627583E8036C41Baec",
          startBlock: 40678285,
        },
        degen: {
          address: "0x0285626130C127741C18C7730625ca624B727DC3",
          startBlock: 26628691,
        },
        arbitrum: {
          address: "0xF3872201171A0fF0a6e789627583E8036C41Baec",
          startBlock: 420277040,
        },
      },
    },

    PoidhNFTContract: {
      abi: PoidhClaimNFTAbi,
      chain: {
        base: {
          address: "0x18E5585ca7cE31b90Bc8BB7aAf84152857cE243f",
          startBlock: 40678285,
        },
        degen: {
          address: "0xc43e1ab1f0e9daf37Ba532D06A9Fc713AA999A96",
          startBlock: 26628691,
        },
        arbitrum: {
          address: "0x18E5585ca7cE31b90Bc8BB7aAf84152857cE243f",
          startBlock: 420277024,
        },
      },
    },

    LegacyPoidhContract: {
      abi: PoidhV2ABI,
      chain: {
        base: {
          address: "0xb502c5856F7244DccDd0264A541Cc25675353D39",
          startBlock: 14542727,
          endBlock: 39265657,
        },
        degen: {
          address: "0x2445BfFc6aB9EEc6C562f8D7EE325CddF1780814",
          startBlock: 6991084,
          endBlock: 26575631,
        },
        arbitrum: {
          address: "0x0Aa50ce0d724cc28f8F7aF4630c32377B4d5c27d",
          startBlock: 211898523,
          endBlock: 409717812,
        },
      },
    },

    LegacyPoidhNFTContract: {
      abi: PoidhV2NFTABI,
      chain: {
        base: {
          address: "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80",
          startBlock: 14542570,
          endBlock: 39565960,
        },
        degen: {
          address: "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80",
          startBlock: 4857281,
          endBlock: 26575168,
        },
        arbitrum: {
          address: "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80",
          startBlock: 211898311,
          endBlock: 406284950,
        },
      },
    },
  },
});
