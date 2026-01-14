import { ponder } from "ponder:registry";
import { claims, users, leaderboard } from "ponder:schema";
import { and, eq, sql } from "ponder";
import {
  IGNORE_ADDRESSES,
  LATEST_CLAIMS_INDEX,
} from "./helpers/constants";

ponder.on("PoidhNFTContract:Transfer", async ({ event, context }) => {
  const database = context.db;
  const { to, tokenId, from } = event.args;

  const chainId = context.chain.id;
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(tokenId);

  if (!IGNORE_ADDRESSES.includes(to.toLowerCase())) {
    await database.insert(users).values({ address: to }).onConflictDoNothing();
  }

  await database
    .update(claims, {
      id: newClaimId,
      chainId,
    })
    .set({
      owner: to,
      issuer: to,
      onChainId: Number(tokenId),
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
