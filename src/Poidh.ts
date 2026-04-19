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
import offchainDatabase from "../offchain.database";
import { bountyExtraTable, notificationsTable } from "../offchain.schema";
import {
  ChainId,
  LATEST_BOUNTIES_INDEX,
  LATEST_CLAIMS_INDEX,
} from "./helpers/constants";
import { isLive } from "./helpers/utils";
import {
  getCurrencyByChainId,
  loadLatestPrice,
  priceBasedOnChainId,
} from "./helpers/price";
import type { NotificationEventPayload } from "./helpers/types";

await loadLatestPrice();

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

  const bounty = await database.insert(bounties).values({
    id: bountyId,
    chainId,
    onChainId: Number(id),
    title,
    createdAt: timestamp,
    description: description,
    amount: amount.toString(),
    issuer,
    isMultiplayer: isOpenBounty,
  });

  await offchainDatabase
    .insert(bountyExtraTable)
    .values({
      bounty_id: bounty.id,
      chain_id: chainId,
      amount_sort: amountSort,
    })
    .onConflictDoUpdate({
      target: [bountyExtraTable.bounty_id, bountyExtraTable.chain_id],
      set: {
        amount_sort: amountSort,
      },
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

  if (isLive(event.block.timestamp)) {
    const currency = getCurrencyByChainId({
      chainId,
    });

    await emitEvent({
      event: "BountyCreated",
      data: {
        ...bounty,
        createdAt: Number(bounty.createdAt),
        amountUSD: amountSort,
        amountCrypto: amount.toString(),
        inProgress: bounty.inProgress ?? false,
        isJoinedBounty: bounty.isJoinedBounty ?? false,
        isCanceled: bounty.isCanceled ?? false,
        isMultiplayer: bounty.isMultiplayer ?? false,
        isVoting: bounty.isVoting ?? false,
        currency,
      },
    });
  }
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
  const amountSort =
    Number(formatEther(latestBountyBalance)) * priceBasedOnChainId(chainId);

  await database
    .insert(users)
    .values({ address: participant })
    .onConflictDoNothing();

  const bounty = await database
    .update(bounties, {
      id: newBountyId,
      chainId,
    })
    .set(() => ({
      amount: latestBountyBalance.toString(),
      isJoinedBounty: true,
      onChainId: Number(bountyId),
    }));

  await offchainDatabase
    .insert(bountyExtraTable)
    .values({
      bounty_id: bounty.id,
      chain_id: chainId,
      amount_sort: amountSort,
    })
    .onConflictDoUpdate({
      target: [bountyExtraTable.bounty_id, bountyExtraTable.chain_id],
      set: {
        amount_sort: amountSort,
      },
    });

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

  if (isLive(event.block.timestamp)) {
    const currency = getCurrencyByChainId({
      chainId,
    });

    const bountyParticipants =
      await database.sql.query.participationsBounties.findMany({
        where: (table, { and, eq, ne }) =>
          and(
            eq(table.bountyId, bounty.id),
            eq(table.chainId, chainId),
            ne(table.userAddress, participant),
          ),
        columns: {
          userAddress: true,
        },
        orderBy: (table) => table.amount,
      });

    await emitEvent({
      event: "BountyJoined",
      data: {
        participant: {
          address: participant,
          amountCrypto: amount.toString(),
          amountUSD: Number(formatEther(amount)) * priceBasedOnChainId(chainId),
        },
        bounty: {
          ...bounty,
          amountUSD: amountSort,
          amountCrypto: bounty.amount,
          createdAt: Number(bounty.createdAt),
          inProgress: bounty.inProgress ?? false,
          isJoinedBounty: bounty.isJoinedBounty ?? false,
          isCanceled: bounty.isCanceled ?? false,
          isMultiplayer: bounty.isMultiplayer ?? false,
          isVoting: bounty.isVoting ?? false,
          participants: bountyParticipants.map((p) => p.userAddress),
          currency,
        },
      },
    });
  }
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
    const amountSort =
      Number(formatEther(latestBountyAmount)) * priceBasedOnChainId(chainId);

    const bounty = await database
      .update(bounties, {
        id: newBountyId,
        chainId,
      })
      .set((raw) => ({
        amount: latestBountyAmount.toString(),
        onChainId: Number(bountyId),
      }));

    await offchainDatabase
      .insert(bountyExtraTable)
      .values({
        bounty_id: bounty.id,
        chain_id: chainId,
        amount_sort: amountSort,
      })
      .onConflictDoNothing();

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

    if (isLive(event.block.timestamp)) {
      const currency = getCurrencyByChainId({
        chainId,
      });
      const participants =
        await database.sql.query.participationsBounties.findMany({
          where: (table, { and, eq, ne }) =>
            and(
              eq(table.bountyId, bounty.id),
              eq(table.chainId, chainId),
              ne(table.userAddress, participant),
            ),
          columns: {
            userAddress: true,
          },
          orderBy: (table) => table.amount,
        });

      const user = await database.find(users, {
        address: participant,
      });
      const withdrawIssuer = {
        address: participant,
        amountCrypto: amount.toString(),
        amountUSD: Number(formatEther(amount)) * priceBasedOnChainId(chainId),
        withdrawalAmounts: getWithdrawalAmounts(user),
      };

      await emitEvent({
        event: "WithdrawFromOpenBounty",
        data: {
          issuer: withdrawIssuer,
          bounty: {
            ...bounty,
            amountUSD: amountSort,
            amountCrypto: bounty.amount,
            createdAt: Number(bounty.createdAt),
            inProgress: bounty.inProgress ?? false,
            isJoinedBounty: bounty.isJoinedBounty ?? false,
            isCanceled: bounty.isCanceled ?? false,
            isMultiplayer: bounty.isMultiplayer ?? false,
            isVoting: bounty.isVoting ?? false,
            participants: participants.map((p) => p.userAddress),
            currency,
          },
        },
      });
    }
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

  const claim = await database
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

  if (isLive(event.block.timestamp)) {
    const bounty = await database.find(bounties, {
      chainId,
      id: newBountyId,
    });

    if (!bounty) {
      return;
    }

    const participants =
      await database.sql.query.participationsBounties.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.bountyId, bounty.id), eq(table.chainId, chainId)),
        columns: {
          userAddress: true,
        },
        orderBy: (table) => table.amount,
      });

    const currency = getCurrencyByChainId({
      chainId,
    });

    const amountSort =
      Number(formatEther(BigInt(bounty.amount))) * priceBasedOnChainId(chainId);

    await emitEvent({
      event: "ClaimCreated",
      data: {
        bounty: {
          ...bounty,
          amountUSD: amountSort,
          amountCrypto: bounty.amount,
          createdAt: Number(bounty.createdAt),
          inProgress: bounty.inProgress ?? false,
          isJoinedBounty: bounty.isJoinedBounty ?? false,
          isCanceled: bounty.isCanceled ?? false,
          isMultiplayer: bounty.isMultiplayer ?? false,
          isVoting: bounty.isVoting ?? false,
          participants: participants.map((p) => p.userAddress),
          currency,
        },
        claim: {
          ...claim,
          isVoting: claim.isVoting ?? false,
          isAccepted: claim.isAccepted ?? false,
        },
      },
    });
  }
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

  const claim = await database
    .update(claims, {
      id: newClaimId,
      chainId,
    })
    .set({
      isAccepted: true,
      isVoting: false,
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
      columns: {
        userAddress: true,
        amount: true,
      },
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

  if (isLive(event.block.timestamp)) {
    const currency = getCurrencyByChainId({
      chainId,
    });

    const amountSort =
      Number(formatEther(BigInt(bounty.amount))) * priceBasedOnChainId(chainId);

    await emitEvent({
      event: "ClaimAccepted",
      data: {
        bounty: {
          ...bounty,
          amountUSD: amountSort,
          amountCrypto: bounty.amount,
          createdAt: Number(bounty.createdAt),
          inProgress: bounty.inProgress ?? false,
          isJoinedBounty: bounty.isJoinedBounty ?? false,
          isCanceled: bounty.isCanceled ?? false,
          isMultiplayer: bounty.isMultiplayer ?? false,
          isVoting: bounty.isVoting ?? false,
          participants: participations.map((p) => p.userAddress),
          currency,
        },
        claim: {
          ...claim,
          isVoting: claim.isVoting ?? false,
          isAccepted: claim.isAccepted ?? false,
        },
      },
    });
  }
});

