import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SaveScreenDialog } from "../pages/equity/screener/SaveScreenDialog";
import { SavedScreens } from "../pages/equity/screener/SavedScreens";

const createSavedScreenV3Mock = vi.fn();
const publishScreenV3Mock = vi.fn();
const updateSavedScreenV3Mock = vi.fn();
const deleteSavedScreenV3Mock = vi.fn();
const useScreenerContextMock = vi.fn();

vi.mock("../api/client", () => ({
  createSavedScreenV3: (...args: unknown[]) => createSavedScreenV3Mock(...args),
  publishScreenV3: (...args: unknown[]) => publishScreenV3Mock(...args),
  updateSavedScreenV3: (...args: unknown[]) => updateSavedScreenV3Mock(...args),
  deleteSavedScreenV3: (...args: unknown[]) => deleteSavedScreenV3Mock(...args),
}));

vi.mock("../pages/equity/screener/ScreenerContext", () => ({
  useScreenerContext: () => useScreenerContextMock(),
}));

const baseScreen = {
  id: "screen-1",
  user_id: "user-1",
  name: "Compounders",
  description: "High-quality compounders",
  query: "ROE > 20",
  columns_config: [],
  viz_config: {},
  is_public: false,
  upvotes: 5,
};

describe("screener saved screen workflows", () => {
  beforeEach(() => {
    createSavedScreenV3Mock.mockReset();
    publishScreenV3Mock.mockReset();
    updateSavedScreenV3Mock.mockReset();
    deleteSavedScreenV3Mock.mockReset();
    useScreenerContextMock.mockReset();
  });

  it("creates and publishes a new screen from the active query", async () => {
    const refreshScreensMock = vi.fn().mockResolvedValue(undefined);
    const setActiveSavedScreenIdMock = vi.fn();

    createSavedScreenV3Mock.mockResolvedValue({
      ...baseScreen,
      id: "screen-2",
      name: "Breakout Focus",
      query: "Revenue Growth > 20",
    });
    publishScreenV3Mock.mockResolvedValue({ ...baseScreen, id: "screen-2", is_public: true });

    useScreenerContextMock.mockReturnValue({
      query: "Revenue Growth > 20",
      refreshScreens: refreshScreensMock,
      savedScreens: [baseScreen],
      activeSavedScreenId: null,
      setActiveSavedScreenId: setActiveSavedScreenIdMock,
    });

    render(<SaveScreenDialog />);

    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Breakout Focus" } });
    fireEvent.change(screen.getByPlaceholderText("Description"), { target: { value: "Momentum and revenue leaders" } });
    fireEvent.click(screen.getByLabelText("Publish after save"));
    fireEvent.click(screen.getByRole("button", { name: "Save New" }));

    await waitFor(() =>
      expect(createSavedScreenV3Mock).toHaveBeenCalledWith({
        name: "Breakout Focus",
        description: "Momentum and revenue leaders",
        query: "Revenue Growth > 20",
        columns_config: [],
        viz_config: {},
        is_public: false,
      }),
    );
    await waitFor(() => expect(publishScreenV3Mock).toHaveBeenCalledWith("screen-2"));
    expect(setActiveSavedScreenIdMock).toHaveBeenCalledWith("screen-2");
    expect(refreshScreensMock).toHaveBeenCalled();
  });

  it("loads, updates, and deletes an existing saved screen", async () => {
    const refreshScreensMock = vi.fn().mockResolvedValue(undefined);
    const setActiveSavedScreenIdMock = vi.fn();
    const setQueryMock = vi.fn();
    const loadSavedScreenMock = vi.fn();
    const runMock = vi.fn().mockResolvedValue(undefined);

    updateSavedScreenV3Mock.mockResolvedValue({
      ...baseScreen,
      query: "Debt to equity < 0.5",
    });
    deleteSavedScreenV3Mock.mockResolvedValue(undefined);

    useScreenerContextMock.mockReturnValue({
      query: "Debt to equity < 0.5",
      refreshScreens: refreshScreensMock,
      savedScreens: [baseScreen],
      activeSavedScreenId: "screen-1",
      setActiveSavedScreenId: setActiveSavedScreenIdMock,
      setQuery: setQueryMock,
      loadSavedScreen: loadSavedScreenMock,
      run: runMock,
    });

    render(
      <>
        <SavedScreens />
        <SaveScreenDialog />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compounders" }));
    await waitFor(() => expect(loadSavedScreenMock).toHaveBeenCalledWith(baseScreen));
    expect(runMock).toHaveBeenCalledWith({ query: "ROE > 20", preset_id: null });

    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(setActiveSavedScreenIdMock).toHaveBeenCalledWith("screen-1");
    expect(setQueryMock).toHaveBeenCalledWith("ROE > 20");

    fireEvent.click(screen.getByRole("button", { name: "Update Current" }));
    await waitFor(() =>
      expect(updateSavedScreenV3Mock).toHaveBeenCalledWith("screen-1", {
        name: "Compounders",
        description: "High-quality compounders",
        query: "Debt to equity < 0.5",
        columns_config: [],
        viz_config: {},
        is_public: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteSavedScreenV3Mock).toHaveBeenCalledWith("screen-1"));
    expect(refreshScreensMock).toHaveBeenCalled();
  });
});
