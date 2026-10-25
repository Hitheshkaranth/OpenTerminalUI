import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TerminalModal } from "../components/terminal/TerminalModal";

it("preserves a field focused before the opening animation frame", () => {
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  try {
    const close = vi.fn();
    render(<TerminalModal open onClose={close} title="Save layout"><input aria-label="Name" /></TerminalModal>);
    const field = screen.getByRole("textbox", { name: "Name" });
    field.focus();
    act(() => frame?.(0));
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "My Layout" } });
    expect(field).toHaveValue("My Layout");
    expect(close).not.toHaveBeenCalled();
  } finally {
    raf.mockRestore();
    cancel.mockRestore();
  }
});
