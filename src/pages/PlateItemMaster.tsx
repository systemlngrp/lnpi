import { SheetMasterPage } from "./SheetMasterPage";
import { PLATE_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";
import { useData } from "../hooks/useData";
import { buildPhpPlateInventoryRows } from "../lib/phpPlateInventory";
import type { LoadingSlip, Production } from "../types";

const HIDDEN_PLATE_ITEM_MASTER_COLUMNS = new Set(["syncInItemMaster", "hostingerSync"]);

export function PlateItemMaster() {
  const [rows] = useData<any>("plate_item_master", []);
  const [jobs] = useData<Production>("plate_job_master", []);
  const [standaloneLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);
  const [commonLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  return (
    <SheetMasterPage
      title="Plate Item Master"
      entity="plate_item_master"
      columns={PLATE_ITEM_MASTER_COLUMNS.filter((column) => !HIDDEN_PLATE_ITEM_MASTER_COLUMNS.has(column.key))}
      editableColumns={["openingQty"]}
      rowsOverride={buildPhpPlateInventoryRows(rows, jobs, [...standaloneLoadingSlips, ...commonLoadingSlips], "PLATE")}
      filters={[
        { key: "company", label: "Company", searchable: true },
        { key: "itemName", label: "Item", searchable: true, optionLabelKeys: ["itemName", "erpItemCode"], optionSearchKeys: ["masterItemNameErpCode"] },
      ]}
      searchPlaceholder="Search plate item master..."
    />
  );
}
