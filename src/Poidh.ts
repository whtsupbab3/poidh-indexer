import { ponder } from "ponder:registry";
import { sql } from "ponder";
import {
  bounties,
  claims,
  participationsBounties,
  users,
  transactions,
  leaderboard,
  votes,
} from "ponder:schema";

import { formatEther } from "viem";
import { desc } from "drizzle-orm";

import offchainDatabase from "../offchain.database";
import { priceTable } from "../offchain.schema";

const [price] = await offchainDatabase
  .select()
  .from(priceTable)
  .orderBy(desc(priceTable.id))
  .limit(1);

ponder.on("PoidhContract:BountyCreated", async ({ event, context }) => {
  const database = context.db;
  const { id, title, isOpenBounty, amount, issuer, description } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  const amountSort = Number(formatEther(amount)) * priceBasedOnChainId(chainId);

  await database.insert(bounties).values({
    id: Number(id),
    chainId,
    title,
    createdAt: timestamp,
    description: description,
    amount: amount.toString(),
    amountSort,
    issuer,
    isMultiplayer: isOpenBounty,
  });

  await database.insert(participationsBounties).values({
    userAddress: issuer,
    bountyId: Number(id),
    amount: amount.toString(),
    chainId,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: Number(id),
    action: `bounty created`,
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:BountyCancelled", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, issuer } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId: context.chain.id,
    })
    .set({
      isCanceled: true,
      inProgress: false,
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: Number(bountyId),
    action: `bounty canceled`,
    chainId: context.chain.id,
    timestamp,
  });
});

ponder.on("PoidhContract:BountyJoined", async ({ event, context }) => {
  const database = context.db;
  const { amount, participant, bountyId, latestBountyBalance } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  await database
    .insert(users)
    .values({ address: participant })
    .onConflictDoNothing();

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId,
    })
    .set(() => ({
      amount: latestBountyBalance.toString(),
      isJoinedBounty: true,
      amountSort:
        Number(formatEther(latestBountyBalance)) * priceBasedOnChainId(chainId),
    }));

  await database.insert(participationsBounties).values({
    userAddress: participant,
    bountyId: Number(bountyId),
    amount: amount.toString(),
    chainId,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: participant,
    bountyId: Number(bountyId),
    action: `+${formatEther(amount)} ${
      context.chain.name === "degen" ? "degen" : "eth"
    }`,
    chainId,
    timestamp,
  });
});

ponder.on(
  "PoidhContract:WithdrawFromOpenBounty",
  async ({ event, context }) => {
    const database = context.db;
    const { amount, participant, bountyId, latestBountyAmount } = event.args;
    const { hash, transactionIndex } = event.transaction;
    const { timestamp } = event.block;
    const chainId = context.chain.id;

    await database
      .update(bounties, {
        id: Number(bountyId),
        chainId,
      })
      .set((raw) => ({
        amount: latestBountyAmount.toString(),
        amountSort:
          Number(formatEther(latestBountyAmount)) *
          priceBasedOnChainId(chainId),
      }));

    await database.delete(participationsBounties, {
      bountyId: Number(bountyId),
      userAddress: participant,
      chainId,
    });

    await database.insert(transactions).values({
      index: transactionIndex,
      tx: hash,
      address: participant,
      bountyId: Number(bountyId),
      action: `-${formatEther(amount)} ${
        context.chain.name === "degen" ? "degen" : "eth"
      }`,
      chainId,
      timestamp,
    });
  },
);

ponder.on("PoidhContract:ClaimCreated", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, description, id, issuer, title, imageUri } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  await database
    .insert(claims)
    .values({
      id: Number(id),
      chainId,
      bountyId: Number(bountyId),
      title,
      description,
      url: imageUri,
      issuer,
      owner: context.contracts.PoidhContract.address!,
    })
    .onConflictDoUpdate({
      bountyId: Number(bountyId),
      title,
      description,
      issuer,
      url: imageUri,
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: Number(bountyId),
    claimId: Number(id),
    action: "claim created",
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:ClaimAccepted", async ({ event, context }) => {
  const database = context.db;
  const { claimId, bountyIssuer, claimIssuer } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const bountyId = Number(event.args.bountyId);
  const chainId = context.chain.id;

  await database
    .update(claims, {
      id: Number(claimId),
      chainId,
    })
    .set({
      isAccepted: true,
    });

  const bounty = await database
    .update(bounties, {
      id: bountyId,
      chainId,
    })
    .set({
      inProgress: false,
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: bountyIssuer,
    bountyId,
    action: "claim accepted",
    chainId,
    timestamp,
  });

  const participations =
    await database.sql.query.participationsBounties.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.bountyId, bountyId), eq(table.chainId, chainId)),
    });

  await database.sql
    .insert(leaderboard)
    .values({
      address: claimIssuer,
      chainId,
      earned: Number(formatEther(BigInt(bounty.amount))),
    })
    .onConflictDoUpdate({
      target: [leaderboard.address, leaderboard.chainId],
      set: {
        earned: sql`${leaderboard.earned} + ${Number(
          formatEther(BigInt(bounty.amount)),
        )}`,
      },
    });

  await Promise.all(
    participations.map(async (p) => {
      const paid = Number(formatEther(BigInt(p.amount)));
      return database.sql
        .insert(leaderboard)
        .values({
          address: p.userAddress,
          chainId,
          paid: Number(formatEther(BigInt(p.amount))),
        })
        .onConflictDoUpdate({
          target: [leaderboard.address, leaderboard.chainId],
          set: {
            paid: sql`${leaderboard.paid} + ${paid}`,
          },
        });
    }),
  );
});

ponder.on("PoidhContract:VotingResolved", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, passed } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId,
    })
    .set({
      isVoting: false,
      inProgress: !passed,
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: "0x0",
    bountyId: Number(bountyId),
    action: "voting reset period",
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:VotingStarted", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, claimId, deadline, round } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId,
    })
    .set({
      isVoting: true,
      deadline: Number(deadline),
    });

  await database.insert(votes).values({
    bountyId: Number(bountyId),
    chainId,
    claimId: Number(claimId),
    no: 0,
    yes: 0,
    round: Number(round),
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: "0x0",
    bountyId: Number(bountyId),
    action: `${claimId} submitted for vote`,
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:VoteCast", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, voter, support } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const latestVoteRound = await database.sql.query.votes.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.bountyId, Number(bountyId)), eq(table.chainId, chainId)),
    orderBy: (table, { desc }) => [desc(table.round)],
  });

  await database
    .update(votes, {
      bountyId: Number(bountyId),
      chainId,
      round: latestVoteRound!.round,
    })
    .set((row) => ({
      yes: support ? row.yes + 1 : row.yes,
      no: support ? row.no : row.no + 1,
    }));

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: voter,
    bountyId: Number(bountyId),
    action: `voted`,
    chainId: context.chain.id,
    timestamp,
  });
});

function priceBasedOnChainId(chainId: number) {
  return chainId === 666666666
    ? Number(price!.degen_usd)
    : Number(price!.eth_usd);
}
