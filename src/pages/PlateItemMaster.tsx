import { SheetMasterPage } from "./SheetMasterPage";
import { PLATE_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";

export function PlateItemMaster() {
  return (
    <SheetMasterPage
      title="Plate Item Master"
      entity="plate_item_master"
      columns={PLATE_ITEM_MASTER_COLUMNS}
      filters={[
        { key: "company", label: "Company" },
        { key: "category", label: "Category" },
        { key: "typeOfPlate", label: "Type of Plate" },
        { key: "hostingerSync", label: "Hostinger Sync" },
      ]}
      searchPlaceholder="Search plate item master..."
    />
  );
}