ponder.on("PoidhContract:VotingResolved", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, claimId, passed, yes, no, round } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(claimId);

  const bounty = (await database.find(bounties, {
    id: newBountyId,
    chainId,
  }))!;

  const claim = (await database
    .update(claims, {
      id: newClaimId,
      chainId,
    })
    .set({
      isAccepted: passed,
      isVoting: false,
    }))!;

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: "0x0",
    bountyId: newBountyId,
    claimId: newClaimId,
    action: "voting resolved",
    chainId,
    timestamp,
  });

  if (isLive(timestamp)) {
    const currency = getCurrencyByChainId({
      chainId,
    });

    const amountSort =
      Number(formatEther(BigInt(bounty.amount))) * priceBasedOnChainId(chainId);

    const participations =
      await database.sql.query.participationsBounties.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.bountyId, newBountyId), eq(table.chainId, chainId)),
        columns: {
          userAddress: true,
          amount: true,
        },
      });

    await emitEvent({
      event: "VotingResolved",
      data: {
        bounty: {
          ...bounty,
          amountUSD: amountSort,
          amountCrypto: bounty.amount,
          createdAt: Number(bounty.createdAt),
          inProgress: !passed,
          isJoinedBounty: bounty.isJoinedBounty ?? false,
          isCanceled: bounty.isCanceled ?? false,
          isMultiplayer: bounty.isMultiplayer ?? false,
          isVoting: false,
          participants: participations.map((p) => p.userAddress),
          currency,
        },
        claim: {
          ...claim,
          isVoting: false,
          isAccepted: passed,
        },
        voting: {
          passed,
          yes: yes.toString(),
          no: no.toString(),
          round: round.toString(),
        },
      },
    });
  }
});

