import { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Machine, OrderItemSource, Setting, User } from "../types";
import { PRODUCTION_FORM_COLUMN_OPTIONS, parseProductionFormVisibleColumns } from "../lib/productionFormColumns";
import { Spinner } from "../components/Spinner";

import { TableControls } from "../components/TableControls";
import { normalizeMachineName } from "../lib/productionMachineNames";
import { parseMandatoryMachinesByType } from "../lib/mandatoryMachines";
import { getFinancialYear } from "../lib/serial";
import { useNpdItems } from "../hooks/useNpdItems";
import { PO_MANDATORY_MRR_TYPES, parsePoMandatoryMrrTypes } from "../lib/materialInPoMandatory";
import { useAuth } from "../auth/AuthContext";
import { parseRealizationTargets } from "../lib/realizationTargets";
import { useOrderItemCatalog } from "../hooks/useOrderItemCatalog";
import { getOrderItemSourceLabel, OrderCatalogItem } from "../lib/orderItems";

const REEL_FORMULA_OPTIONS = [
  {
    value: "breadth-height-based",
    label: "Breadth/Height Based Formula",
    description:
      "If Breadth is blank or 0, use Height x UPS. Otherwise use ((Breadth + Height) x UPS) + ((ID to OD x UPS) + 16).",
  },
  {
    value: "type-based",
    label: "TYPE Based Formula",
    description:
      "If TYPE = ROTARY TRAY: ((Length (OD) + Height (OD)) x UPS + 20) / 25.4. If TYPE = 2 PLY LINER, U/C PLATE, HORIZONTAL PLATE, or TRAY: ((Width (OD) x UPS) + 20) / 25.4. If TYPE = DIE CUT SHEET: ((Open Width x UPS) + 20) / 25.4. If TYPE = RSC: ((FLAP + Height (OD) + FLAP) x UPS + 20) / 25.4. For any other non-blank TYPE: ((Height (OD) x UPS) + 20) / 25.4.",
  },
];

const FLAP_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "If W (OD) is blank, keep FLAP blank. If PLY = 3, FLAP = half of Width (OD). Otherwise FLAP = half of Width (OD) + 1.",
  },
  {
    value: "type-based",
    label: "TYPE Based Logic",
    description:
      "If TYPE is VERTICAL PLATE, HORIZONTAL PLATE, or DIE CUT SHEET, keep FLAP blank. Otherwise calculate FLAP from Width (OD) based on Ply: for 3 Ply use half of Width (OD), for 5 Ply use half of Width (OD) + 1, for 7 Ply use half of Width (OD) + 2, and for 9 Ply use half of Width (OD) + 3.",
  },
];

const CUTTING_SIZE_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "If Breadth is blank or 0, use Length. If Number of Parts = 1, use ((Length + Breadth) x 2) + (ID to OD 17 x Number of Parts). If Number of Parts = 2, use Length + Breadth + ID to OD 17.",
  },
  {
    value: "type-based",
    label: "TYPE Based Logic",
    description:
      "If TYPE is 2 PLY ROLL, keep Cutting Size blank. If TYPE is DIE CUT SHEET, use ((Open Length x No. of ups in Cutting (For Plates)) + 20) / 25.4. If TYPE is RSC and PART is 1, use ((2 x (Length (OD) + Width (OD))) + 50) / 25.4. If TYPE is RSC and PART is 2, use ((Length (OD) + Width (OD)) + 50) / 25.4. In other filled cases, use ((Length (OD) x No. of ups in Cutting (For Plates)) + 20) / 25.4.",
  },
];

const GSM_FORMULA_OPTIONS = [
  {
    value: "current-logic",
    label: "Current Logic",
    description:
      "L1 + (F1 x Take up Factor) + L2 + (F2 x Take up Factor) + L3.",
  },
  {
    value: "ply-based",
    label: "Ply Based Logic",
    description:
      "For 3 Ply: add Top, F1, B1, F2, and B2, then add 50% of F1 and 36% of F2. For 5 Ply: add Top, F1, B1, F2, and B2, then add 36% of F1 and 36% of F2. For 2 Ply: use the same 5 Ply weighting. For 7 Ply: add Top, F1, B1, F2, B2, F3, and B3, then add 36% each of F1, F2, and F3.",
  },
];

const GLOBAL_ITEM_RENAME_ALLOWED_EMAIL = "pankaj@bizskilledu.com";
const GLOBAL_ITEM_RENAME_SYNC_EVENTS = [
  "sync-data-npd",
  "sync-data-php_item_master",
  "sync-data-plate_item_master",
  "sync-data-materials",
];
const GLOBAL_ITEM_RENAME_CACHE_KEYS = [
  "udc_npd",
  "udc_npd_order_catalog",
  "udc_php_item_master",
  "udc_plate_item_master",
  "udc_materials",
];
const GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS = [
  { key: "orders", label: "Orders" },
  { key: "plans", label: "Plans / Scheduling" },
  { key: "dispatch", label: "Dispatch" },
  { key: "loading", label: "Loading" },
  { key: "billing", label: "Billing" },
] as const;
const GLOBAL_ITEM_TRANSFER_SYNC_EVENTS = [
  ...GLOBAL_ITEM_RENAME_SYNC_EVENTS,
  "sync-data-orders",
  "sync-data-orders_schedule",
  "sync-data-productions",
  "sync-data-dispatch_plans",
  "sync-data-loading_slips",
  "sync-data-php_loading_slips",
  "sync-data-plate_loading_slips",
  "sync-data-invoice_line_items",
];
const GLOBAL_ITEM_TRANSFER_CACHE_KEYS = [
  ...GLOBAL_ITEM_RENAME_CACHE_KEYS,
  "udc_orders",
  "udc_orders_schedule",
  "udc_productions",
  "udc_dispatch_plans",
  "udc_loading_slips",
  "udc_php_loading_slips",
  "udc_plate_loading_slips",
  "udc_invoice_line_items",
];

type GlobalItemTransferModule = (typeof GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS)[number]["key"];
type GlobalItemTransferDetailRow = Record<string, string | number | undefined>;
type GlobalItemTransferOption = {
  key: string;
  label: string;
  searchText: string;
  item: OrderCatalogItem;
};

type GlobalItemTransferDetails = {
  orders?: GlobalItemTransferDetailRow[];
  plans?: { schedules?: number; productions?: number; rows?: GlobalItemTransferDetailRow[] };
  dispatch?: GlobalItemTransferDetailRow[];
  loading?: { records?: number; lines?: number; rows?: GlobalItemTransferDetailRow[] };
  billing?: GlobalItemTransferDetailRow[];
};

