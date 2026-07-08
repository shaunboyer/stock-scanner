import React from "react";

const ITEMS = [
  { key: "debt", label: "Debt load", flagField: "debt_flag", detailField: "debt_detail" },
  { key: "fcf", label: "Free cash flow", flagField: "fcf_flag", detailField: "fcf_detail" },
  { key: "revenueGrowth", label: "Revenue growth", flagField: "revenue_growth_flag", detailField: "revenue_growth_detail" },
  { key: "margin", label: "Gross margin", flagField: "margin_flag", detailField: "margin_detail" },
  { key: "goingConcern", label: "Liquidity", flagField: "going_concern_flag", detailField: "going_concern_detail" },
  { key: "insiderBuying", label: "Insider buying", flagField: "insider_buying_flag", detailField: "insider_buying_detail" },
];

export default function DetailPanel({ result }) {
  return (
    <div className="detail-panel">
      <div className="narrative">
        {result.news_headline && <span className="headline">{result.news_headline}</span>}
        {result.narrative || "No narrative generated for this name."}
      </div>
      <div className="checklist">
        {ITEMS.map((item) => (
          <div className={`checklist-item ${result[item.flagField]}`} key={item.key}>
            <span className="name">{item.label}</span>
            <span className="detail">{result[item.detailField]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
