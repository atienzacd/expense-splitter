import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockSystemTheme } from "../test/render.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

const html = document.documentElement;
const pressed = () => screen.getAllByRole("button").find((button) => button.getAttribute("aria-pressed") === "true");

describe("theme toggle", () => {
  it("follows the system by default", () => {
    mockSystemTheme("dark");
    render(<ThemeToggle />);

    expect(pressed()).toHaveAccessibleName("System");
    expect(html).toHaveClass("dark");
    expect(html.style.colorScheme).toBe("dark");
  });

  it("switches to dark and light, and remembers the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(html).not.toHaveClass("dark");

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(html).toHaveClass("dark");
    expect(pressed()).toHaveAccessibleName("Dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(html).not.toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("restores a saved choice on the next visit", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);

    expect(pressed()).toHaveAccessibleName("Dark");
    expect(html).toHaveClass("dark");
  });

  it("going back to System forgets the choice and follows the device again", async () => {
    const user = userEvent.setup();
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "System" }));

    expect(localStorage.getItem("theme")).toBeNull();
    expect(html).not.toHaveClass("dark");
  });

  it("in System mode, reacts when the device switches", () => {
    const setDevice = mockSystemTheme("light");
    render(<ThemeToggle />);
    expect(html).not.toHaveClass("dark");

    act(() => setDevice("dark"));
    expect(html).toHaveClass("dark");
  });

  it("ignores the device once a theme is chosen", async () => {
    const user = userEvent.setup();
    const setDevice = mockSystemTheme("light");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Light" }));
    act(() => setDevice("dark"));

    expect(html).not.toHaveClass("dark");
  });
});
