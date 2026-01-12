import { ponder } from "ponder:registry";
import { claims, users, leaderboard } from "../../ponder.schema";
import { and, eq, sql } from "ponder";

const IGNORE_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0xb502c5856F7244DccDd0264A541Cc25675353D39",
  "0x2445BfFc6aB9EEc6C562f8D7EE325CddF1780814",
  "0x0Aa50ce0d724cc28f8F7aF4630c32377B4d5c27d",
].map((address) => address.toLowerCase());

ponder.on("PoidhNFTV2Contract:Transfer", async ({ event, context }) => {
  const database = context.db;
  const { to, tokenId, from } = event.args;

  const chainId = context.chain.id;

  if (!IGNORE_ADDRESSES.includes(to.toLowerCase())) {
    await database.insert(users).values({ address: to }).onConflictDoNothing();
  }

  const url = await context.client.readContract({
    abi: context.contracts.PoidhNFTV2Contract.abi,
    address: context.contracts.PoidhNFTV2Contract.address,
    functionName: "tokenURI",
    args: [tokenId],
    blockNumber: event.block.number,
  });

  await database
    .insert(claims)
    .values({
      id: Number(tokenId),
      chainId,
      title: "",
      description: "",
      url,
      bountyId: 0,
      owner: to,
      issuer: to,
    })
    .onConflictDoUpdate({
      owner: to,
    });

  if (!IGNORE_ADDRESSES.includes(from.toLowerCase())) {
    const fromNFTs =
      (
        await database.sql
          .select({
            count: sql<number>`count(*)`,
          })
          .from(claims)
          .where(and(eq(claims.owner, from), eq(claims.chainId, chainId)))
      )[0]?.count ?? 0;

    await database
      .insert(leaderboard)
      .values({
        address: from,
        chainId,
        nfts: fromNFTs,
      })
      .onConflictDoUpdate({
        nfts: fromNFTs,
      });
  }
  if (!IGNORE_ADDRESSES.includes(to.toLowerCase())) {
    const toNFTs =
      (
        await database.sql
          .select({
            count: sql<number>`count(*)`,
          })
          .from(claims)
          .where(and(eq(claims.owner, to), eq(claims.chainId, chainId)))
      )[0]?.count ?? 0;

    await database
      .insert(leaderboard)
      .values({
        chainId,
        address: to,
        nfts: toNFTs,
      })
      .onConflictDoUpdate({
        nfts: toNFTs,
      });
  }
});
