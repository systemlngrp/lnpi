type DataSummaryTilesProps = {
  totalRecords: number;
  filteredRecords: number;
  showingRecords: number;
  pageLabel?: string;
  hideTotalRecords?: boolean;
  filteredRecordsLabel?: string;
};

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

export function DataSummaryTiles({
  totalRecords,
  filteredRecords,
  showingRecords,
  pageLabel = "-",
  hideTotalRecords = false,
  filteredRecordsLabel = "Filtered Records",
}: DataSummaryTilesProps) {
  const tiles = [
    ...(!hideTotalRecords ? [{ label: "Total Records", value: formatCount(totalRecords) }] : []),
    { label: filteredRecordsLabel, value: formatCount(filteredRecords) },
    { label: "Showing", value: formatCount(showingRecords) },
    { label: "Page", value: pageLabel },
  ];

  return (
    <div className={`grid grid-cols-2 gap-3 ${hideTotalRecords ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded border border-black bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{tile.label}</div>
          <div className="mt-1 text-lg font-black text-black">{tile.value}</div>
        </div>
      ))}
    </div>
  );
}
