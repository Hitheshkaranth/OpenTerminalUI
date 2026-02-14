export type ReportLinkType = "PDF" | "HTML" | "SOURCE";

export type QuarterlyReportLink = {
  type: ReportLinkType;
  url: string;
};

export type QuarterlyReport = {
  id: string;
  quarterLabel: string;
  periodEndDate: string;
  filingDate: string;
  reportType: "10-Q" | "10-K" | "Quarterly Results" | "Annual Report";
  links: QuarterlyReportLink[];
};
