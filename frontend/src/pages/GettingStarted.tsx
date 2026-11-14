import { useContext, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, Compass, RefreshCw } from "lucide-react";

import { AuthContextRef } from "../contexts/AuthContext";
import { fetchProvidersStatus } from "../api/providers";
import { createWatchlist, fetchWatchlists } from "../api/watchlist";
import { useSettingsStore } from "../store/settingsStore";
import { ONBOARDING_GOALS, providerReadiness, providersForMarket, readOnboardingPreferences, saveOnboardingPreferences, validateWatchlistName } from "../data/onboarding";
import "./GettingStarted.css";

const providerLabels = { ok: "Healthy", degraded: "Needs attention", down: "Unavailable", unconfigured: "Not configured" };

export function GettingStartedPage() {
  const auth = useContext(AuthContextRef);
  return <GettingStartedContent key={auth?.user?.id || "session"} accountId={auth?.user?.id} />;
}

function GettingStartedContent({ accountId }: { accountId?: string }) {
  const market = useSettingsStore((state) => state.selectedMarket);
  const [preferences, setPreferences] = useState(() => readOnboardingPreferences(accountId));
  const [storageError, setStorageError] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState("");
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["providers", "status"], queryFn: fetchProvidersStatus, retry: 1, staleTime: 30_000 });
  const watchlists = useQuery({ queryKey: ["watchlists", accountId || "session"], queryFn: fetchWatchlists, retry: 1, staleTime: 30_000 });
  const create = useMutation({
    mutationFn: createWatchlist,
    onSuccess: async (watchlist) => {
      setCreatedName(watchlist.name);
      setName("");
      queryClient.setQueryData(["watchlists", accountId || "session"], (current: Awaited<ReturnType<typeof fetchWatchlists>> | undefined) => [...(current || []).filter((item) => item.id !== watchlist.id), watchlist]);
      await queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });
  useEffect(() => { setStorageError(!saveOnboardingPreferences(accountId, preferences)); }, [accountId, preferences]);

  const relevant = providersForMarket(providers.data?.providers || [], market);
  const readiness = providerReadiness(relevant);
  const goal = ONBOARDING_GOALS.find((item) => item.id === preferences.goal)!;
  const watchlistCount = watchlists.data?.length || 0;
  const providerFailed = providers.isError || Boolean(providers.data?.error);
  const hasHealthyProvider = !providerFailed && !providers.isPending && readiness === "healthy";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = validateWatchlistName(name);
    setNameError(error);
    if (error || create.isPending) return;
    setCreatedName("");
    create.mutate(name.trim());
  };

  return (
    <main className="getting-started">
      <header className="getting-started-header">
        <div><p className="getting-started-eyebrow"><Compass size={15} aria-hidden="true" /> Your terminal, ready for a first session</p><h1>Start with a clear next step.</h1><p>Check your data access, organize a watchlist and choose the work you want to do.</p></div>
        <Link className="gs-button" to="/equity/workflows">Explore workflows <ArrowRight size={15} aria-hidden="true" /></Link>
      </header>

      <section aria-labelledby="gs-goal-title" className="gs-goals">
        <div className="gs-section-heading"><div><h2 id="gs-goal-title">What brings you here?</h2><p>Your choice changes the next action. You can switch at any time.</p></div><span>Saved in this browser{accountId ? " for your account" : " for this visit"}</span></div>
        <div role="group" aria-label="Choose your goal" className="gs-goal-options">{ONBOARDING_GOALS.map((item) => <button key={item.id} type="button" aria-pressed={preferences.goal === item.id} onClick={() => setPreferences((current) => ({ ...current, goal: item.id }))}>{item.label}</button>)}</div>
        <div className="gs-next-action"><div><span>Recommended next action</span><h3>{goal.label}</h3><p>{goal.description}</p></div><Link className="gs-primary" to={goal.path}>{goal.action}<ArrowRight size={15} aria-hidden="true" /></Link></div>
      </section>

      <div className="gs-columns">
        <section className="gs-readiness" aria-labelledby="gs-readiness-title">
          <div className="gs-section-heading"><div><h2 id="gs-readiness-title">Your setup checklist</h2><p>Data and watchlist status come from your terminal. Research steps are yours to confirm.</p></div></div>
          <ol className="gs-checklist">
            <li><span className={`gs-step-icon ${hasHealthyProvider ? "is-complete" : ""}`}>{hasHealthyProvider ? <Check size={17} aria-label="Data access healthy" /> : <Circle size={17} aria-hidden="true" />}</span><div><h3>Check data access for {market}</h3><p>{providers.isPending ? "Checking provider availability…" : providerFailed ? "Provider status could not be confirmed. Retry the check below." : hasHealthyProvider ? "At least one relevant provider reports healthy. Coverage and quote freshness vary by instrument." : readiness === "attention" ? "Configured sources need attention. Configuration alone does not confirm working data access." : "No relevant provider currently reports healthy. Review availability below before relying on market data."}</p><Link to="/equity/data-quality">Inspect data quality <ArrowRight size={13} aria-hidden="true" /></Link></div></li>
            <li><span className={`gs-step-icon ${watchlistCount ? "is-complete" : ""}`}>{watchlistCount ? <Check size={17} aria-label="Watchlists available" /> : <Circle size={17} aria-hidden="true" />}</span><div><h3>Organize a watchlist</h3>{watchlists.isPending ? <p role="status">Loading your watchlists…</p> : watchlists.isError ? <div><p>We could not load your watchlists.</p><button type="button" className="gs-text-button" onClick={() => void watchlists.refetch()}>Retry watchlists</button></div> : watchlistCount ? <p>{watchlistCount} watchlist{watchlistCount === 1 ? " is" : "s are"} available, including any default lists. Add symbols or create your own shortlist.</p> : <p>Keep a shortlist of companies or instruments you want to revisit.</p>}
              {!watchlists.isPending && !watchlists.isError && <form className="gs-watchlist-form" onSubmit={submit}><label htmlFor="gs-watchlist-name">Watchlist name</label><div><input id="gs-watchlist-name" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setNameError(null); create.reset(); }} placeholder="e.g. Companies to research" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "gs-watchlist-error" : undefined} disabled={create.isPending} /><button className="gs-button" type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create watchlist"}</button></div>{nameError && <p id="gs-watchlist-error" role="alert" className="gs-error">{nameError}</p>}{create.isError && <p role="alert" className="gs-error">The watchlist could not be created. Your name is retained; please try again.</p>}</form>}
              {watchlistCount > 0 && <Link to="/equity/watchlist">Open watchlists <ArrowRight size={13} aria-hidden="true" /></Link>}
            </div></li>
            <li><span className={`gs-step-icon ${preferences.inspectedSecurity ? "is-complete" : ""}`}>{preferences.inspectedSecurity ? <Check size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}</span><div><h3>Inspect a company</h3><p>Open a security, check its financials and read the provenance of a quote.</p><Link to="/equity/security">Open Security Hub <ArrowRight size={13} aria-hidden="true" /></Link><label className="gs-confirmation"><input type="checkbox" checked={preferences.inspectedSecurity} onChange={(event) => setPreferences((current) => ({ ...current, inspectedSecurity: event.target.checked }))} />I reviewed a security <span>(manual confirmation)</span></label></div></li>
            <li><span className={`gs-step-icon ${preferences.savedResearch ? "is-complete" : ""}`}>{preferences.savedResearch ? <Check size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}</span><div><h3>Save a research question</h3><p>Use a dossier to record your thesis and what evidence could change your view.</p><Link to="/equity/research-dossiers">Open research dossiers <ArrowRight size={13} aria-hidden="true" /></Link><label className="gs-confirmation"><input type="checkbox" checked={preferences.savedResearch} onChange={(event) => setPreferences((current) => ({ ...current, savedResearch: event.target.checked }))} />I saved a research note <span>(manual confirmation)</span></label></div></li>
          </ol>
          {createdName && <p className="gs-success" role="status">Created “{createdName}”. Open watchlists to add your symbols.</p>}
        </section>

        <section className="gs-provider-section" aria-labelledby="gs-provider-title">
          <div className="gs-section-heading"><div><h2 id="gs-provider-title">Data access · {market}</h2><p>Relevant market and global providers.</p></div><button className="gs-icon-button" type="button" aria-label="Refresh provider status" disabled={providers.isFetching} onClick={() => void providers.refetch()}><RefreshCw size={15} aria-hidden="true" /></button></div>
          <p className="gs-free-path">Start with public sources. API keys are optional; public data may be delayed or temporarily unavailable.</p>
          {providers.isPending ? <p role="status" className="gs-provider-message">Checking providers…</p> : providerFailed ? <div className="gs-provider-message" role="alert"><p>Provider status is unavailable. This check does not confirm a working connection.</p><button type="button" className="gs-button" onClick={() => void providers.refetch()}>Retry provider check</button></div> : relevant.length ? <ul className="gs-providers">{relevant.map((provider) => <li key={provider.id}><div><strong>{provider.name}</strong><span className={`gs-provider-state state-${provider.status}`}>{providerLabels[provider.status]}</span></div><p>{provider.unlocks.join(" · ") || "See provider settings for supported data."}</p><span className="gs-provider-kind">{provider.env_keys.length === 0 ? "Public source · no API key required" : provider.configured ? "Credentials configured · health shown above" : "Optional integration · credentials not configured"}</span></li>)}</ul> : <p className="gs-provider-message">No provider coverage is reported for {market}. Review settings to inspect available sources.</p>}
          <div className="gs-provider-footer"><Link to="/equity/settings">Review provider settings <ArrowRight size={13} aria-hidden="true" /></Link><p>Provider administration may require an administrator. A healthy provider does not guarantee coverage for every symbol.</p>{providers.data?.checked_at && !providerFailed && <p>Checked {new Date(providers.data.checked_at).toLocaleString()}</p>}</div>
        </section>
      </div>
      {storageError && <p role="status" className="gs-error">Browser storage is unavailable. Your goal and manual confirmations will last for this visit.</p>}
    </main>
  );
}
