import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { mockSystemTheme } from "./render.tsx";

beforeEach(() => {
  // jsdom has no matchMedia; default every test to a device in light mode.
  mockSystemTheme("light");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});
