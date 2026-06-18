import { SheetMasterPage } from "./SheetMasterPage";
import { PLATE_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";

export function PlateItemMaster() {
  return (
    <SheetMasterPage
      title="Plate Item Master"
      entity="plate_item_master"
      columns={PLATE_ITEM_MASTER_COLUMNS}
      searchPlaceholder="Search plate item master..."
    />
  );
}
