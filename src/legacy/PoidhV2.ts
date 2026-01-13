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

import {
  getCreatorDisplayName,
  isLive,
  sendNotification,
} from "../helpers/notifications";

const POIDH_BASE_URL = "https://poidh.xyz";

const [price] = await offchainDatabase
  .select()
  .from(priceTable)
  .orderBy(desc(priceTable.id))
  .limit(1);

ponder.on("PoidhV2Contract:BountyCreated", async ({ event, context }) => {
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
        abi: context.contracts.PoidhV2Contract.abi,
        address: context.contracts.PoidhV2Contract.address,
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

  if (amountSort >= 100 && isLive(event.block.timestamp)) {
    const creatorName = await getCreatorDisplayName(issuer);
    await sendNotification({
      title: `💰 NEW $${amountSort.toFixed(0)} BOUNTY 💰`,
      messageBody: `${name}${creatorName ? ` from ${creatorName}` : ""}`,
      targetUrl: `${POIDH_BASE_URL}/${context.chain.name}/bounty/${id}`,
      targetFIds: [],
    });
  }
});

ponder.on("PoidhV2Contract:BountyCancelled", async ({ event, context }) => {
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

ponder.on("PoidhV2Contract:BountyJoined", async ({ event, context }) => {
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
    abi: contracts.PoidhV2Contract.abi,
    address: contracts.PoidhV2Contract.address,
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
  "PoidhV2Contract:WithdrawFromOpenBounty",
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

ponder.on("PoidhV2Contract:ClaimCreated", async ({ event, context }) => {
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
      title: name,
      description,
      url: "",
      issuer,
      bountyId: Number(bountyId),
      owner: context.contracts.PoidhV2Contract.address!,
    })
    .onConflictDoUpdate({
      title: name,
      description,
      issuer,
      bountyId: Number(bountyId),
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

ponder.on("PoidhV2Contract:ClaimAccepted", async ({ event, context }) => {
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

ponder.on("PoidhV2Contract:ResetVotingPeriod", async ({ event, context }) => {
  const database = context.db;
  const { bountyId } = event.args;
  const { client, contracts } = context;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const [_, __, deadline] = await client.readContract({
    abi: contracts.PoidhV2Contract.abi,
    address: contracts.PoidhV2Contract.address,
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
});

ponder.on(
  "PoidhV2Contract:ClaimSubmittedForVote",
  async ({ event, context }) => {
    const database = context.db;
    const { bountyId, claimId } = event.args;
    const { client, contracts } = context;
    const { hash, transactionIndex } = event.transaction;
    const { timestamp } = event.block;

    const [_, __, deadline] = await client.readContract({
      abi: contracts.PoidhV2Contract.abi,
      address: contracts.PoidhV2Contract.address,
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

ponder.on("PoidhV2Contract:VoteClaim", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, claimId, voter } = event.args;
  const { client, contracts } = context;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;

  const [_, __, deadline] = await client.readContract({
    abi: contracts.PoidhV2Contract.abi,
    address: contracts.PoidhV2Contract.address,
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
