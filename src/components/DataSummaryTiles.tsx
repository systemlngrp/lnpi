type DataSummaryTilesProps = {
  totalRecords: number;
  filteredRecords: number;
  showingRecords: number;
  pageLabel?: string;
};

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

export function DataSummaryTiles({ totalRecords, filteredRecords, showingRecords, pageLabel = "-" }: DataSummaryTilesProps) {
  const tiles = [
    { label: "Total Records", value: formatCount(totalRecords) },
    { label: "Filtered Records", value: formatCount(filteredRecords) },
    { label: "Showing", value: formatCount(showingRecords) },
    { label: "Page", value: pageLabel },
  ];

  return (
    <div className="rounded border border-black bg-white p-3 shadow-sm">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">Data Summary</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded border border-black bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{tile.label}</div>
            <div className="mt-1 text-lg font-black text-black">{tile.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