ponder.on("PoidhContract:VotingStarted", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, claimId, deadline, round, issuerYesWeight } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);
  const newClaimId = LATEST_CLAIMS_INDEX[chainId] + Number(claimId);

  const bounty = await database
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
    no: 0n,
    yes: issuerYesWeight,
    round: Number(round),
  });

  await database
    .update(claims, {
      id: newClaimId,
      chainId,
    })
    .set({
      isVoting: true,
    });

  await database.insert(transactions).values({
    index: transactionIndex,
    tx: hash,
    address: bounty.issuer,
    bountyId: newBountyId,
    action: `${newClaimId} submitted for vote`,
    chainId,
    timestamp,
  });

  if (isLive(timestamp)) {
    const claim = await database.find(claims, {
      chainId,
      id: newClaimId,
    });

    if (!claim) {
      return;
    }

    const currency = getCurrencyByChainId({
      chainId: context.chain.id,
    });
    const amountSort =
      Number(formatEther(BigInt(bounty.amount))) * priceBasedOnChainId(chainId);

    const participations =
      await database.sql.query.participationsBounties.findMany({
        where: (table, { and, eq, ne }) =>
          and(
            eq(table.bountyId, bounty.id),
            eq(table.chainId, chainId),
            ne(table.userAddress, bounty.issuer),
          ),
      });

    const otherClaims = await database.sql
      .selectDistinctOn([claims.issuer])
      .from(claims)
      .where(
        sql`${claims.bountyId} = ${bounty.id} AND ${claims.chainId} = ${chainId} AND ${claims.isVoting} IS FALSE`,
      );

    await emitEvent({
      event: "VotingStarted",
      data: {
        bounty: {
          ...bounty,
          amountUSD: amountSort,
          amountCrypto: bounty.amount,
          createdAt: Number(bounty.createdAt),
          inProgress: bounty.inProgress ?? false,
          isJoinedBounty: bounty.isJoinedBounty ?? false,
          isCanceled: bounty.isCanceled ?? false,
          isMultiplayer: bounty.isMultiplayer ?? false,
          isVoting: bounty.isVoting ?? false,
          participants: participations.map((p) => p.userAddress),
          currency,
        },
        claim: {
          ...claim,
          isVoting: true,
          isAccepted: claim.isAccepted ?? false,
        },
        otherClaimers: otherClaims.map((c) => c.issuer),
      },
    });
  }
});

ponder.on("PoidhContract:VoteCast", async ({ event, context }) => {
  const database = context.db;
  const { bountyId, voter, support, weight, round } = event.args;
  const { hash, transactionIndex } = event.transaction;
  const { timestamp } = event.block;
  const chainId = context.chain.id;

  const newBountyId = LATEST_BOUNTIES_INDEX[chainId] + Number(bountyId);

  await database
    .update(votes, {
      bountyId: newBountyId,
      chainId,
      round: Number(round),
    })
    .set((row) => ({
      yes: support ? row.yes + weight : row.yes,
      no: support ? row.no : row.no + weight,
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
  const { user, amount } = event.args;
  const chainId = context.chain.id;
  const database = context.db;

  const userRecord = await database
    .insert(users)
    .values({
      address: user,
      ...withdrawBasedOnChainId(chainId),
    })
    .onConflictDoUpdate(withdrawBasedOnChainId(chainId));

  if (isLive(event.block.timestamp)) {
    await emitEvent({
      event: "Withdrawal",
      data: {
        issuer: {
          address: user,
          amountCrypto: amount.toString(),
          amountUSD: Number(formatEther(amount)) * priceBasedOnChainId(chainId),
          withdrawalAmounts: getWithdrawalAmounts(userRecord),
        },
      },
    });
  }
});

ponder.on("PoidhContract:WithdrawalTo", async ({ event, context }) => {
  const { to, user, amount } = event.args;
  const chainId = context.chain.id;
  const database = context.db;

  const userRecord = await database
    .insert(users)
    .values({
      address: to,
      ...withdrawBasedOnChainId(chainId),
    })
    .onConflictDoUpdate(withdrawBasedOnChainId(chainId));

  if (isLive(event.block.timestamp)) {
    await emitEvent({
      event: "WithdrawalTo",
      data: {
        to,
        issuer: {
          address: user,
          amountCrypto: amount.toString(),
          amountUSD: Number(formatEther(amount)) * priceBasedOnChainId(chainId),
          withdrawalAmounts: getWithdrawalAmounts(userRecord),
        },
      },
    });
  }
});

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

function getWithdrawalAmounts(
  user: {
    withdrawalAmountDegen: number | null;
    withdrawalAmountBase: number | null;
    withdrawalAmountArbitrum: number | null;
  } | null,
) {
  return {
    withdrawalAmountDegen: user?.withdrawalAmountDegen ?? null,
    withdrawalAmountBase: user?.withdrawalAmountBase ?? null,
    withdrawalAmountArbitrum: user?.withdrawalAmountArbitrum ?? null,
  };
}

async function emitEvent({ event, data }: NotificationEventPayload) {
  await offchainDatabase.insert(notificationsTable).values({
    data,
    event,
  });
}
