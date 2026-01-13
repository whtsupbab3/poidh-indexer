import { ponder } from "ponder:registry";
import { claims, users, leaderboard } from "ponder:schema";
import { and, eq, sql } from "ponder";
import { IGNORE_ADDRESSES } from "../helpers/constants";

ponder.on("LegacyPoidhNFTContract:Transfer", async ({ event, context }) => {
  const database = context.db;
  const { to, tokenId, from } = event.args;

  const chainId = context.chain.id;

  if (!IGNORE_ADDRESSES.includes(to.toLowerCase())) {
    await database.insert(users).values({ address: to }).onConflictDoNothing();
  }

  const url = await context.client.readContract({
    abi: context.contracts.LegacyPoidhNFTContract.abi,
    address: context.contracts.LegacyPoidhNFTContract.address,
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
