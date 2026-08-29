import { describe, expect, it, vi } from "vitest";

const captureMock = vi.fn();

vi.mock("@/lib/backtest/capture", () => ({
  captureGameweekSnapshots: () => captureMock(),
}));

const { GET } = await import("@/app/api/cron/snapshot/route");

describe("GET /api/cron/snapshot", () => {
  it("returns the capture result as JSON on success", async () => {
    captureMock.mockResolvedValueOnce({ ok: true, written: ["rs:snapshot:pre:5"] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, written: ["rs:snapshot:pre:5"] });
  });

  it("passes through the clean store-unavailable shape", async () => {
    captureMock.mockResolvedValueOnce({ ok: false, written: [], reason: "redis not configured" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, written: [], reason: "redis not configured" });
  });

  it("returns a 502 with the error message if the capture throws", async () => {
    captureMock.mockRejectedValueOnce(new Error("fpl unreachable"));
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "fpl unreachable" });
  });
});
