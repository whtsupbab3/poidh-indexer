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
import {
  ChainId,
  LATEST_BOUNTIES_INDEX,
  LATEST_CLAIMS_INDEX,
} from "./helpers/constants";

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
  const bountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(id);

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  const amountSort = Number(formatEther(amount)) * priceBasedOnChainId(chainId);

  await database.insert(bounties).values({
    id: bountyId,
    chainId,
    onChainId: Number(id),
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
    bountyId,
    amount: amount.toString(),
    chainId,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId,
    action: `bounty created`,
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:BountyCancelled", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, issuer, issuerRefund } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

  await database
    .update(bounties, {
      id: newBountyId,
      chainId,
    })
    .set({
      isCanceled: true,
      inProgress: false,
      onChainId: Number(bountyId),
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: newBountyId,
    action: `bounty canceled`,
    chainId,
    timestamp,
  });

  await database
    .insert(users)
    .values({
      address: issuer,
      ...updatePriceBasedOnChainId(null, chainId, issuerRefund),
    })
    .onConflictDoUpdate((row) =>
      updatePriceBasedOnChainId(row, chainId, issuerRefund),
    );
});

ponder.on("PoidhContract:BountyJoined", async ({ event, context }) => {
  const database = context.db;
  const { amount, participant, bountyId, latestBountyBalance } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

  await database
    .insert(users)
    .values({ address: participant })
    .onConflictDoNothing();

  await database
    .update(bounties, {
      id: newBountyId,
      chainId,
    })
    .set(() => ({
      amount: latestBountyBalance.toString(),
      isJoinedBounty: true,
      amountSort:
        Number(formatEther(latestBountyBalance)) * priceBasedOnChainId(chainId),
      onChainId: Number(bountyId),
    }));

  await database.insert(participationsBounties).values({
    userAddress: participant,
    bountyId: newBountyId,
    amount: amount.toString(),
    chainId,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: participant,
    bountyId: newBountyId,
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

    const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

    await database
      .update(bounties, {
        id: newBountyId,
        chainId,
      })
      .set((raw) => ({
        amount: latestBountyAmount.toString(),
        amountSort:
          Number(formatEther(latestBountyAmount)) *
          priceBasedOnChainId(chainId),
        onChainId: Number(bountyId),
      }));

    await database.delete(participationsBounties, {
      bountyId: newBountyId,
      userAddress: participant,
      chainId,
    });

    await database.insert(transactions).values({
      index: transactionIndex,
      tx: hash,
      address: participant,
      bountyId: newBountyId,
      action: `-${formatEther(amount)} ${
        context.chain.name === "degen" ? "degen" : "eth"
      }`,
      chainId,
      timestamp,
    });

    await database
      .insert(users)
      .values({
        address: participant,
        ...updatePriceBasedOnChainId(null, chainId, amount),
      })
      .onConflictDoUpdate((row) =>
        updatePriceBasedOnChainId(row, chainId, amount),
      );
  },
);

ponder.on("PoidhContract:ClaimCreated", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, description, id, issuer, title, imageUri } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(id);

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  await database
    .insert(claims)
    .values({
      id: newClaimId,
      chainId,
      onChainId: Number(id),
      bountyId: newBountyId,
      title,
      description,
      url: imageUri,
      issuer,
      owner: context.contracts.PoidhContract.address!,
    })
    .onConflictDoUpdate({
      bountyId: newBountyId,
      title,
      description,
      issuer,
      url: imageUri,
      onChainId: Number(id),
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: newBountyId,
    claimId: newClaimId,
    action: "claim created",
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:ClaimAccepted", async ({ event, context }) => {
  const database = context.db;
  const { claimId, bountyIssuer, claimIssuer, payout } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const chainId = context.chain.id;
  const onChainBountyId = Number(event.args.bountyId);
  const bountyId = LATEST_BOUNTIES_INDEX[chainId] + onChainBountyId;
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(claimId);

  await database
    .update(claims, {
      id: newClaimId,
      chainId,
    })
    .set({
      isAccepted: true,
      onChainId: Number(claimId),
    });

  await database
    .insert(users)
    .values({
      address: claimIssuer,
      ...updatePriceBasedOnChainId(null, chainId, payout),
    })
    .onConflictDoUpdate((row) =>
      updatePriceBasedOnChainId(row, chainId, payout),
    );

  const bounty = await database
    .update(bounties, {
      id: bountyId,
      chainId,
    })
    .set({
      inProgress: false,
      onChainId: onChainBountyId,
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

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

  await database
    .update(bounties, {
      id: newBountyId,
      chainId,
    })
    .set({
      isVoting: false,
      inProgress: !passed,
      onChainId: Number(bountyId),
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: "0x0",
    bountyId: newBountyId,
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

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(claimId);

  await database
    .update(bounties, {
      id: newBountyId,
      chainId,
    })
    .set({
      isVoting: true,
      deadline: Number(deadline),
      onChainId: Number(bountyId),
    });

  await database.insert(votes).values({
    bountyId: newBountyId,
    chainId,
    claimId: newClaimId,
    no: 0,
    yes: 0,
    round: Number(round),
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: "0x0",
    bountyId: newBountyId,
    action: `${newClaimId} submitted for vote`,
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

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

  const latestVoteRound = await database.sql.query.votes.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.bountyId, newBountyId), eq(table.chainId, chainId)),
    orderBy: (table, { desc }) => [desc(table.round)],
  });

  await database
    .update(votes, {
      bountyId: newBountyId,
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
    bountyId: newBountyId,
    action: `voted`,
    chainId,
    timestamp,
  });
});

ponder.on("PoidhContract:RefundClaimed", async ({ event, context }) => {
  const { amount, participant } = event.args;
  const chainId = context.chain.id;
  const database = context.db;

  await database
    .insert(users)
    .values({
      address: participant,
      ...updatePriceBasedOnChainId(null, chainId, amount),
    })
    .onConflictDoUpdate((row) =>
      updatePriceBasedOnChainId(row, chainId, amount),
    );
});

ponder.on("PoidhContract:Withdrawal", async ({ event, context }) => {
  const { user } = event.args;
  const chainId = context.chain.id;
  const database = context.db;

  await database
    .insert(users)
    .values({
      address: user,
      ...withdrawBasedOnChainId(chainId),
    })
    .onConflictDoUpdate(withdrawBasedOnChainId(chainId));
});

ponder.on("PoidhContract:WithdrawalTo", async ({ event, context }) => {
  const { to } = event.args;
  const chainId = context.chain.id;
  const database = context.db;

  await database
    .insert(users)
    .values({
      address: to,
      ...withdrawBasedOnChainId(chainId),
    })
    .onConflictDoUpdate(withdrawBasedOnChainId(chainId));
});

function priceBasedOnChainId(chainId: number) {
  return chainId === 666666666
    ? Number(price!.degen_usd)
    : Number(price!.eth_usd);
}

function updatePriceBasedOnChainId(
  row: {
    address: `0x${string}`;
    withdrawalAmountDegen: number | null;
    withdrawalAmountBase: number | null;
    withdrawalAmountArbitrum: number | null;
  } | null,
  chainId: ChainId,
  payout: bigint,
) {
  const amountParsed = Number(formatEther(payout));

  if (chainId === 8453) {
    return {
      withdrawalAmountBase: (row?.withdrawalAmountBase ?? 0) + amountParsed,
    };
  }
  if (chainId === 666666666) {
    return {
      withdrawalAmountDegen: (row?.withdrawalAmountDegen ?? 0) + amountParsed,
    };
  }
  return {
    withdrawalAmountArbitrum:
      (row?.withdrawalAmountArbitrum ?? 0) + amountParsed,
  };
}

function withdrawBasedOnChainId(chainId: ChainId) {
  if (chainId === 8453) {
    return {
      withdrawalAmountBase: 0,
    };
  }
  if (chainId === 666666666) {
    return {
      withdrawalAmountDegen: 0,
    };
  }
  return {
    withdrawalAmountArbitrum: 0,
  };
}
