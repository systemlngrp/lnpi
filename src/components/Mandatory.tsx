import React from "react";

function hasAsterisk(label: string) {
  return /\*/.test(label);
}

export function MandatoryLabel({
  label,
  required = false,
  className = "",
  htmlFor,
}: {
  label: string;
  required?: boolean;
  className?: string;
  htmlFor?: string;
}) {
  const safeLabel = String(label || "").trim();
  const showAsterisk = required && safeLabel && !hasAsterisk(safeLabel);

  return (
    <label htmlFor={htmlFor} className={className}>
      {showAsterisk ? <span className="text-red-500 mr-1">*</span> : null}
      {safeLabel}
    </label>
  );
}

export function MandatoryLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`text-xs text-slate-600 ${className}`}>
      <span className="text-red-500 mr-1">*</span>
      Mandatory
    </div>
  );
}

