import { SheetMasterPage } from "./SheetMasterPage";
import { PHP_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";

export function PhpItemMaster() {
  return (
    <SheetMasterPage
      title="PHP Item Master"
      entity="php_item_master"
      columns={PHP_ITEM_MASTER_COLUMNS}
      searchPlaceholder="Search PHP item master..."
    />
  );
}
