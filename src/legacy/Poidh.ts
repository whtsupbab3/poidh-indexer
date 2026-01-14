import { ponder } from "ponder:registry";
import { sql } from "ponder";
import {
  bounties,
  claims,
  participationsBounties,
  users,
  transactions,
  leaderboard,
} from "ponder:schema";

import { formatEther } from "viem";
import { desc } from "drizzle-orm";

import offchainDatabase from "../../offchain.database";
import { priceTable } from "../../offchain.schema";

const [price] = await offchainDatabase
  .select()
  .from(priceTable)
  .orderBy(desc(priceTable.id))
  .limit(1);

ponder.on("LegacyPoidhContract:BountyCreated", async ({ event, context }) => {
  const database = context.db;
  const { id, name, amount, issuer, description } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  const isMultiplayer =
    (
      await context.client.readContract({
        abi: context.contracts.LegacyPoidhContract.abi,
        address: context.contracts.LegacyPoidhContract.address,
        functionName: "getParticipants",
        args: [id],
      })
    )[0].length > 0;

  const amountSort =
    Number(formatEther(amount)) *
    (context.chain.id === 666666666
      ? Number(price!.degen_usd)
      : Number(price!.eth_usd));

  await database.insert(bounties).values({
    id: Number(id),
    chainId: context.chain.id,
    onChainId: Number(id),
    title: name,
    createdAt: timestamp,
    description: description,
    amount: amount.toString(),
    amountSort,
    issuer,
    isMultiplayer,
  });

  await database.insert(participationsBounties).values({
    userAddress: issuer,
    bountyId: Number(id),
    amount: amount.toString(),
    chainId: context.chain.id,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: Number(id),
    action: `bounty created`,
    chainId: context.chain.id,
    timestamp,
  });
});

ponder.on("LegacyPoidhContract:BountyCancelled", async ({ event, context }) => {
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
      onChainId: Number(bountyId),
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

ponder.on("LegacyPoidhContract:BountyJoined", async ({ event, context }) => {
  const database = context.db;
  const { amount, participant, bountyId } = event.args;
  const { client, contracts } = context;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  await database
    .insert(users)
    .values({ address: participant })
    .onConflictDoNothing();

  const [_, __, deadline] = await client.readContract({
    abi: contracts.LegacyPoidhContract.abi,
    address: contracts.LegacyPoidhContract.address,
    functionName: "bountyVotingTracker",
    args: [bountyId],
  });

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId: context.chain.id,
    })
    .set((raw) => ({
      amount: (BigInt(raw.amount) + amount).toString(),
      isJoinedBounty: true,
      amountSort:
        Number(formatEther(BigInt(raw.amount) + amount)) *
        (context.chain.id === 666666666
          ? Number(price!.degen_usd)
          : Number(price!.eth_usd)),
      deadline: Number(deadline),
      onChainId: Number(bountyId),
    }));

  await database.insert(participationsBounties).values({
    userAddress: participant,
    bountyId: Number(bountyId),
    amount: amount.toString(),
    chainId: context.chain.id,
  });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: participant,
    bountyId: Number(bountyId),
    action: `+${formatEther(amount)} ${
      context.chain.name === "degen" ? "degen" : "eth"
    }`,
    chainId: context.chain.id,
    timestamp,
  });
});

ponder.on(
  "LegacyPoidhContract:WithdrawFromOpenBounty",
  async ({ event, context }) => {
    const database = context.db;
    const { amount, participant, bountyId } = event.args;
    const { hash, transactionIndex } = event.transaction;
    const { timestamp } = event.block;

    await database
      .update(bounties, {
        id: Number(bountyId),
        chainId: context.chain.id,
      })
      .set((raw) => ({
        amount: (BigInt(raw.amount) - amount).toString(),
        amountSort:
          Number(formatEther(BigInt(raw.amount) - amount)) *
          (context.chain.id === 666666666
            ? Number(price!.degen_usd)
            : Number(price!.eth_usd)),
        onChainId: Number(bountyId),
      }));

    await database.delete(participationsBounties, {
      bountyId: Number(bountyId),
      userAddress: participant,
      chainId: context.chain.id,
    });

    await database.insert(transactions).values({
      index: transactionIndex,
      tx: hash,
      address: participant,
      bountyId: Number(bountyId),
      action: `-${formatEther(amount)} ${
        context.chain.name === "degen" ? "degen" : "eth"
      }`,
      chainId: context.chain.id,
      timestamp,
    });
  },
);

