import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store/redis", () => ({
  storeEnabled: false,
  getRedis: () => null,
}));

const { GET } = await import("@/app/api/cron/snapshot/route");

describe("GET /api/cron/snapshot", () => {
  it("returns the clean store-unavailable shape when storeEnabled is false", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: "redis not configured" });
  });
});

describe("GET /api/cron/snapshot when storeEnabled is stale relative to getRedis", () => {
  it("still returns the clean store-unavailable shape rather than throwing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/store/redis", () => ({
      storeEnabled: true,
      getRedis: () => null,
    }));
    const { GET: getWithStaleFlag } = await import("@/app/api/cron/snapshot/route");
    const res = await getWithStaleFlag();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: "redis not configured" });
  });
});
