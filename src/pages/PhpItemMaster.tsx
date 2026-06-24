import { SheetMasterPage } from "./SheetMasterPage";
import { PHP_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";
import { useData } from "../hooks/useData";
import { buildPhpPlateInventoryRows } from "../lib/phpPlateInventory";
import type { LoadingSlip, Production } from "../types";

export function PhpItemMaster() {
  const [rows] = useData<any>("php_item_master", []);
  const [jobs] = useData<Production>("php_job_master", []);
  const [loadingSlips] = useData<LoadingSlip>("php_loading_slips", []);

  return (
    <SheetMasterPage
      title="PHP Item Master"
      entity="php_item_master"
      columns={PHP_ITEM_MASTER_COLUMNS}
      rowsOverride={buildPhpPlateInventoryRows(rows, jobs, loadingSlips)}
      filters={[
        { key: "company", label: "Company" },
        { key: "category", label: "Category" },
        { key: "hostingerSync", label: "Hostinger Sync" },
      ]}
      searchPlaceholder="Search PHP item master..."
    />
  );
}
