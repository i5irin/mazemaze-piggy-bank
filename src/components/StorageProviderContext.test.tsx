import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  StorageProviderContextProvider,
  useStorageProviderContext,
} from "./StorageProviderContext";

const key = "mazemaze-piggy-bank-storage-provider";
const wrapper = ({ children }: { children: ReactNode }) => (
  <StorageProviderContextProvider>{children}</StorageProviderContextProvider>
);

beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key }));
});

it("does not persist the default as an explicit selection", () => {
  const { result } = renderHook(() => useStorageProviderContext(), { wrapper });
  expect(result.current.activeProviderId).toBe("onedrive");
  expect(localStorage.getItem(key)).toBeNull();
});

it("restores the selected provider and synchronizes explicit changes", () => {
  localStorage.setItem(key, "gdrive");
  const first = renderHook(() => useStorageProviderContext(), { wrapper });
  const second = renderHook(() => useStorageProviderContext(), { wrapper });
  expect(first.result.current.activeProviderId).toBe("gdrive");
  act(() => first.result.current.setActiveProviderId("onedrive"));
  expect(second.result.current.activeProviderId).toBe("onedrive");
  expect(localStorage.getItem(key)).toBe("onedrive");
});

it("keeps selection usable when preference storage fails", () => {
  const { result } = renderHook(() => useStorageProviderContext(), { wrapper });
  const blocked = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  act(() => result.current.setActiveProviderId("gdrive"));
  expect(result.current.activeProviderId).toBe("gdrive");
  blocked.mockRestore();
});
