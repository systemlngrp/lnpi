import { SheetMasterPage } from "./SheetMasterPage";
import { PLATE_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";
import { useData } from "../hooks/useData";
import { buildPhpPlateInventoryRows } from "../lib/phpPlateInventory";
import type { LoadingSlip, Production } from "../types";

export function PlateItemMaster() {
  const [rows] = useData<any>("plate_item_master", []);
  const [jobs] = useData<Production>("plate_job_master", []);
  const [standaloneLoadingSlips] = useData<LoadingSlip>("plate_loading_slips", []);
  const [commonLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  return (
    <SheetMasterPage
      title="Plate Item Master"
      entity="plate_item_master"
      columns={PLATE_ITEM_MASTER_COLUMNS}
      editableColumns={["openingQty"]}
      rowsOverride={buildPhpPlateInventoryRows(rows, jobs, [...standaloneLoadingSlips, ...commonLoadingSlips], "PLATE")}
      filters={[
        { key: "company", label: "Company" },
        { key: "typeOfPlate", label: "Type of Plate" },
        { key: "hostingerSync", label: "Hostinger Sync" },
      ]}
      searchPlaceholder="Search plate item master..."
    />
  );
}
