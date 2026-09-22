import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OneDriveJoin } from "./OneDriveJoin";
import type { StorageService } from "@/lib/storage/storageService";

const root = {
  providerId: "onedrive" as const,
  sharedId: "owner_root",
  driveId: "owner",
  itemId: "root",
  name: "Family",
  isFolder: true,
};

it("joins via keyboard submission and selects the validated workspace", async () => {
  const join = jest.fn().mockResolvedValue(root);
  const selected = jest.fn();
  render(
    <OneDriveJoin
      storage={{ joinSharedRootByLink: join } as unknown as StorageService}
      disabled={false}
      onJoined={selected}
    />,
  );
  fireEvent.change(screen.getByLabelText("OneDrive workspace link"), {
    target: { value: "https://1drv.ms/f/test" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Join workspace" }).closest("form")!);
  await waitFor(() => expect(selected).toHaveBeenCalledWith(root));
  expect(join).toHaveBeenCalledWith("https://1drv.ms/f/test");
  expect(screen.getByRole("status")).toHaveTextContent("joined and selected");
  expect(screen.getByLabelText("OneDrive workspace link")).toHaveValue("");
});

it("does not select on errors or expose the raw provider error / sharing link", async () => {
  const selected = jest.fn();
  const join = jest.fn().mockRejectedValue(new Error("raw authKey=secret"));
  render(
    <OneDriveJoin
      storage={{ joinSharedRootByLink: join } as unknown as StorageService}
      disabled={false}
      onJoined={selected}
    />,
  );
  fireEvent.change(screen.getByLabelText("OneDrive workspace link"), {
    target: { value: "https://1drv.ms/a" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Join workspace" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not join"));
  expect(screen.getByRole("status")).not.toHaveTextContent("secret");
  expect(selected).not.toHaveBeenCalled();
});

it("ignores a late response after account-specific UI unmounts", async () => {
  let finish!: (value: typeof root) => void;
  const selected = jest.fn();
  const join = jest.fn(
    () =>
      new Promise<typeof root>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <OneDriveJoin
      storage={{ joinSharedRootByLink: join } as unknown as StorageService}
      disabled={false}
      onJoined={selected}
    />,
  );
  fireEvent.change(screen.getByLabelText("OneDrive workspace link"), {
    target: { value: "https://1drv.ms/a" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Join workspace" }).closest("form")!);
  view.unmount();
  finish(root);
  await Promise.resolve();
  expect(selected).not.toHaveBeenCalled();
});