ponder.on("LegacyPoidhContract:ClaimCreated", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, description, id, issuer, name } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  await database
    .insert(users)
    .values({ address: issuer })
    .onConflictDoNothing();

  await database
    .insert(claims)
    .values({
      id: Number(id),
      chainId: context.chain.id,
      onChainId: Number(id),
      title: name,
      description,
      url: "",
      issuer,
      bountyId: Number(bountyId),
      owner: context.contracts.LegacyPoidhContract.address!,
    })
    .onConflictDoUpdate({
      title: name,
      description,
      issuer,
      bountyId: Number(bountyId),
      onChainId: Number(id),
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: issuer,
    bountyId: Number(bountyId),
    claimId: Number(id),
    action: "claim created",
    chainId: context.chain.id,
    timestamp,
  });
});

ponder.on("LegacyPoidhContract:ClaimAccepted", async ({ event, context }) => {
  const database = context.db;
  const { claimId, claimIssuer } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const bountyId = Number(event.args.bountyId);
  const chainId = context.chain.id;

  await database
    .update(claims, {
      id: Number(claimId),
      chainId: context.chain.id,
    })
    .set({
      isAccepted: true,
      onChainId: Number(claimId),
    });

  const bounty = await database
    .update(bounties, {
      id: bountyId,
      chainId,
    })
    .set({
      inProgress: false,
      onChainId: Number(bountyId),
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: claimIssuer,
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

ponder.on(
  "LegacyPoidhContract:ResetVotingPeriod",
  async ({ event, context }) => {
    const database = context.db;
    const { bountyId } = event.args;
    const { client, contracts } = context;
    const { hash, transactionIndex } = event.transaction;
    const { timestamp } = event.block;

    const [_, __, deadline] = await client.readContract({
      abi: contracts.LegacyPoidhContract.abi,
      address: contracts.LegacyPoidhContract.address,
      functionName: "bountyVotingTracker",
      args: [bountyId],
    });

    await database
      .update(bounties, {
        id: Number(bountyId),
        chainId: context.chain.id,
      })
    .set({
      deadline: Number(deadline),
      isVoting: false,
      inProgress: false,
      onChainId: Number(bountyId),
    });


    await database.insert(transactions).values({
      index: transactionIndex,
      tx: hash,
      address: "0x0",
      bountyId: Number(bountyId),
      action: "voting reset period",
      chainId: context.chain.id,
      timestamp,
    });
  },
);

ponder.on(
  "LegacyPoidhContract:ClaimSubmittedForVote",
  async ({ event, context }) => {
    const database = context.db;
    const { bountyId, claimId } = event.args;
    const { client, contracts } = context;
    const { hash, transactionIndex } = event.transaction;
    const { timestamp } = event.block;

    const [_, __, deadline] = await client.readContract({
      abi: contracts.LegacyPoidhContract.abi,
      address: contracts.LegacyPoidhContract.address,
      functionName: "bountyVotingTracker",
      args: [bountyId],
      blockNumber: event.block.number,
    });

    await database
      .update(bounties, {
        id: Number(bountyId),
        chainId: context.chain.id,
      })
    .set({
      isVoting: true,
      deadline: Number(deadline),
      onChainId: Number(bountyId),
    });


    await database.insert(transactions).values({
      index: transactionIndex,
      tx: hash,
      address: "0x0",
      bountyId: Number(bountyId),
      action: `${claimId} submitted for vote`,
      chainId: context.chain.id,
      timestamp,
    });
  },
);

ponder.on("LegacyPoidhContract:VoteClaim", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, claimId, voter } = event.args;
  const { client, contracts } = context;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const [_, __, deadline] = await client.readContract({
    abi: contracts.LegacyPoidhContract.abi,
    address: contracts.LegacyPoidhContract.address,
    functionName: "bountyVotingTracker",
    args: [bountyId],
    blockNumber: event.block.number,
  });

  await database
    .update(bounties, {
      id: Number(bountyId),
      chainId: context.chain.id,
    })
    .set({
      deadline: Number(deadline),
      onChainId: Number(bountyId),
    });

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
