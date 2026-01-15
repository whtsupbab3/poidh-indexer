import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { and, eq, graphql } from "ponder";
import { openAPI } from "./openAPI";
import { swaggerUI } from "@hono/swagger-ui";

const app = new Hono();

app.route("/openapi", openAPI);

app.use("/graphql", graphql({ db, schema }));

app.get("/swagger", swaggerUI({ url: "/openapi/doc" }));

app.get("/deployment_id", async (c) => {
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID;
  if (!deploymentId) {
    return c.status(404);
  }

  return c.json({
    deploymentId,
  });
});

app.get("/bounty/:chainId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);

  const bounties = await db
    .select()
    .from(schema.bounties)
    .where(eq(schema.bounties.chainId, chainId))
    .orderBy((bounty) => bounty.id);

  return c.json(bounties);
});

app.get("/bounty/:chainId/:bountyId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);
  const bountyId = Number(c.req.param("bountyId"));

  const bounty = await db
    .select()
    .from(schema.bounties)
    .where(
      and(
        eq(schema.bounties.chainId, chainId),
        eq(schema.bounties.id, bountyId),
      ),
    );

  return c.json(bounty[0]);
});

app.get("/bounty/participations/:chainId/:bountyId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);
  const bountyId = Number(c.req.param("bountyId"));

  const participations = await db
    .select()
    .from(schema.participationsBounties)
    .where(
      and(
        eq(schema.participationsBounties.bountyId, bountyId),
        eq(schema.participationsBounties.chainId, chainId),
      ),
    );

  return c.json(participations);
});

app.get("/bounty/claims/:chainId/:bountyId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);

  const bountyId = Number(c.req.param("bountyId") ?? 0);

  const claims = await db
    .select()
    .from(schema.claims)
    .where(
      and(
        eq(schema.claims.chainId, chainId),
        eq(schema.claims.bountyId, bountyId),
      ),
    )
    .orderBy((claim) => claim.id);

  return c.json(claims);
});

app.get("/live/bounty/:chainId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);
  const bounty = await db
    .select()
    .from(schema.bounties)
    .where(
      and(
        eq(schema.bounties.chainId, chainId),
        eq(schema.bounties.inProgress, true),
        eq(schema.bounties.isVoting, false),
      ),
    );

  return c.json(bounty);
});

app.get("/voting/bounty/:chainId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);

  const bounty = await db
    .select()
    .from(schema.bounties)
    .where(
      and(
        eq(schema.bounties.chainId, chainId),
        eq(schema.bounties.inProgress, true),
        eq(schema.bounties.isVoting, true),
      ),
    );

  return c.json(bounty);
});

app.get("/past/bounty/:chainId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);

  const bounty = await db
    .select()
    .from(schema.bounties)
    .where(
      and(
        eq(schema.bounties.chainId, chainId),
        eq(schema.bounties.inProgress, false),
        eq(schema.bounties.isCanceled, false),
      ),
    );

  return c.json(bounty);
});

app.get("/claim/:chainId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);

  const claims = await db
    .select()
    .from(schema.claims)
    .where(eq(schema.claims.chainId, chainId))
    .orderBy((claim) => claim.id);

  return c.json(claims);
});

app.get("/claim/:chainId/:claimId", async (c) => {
  const chainId = Number(c.req.param("chainId") ?? 0);
  const claimId = Number(c.req.param("claimId"));

  const claim = await db
    .select()
    .from(schema.claims)
    .where(
      and(eq(schema.claims.chainId, chainId), eq(schema.claims.id, claimId)),
    );

  return c.json(claim[0]);
});

export default app;
