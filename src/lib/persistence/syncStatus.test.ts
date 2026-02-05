import { getSyncIndicatorMeta, resolveSyncIndicatorState } from "./syncStatus";

describe("syncStatus", () => {
  it("resolves status by priority", () => {
    expect(
      resolveSyncIndicatorState({
        isOnline: false,
        isSaving: true,
        retryQueueCount: 2,
        isViewOnly: true,
      }),
    ).toBe("offline");

    expect(
      resolveSyncIndicatorState({
        isOnline: true,
        isSaving: true,
        retryQueueCount: 2,
        isViewOnly: true,
      }),
    ).toBe("saving");

    expect(
      resolveSyncIndicatorState({
        isOnline: true,
        isSaving: false,
        retryQueueCount: 2,
        isViewOnly: true,
      }),
    ).toBe("retry_needed");

    expect(
      resolveSyncIndicatorState({
        isOnline: true,
        isSaving: false,
        retryQueueCount: 0,
        isViewOnly: true,
      }),
    ).toBe("view_only");

    expect(
      resolveSyncIndicatorState({
        isOnline: true,
        isSaving: false,
        retryQueueCount: 0,
        isViewOnly: false,
      }),
    ).toBe("online");
  });

  it("returns fixed labels and tones", () => {
    expect(getSyncIndicatorMeta("online")).toEqual({ label: "Online", tone: "green" });
    expect(getSyncIndicatorMeta("saving")).toEqual({ label: "Saving…", tone: "yellow" });
    expect(getSyncIndicatorMeta("retry_needed")).toEqual({
      label: "Retry needed",
      tone: "red",
    });
    expect(getSyncIndicatorMeta("offline")).toEqual({ label: "Offline", tone: "red" });
    expect(getSyncIndicatorMeta("view_only")).toEqual({ label: "View-only", tone: "yellow" });
  });
});
