import { vi } from "vitest";

// Mock requestUrl globally for all tests
vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("./__mocks__/obsidian")>("./__mocks__/obsidian");
  return actual;
});
