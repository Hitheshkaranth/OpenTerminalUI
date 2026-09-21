import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderKeyForm } from "../components/settings/ProviderKeyForm";
import * as providerKeysApi from "../api/providerKeys";

const mockRows: providerKeysApi.ProviderKeyRow[] = [
  { name: "FMP_API_KEY", provider: "fmp", set: false, masked: null, source: "unset" },
  { name: "OPENROUTER_API_KEY", provider: "openrouter", set: true, masked: "sk…b2", source: "env_file" },
];

const mockEnvKeys = ["FMP_API_KEY", "OPENROUTER_API_KEY"];

const mockOnSaved = vi.fn();

const defaultProps = {
  providerId: "fmp",
  envKeys: mockEnvKeys,
  rows: mockRows,
  onSaved: mockOnSaved,
};

describe("ProviderKeyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one input per env key with masked placeholder", () => {
    render(<ProviderKeyForm {...defaultProps} />);

    // Use getByLabelText to find inputs (password inputs are textboxes)
    const fmpInput = screen.getByLabelText("FMP_API_KEY") as HTMLInputElement;
    const orInput = screen.getByLabelText("OPENROUTER_API_KEY") as HTMLInputElement;
    expect(fmpInput).toHaveAttribute("type", "password");
    expect(fmpInput).toHaveAttribute("placeholder", "not set");
    expect(orInput).toHaveAttribute("type", "password");
    expect(orInput).toHaveAttribute("placeholder", "current: sk…b2");
  });

  it("Save is disabled until typing", () => {
    render(<ProviderKeyForm {...defaultProps} />);

    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();
  });

  it("typing a value then Save calls saveProviderKeys with only that key", async () => {
    vi.spyOn(providerKeysApi, "saveProviderKeys").mockResolvedValue({
      env_file: "/path/.env",
      keys: mockRows,
    });

    render(<ProviderKeyForm {...defaultProps} />);

    const fmpInput = screen.getByLabelText("FMP_API_KEY") as HTMLInputElement;
    fireEvent.change(fmpInput, { target: { value: "my-secret-key" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(providerKeysApi.saveProviderKeys).toHaveBeenCalledWith({
        FMP_API_KEY: "my-secret-key",
      });
    });
  });

  it("response with restart_required:[\"FMP_API_KEY\"] shows the restart line", async () => {
    vi.spyOn(providerKeysApi, "saveProviderKeys").mockResolvedValue({
      env_file: "/path/.env",
      keys: mockRows,
      restart_required: ["FMP_API_KEY"],
      applied_live: [],
    });

    render(<ProviderKeyForm {...defaultProps} />);

    const fmpInput = screen.getByLabelText("FMP_API_KEY") as HTMLInputElement;
    fireEvent.change(fmpInput, { target: { value: "my-secret-key" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Restart the backend to apply: FMP_API_KEY/)).toBeInTheDocument();
    });
  });

  it("422 error detail is rendered", async () => {
    vi.spyOn(providerKeysApi, "saveProviderKeys").mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: "invalid key: FMP_API_KEY",
        },
      },
    });

    render(<ProviderKeyForm {...defaultProps} />);

    const fmpInput = screen.getByLabelText("FMP_API_KEY") as HTMLInputElement;
    fireEvent.change(fmpInput, { target: { value: "bad" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText("invalid key: FMP_API_KEY")).toBeInTheDocument();
    });
  });

  it("Show toggle flips input type", () => {
    render(<ProviderKeyForm {...defaultProps} />);

    const orInput = screen.getByLabelText("OPENROUTER_API_KEY") as HTMLInputElement;
    expect(orInput).toHaveAttribute("type", "password");

    const rowEl = orInput.closest("div[class*='mb-2']") as HTMLElement;
    const showBtn = rowEl.querySelector("button");
    expect(showBtn).toHaveTextContent("Show");
    fireEvent.click(showBtn!);

    expect(orInput).toHaveAttribute("type", "text");

    expect(showBtn).toHaveTextContent("Hide");

    fireEvent.click(showBtn!);
    expect(orInput).toHaveAttribute("type", "password");
  });

  it("Clear link appears after typing and sets value to empty", async () => {
    render(<ProviderKeyForm {...defaultProps} />);

    const fmpInput = screen.getByLabelText("FMP_API_KEY") as HTMLInputElement;
    fireEvent.change(fmpInput, { target: { value: "test" } });

    const clearLink = screen.getByText("Clear");
    expect(clearLink).toBeInTheDocument();

    fireEvent.click(clearLink);
    expect(fmpInput).toHaveValue("");
  });

  it("onSaved is called after successful save", async () => {
    const mockResponse = {
      env_file: "/path/.env",
      keys: mockRows,
      applied_live: ["OPENROUTER_API_KEY"],
    };
    vi.spyOn(providerKeysApi, "saveProviderKeys").mockResolvedValue(mockResponse);

    render(<ProviderKeyForm {...defaultProps} />);

    const orInput = screen.getByLabelText("OPENROUTER_API_KEY") as HTMLInputElement;
    fireEvent.change(orInput, { target: { value: "new-key" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockOnSaved).toHaveBeenCalledWith(mockResponse);
    });
  });
});