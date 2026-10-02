from __future__ import annotations

from typing import Any

# OWNER: agent B. The driver taxonomy (docs/FILINGS_INTELLIGENCE.md): 10 growth
# and 11 headwind drivers. Each entry is a dict with id, label, kind, description,
# queries (3-5 retrieval queries), keywords (regexes forwarded to retrieve.search)
# and an optional doc_types filter.

# Each tuple: (id, label, kind, description, [queries], [keywords], [doc_types|None])
_DRIVERS_DEF: list[tuple] = [
    # ------------------------------------------------------------------ growth
    ("order_book_backlog", "Order book & backlog", "growth",
     "Growth committed in a rising book of work (orders, backlog, RPO) that future revenue can be traced to.",
     ["What is the current order book or backlog and how has it grown",
      "New order wins, letters of award and bagged orders",
      "Remaining performance obligation and booked versus recognised revenue",
      "Order inflow, pipeline and capacity utilisation"],
     [r"order book|backlog|order inflow|order wins|letter of award|LoA|L1|bagged|RPO|"
      r"remaining performance obligation|booked revenue|order pipeline"],
     None),
    ("new_client_wins", "New client / customer wins", "growth",
     "Land-and-expand signals: newly won customers, contracts or accounts.",
     ["New customer or client wins and contracts this year",
      "Multi-year or supply agreements and strategic account onboarding",
      "Logo wins and migration of new customers onto the platform"],
     [r"new customer|new client|won the contract|contract win|supply agreement|"
      r"multi-year agreement|strategic account|customer onboarding"],
     None),
    ("capacity_capex", "Capacity expansion & capex", "growth",
     "Growth-capital commitments: greenfield/brownfield plants, expansions and incremental capacity.",
     ["Planned and committed capital expenditure and capacity additions",
      "New manufacturing sites, plants and commissioning timelines",
      "Order against fixed assets and pre-commentary capital commitments"],
     [r"capex|capital expenditure|capacity|greenfield|brownfield|commissioning|"
      r"expansion|plant|order against fixed assets|capital commitment"],
     ["annual_report", "investor_presentation", "press_release"]),
    ("new_products", "New products & launches", "growth",
     "Revenue from newly launched or in-pipeline products, therapies and technology.",
     ["New product launches and their revenue contribution",
      "Product pipeline, clinical-stage assets and launch calendars",
      "Contribution of recently launched products to revenue"],
     [r"new product|product launch|launched|product line|pipeline|therapy|in-pipeline"],
     None),
    ("regulatory_approvals", "Regulatory approvals (growth)", "growth",
     "Growth-driving regulatory clearances: USFDA approvals/ANDAs, NDA, EIR, CE mark, DCGI.",
     ["USFDA approval, ANDA interplay, NDA or resolved complete response letters",
      "European CE mark, SEBI EIR or DCGI / CDSCO clearances obtained",
      "Regulatory approvals that open a new market or indication"],
     [r"USFDA|ANDA|NDA|EIR|CE mark|DCGI|CDSCO|approval|complete response|interplay"],
     ["regulatory", "press_release", "annual_report"]),
    ("market_expansion", "Market & geographic expansion", "growth",
     "Entry into new geographies, segments or distribution channels.",
     ["International/overseas revenue and new geographic markets entered",
      "New distribution channels, segments and export growth",
      "Market-share gains in core versus adjacent markets"],
     [r"geographic|international|overseas|export|segment|channel|market share|"
      r"new market|adjacent"],
     None),
    ("pricing_margin", "Pricing power & margin expansion", "growth",
     "Ability to raise prices or shift mix that expands gross/operating margin.",
     ["Pricing trends, realized prices and mix-driven margin expansion",
      "Gross and operating margin trajectory and its drivers",
      "Input-price pass-through and realization versus inflation"],
     [r"pricing|realization|realisation|margin expansion|mix shift|gross margin|"
      r"pass-through|realization|pricing power"],
     None),
    ("guidance_raise", "Guidance raise", "growth",
     "Management guiding revenue/profit above prior year or prior guidance.",
     ["Management guidance for the coming year versus prior guidance",
      "Volume/revenue growth commentary and upward revisions",
      "Board recommendations and forward-looking profit statements"],
     [r"guidance|outlook|board recommendation|forward looking|upward revision|"
      r"record revenue|record top line|record profit"],
     None),
    ("strategic_deals", "Strategic deals (M&A / partnerships / licensing)", "growth",
     "Growth via acquisition, joint ventures, partnerships and licensing deals.",
     ["Acquisitions, joint ventures and partnerships announced",
      "Rationale and expected synergy/revenue contribution of deals",
      "Strategic investments and stake acquisitions"],
     [r"acquisition|joint venture|partnership|licensing|synergy|stake acquisition|merger"],
     ["press_release", "annual_report"]),
    ("operating_leverage", "Operating leverage & efficiency", "growth",
     "Cost discipline and operating leverage that grows profit faster than revenue.",
     ["Operating expense ratio improvement and cost-to-income trends",
      "Operating leverage, productivity gains and margin improvement",
      "One-time cost items and efficiency-driven savings"],
     [r"operating leverage|cost efficiency|cost to income|operating expense|productivity|"
      r"margin improvement|cost savings|operating margin"],
     None),

    # --------------------------------------------------------------- headwind
    ("client_concentration", "Client / revenue concentration", "headwind",
     "Reliance on a few customers, geographies or products that could evaporate.",
     ["Revenue concentration among the top customers and any single-customer dependence",
      "Top-five client share and contract renewal exposure",
      "Customer diversity and any loss of a major account"],
     [r"top customer|top client|single customer|concentration|top five|client share|"
      r"customer mix|largest customer"],
     None),
    ("order_slowdown", "Order slowdown or cancellations", "headwind",
     "Decelerating order inflow, cancellations or an empty back-order coverage.",
     ["Order cancellations and cancelled purchase orders",
      "Order-book growth deceleration and backlog coverage ratio",
      "Quarterly order inflow versus revenue and deferred revenue"],
     [r"order cancellation|cancelled order|cancelled purchase order|order book deceleration|"
      r"deceleration|backlog coverage|order inflow|revenue backlog|deferred revenue"],
     None),
    ("adverse_regulatory", "Adverse regulatory action", "headwind",
     "Regulatory friction: warning letters, Form 483, import alerts, OAI, observations.",
     ["USFDA warning letter, Form 483 observations, import alert or objection letter",
      "Office of inspection findings and corrective action plans",
      "Regulatory observations, audit findings and deadlines"],
     [r"warning letter|Form 483|import alert|OAI|observations|Objection Letter|"
      r"office of inspection|regulatory action|audit finding|compliance"],
     ["regulatory", "press_release", "annual_report"]),
    ("margin_pressure", "Margin pressure (input costs, wages, pricing)", "headwind",
     "Squeezed margins from rising input costs, wages, freight or price cuts.",
     ["Raw-material, freight and input-cost inflation versus realization",
      "Wage inflation and its impact on margins",
      "Gross margin decline and its drivers"],
     [r"margin decline|margin compression|input cost|raw material|wage inflation|freight|"
      r"realization lag|pricing pressure|price cut|margin squeeze|declining margin"],
     None),
    ("working_capital", "Working-capital stress", "headwind",
     "Tightening working capital: rising receivable/inventory days or cash-cycle strain.",
     ["Receivable days, inventory days and working-capital trajectory",
      "Inventory obsolescence, slow-moving stock and debtor overdues",
      "Operating cash flow versus profit and working-capital intensification"],
     [r"receivable|inventory days|working capital|debtor|creditor|slow moving|"
      r"obsolescence|cash flow|receivables|turnover|cash conversion"],
     None),
    ("leverage", "Leverage & refinancing", "headwind",
     "Debt load, interest burden, refinancing and covenant exposure.",
     ["Net debt, interest coverage and debt-to-equity trajectory",
      "Refinancing maturity wall, covenant and creditor commentary",
      "Interest cost, finance cost and derivative exposure"],
     [r"net debt|interest coverage|debt to equity|debt-to-equity|refinancing|covenant|"
      r"finance cost|interest burden|leverage|debt profile|debt maturity"],
     None),
    ("governance", "Governance red flags", "headwind",
     "Related-party deals, pledges, auditor remarks and KMP exits.",
     ["Related-party transactions and conflicts of interest",
      "Promoter share pledges and KMP changes/exits",
      "Auditor qualifications, going-concern and rotation remarks"],
     [r"related party|pledge|promoter pledge|KMP|key managerial personnel|auditor|"
      r"going concern|rotation|independent director exit|governance"],
     ["annual_report", "regulatory"]),
    ("litigation", "Litigation & contingent liabilities", "headwind",
     "Pending litigation, claims and contingencies that could require provisioning.",
     ["Material litigations and contingent liabilities disclosed",
      "Provisions for litigation and claim outcomes",
      "Tax/regulatory disputes and their financial exposure"],
     [r"litigation|pending case|contingent liability|provision|claim|arbitration|"
      r"penalty|dispute|regulatory dispute"],
     None),
    ("guidance_cut", "Guidance cut / demand weakness", "headwind",
     "Management lowering guidance or commenting on softening demand.",
     ["Management lowering guidance or cutting the full-year outlook",
      "Demand weakness, soft volumes and order-cancellation commentary",
      "Declining segments or geographies"],
     [r"lowering guidance|cut outlook|weak demand|softening|declining demand|"
      r"lowered guidance|downside demand|demand weakness|declining volumes|weakening demand"],
     None),
    ("competition", "Competition & price erosion", "headwind",
     "Increasing competition, loss of market share or price erosion.",
     ["Competitive intensity, new entrants and market-share trends",
      "Price erosion, discounting and loss of pricing power",
      "Competitor responses to launches and capacity additions"],
     [r"competition|competitor|market share|price erosion|discounting|entrant|"
      r"pricing pressure|competitive|competitive intensity|new entrants"],
     None),
    ("geopolitical_fx", "FX / geopolitical / supply-chain exposure", "headwind",
     "Currency, geopolitical and supply-chain risks to the business.",
     ["Foreign-exchange exposure and hedging on net debt or receivables",
      "Geopolitical exposure, tariffs and cross-border revenue risk",
      "Supply-chain concentration, single-source inputs and disruption risk"],
     [r"foreign exchange|FX exposure|geopolitical|tariff|supply chain|single source|"
      r"currency|exchange rate|geopolitical risk|disruption|hedging"],
     None),
]


def _driver_from(defn: tuple) -> dict:
    did, label, kind, description, queries, keywords, doc_types = defn
    entry: dict[str, Any] = {
        "id": did,
        "label": label,
        "kind": kind,
        "description": description,
        "queries": queries,
        "keywords": keywords,
    }
    if doc_types:
        entry["doc_types"] = doc_types
    return entry


#: Full driver taxonomy (10 growth, 11 headwind).
DRIVERS: list[dict] = [_driver_from(defn) for defn in _DRIVERS_DEF]


def drivers_for(kind: str) -> list[dict]:
    """All drivers of one kind, preserving the taxonomy's ordering."""
    return [d for d in DRIVERS if d["kind"] == kind]