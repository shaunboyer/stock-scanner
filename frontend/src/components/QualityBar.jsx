import React from "react";

const ORDER = ["debt", "fcf", "revenueGrowth", "margin", "goingConcern"];
const KEY_TO_FLAG = {
  debt: "debt_flag",
  fcf: "fcf_flag",
  revenueGrowth: "revenue_growth_flag",
  margin: "margin_flag",
  goingConcern: "going_concern_flag",
};

export default function QualityBar({ result }) {
  const score = result.quality_score;
  return (
    <div className="quality-bar">
      {ORDER.map((key) => {
        const flagValue = result[KEY_TO_FLAG[key]];
        return <span key={key} className={`quality-seg ${flagValue}`} title={key} />;
      })}
      <span className="quality-label">{score}/5</span>
    </div>
  );
}
