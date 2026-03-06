import { CryptoOverview } from "../components/crypto/CryptoOverview";

export function CryptoPage() {
  return (
    <div className="p-3 space-y-3">
      <div>
        <div className="ot-type-heading-lg text-terminal-text">Crypto</div>
        <div className="text-xs text-terminal-muted">Overview board and core coin-detail workflow</div>
      </div>
      <CryptoOverview />
    </div>
  );
}
