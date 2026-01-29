import { GraphError, isPreconditionFailed } from "./graphErrors";

describe("graphErrors", () => {
  it("detects precondition failures", () => {
    const error = new GraphError("Precondition failed", {
      status: 412,
      code: "precondition_failed",
    });
    expect(isPreconditionFailed(error)).toBe(true);
  });
});
