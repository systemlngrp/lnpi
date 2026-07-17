import { SheetMasterPage } from "./SheetMasterPage";
import { PHP_ITEM_MASTER_COLUMNS } from "../lib/sheetMasterConfigs";
import { useData } from "../hooks/useData";
import { buildPhpPlateInventoryRows } from "../lib/phpPlateInventory";
import type { LoadingSlip, Production } from "../types";

const HIDDEN_PHP_ITEM_MASTER_COLUMNS = new Set(["hostingerSync", "syncInItemMaster", "planQty"]);

export function PhpItemMaster() {
  const [rows] = useData<any>("php_item_master", []);
  const [jobs] = useData<Production>("php_job_master", []);
  const [standaloneLoadingSlips] = useData<LoadingSlip>("php_loading_slips", []);
  const [commonLoadingSlips] = useData<LoadingSlip>("loading_slips", []);

  return (
    <SheetMasterPage
      title="PHP Item Master"
      entity="php_item_master"
      columns={PHP_ITEM_MASTER_COLUMNS.filter((column) => !HIDDEN_PHP_ITEM_MASTER_COLUMNS.has(column.key))}
      editableColumns={["openingQty"]}
      rowsOverride={buildPhpPlateInventoryRows(rows, jobs, [...standaloneLoadingSlips, ...commonLoadingSlips], "PHP")}
      filters={[
        { key: "company", label: "Company", searchable: true },
        { key: "itemName", label: "Item", searchable: true, optionLabelKeys: ["itemName", "erpItemCode"], optionSearchKeys: ["masterItemNameErpCode"] },
      ]}
      searchPlaceholder="Search PHP item master..."
    />
  );
}
