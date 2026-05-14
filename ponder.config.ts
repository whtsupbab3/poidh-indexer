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
    main: {
      id: 1,
      rpc: http(process.env.MAIN_RPC_URL),
    },
  },
  contracts: {
    PoidhContract: {
      abi: PoidhV3Abi,
      chain: {
        base: {
          address: "0x5555fa783936c260f77385b4e153b9725fef1719",
          startBlock: 41026079,
        },
        degen: {
          address: "0x18e5585ca7ce31b90bc8bb7aaf84152857ce243f",
          startBlock: 26638629,
        },
        arbitrum: {
          address: "0x5555fa783936c260f77385b4e153b9725fef1719",
          startBlock: 423059298,
        },
        main: {
          address: "0xE731dFadBFf20542E10D09D26Fc71445C70d4232",
          startBlock: 25088349,
        },
      },
    },

    PoidhNFTContract: {
      abi: PoidhClaimNFTAbi,
      chain: {
        base: {
          address: "0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A",
          startBlock: 41026079,
        },
        degen: {
          address: "0x39f04b7897dcaf9dc454e433f43fb1c3bb528e11",
          startBlock: 26638628,
        },
        arbitrum: {
          address: "0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A",
          startBlock: 423059286,
        },
        main: {
          address: "0x9c5F45D5e1382e4058D334d93C6c01442012a4D9",
          startBlock: 25088348,
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
