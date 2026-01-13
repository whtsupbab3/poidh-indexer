import { index, onchainTable, primaryKey, relations } from "ponder";

export const bounties = onchainTable(
  "Bounties",
  (t) => ({
    id: t.integer().notNull(),
    chainId: t.integer().notNull(),

    createdAt: t.bigint().notNull(),
    title: t.text().notNull(),
    description: t.text().notNull(),
    amount: t.text().notNull(),
    amountSort: t.real().notNull(),
    issuer: t.hex().notNull(),

    inProgress: t.boolean().default(true),
    isJoinedBounty: t.boolean().default(false),
    isCanceled: t.boolean().default(false),
    isMultiplayer: t.boolean(),
    isVoting: t.boolean().default(false),
    deadline: t.integer(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.id, table.chainId],
    }),
    chain_idx: index().on(table.chainId),
  }),
);

export const claims = onchainTable(
  "Claims",
  (t) => ({
    id: t.integer().notNull(),
    chainId: t.integer().notNull(),

    title: t.text().notNull(),
    description: t.text().notNull(),
    url: t.text().notNull(),
    issuer: t.hex().notNull(),

    isAccepted: t.boolean().default(false),

    bountyId: t.integer().notNull(),
    owner: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.id, table.chainId],
    }),
    chain_idx: index().on(table.chainId),
    bounty_idx: index().on(table.bountyId),
    owner_idx: index().on(table.owner),
  }),
);

export const users = onchainTable(
  "Users",
  (t) => ({
    address: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.address] }),
  }),
);

export const leaderboard = onchainTable(
  "Leaderboard",
  (t) => ({
    address: t.hex().notNull(),
    chainId: t.integer().notNull(),
    earned: t.real().default(0),
    paid: t.real().default(0),
    nfts: t.real().default(0),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.address, table.chainId],
    }),
    address_idx: index().on(table.address),
    chain_idx: index().on(table.chainId),
  }),
);

export const participationsBounties = onchainTable(
  "ParticipationsBounties",
  (t) => ({
    userAddress: t.hex().notNull(),
    bountyId: t.integer().notNull(),
    chainId: t.integer().notNull(),
    amount: t.text().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.userAddress, table.bountyId, table.chainId],
    }),
  }),
);

export const transactions = onchainTable(
  "Transactions",
  (t) => ({
    tx: t.hex().notNull(),
    index: t.integer().notNull(),
    bountyId: t.integer().notNull(),
    claimId: t.integer(),
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    action: t.text().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.tx, table.index, table.chainId, table.bountyId],
    }),
  }),
);

export const bountiesRelations = relations(bounties, ({ many, one }) => ({
  claims: many(claims),
  participants: many(participationsBounties),
  issuer: one(users, {
    fields: [bounties.issuer],
    references: [users.address],
  }),
  transactions: many(transactions),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  bounties: many(bounties),
  claims: many(claims),
  participations: many(participationsBounties),
  transactions: many(transactions),
  score: many(leaderboard),
}));

export const claimsRelations = relations(claims, ({ one }) => ({
  bounty: one(bounties, {
    fields: [claims.bountyId, claims.chainId],
    references: [bounties.id, bounties.chainId],
  }),
  issuer: one(users, {
    fields: [claims.issuer],
    references: [users.address],
  }),
  owner: one(users, {
    fields: [claims.owner],
    references: [users.address],
  }),
}));

export const participationsBountiesRelations = relations(
  participationsBounties,
  ({ one }) => ({
    user: one(users, {
      fields: [participationsBounties.userAddress],
      references: [users.address],
    }),
    bounty: one(bounties, {
      fields: [participationsBounties.bountyId],
      references: [bounties.id],
    }),
  }),
);

export const transactionRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.address],
    references: [users.address],
  }),
  bounties: one(bounties, {
    fields: [transactions.bountyId],
    references: [bounties.id],
  }),
}));

export const leaderboardRelations = relations(leaderboard, ({ one }) => ({
  user: one(users, {
    fields: [leaderboard.address],
    references: [users.address],
  }),
}));
