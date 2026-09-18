import { act, renderHook, waitFor } from "@testing-library/react";
import { useSharedRoots } from "./useSharedRoots";
import type { StorageService } from "@/lib/storage/storageService";

const root = {
  providerId: "onedrive" as const,
  sharedId: "owner_root",
  name: "Family",
  isFolder: true,
};
const service = (list: () => Promise<(typeof root)[]>, own = async () => [] as (typeof root)[]) =>
  ({
    capabilities: { supportsShared: true },
    listSharedWithMeRoots: list,
    listSharedByMeRoots: own,
  }) as unknown as StorageService;

it("keeps joined roots usable when the owner's folder enumeration fails", async () => {
  const storage = service(
    async () => [root],
    async () => {
      throw new Error("403");
    },
  );
  const { result } = renderHook(() => useSharedRoots(storage, "account-a", true));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.roots).toEqual([root]);
  expect(result.current.message).toContain("Some workspaces");
});

it("hides old results on account switch and ignores in-flight old requests", async () => {
  let finish!: (items: (typeof root)[]) => void;
  const list = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([]);
  const storage = service(list);
  const { result, rerender } = renderHook(({ account }) => useSharedRoots(storage, account, true), {
    initialProps: { account: "account-a" },
  });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  rerender({ account: "account-b" });
  expect(result.current.roots).toEqual([]);
  await act(async () => {
    finish([root]);
  });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.roots).toEqual([]);
});

it("does not refetch on unrelated browser storage writes", async () => {
  const list = jest.fn().mockResolvedValue([root]);
  const storage = service(list);
  const { result } = renderHook(() => useSharedRoots(storage, "account", true));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  });
  expect(list).toHaveBeenCalledTimes(1);
});