const GLOBAL_ITEM_TRANSFER_DETAIL_COLUMNS: Record<GlobalItemTransferModule, Array<{ key: string; label: string }>> = {
  orders: [
    { key: "orderNo", label: "Order No" },
    { key: "date", label: "Date" },
    { key: "qty", label: "Qty" },
    { key: "status", label: "Status" },
  ],
  plans: [
    { key: "type", label: "Type" },
    { key: "scheduleNo", label: "Schedule No" },
    { key: "scheduledDate", label: "Date" },
    { key: "orderNo", label: "Order No" },
    { key: "jobNo", label: "Job No" },
    { key: "qty", label: "Qty" },
    { key: "status", label: "Status" },
  ],
  dispatch: [
    { key: "planNo", label: "Plan No" },
    { key: "date", label: "Date" },
    { key: "orderNo", label: "Order No" },
    { key: "jobNo", label: "Job No" },
    { key: "plannedQty", label: "Planned Qty" },
    { key: "loadedQty", label: "Loaded Qty" },
    { key: "status", label: "Status" },
  ],
  loading: [
    { key: "slipNo", label: "Slip No" },
    { key: "date", label: "Date" },
    { key: "itemName", label: "Line Item" },
    { key: "erpCode", label: "ERP" },
    { key: "loadedQty", label: "Loaded Qty" },
    { key: "jobNos", label: "Job Nos" },
    { key: "invoiceNo", label: "Invoice No" },
  ],
  billing: [
    { key: "invoiceNo", label: "Invoice No" },
    { key: "invoiceDate", label: "Invoice Date" },
    { key: "loadingSlipNo", label: "Loading Slip" },
    { key: "qty", label: "Qty" },
    { key: "rate", label: "Rate" },
    { key: "amount", label: "Amount" },
  ],
};

type GlobalItemTransferPreview = {
  counts: Record<GlobalItemTransferModule, number>;
  details?: GlobalItemTransferDetails;
  fromItem?: { id: string; source: OrderItemSource; name: string; erp?: string };
  toItem?: { id: string; source: OrderItemSource; name: string; erp?: string };
};

function getGlobalItemRenameKey(item: Pick<OrderCatalogItem, "source" | "id">) {
  return `${item.source}::${item.id}`;
}
function GlobalItemTransferSelector({
  id,
  label,
  value,
  options,
  selectedItem,
  disabled,
  placeholder,
  onInputChange,
  onSelect,
}: {
  id: string;
  label: string;
  value: string;
  options: GlobalItemTransferOption[];
  selectedItem?: OrderCatalogItem;
  disabled?: boolean;
  placeholder: string;
  onInputChange: (value: string) => void;
  onSelect: (option: GlobalItemTransferOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const filteredOptions = useMemo(() => {
    const needle = value.trim().toLowerCase();
    const rows = needle
      ? options.filter((option) => option.searchText.includes(needle))
      : options;
    return rows.slice(0, 80);
  }, [options, value]);

  return (
    <div className="relative flex flex-col space-y-2">
      <label htmlFor={id} className="text-xs font-black uppercase tracking-wide text-black">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          onInputChange(event.target.value);
          setOpen(true);
        }}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
      />
      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded border-2 border-black bg-white shadow-lg">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-3 text-sm font-semibold text-slate-500">No item found.</div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(option);
                  setOpen(false);
                }}
                className={`block w-full border-b border-black px-3 py-2 text-left text-sm hover:bg-indigo-50 ${selectedItem?.id === option.item.id && selectedItem?.source === option.item.source ? "bg-indigo-50" : "bg-white"}`}
              >
                <div className="font-black text-black">{option.item.name}</div>
                <div className="mt-0.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                  {getOrderItemSourceLabel(option.item.source)} / {option.item.erp || "-"}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{option.item.id}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
const DEFAULT_ITEM_TYPES = [
  "2 PLY LINER",
  "2 PLY ROLL",
  "DIE CUT SHEET",
  "HORIZONTAL PLATE",
  "PARTITION",
  "Paper",
  "ROTARY TRAY",
  "RSC",
  "U/C PLATE",
  "VERTICAL PLATE",
];


type RealizationDraftRow = {
  dateFrom: string;
  dateTo: string;
  value: number | "";
};

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDefaultBenchmarkRange() {
  const today = new Date();
  return {
    dateFrom: toDateInput(today),
    dateTo: toDateInput(today),
    value: "" as const,
  };
}

type InvoiceSeriesRow = {
  fy: string;
  prefix: string;
  startingNumber: number | "";
  paddingLength: number | "";
  separator: string;
  active: "Yes" | "No";
};

function parseInvoiceNumberSeries(raw?: string): InvoiceSeriesRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        fy: String(row?.fy || "").trim(),
        prefix: String(row?.prefix || "").trim(),
        startingNumber: Number(row?.startingNumber || 1),
        paddingLength: Number(row?.paddingLength || 5),
        separator: String(row?.separator || "/") || "/",
        active: (String(row?.active || "Yes").trim() === "No" ? "No" : "Yes") as "Yes" | "No",
      }))
      .filter((row) => row.fy.length > 0 || row.prefix.length > 0);
  } catch {
    return [];
  }
}

