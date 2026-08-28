import { NextResponse } from "next/server";

import report from "@/data/model-report.json";
import type { ModelReport } from "@/lib/projections/model-report";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(report as ModelReport, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
