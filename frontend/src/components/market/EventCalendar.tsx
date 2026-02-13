import React from "react";

import { useEvents } from "../../hooks/useStocks";
import type { MarketEvent } from "../../types";

export const EventCalendar: React.FC = () => {
    const { data, isLoading } = useEvents();

    if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;

    return (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Upcoming Events</h3>
            <div className="space-y-4">
                {data && data.map((evt: MarketEvent, idx: number) => (
                    <div key={idx} className="flex items-start space-x-3 border-l-2 border-terminal-accent pl-3">
                        <div className="flex-shrink-0 w-12 text-center">
                            <div className="text-xs uppercase text-terminal-muted">{new Date(evt.date).toLocaleString("default", { month: "short" })}</div>
                            <div className="text-xl font-bold text-terminal-text">{new Date(evt.date).getDate()}</div>
                        </div>
                        <div>
                            <div className="font-medium text-terminal-text">{evt.ticker}</div>
                            <div className="text-sm text-terminal-muted">{evt.event}</div>
                        </div>
                    </div>
                ))}
                {!data?.length && <div className="text-sm text-terminal-muted">No upcoming events found.</div>}
            </div>
        </div>
    );
};
