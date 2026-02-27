import { describe, expect, it } from "vitest";
import { checkAppScopes } from "../../app/services/migration.server";

describe("checkAppScopes", () => {
  it("returns false when GraphQL call fails", async () => {
    const admin = {
      graphql: async () => {
        throw new Error("network failed");
      },
    } as any;

    await expect(checkAppScopes(admin)).resolves.toBe(false);
  });

  it("returns true only when required scopes are present", async () => {
    const admin = {
      graphql: async () => ({
        json: async () => ({
          data: {
            app: {
              installation: {
                accessScopes: [{ handle: "read_pixels" }, { handle: "write_pixels" }],
              },
            },
          },
        }),
      }),
    } as any;

    await expect(checkAppScopes(admin)).resolves.toBe(true);
  });
});