export function SettingsPage() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  // Simple DOM-based table row filter bound to the search input
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const rows = document.querySelectorAll('table tbody tr');
    rows.forEach((row) => {
      const txt = (row.textContent || '').toLowerCase();
      (row as HTMLElement).style.display = q && !txt.includes(q) ? 'none' : '';
    });
  }, [searchTerm]);

  const [settings, setSettings, loading] = useData<Setting>("settings", []);
  const [users] = useData<User>("users", []);
  const [machines] = useData<Machine>("machines", []);
  const npdItems = useNpdItems();
  const { allItems: globalRenameItems } = useOrderItemCatalog();
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [designationDraft, setDesignationDraft] = useState<string[]>([]);
  const [newDesignation, setNewDesignation] = useState("");
  const [organizationDraft, setOrganizationDraft] = useState({
    organizationName: "",
    organizationAddress: "",
    organizationGstDetails: "",
    organizationLogo: "",
  });
  const [invoiceSeriesDraft, setInvoiceSeriesDraft] = useState<InvoiceSeriesRow[]>([]);
  const [poMandatoryDraft, setPoMandatoryDraft] = useState<string[]>([]);
  const [transferFromInput, setTransferFromInput] = useState("");
  const [transferToInput, setTransferToInput] = useState("");
  const [transferModules, setTransferModules] = useState<Record<GlobalItemTransferModule, boolean>>({
    orders: true,
    plans: true,
    dispatch: true,
    loading: true,
    billing: true,
  });
  const [transferPreview, setTransferPreview] = useState<GlobalItemTransferPreview | null>(null);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");

  const currentSetting = settings[0];
  const isPankajUser = String(user?.email || "").trim().toLowerCase() === GLOBAL_ITEM_RENAME_ALLOWED_EMAIL;
  const allowInvoiceTallyEdit = currentSetting?.allowInvoiceTallyEdit === "Yes";

  const allowedInvoiceEditUsers = useMemo(() => {
    if (!currentSetting?.allowInvoiceTallyEditUsers) return [] as string[];
    try {
      const parsed = JSON.parse(currentSetting.allowInvoiceTallyEditUsers);
      if (!Array.isArray(parsed)) return [];
      return Array.from(new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean)));
    } catch {
      return [];
    }
  }, [currentSetting?.allowInvoiceTallyEditUsers]);

  const selectableInvoiceEditUsers = useMemo(() => {
    return users
      .filter((row) => String(row.email || "").trim())
      .sort((a, b) => {
        const nameCompare = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
        if (nameCompare !== 0) return nameCompare;
        return String(a.email || "").localeCompare(String(b.email || ""), undefined, { sensitivity: "base" });
      });
  }, [users]);

  const typeNames = useMemo(() => {
    const fromItems = npdItems.map((item) => String(item.typeName || "").trim()).filter(Boolean);
    const fromSetting = Object.keys(parseMandatoryMachinesByType(currentSetting));
    return Array.from(new Set([...DEFAULT_ITEM_TYPES, ...fromItems, ...fromSetting]))
      .map((t) => t.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [currentSetting, npdItems]);

  const machineNames = useMemo(() => {
    return Array.from(new Set(machines.map((m) => normalizeMachineName(m.name)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [machines]);

  const [mandatoryDraft, setMandatoryDraft] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setMandatoryDraft(parseMandatoryMachinesByType(currentSetting));
  }, [currentSetting?.mandatoryMachinesByType]);

  useEffect(() => {
    if (!currentSetting?.designations) {
      setDesignationDraft([]);
      return;
    }
    try {
      const parsed = JSON.parse(currentSetting.designations);
      setDesignationDraft(
        Array.isArray(parsed)
          ? parsed.map((value) => String(value || "").trim()).filter(Boolean)
          : []
      );
    } catch {
      setDesignationDraft([]);
    }
  }, [currentSetting?.designations]);

  const fyOptions = useMemo(() => {
    const now = new Date();
    const baseStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const toFy = (startYear: number) => `${String(startYear % 100).padStart(2, "0")}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    return Array.from({ length: 8 }, (_, i) => toFy(baseStartYear - 5 + i));
  }, []);
  const realizationTargets = useMemo(
    () => parseRealizationTargets(currentSetting?.realizationPerKgTargets),
    [currentSetting?.realizationPerKgTargets]
  );

  const [realizationDraft, setRealizationDraft] = useState<RealizationDraftRow[]>([]);

  useEffect(() => {
    setRealizationDraft(
      realizationTargets.map((row) => ({
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
        value: Number(row.value || 0),
      }))
    );
  }, [realizationTargets]);

  useEffect(() => {
    setInvoiceSeriesDraft(parseInvoiceNumberSeries(currentSetting?.invoiceNumberSeries));
  }, [currentSetting?.invoiceNumberSeries]);

  useEffect(() => {
    setPoMandatoryDraft(parsePoMandatoryMrrTypes(currentSetting));
  }, [currentSetting?.poMandatoryMrrTypes]);

  const selectedReelFormula = currentSetting?.reelAsPerCalculation || REEL_FORMULA_OPTIONS[0].value;
  const selectedReelOption = useMemo(
    () => REEL_FORMULA_OPTIONS.find((option) => option.value === selectedReelFormula) || REEL_FORMULA_OPTIONS[0],
    [selectedReelFormula]
  );
  const selectedFlapFormula = currentSetting?.flapAsPerCalculation || FLAP_FORMULA_OPTIONS[0].value;
  const selectedFlapOption = useMemo(
    () => FLAP_FORMULA_OPTIONS.find((option) => option.value === selectedFlapFormula) || FLAP_FORMULA_OPTIONS[0],
    [selectedFlapFormula]
  );
  const selectedCuttingFormula = currentSetting?.cuttingSizeAsPerCalculation || CUTTING_SIZE_FORMULA_OPTIONS[0].value;
  const selectedCuttingOption = useMemo(
    () => CUTTING_SIZE_FORMULA_OPTIONS.find((option) => option.value === selectedCuttingFormula) || CUTTING_SIZE_FORMULA_OPTIONS[0],
    [selectedCuttingFormula]
  );
  const selectedGsmFormula = currentSetting?.gsmAsPerCalculation || GSM_FORMULA_OPTIONS[0].value;
  const selectedGsmOption = useMemo(
    () => GSM_FORMULA_OPTIONS.find((option) => option.value === selectedGsmFormula) || GSM_FORMULA_OPTIONS[0],
    [selectedGsmFormula]
  );
  const selectedProductionFormColumns = useMemo(
    () => parseProductionFormVisibleColumns(currentSetting?.productionFormVisibleColumns),
    [currentSetting?.productionFormVisibleColumns]
  );
  const organizationLogoUrl = useMemo(() => {
    if (!organizationDraft.organizationLogo) return "";
    const encoded = organizationDraft.organizationLogo.split("/").map(encodeURIComponent).join("/");
    if (typeof window === "undefined") return `/uploads/${encoded}`;
    return new URL(`/uploads/${encoded}`, window.location.origin).toString();
  }, [organizationDraft.organizationLogo]);
  const organizationValues = useMemo(
    () => ({
      organizationName: currentSetting?.organizationName || "",
      organizationAddress: currentSetting?.organizationAddress || "",
      organizationGstDetails: currentSetting?.organizationGstDetails || "",
      organizationLogo: currentSetting?.organizationLogo || "",
    }),
    [
      currentSetting?.organizationAddress,
      currentSetting?.organizationGstDetails,
      currentSetting?.organizationLogo,
      currentSetting?.organizationName,
    ]
  );

  useEffect(() => {
    setOrganizationDraft(organizationValues);
  }, [organizationValues]);

  const hasOrganizationContent = useMemo(
    () =>
      Boolean(
        organizationDraft.organizationName.trim() ||
        organizationDraft.organizationAddress.trim() ||
        organizationDraft.organizationGstDetails.trim() ||
        organizationDraft.organizationLogo
      ),
    [organizationDraft]
  );

  const hasOrganizationChanges = useMemo(
    () =>
      organizationDraft.organizationName !== organizationValues.organizationName ||
      organizationDraft.organizationAddress !== organizationValues.organizationAddress ||
      organizationDraft.organizationGstDetails !== organizationValues.organizationGstDetails ||
      organizationDraft.organizationLogo !== organizationValues.organizationLogo,
    [organizationDraft, organizationValues]
  );

  const globalRenameOptions = useMemo<GlobalItemTransferOption[]>(() => {
    return globalRenameItems.map((item) => {
      const labelParts = [
        `[${getOrderItemSourceLabel(item.source)}]`,
        item.erp ? `${item.erp} -` : "",
        item.name,
        `(${item.id})`,
      ].filter(Boolean);
      const label = labelParts.join(" ");

      return {
        key: getGlobalItemRenameKey(item),
        label,
        searchText: [label, item.name, item.erp, item.source, item.id].join(" ").toLowerCase(),
        item,
      };
    });
  }, [globalRenameItems]);

  const selectedTransferFromOption = useMemo(
    () => globalRenameOptions.find((option) => option.label === transferFromInput || option.key === transferFromInput),
    [globalRenameOptions, transferFromInput]
  );
  const selectedTransferToOption = useMemo(
    () => globalRenameOptions.find((option) => option.label === transferToInput || option.key === transferToInput),
    [globalRenameOptions, transferToInput]
  );
  const selectedTransferFromItem = selectedTransferFromOption?.item;
  const selectedTransferToItem = selectedTransferToOption?.item;
  const selectedTransferModules = useMemo(
    () => GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS.filter((option) => transferModules[option.key]).map((option) => option.key),
    [transferModules]
  );
  const transferSameSource = Boolean(
    selectedTransferFromItem && selectedTransferToItem && selectedTransferFromItem.source === selectedTransferToItem.source
  );
  const transferReady = Boolean(
    selectedTransferFromItem &&
      selectedTransferToItem &&
      selectedTransferFromItem.id !== selectedTransferToItem.id &&
      transferSameSource &&
      selectedTransferModules.length > 0
  );

  const getTransferDetailRows = (moduleName: GlobalItemTransferModule): GlobalItemTransferDetailRow[] => {
    const details = transferPreview?.details;
    if (!details) return [];
    if (moduleName === "plans") return details.plans?.rows || [];
    if (moduleName === "loading") return details.loading?.rows || [];
    const rows = details[moduleName];
    return Array.isArray(rows) ? rows : [];
  };

  const formatTransferCell = (value: string | number | undefined) => {
    if (value === undefined || value === null || value === "") return "-";
    if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-IN") : "-";
    return value;
  };
  const resetGlobalItemTransferPreview = () => {
    setTransferPreview(null);
    setTransferStatus("");
  };

  const buildGlobalItemTransferPayload = () => ({
    fromSource: selectedTransferFromItem?.source as OrderItemSource | undefined,
    fromItemId: selectedTransferFromItem?.id || "",
    toSource: selectedTransferToItem?.source as OrderItemSource | undefined,
    toItemId: selectedTransferToItem?.id || "",
    modules: selectedTransferModules,
  });

  const refreshGlobalItemTransferCaches = () => {
    GLOBAL_ITEM_TRANSFER_CACHE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    GLOBAL_ITEM_TRANSFER_SYNC_EVENTS.forEach((eventName) => window.dispatchEvent(new CustomEvent(eventName)));
  };

  const handleGlobalItemTransferPreview = async () => {
    if (!isPankajUser) {
      alert("You are not allowed to transfer item usage.");
      return;
    }
    if (!transferReady) {
      alert("Select From Item, To Item of the same source, and at least one module.");
      return;
    }

    setTransferSaving(true);
    setTransferStatus("");
    try {
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/settings/item-transfer/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildGlobalItemTransferPayload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Failed to preview item transfer.");
      setTransferPreview(result as GlobalItemTransferPreview);
      setTransferStatus("Preview ready. Review the counts before applying.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to preview item transfer.";
      setTransferPreview(null);
      setTransferStatus(message);
      alert(message);
    } finally {
      setTransferSaving(false);
    }
  };

  const handleGlobalItemTransferApply = async () => {
    if (!transferReady || !transferPreview || !selectedTransferFromItem || !selectedTransferToItem) {
      alert("Run preview before applying the transfer.");
      return;
    }

    const countSummary = GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS
      .filter((option) => selectedTransferModules.includes(option.key))
      .map((option) => `${option.label}: ${transferPreview.counts?.[option.key] || 0}`)
      .join("\n");
    const confirmed = window.confirm(
      `Transfer linked usage?\n\nFrom: ${selectedTransferFromItem.name}\nTo: ${selectedTransferToItem.name}\n\n${countSummary}`
    );
    if (!confirmed) return;

    setTransferSaving(true);
    setTransferStatus("");
    try {
      const token = window.localStorage.getItem("authToken") || "";
      const response = await fetch("/api/settings/item-transfer/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildGlobalItemTransferPayload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Failed to apply item transfer.");

      refreshGlobalItemTransferCaches();
      setTransferPreview(result as GlobalItemTransferPreview);
      setTransferStatus("Transfer completed. Linked screens will refresh with the target item.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply item transfer.";
      setTransferStatus(message);
      alert(message);
    } finally {
      setTransferSaving(false);
    }
  };

  const handleChange = async (patch: Partial<Setting>) => {
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const nextRow: Setting = {
        id: currentSetting?.id || crypto.randomUUID(),
        reelAsPerCalculation: currentSetting?.reelAsPerCalculation || REEL_FORMULA_OPTIONS[0].value,
        flapAsPerCalculation: currentSetting?.flapAsPerCalculation || FLAP_FORMULA_OPTIONS[0].value,
        cuttingSizeAsPerCalculation: currentSetting?.cuttingSizeAsPerCalculation || CUTTING_SIZE_FORMULA_OPTIONS[0].value,
        gsmAsPerCalculation: currentSetting?.gsmAsPerCalculation || GSM_FORMULA_OPTIONS[0].value,
        allowInvoiceTallyEdit: currentSetting?.allowInvoiceTallyEdit || "No",
        allowInvoiceTallyEditUsers: currentSetting?.allowInvoiceTallyEditUsers || JSON.stringify([]),
        productionFormVisibleColumns: currentSetting?.productionFormVisibleColumns || JSON.stringify(PRODUCTION_FORM_COLUMN_OPTIONS),
        poMandatoryMrrTypes: currentSetting?.poMandatoryMrrTypes || JSON.stringify(["Reel"]),
        realizationPerKgTargets: currentSetting?.realizationPerKgTargets || JSON.stringify([]),
        invoiceNumberSeries: currentSetting?.invoiceNumberSeries || JSON.stringify([]),
        mandatoryMachinesByType: currentSetting?.mandatoryMachinesByType || JSON.stringify({}),
        designations: currentSetting?.designations || JSON.stringify([]),
        organizationName: currentSetting?.organizationName || "",
        organizationAddress: currentSetting?.organizationAddress || "",
        organizationGstDetails: currentSetting?.organizationGstDetails || "",
        organizationLogo: currentSetting?.organizationLogo || "",
        updatedBy: "System User",
        updateTimestamp: timestamp,
        ...patch,
      };

      await setSettings(currentSetting ? [nextRow, ...settings.slice(1)] : [nextRow]);
    } catch (error) {
      console.error("Failed to save setting:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File size exceeds 10MB. Please upload a smaller logo.");
      return;
    }

    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const token = window.localStorage.getItem("authToken");
        const response = await fetch("/api/upload-artwork", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ base64, filename: file.name }),
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const result = await response.json();
        setOrganizationDraft((prev) => ({ ...prev, organizationLogo: result.filename }));
      } catch (error) {
        console.error("Failed to upload organization logo:", error);
        alert("Failed to upload logo.");
      } finally {
        setUploadingLogo(false);
        event.target.value = "";
      }
    };

    reader.readAsDataURL(file);
  };

  const handleOrganizationSave = async () => {
    if (!hasOrganizationContent || !hasOrganizationChanges) return;
    await handleChange({
      organizationName: organizationDraft.organizationName,
      organizationAddress: organizationDraft.organizationAddress,
      organizationGstDetails: organizationDraft.organizationGstDetails,
      organizationLogo: organizationDraft.organizationLogo,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Settings</h2>
      </div>

      <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} />

      {isPankajUser && (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl space-y-4">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Billing Master Edit Control</h3>
            <p className="text-sm text-black leading-6">
              Temporarily allow editing of the <span className="font-bold">INVOICE</span> and <span className="font-bold">TALLY NO.</span> columns in Billing Master.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm font-semibold text-black">
            <input
              type="checkbox"
              checked={allowInvoiceTallyEdit}
              onChange={(e) => void handleChange({ allowInvoiceTallyEdit: e.target.checked ? "Yes" : "No" })}
              disabled={loading || saving}
              className="h-4 w-4 border-black"
            />
            <span>Allow Edit Invoice &amp; Tally No.</span>
          </label>
          <div className="space-y-3">
            <div className="text-xs font-black uppercase tracking-wide text-slate-600">Users Allowed To Edit</div>
            <div className="rounded border border-black bg-slate-50 p-3 max-h-56 overflow-y-auto space-y-2">
              {selectableInvoiceEditUsers.length === 0 ? (
                <div className="text-sm text-slate-500">No users with email found.</div>
              ) : (
                selectableInvoiceEditUsers.map((row) => {
                  const email = String(row.email || "").trim();
                  const checked = allowedInvoiceEditUsers.includes(email);
                  return (
                    <label key={row.id} className="flex items-center gap-3 text-sm text-black">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={loading || saving}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? Array.from(new Set([...allowedInvoiceEditUsers, email]))
                            : allowedInvoiceEditUsers.filter((value) => value !== email);
                          void handleChange({ allowInvoiceTallyEditUsers: JSON.stringify(next) });
                        }}
                        className="h-4 w-4 border-black"
                      />
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-slate-500">({email})</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Status: {allowInvoiceTallyEdit ? "Enabled temporarily" : "Disabled"} | Allowed users: {allowedInvoiceEditUsers.length}
          </p>
        </div>
      )}

      {isPankajUser && (
        <>
          <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl space-y-4">
            <div>
              <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Global Item Transfer</h3>
              <p className="text-sm text-black leading-6">
                Transfer linked usage from one item to another item of the same source. Selected modules are updated in backend records, including completed history.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <GlobalItemTransferSelector
                id="globalItemTransferFrom"
                label="From Item"
                value={transferFromInput}
                options={globalRenameOptions}
                selectedItem={selectedTransferFromItem}
                disabled={transferSaving}
                placeholder="Search source item"
                onInputChange={(value) => {
                  setTransferFromInput(value);
                  resetGlobalItemTransferPreview();
                }}
                onSelect={(option) => {
                  setTransferFromInput(option.label);
                  resetGlobalItemTransferPreview();
                }}
              />

              <GlobalItemTransferSelector
                id="globalItemTransferTo"
                label="To Item"
                value={transferToInput}
                options={globalRenameOptions}
                selectedItem={selectedTransferToItem}
                disabled={transferSaving}
                placeholder="Search target item"
                onInputChange={(value) => {
                  setTransferToInput(value);
                  resetGlobalItemTransferPreview();
                }}
                onSelect={(option) => {
                  setTransferToInput(option.label);
                  resetGlobalItemTransferPreview();
                }}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-black bg-slate-50 px-3 py-2 text-sm text-black">
                <div className="text-xs font-black uppercase tracking-wide text-slate-600">From</div>
                <div className="mt-1 font-bold">{selectedTransferFromItem ? selectedTransferFromItem.name : "Select an item"}</div>
                <div className="text-xs font-semibold text-slate-600">
                  {selectedTransferFromItem ? `${selectedTransferFromItem.erp || "-"} / ${getOrderItemSourceLabel(selectedTransferFromItem.source)}` : "-"}
                </div>
              </div>
              <div className="rounded border border-black bg-slate-50 px-3 py-2 text-sm text-black">
                <div className="text-xs font-black uppercase tracking-wide text-slate-600">To</div>
                <div className="mt-1 font-bold">{selectedTransferToItem ? selectedTransferToItem.name : "Select an item"}</div>
                <div className="text-xs font-semibold text-slate-600">
                  {selectedTransferToItem ? `${selectedTransferToItem.erp || "-"} / ${getOrderItemSourceLabel(selectedTransferToItem.source)}` : "-"}
                </div>
              </div>
            </div>

            {selectedTransferFromItem && selectedTransferToItem && !transferSameSource && (
              <div className="rounded border border-red-700 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                Transfer is allowed only within the same source/type.
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-black uppercase tracking-wide text-black">Modules To Update</div>
              <div className="grid gap-2 md:grid-cols-3">
                {GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-bold text-black">
                    <input
                      type="checkbox"
                      checked={transferModules[option.key]}
                      onChange={(event) => {
                        setTransferModules((prev) => ({ ...prev, [option.key]: event.target.checked }));
                        resetGlobalItemTransferPreview();
                      }}
                      disabled={transferSaving}
                      className="h-4 w-4 border-black"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {transferPreview && (
              <div className="space-y-4 rounded border border-black bg-yellow-50 p-4 text-sm text-black">
                <div>
                  <div className="font-black uppercase tracking-wide">Preview Counts</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    {GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS.filter((option) => selectedTransferModules.includes(option.key)).map((option) => (
                      <div key={option.key} className="rounded border border-black bg-white px-3 py-2">
                        <div className="text-xs font-black uppercase tracking-wide text-slate-600">{option.label}</div>
                        <div className="text-lg font-black text-black">{transferPreview.counts?.[option.key] || 0}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="font-black uppercase tracking-wide">Related Records</div>
                  {GLOBAL_ITEM_TRANSFER_MODULE_OPTIONS.filter((option) => selectedTransferModules.includes(option.key)).map((option) => {
                    const rows = getTransferDetailRows(option.key);
                    const columns = GLOBAL_ITEM_TRANSFER_DETAIL_COLUMNS[option.key];
                    return (
                      <div key={`details-${option.key}`} className="rounded border border-black bg-white">
                        <div className="flex items-center justify-between gap-3 border-b border-black bg-slate-900 px-3 py-2 text-white">
                          <div className="text-xs font-black uppercase tracking-wide">{option.label}</div>
                          <div className="text-[11px] font-bold uppercase tracking-wide">{rows.length} Rows</div>
                        </div>
                        {rows.length === 0 ? (
                          <div className="px-3 py-4 text-sm font-semibold text-slate-500">No related records found.</div>
                        ) : (
                          <div className="max-h-64 overflow-auto">
                            <table className="min-w-full border-collapse text-xs">
                              <thead className="sticky top-0 bg-slate-100">
                                <tr>
                                  {columns.map((column) => (
                                    <th key={column.key} className="border border-black px-3 py-2 text-left font-black uppercase text-slate-700 whitespace-nowrap">
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, rowIndex) => (
                                  <tr key={String(row.id || `${option.key}-${rowIndex}`)}>
                                    {columns.map((column) => (
                                      <td key={column.key} className="border border-black px-3 py-2 font-semibold text-black whitespace-nowrap">
                                        {formatTransferCell(row[column.key])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {transferStatus && (
              <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm font-bold text-black">
                {transferStatus}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => void handleGlobalItemTransferPreview()}
                disabled={transferSaving || !transferReady}
                className="inline-flex min-w-[160px] items-center justify-center rounded border border-black bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-slate-50 disabled:opacity-50"
              >
                {transferSaving ? <Spinner size={16} /> : "Preview"}
              </button>
              <button
                type="button"
                onClick={() => void handleGlobalItemTransferApply()}
                disabled={transferSaving || !transferReady || !transferPreview}
                className="inline-flex min-w-[180px] items-center justify-center rounded bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {transferSaving ? <Spinner size={16} className="text-white" /> : "Apply Transfer"}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="bg-white p-6 rounded shadow-sm border border-black max-w-3xl space-y-5">
          <div className="space-y-4 border-b border-dashed border-black pb-5">
            <div>
              <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Realization Setup (Date Range)</h3>
              <p className="text-sm text-black leading-6">
                Store date-range benchmark values for Realization/KG. The report uses the row where Date From &lt;= today &lt;= Date To.
              </p>
            </div>

            <div className="table-sticky-scroll border border-black rounded">
              <table className="min-w-full divide-y divide-black border-collapse">
                <thead className="sticky top-0 z-30 bg-slate-100">
                  <tr className="divide-x divide-black">
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Date From</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Date To</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Benchmark Rate</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {realizationDraft.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-sm text-slate-500 text-center">
                        No realization benchmarks configured.
                      </td>
                    </tr>
                  ) : (
                    realizationDraft.map((row, idx) => (
                      <tr key={`${row.dateFrom}-${row.dateTo}-${idx}`} className="divide-x divide-black">
                        <td className="px-4 py-2 border border-black">
                          <input
                            type="date"
                            value={row.dateFrom}
                            onChange={(e) =>
                              setRealizationDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, dateFrom: e.target.value } : r)))
                            }
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <input
                            type="date"
                            value={row.dateTo}
                            onChange={(e) =>
                              setRealizationDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, dateTo: e.target.value } : r)))
                            }
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black text-right">
                          <input
                            type="number"
                            value={row.value}
                            onChange={(e) =>
                              setRealizationDraft((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, value: e.target.value === "" ? "" : Number(e.target.value) } : r
                                )
                              )
                            }
                            disabled={loading || saving}
                            className="w-32 border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none text-right"
                            step={0.01}
                            min={0}
                          />
                        </td>
                        <td className="px-4 py-2 border border-black text-right">
                          <button
                            type="button"
                            onClick={() => setRealizationDraft((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={loading || saving}
                            className="px-3 py-1 border-2 border-black rounded bg-white text-black text-xs font-bold hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3 items-center justify-between">
              <button
                type="button"
                onClick={() => setRealizationDraft((prev) => [...prev, getDefaultBenchmarkRange()])}
                disabled={loading || saving}
                className="bg-white text-black border-2 border-black px-4 py-2 rounded font-bold hover:bg-slate-50 transition shadow-sm"
              >
                Add Date Range
              </button>
              <button
                type="button"
                onClick={() => {
                  const cleaned = realizationDraft
                    .map((row) => ({
                      dateFrom: String(row.dateFrom || "").trim(),
                      dateTo: String(row.dateTo || "").trim(),
                      value: Number(row.value || 0),
                    }))
                    .filter((row) => row.dateFrom.length > 0 && row.dateTo.length > 0 && Number.isFinite(row.value));
                  void handleChange({ realizationPerKgTargets: JSON.stringify(cleaned) });
                }}
                disabled={loading || saving}
                className="bg-emerald-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              >
                {saving ? <Spinner size={18} className="text-white" /> : "Save Realization Setup"}
              </button>
            </div>
          </div>
          <div className="space-y-4 border-b border-dashed border-black pb-5">
            <div>
              <h3 className="text-sm font-black uppercase text-slate-600 mb-2">PO Mandatory In MRR</h3>
              <p className="text-sm text-black leading-6">
                Choose which Material Receipt types must have <span className="font-bold">Our PO No.</span>. Rejection In and Service Return always remain optional.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {PO_MANDATORY_MRR_TYPES.map((type) => {
                const checked = poMandatoryDraft.includes(type);
                return (
                  <label key={type} className="flex items-center justify-between gap-3 rounded border-2 border-black bg-white px-4 py-3 text-sm font-bold text-black">
                    <span>{type}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextChecked = e.target.checked;
                        setPoMandatoryDraft((prev) => {
                          const current = new Set(prev);
                          if (nextChecked) current.add(type);
                          else current.delete(type);
                          return PO_MANDATORY_MRR_TYPES.filter((value) => current.has(value));
                        });
                      }}
                      disabled={loading || saving}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleChange({ poMandatoryMrrTypes: JSON.stringify(poMandatoryDraft) })}
                disabled={loading || saving}
                className="bg-indigo-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
              >
                {saving ? <Spinner size={18} className="text-white" /> : "Save PO Mandatory"}
              </button>
            </div>
          </div>

          <div className="space-y-4 border-b border-dashed border-black pb-5">
            <div>
              <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Invoice Number Series</h3>
              <p className="text-sm text-black leading-6">
                Configure FY-wise invoice numbering format like <span className="font-bold">LNPI/26-27/00289</span>.
              </p>
            </div>

            <div className="table-sticky-scroll border border-black rounded">
              <table className="min-w-full divide-y divide-black border-collapse">
                <thead className="sticky top-0 z-30 bg-slate-100">
                  <tr className="divide-x divide-black">
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">FY</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Prefix</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Starting No</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Padding</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Separator</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Active</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-black uppercase border border-black whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-black">
                  {invoiceSeriesDraft.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-sm text-slate-500 text-center">
                        No invoice series configured.
                      </td>
                    </tr>
                  ) : (
                    invoiceSeriesDraft.map((row, idx) => (
                      <tr key={`${row.fy}-${row.prefix}-${idx}`} className="divide-x divide-black">
                        <td className="px-4 py-2 border border-black">
                          <select
                            value={row.fy}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, fy: e.target.value } : r)))}
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          >
                            {fyOptions.map((fy) => (
                              <option key={fy} value={fy}>{fy}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <input
                            value={row.prefix}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, prefix: e.target.value.toUpperCase() } : r)))}
                            disabled={loading || saving}
                            placeholder="LNPI"
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <input
                            type="number"
                            min={1}
                            value={row.startingNumber}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, startingNumber: e.target.value === "" ? "" : Number(e.target.value) } : r)))}
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm text-right font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <input
                            type="number"
                            min={1}
                            value={row.paddingLength}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, paddingLength: e.target.value === "" ? "" : Number(e.target.value) } : r)))}
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm text-right font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <input
                            value={row.separator}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, separator: e.target.value || "/" } : r)))}
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          />
                        </td>
                        <td className="px-4 py-2 border border-black">
                          <select
                            value={row.active}
                            onChange={(e) => setInvoiceSeriesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, active: e.target.value === "No" ? "No" : "Yes" } : r)))}
                            disabled={loading || saving}
                            className="w-full border border-black rounded px-2 py-1 text-sm font-semibold text-black outline-none bg-white"
                          >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        </td>
                        <td className="px-4 py-2 border border-black text-right">
                          <button
                            type="button"
                            onClick={() => setInvoiceSeriesDraft((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={loading || saving}
                            className="px-3 py-1 border-2 border-black rounded bg-white text-black text-xs font-bold hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setInvoiceSeriesDraft((prev) => [
                    ...prev,
                    {
                      fy: getFinancialYear(new Date().toISOString()),
                      prefix: "",
                      startingNumber: 1,
                      paddingLength: 5,
                      separator: "/",
                      active: "Yes",
                    },
                  ])
                }
                disabled={loading || saving}
                className="bg-white text-black px-4 py-2 rounded font-bold border-2 border-black hover:bg-slate-50"
              >
                Add Invoice Series
              </button>

              <button
                type="button"
                onClick={() => {
                  const cleaned = invoiceSeriesDraft
                    .map((row) => ({
                      fy: String(row.fy || "").trim(),
                      prefix: String(row.prefix || "").trim().toUpperCase(),
                      startingNumber: Math.max(1, Number(row.startingNumber || 1)),
                      paddingLength: Math.max(1, Number(row.paddingLength || 5)),
                      separator: String(row.separator || "/") || "/",
                      active: row.active === "No" ? "No" : "Yes",
                    }))
                    .filter((row) => row.fy.length > 0 && row.prefix.length > 0);

                  const activeByFy = new Set<string>();
                  for (const row of cleaned) {
                    if (row.active !== "Yes") continue;
                    if (activeByFy.has(row.fy)) {
                      alert(`Only one active invoice series is allowed for FY ${row.fy}.`);
                      return;
                    }
                    activeByFy.add(row.fy);
                  }

                  void handleChange({ invoiceNumberSeries: JSON.stringify(cleaned) });
                }}
                disabled={loading || saving}
                className="bg-emerald-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
              >
                {saving ? <Spinner size={18} className="text-white" /> : "Save Invoice Series"}
              </button>
            </div>
          </div>

          <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Designation Setup</h3>
            <p className="text-sm text-black leading-6">
              Maintain the designation list used in the Users form.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={newDesignation}
              onChange={(e) => setNewDesignation(e.target.value)}
              disabled={loading || saving}
              placeholder="Enter designation"
              className="flex-1 rounded border-2 border-black p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = newDesignation.trim();
                if (!trimmed) return;
                if (designationDraft.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
                  alert("Designation already exists.");
                  return;
                }
                setDesignationDraft((prev) => [...prev, trimmed]);
                setNewDesignation("");
              }}
              disabled={loading || saving}
              className="rounded border-2 border-black bg-white px-4 py-2 font-bold text-black hover:bg-slate-50"
            >
              Add Designation
            </button>
          </div>

          <div className="table-sticky-scroll rounded border border-black">
            <table className="min-w-full border-collapse border border-black">
              <thead className="sticky top-0 z-30 bg-slate-100">
                <tr className="divide-x divide-black">
                  <th className="border border-black px-4 py-2 text-left text-xs font-bold uppercase text-black">Designation</th>
                  <th className="border border-black px-4 py-2 text-right text-xs font-bold uppercase text-black">Action</th>
                </tr>
              </thead>
              <tbody>
                {designationDraft.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="border border-black px-4 py-4 text-center text-sm text-slate-500">
                      No designations configured.
                    </td>
                  </tr>
                ) : (
                  designationDraft.map((designation, index) => (
                    <tr key={`${designation}-${index}`} className="divide-x divide-black">
                      <td className="border border-black px-4 py-2">
                        <input
                          type="text"
                          value={designation}
                          onChange={(e) =>
                            setDesignationDraft((prev) =>
                              prev.map((value, valueIndex) => (valueIndex === index ? e.target.value : value))
                            )
                          }
                          disabled={loading || saving}
                          className="w-full rounded border border-black px-2 py-1 text-sm text-black"
                        />
                      </td>
                      <td className="border border-black px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setDesignationDraft((prev) => prev.filter((_, valueIndex) => valueIndex !== index))}
                          disabled={loading || saving}
                          className="rounded border border-black bg-white px-3 py-1 text-xs font-bold text-black hover:bg-slate-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                const cleaned = Array.from(
                  new Set(designationDraft.map((value) => value.trim()).filter(Boolean))
                ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
                setDesignationDraft(cleaned);
                void handleChange({ designations: JSON.stringify(cleaned) });
              }}
              disabled={loading || saving}
              className="bg-indigo-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
            >
              {saving ? <Spinner size={18} className="text-white" /> : "Save Designations"}
            </button>
          </div>
        </div>

        <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Mandatory Machines By Type</h3>
            <p className="text-sm text-black leading-6">
              Select which machine entries are mandatory (Production Processing) for each item TYPE. These selections can be used to
              control pending/workflow visibility.
            </p>
          </div>

          {typeNames.length === 0 ? (
            <div className="rounded border border-black bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No TYPE values found in NPD master.
            </div>
          ) : machineNames.length === 0 ? (
            <div className="rounded border border-black bg-slate-50 p-4 text-sm font-semibold text-slate-700">
              No Machines found. Add machines first in Masters â†’ Machines.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {typeNames.map((typeName) => {
                const selected = new Set(mandatoryDraft[typeName] || []);
                return (
                  <div key={typeName} className="rounded-xl border-2 border-black bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Type</div>
                        <div className="mt-1 text-sm font-black text-black">{typeName}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMandatoryDraft((prev) => {
                            const next = { ...prev };
                            delete next[typeName];
                            return next;
                          })
                        }
                        disabled={saving || loading}
                        className="text-xs font-black uppercase tracking-wide text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded border border-black bg-slate-50 p-3">
                      {machineNames.map((machineName) => {
                        const checked = selected.has(machineName);
                        return (
                          <label key={machineName} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span className="font-semibold text-slate-800">{machineName}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextChecked = e.target.checked;
                                setMandatoryDraft((prev) => {
                                  const current = new Set(prev[typeName] || []);
                                  if (nextChecked) current.add(machineName);
                                  else current.delete(machineName);
                                  return { ...prev, [typeName]: Array.from(current).sort((a, b) => a.localeCompare(b)) };
                                });
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Selected: {selected.size}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleChange({ mandatoryMachinesByType: JSON.stringify(mandatoryDraft) })}
              disabled={loading || saving}
              className="bg-indigo-600 text-white px-6 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all disabled:opacity-50"
            >
              {saving ? <Spinner size={18} className="text-white" /> : "Save Mandatory Machines"}
            </button>
          </div>
        </div>

        <div className="space-y-4 border-b border-dashed border-black pb-5">
          <div>
            <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Organization Details</h3>
            <p className="text-sm text-black leading-6">
              These details can be used as the centered header section in generated PDFs such as indent documents.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationName" className="text-xs font-black uppercase tracking-wide text-black">
                Organization Name
              </label>
              <input
                id="organizationName"
                type="text"
                value={organizationDraft.organizationName}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationName: e.target.value }))}
                disabled={loading || saving}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationAddress" className="text-xs font-black uppercase tracking-wide text-black">
                Organization Address
              </label>
              <textarea
                id="organizationAddress"
                value={organizationDraft.organizationAddress}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationAddress: e.target.value }))}
                disabled={loading || saving}
                rows={3}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white resize-y"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label htmlFor="organizationGstDetails" className="text-xs font-black uppercase tracking-wide text-black">
                Organization GST Details
              </label>
              <textarea
                id="organizationGstDetails"
                value={organizationDraft.organizationGstDetails}
                onChange={(e) => setOrganizationDraft((prev) => ({ ...prev, organizationGstDetails: e.target.value }))}
                disabled={loading || saving}
                rows={2}
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white resize-y"
              />
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2">
              <label className="text-xs font-black uppercase tracking-wide text-black">Organization Logo</label>
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <label className="inline-flex cursor-pointer items-center justify-center rounded border border-black bg-white px-4 py-2 text-sm font-bold text-black hover:bg-slate-50 transition">
                  {uploadingLogo ? <Spinner size={16} /> : "Upload Logo"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={loading || saving || uploadingLogo}
                    className="hidden"
                  />
                </label>
                {organizationDraft.organizationLogo ? (
                  <div className="space-y-2">
                    <div className="flex min-h-[96px] min-w-[220px] items-center justify-center rounded border border-black bg-transparency p-3">
                      <img
                        src={organizationLogoUrl}
                        alt="Organization logo"
                        className="max-h-20 max-w-[220px] object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setOrganizationDraft((prev) => ({ ...prev, organizationLogo: "" }))}
                      disabled={loading || saving || uploadingLogo}
                      className="text-xs font-bold uppercase tracking-wide text-red-700 hover:text-red-900 disabled:opacity-50"
                    >
                      Remove Logo
                    </button>
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-black bg-white px-4 py-3 text-sm text-slate-600">
                    No logo uploaded yet.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end md:col-span-2">
              <button
                type="button"
                onClick={() => void handleOrganizationSave()}
                disabled={loading || saving || uploadingLogo || !hasOrganizationContent || !hasOrganizationChanges}
                className="inline-flex items-center justify-center min-w-[170px] rounded bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {saving ? <Spinner size={16} className="text-white" /> : "Save Organization"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-black uppercase text-slate-600 mb-2">Production Formula Control</h3>
          <p className="text-sm text-black leading-6">
            Choose which formula the Production Form should use to calculate <span className="font-bold">Reel As per Calculation</span>.
          </p>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="reelAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Reel As per Calculation
          </label>
          <select
            id="reelAsPerCalculation"
            value={selectedReelFormula}
            onChange={(e) => void handleChange({ reelAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {REEL_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedReelOption.description}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="flapAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Flap
          </label>
          <select
            id="flapAsPerCalculation"
            value={selectedFlapFormula}
            onChange={(e) => void handleChange({ flapAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {FLAP_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedFlapOption.description}
          </div>
          <div className="text-xs font-bold text-slate-500">
            {saving ? "Saving setting..." : "These selections are used by NPD-driven forms and Production Form for new calculations."}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="cuttingSizeAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            Cutting Size
          </label>
          <select
            id="cuttingSizeAsPerCalculation"
            value={selectedCuttingFormula}
            onChange={(e) => void handleChange({ cuttingSizeAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {CUTTING_SIZE_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedCuttingOption.description}
          </div>
        </div>

        <div className="flex flex-col space-y-2">
          <label htmlFor="gsmAsPerCalculation" className="text-xs font-black uppercase tracking-wide text-black">
            GSM
          </label>
          <select
            id="gsmAsPerCalculation"
            value={selectedGsmFormula}
            onChange={(e) => void handleChange({ gsmAsPerCalculation: e.target.value })}
            disabled={loading || saving}
            className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-sm bg-white"
          >
            {GSM_FORMULA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="rounded border border-black bg-slate-50 px-4 py-3 text-sm text-black leading-6">
            {selectedGsmOption.description}
          </div>
        </div>

        <div className="space-y-3 border-t border-dashed border-black pt-4">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wide text-black">Production Form Column Visibility</h3>
            <p className="text-sm text-black leading-6 mt-1">
              Choose which columns should stay visible in the Production Form. Unchecked columns will be hidden from the form view only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleChange({ productionFormVisibleColumns: JSON.stringify(PRODUCTION_FORM_COLUMN_OPTIONS) })}
              disabled={loading || saving}
              className="border border-black bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-slate-100 disabled:opacity-50"
            >
              Show All
            </button>
            <button
              type="button"
              onClick={() => void handleChange({ productionFormVisibleColumns: JSON.stringify([]) })}
              disabled={loading || saving}
              className="border border-black bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-slate-100 disabled:opacity-50"
            >
              Hide All
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded border border-black bg-slate-50 p-3 max-h-[420px] overflow-y-auto">
            {PRODUCTION_FORM_COLUMN_OPTIONS.map((column) => {
              const checked = selectedProductionFormColumns.includes(column);
              return (
                <label key={column} className="flex items-center gap-2 rounded border border-black bg-white px-3 py-2 text-sm font-medium text-black">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const nextColumns = e.target.checked
                        ? [...selectedProductionFormColumns, column]
                        : selectedProductionFormColumns.filter((value) => value !== column);
                      void handleChange({ productionFormVisibleColumns: JSON.stringify(nextColumns) });
                    }}
                    disabled={loading || saving}
                    className="h-4 w-4 border-black"
                  />
                  <span>{column}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
