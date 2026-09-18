import { configureAppServiceWorker } from "./serviceWorker";

const worker = (scriptURL: string) => ({ scriptURL }) as ServiceWorker;

function setServiceWorker(value: Partial<ServiceWorkerContainer>) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value });
}

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: {
      keys: jest
        .fn()
        .mockResolvedValue([
          "mazemaze-piggy-bank-static-v1",
          "mazemaze-piggy-bank-static-v2",
          "another-app-cache",
        ]),
      delete: jest.fn().mockResolvedValue(true),
    },
  });
});

it("registers the worker in production", async () => {
  const register = jest.fn().mockResolvedValue(undefined);
  setServiceWorker({ register });
  await configureAppServiceWorker(true);
  expect(register).toHaveBeenCalledWith("/sw.js");
  expect(window.caches.delete).not.toHaveBeenCalled();
});

it("removes only this app's development worker and caches", async () => {
  const unregisterApp = jest.fn().mockResolvedValue(true);
  const unregisterOther = jest.fn().mockResolvedValue(true);
  setServiceWorker({
    controller: null,
    getRegistrations: jest.fn().mockResolvedValue([
      {
        active: worker(`${location.origin}/sw.js`),
        waiting: null,
        installing: null,
        unregister: unregisterApp,
      },
      {
        active: worker(`${location.origin}/other-sw.js`),
        waiting: null,
        installing: null,
        unregister: unregisterOther,
      },
    ]),
  });
  await configureAppServiceWorker(false);
  expect(unregisterApp).toHaveBeenCalledTimes(1);
  expect(unregisterOther).not.toHaveBeenCalled();
  expect(window.caches.delete).toHaveBeenCalledTimes(2);
  expect(window.caches.delete).not.toHaveBeenCalledWith("another-app-cache");
});

it("does not fail cleanup when session storage is unavailable", async () => {
  setServiceWorker({
    controller: worker(`${location.origin}/sw.js`),
    getRegistrations: jest.fn().mockResolvedValue([]),
  });
  const blocked = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await expect(configureAppServiceWorker(false)).resolves.toBeUndefined();
  blocked.mockRestore();
});
