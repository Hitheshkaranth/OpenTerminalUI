import { describe, expect, it } from "vitest";
import { normalizeNewsSentiment } from "../utils/newsSentiment";
describe("news sentiment response shapes", () => {
  it("reads the nested API payload without object stringification or zero confidence", () => {
    expect(normalizeNewsSentiment({ sentiment: { label: "Bullish", score: 0.7, confidence: 0.85 } })).toEqual({ label: "Bullish", score: 0.7, confidence: 0.85 });
  });
  it("supports flat payloads and leaves absent confidence undefined", () => {
    expect(normalizeNewsSentiment({ sentiment_label: "Neutral", sentiment_score: 0 })).toEqual({ label: "Neutral", score: 0, confidence: undefined });
    expect(normalizeNewsSentiment({ sentiment: {} })).toBeNull();
  });
});
