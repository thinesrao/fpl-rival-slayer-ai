import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/decision/route";

function request(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/decision", () => {
  it("rejects a missing teamId", async () => {
    const res = await GET(request("http://localhost/api/decision?leagueId=123"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_query");
  });

  it("rejects a non-numeric teamId", async () => {
    const res = await GET(request("http://localhost/api/decision?teamId=abc&leagueId=123"));
    expect(res.status).toBe(400);
  });

  it("rejects a negative leagueId", async () => {
    const res = await GET(request("http://localhost/api/decision?teamId=1&leagueId=-5"));
    expect(res.status).toBe(400);
  });
});
