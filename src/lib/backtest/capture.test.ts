import { beforeEach, describe, expect, it, vi } from "vitest";

const getBootstrapMock = vi.fn();
const getLiveMock = vi.fn();
const currentEventMock = vi.fn();
const nextEventMock = vi.fn();

vi.mock("@/lib/fpl/client", () => ({
  getBootstrap: () => getBootstrapMock(),
  getLive: (gw: number) => getLiveMock(gw),
  currentEvent: (bs: unknown) => currentEventMock(bs),
  nextEvent: (bs: unknown) => nextEventMock(bs),
}));

const setMock = vi.fn();
const getRedisMock = vi.fn();
let storeEnabledValue = true;

vi.mock("@/lib/store/redis", () => ({
  get storeEnabled() {
    return storeEnabledValue;
  },
  getRedis: () => getRedisMock(),
}));

const { captureGameweekSnapshots } = await import("@/lib/backtest/capture");

describe("captureGameweekSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeEnabledValue = true;
    getRedisMock.mockReturnValue({ set: setMock });
    getBootstrapMock.mockResolvedValue({ elements: [], events: [] });
    nextEventMock.mockReturnValue({ id: 5, finished: false });
  });

  it("returns the clean store-unavailable shape when storeEnabled is false", async () => {
    storeEnabledValue = false;
    const result = await captureGameweekSnapshots();
    expect(result).toEqual({ ok: false, written: [], reason: "redis not configured" });
    expect(getBootstrapMock).not.toHaveBeenCalled();
  });

  it("returns the clean store-unavailable shape when getRedis returns null even though storeEnabled is true", async () => {
    getRedisMock.mockReturnValue(null);
    const result = await captureGameweekSnapshots();
    expect(result).toEqual({ ok: false, written: [], reason: "redis not configured" });
  });

  it("writes only the pre-deadline snapshot when the current gameweek has not finished", async () => {
    currentEventMock.mockReturnValue({ id: 4, finished: false });
    setMock.mockResolvedValueOnce("OK");

    const result = await captureGameweekSnapshots();

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      "rs:snapshot:pre:5",
      expect.objectContaining({ gw: 5 }),
      { ex: expect.any(Number), nx: true },
    );
    expect(getLiveMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, written: ["rs:snapshot:pre:5"] });
  });

  it("also writes the settled snapshot once the current gameweek has finished", async () => {
    currentEventMock.mockReturnValue({ id: 4, finished: true });
    getLiveMock.mockResolvedValue({ elements: [] });
    setMock.mockResolvedValueOnce("OK").mockResolvedValueOnce("OK");

    const result = await captureGameweekSnapshots();

    expect(getLiveMock).toHaveBeenCalledWith(4);
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenNthCalledWith(
      2,
      "rs:snapshot:settled:4",
      expect.objectContaining({ gw: 4 }),
      { ex: expect.any(Number), nx: true },
    );
    expect(result).toEqual({
      ok: true,
      written: ["rs:snapshot:pre:5", "rs:snapshot:settled:4"],
    });
  });

  it("does not report a key as written when the create-only set finds it already exists", async () => {
    currentEventMock.mockReturnValue({ id: 4, finished: true });
    getLiveMock.mockResolvedValue({ elements: [] });
    setMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await captureGameweekSnapshots();

    expect(result).toEqual({ ok: true, written: [] });
  });
});
