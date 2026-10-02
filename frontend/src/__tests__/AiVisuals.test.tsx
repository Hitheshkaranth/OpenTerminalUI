import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentAvatar, AiThinking, AiWorkingBeam } from "../components/ai/AiVisuals";
import { AiInsightCard } from "../components/terminal/AiInsightCard";

describe("AiVisuals (Libraries.dev wrappers)", () => {
  it("maps activities to orb states and announces the label", () => {
    render(<AiThinking activity="reading" label="Searching the filings…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Searching the filings…");
    expect(screen.getByRole("img", { name: "Searching the filings…" })).toHaveAttribute("data-orb", "searching");
  });

  it("beam is on only while active, and the agent avatar reflects busy", () => {
    const { container, rerender } = render(
      <AiWorkingBeam active>
        <input aria-label="prompt" />
      </AiWorkingBeam>,
    );
    expect(container.querySelector("[data-beam]")).toHaveAttribute("data-beam", "on");
    rerender(
      <AiWorkingBeam active={false}>
        <input aria-label="prompt" />
      </AiWorkingBeam>,
    );
    expect(container.querySelector("[data-beam]")).toHaveAttribute("data-beam", "off");
    render(<AgentAvatar busy />);
    expect(screen.getByRole("img", { name: "Agent, working" })).toHaveAttribute("data-bot", "working");
  });

  it("insight card shows the orb while generating and names the real model", async () => {
    let resolve!: (v: unknown) => void;
    const fetcher = () => new Promise((r) => { resolve = r; }) as never;
    render(<AiInsightCard title="AI Investment Briefing" fetcher={fetcher} />);
    screen.getByRole("button", { name: "Generate" }).click();
    expect(await screen.findByRole("img", { name: "Generating analysis…" })).toBeInTheDocument();
    resolve({ engine: "lmstudio", model: "ornith-1.5-35b-a3b", summary: "s", sections: [], generated_at: "" });
    expect(await screen.findByText("ornith-1.5-35b-a3b")).toBeInTheDocument();
    expect(screen.queryByText(/Gemma/)).not.toBeInTheDocument();
  });
});
