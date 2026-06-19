import { SheetMasterPage } from "./SheetMasterPage";
import { PHP_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";

export function PhpItemMaster() {
  return (
    <SheetMasterPage
      title="PHP Item Master"
      entity="php_item_master"
      columns={PHP_ITEM_MASTER_COLUMNS}
      filters={[
        { key: "company", label: "Company" },
        { key: "category", label: "Category" },
        { key: "hostingerSync", label: "Hostinger Sync" },
      ]}
      searchPlaceholder="Search PHP item master..."
    />
  );
}
