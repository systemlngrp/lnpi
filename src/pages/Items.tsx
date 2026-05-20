import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { Plus, Edit, Trash2 } from "lucide-react";
import { ColorMaster, Item, ItemGroup } from "../types";
import { Spinner } from "../components/Spinner";
import { Select } from "../components/Select";
import { TableControls } from "../components/TableControls";
import CreatableSelect from "react-select/creatable";

export function Items() {
  const [items, setItems] = useData<Item>("items", []);
  const [groups, setGroups] = useData<ItemGroup>("item-groups", []);
  const [colors, setColors] = useData<ColorMaster>("color_masters", []);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [uom, setUom] = useState("");
  const [erp, setErp] = useState<string>("");
  const [itemType, setItemType] = useState<"FG" | "Reel" | "Others">("Others");
  const [typeName, setTypeName] = useState<string>("");
  const [customer, setCustomer] = useState<string>("");
  const [openLength, setOpenLength] = useState<string>("");
  const [openWidth, setOpenWidth] = useState<string>("");
  const [opening, setOpening] = useState<string>("0");
  const [gstRate, setGstRate] = useState<string>("18");
  
  // Technical Specifications State
  const [noOfParts, setNoOfParts] = useState<string>("");
  const [ups, setUps] = useState<string>("");
  const [length, setLength] = useState<string>("");
  const [breadth, setBreadth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [ply, setPly] = useState<string>("");
  const [flute, setFlute] = useState<string>("");
  const [dieCutUps, setDieCutUps] = useState<string>("");
  const [topPaperShade, setTopPaperShade] = useState<string>("");
  const [plateWeight, setPlateWeight] = useState<string>("");
  const [gsmLeastCost, setGsmLeastCost] = useState<string>("");
  const [l1, setL1] = useState<string>("");
  const [f1, setF1] = useState<string>("");
  const [l2, setL2] = useState<string>("");
  const [f2, setF2] = useState<string>("");
  const [l3, setL3] = useState<string>("");
  const [f3, setF3] = useState<string>("");
  const [b3, setB3] = useState<string>("");
  const [backingPaperShade, setBackingPaperShade] = useState<string>("");
  const [printingColour1, setPrintingColour1] = useState<string>("");
  const [printingColour2, setPrintingColour2] = useState<string>("");
  const [lOd, setLOd] = useState<string>("");
  const [wOd, setWOd] = useState<string>("");
  const [hOd, setHOd] = useState<string>("");
  const [flap, setFlap] = useState<string>("");
  const [deckleSize, setDeckleSize] = useState<string>("");
  const [cuttingSize, setCuttingSize] = useState<string>("");
  const [itemRate, setItemRate] = useState<string>("");
  const [artwork, setArtwork] = useState<string>("");
  const [spec, setSpec] = useState<string>("");

  const [searchTerm, setSearchTerm] = useState("");

  const uomOptions = [
    { value: "KG", label: "KG" },
    { value: "PCs", label: "PCs" },
    { value: "Metre", label: "Metre" },
    { value: "Liter", label: "Liter" },
  ];

  const fluteOptions = [
    { value: "A", label: "A" },
    { value: "B", label: "B" },
    { value: "C", label: "C" },
    { value: "E", label: "E" },
    { value: "B+C", label: "B+C" },
    { value: "B+E", label: "B+E" },
  ];

  const plyOptions = [
    { value: "3", label: "3 PLY" },
    { value: "5", label: "5 PLY" },
  ];

  const itemTypeOptions = [
    { value: "FG", label: "FG" },
    { value: "Reel", label: "Reel" },
    { value: "Others", label: "Others" },
  ];

  const buildStringOptions = (values: Array<string | undefined>, defaults: string[] = []) =>
    Array.from(
      new Set(
        [...defaults, ...values]
          .map((value) => (value || "").trim())
          .filter(Boolean)
      )
    )
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({ value, label: value }));

  const buildNumericOptions = (values: Array<number | string | undefined>, defaults: Array<number | string> = []) =>
    Array.from(
      new Set(
        [...defaults, ...values]
          .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
          .filter((value) => value !== "" && !Number.isNaN(Number(value)))
      )
    )
      .sort((a, b) => Number(a) - Number(b))
      .map((value) => ({ value, label: value }));

  const groupOptions = groups.map(g => ({ value: g.id, label: g.name }));

  const businessTypeOptions = buildStringOptions(
    items.map((item) => item.typeName),
    ["2 PLY LINER", "2 PLY ROLL", "DIE CUT SHEET", "HORIZONTAL PLATE", "PARTITION", "Paper", "ROTARY TRAY", "RSC", "U/C PLATE", "VERTICAL PLATE"]
  );
  const plyDropdownOptions = buildNumericOptions(items.map((item) => item.ply), [2, 3, 5, 7, 9]);
  const fluteDropdownOptions = buildStringOptions(items.map((item) => item.flute), ["A", "B", "B+B", "B+C", "B+E", "C", "E"]);
  const colorOptions = buildStringOptions(colors.map((color) => color.name), ["Brown", "Red", "plain"]);

  const ensureColorMasterValue = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    const exists = colors.some((color) => color.name.toLowerCase() === cleaned.toLowerCase());
    if (exists) return;

    setColors([
      ...colors,
      {
        id: crypto.randomUUID(),
        name: cleaned,
        updatedBy: "System User",
        updateTimestamp: new Date().toISOString(),
      },
    ]);
  };

  const [showQuickGroup, setShowQuickGroup] = useState(false);
  const [quickGroupName, setQuickGroupName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    setItems(items.filter(i => i.id !== id));
    setDeletingId(null);
  };

  const handleCreateNewGroup = () => {
    setShowQuickGroup(true);
  };

  const handleQuickGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickGroupName.trim()) return;

    if (groups.some(g => g.name.toLowerCase() === quickGroupName.trim().toLowerCase())) {
      alert("Group already exists.");
      return;
    }

    const newGroup: ItemGroup = { 
      id: crypto.randomUUID(), 
      name: quickGroupName.trim(),
      updatedBy: "System User",
      updateTimestamp: new Date().toISOString()
    };
    setGroups([...groups, newGroup]);
    setGroupId(newGroup.id);
    setQuickGroupName("");
    setShowQuickGroup(false);
  };

  const resetForm = () => {
    setName("");
    setGroupId("");
    setUom("");
    setErp("");
    setItemType("Others");
    setTypeName("");
    setCustomer("");
    setOpenLength("");
    setOpenWidth("");
    setOpening("0");
    setGstRate("18");
    setNoOfParts("");
    setUps("");
    setLength("");
    setBreadth("");
    setHeight("");
    setPly("");
    setFlute("");
    setDieCutUps("");
    setTopPaperShade("");
    setPlateWeight("");
    setGsmLeastCost("");
    setL1("");
    setF1("");
    setL2("");
    setF2("");
    setL3("");
    setF3("");
    setB3("");
    setBackingPaperShade("");
    setPrintingColour1("");
    setPrintingColour2("");
    setLOd("");
    setWOd("");
    setHOd("");
    setFlap("");
    setDeckleSize("");
    setCuttingSize("");
    setItemRate("");
    setArtwork("");
    setSpec("");
    setEditingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !groupId || !uom) return;

    // ERP must be integer if provided
    if (erp && !/^[0-9]+$/.test(erp)) {
      alert("ERP must be a whole number without decimals.");
      return;
    }

    const isDuplicate = items.some(i => 
      i.name.toLowerCase() === name.trim().toLowerCase() && i.id !== editingId
    );

    if (isDuplicate) {
      alert("An item with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = { updatedBy: "System User", updateTimestamp: new Date().toISOString() } as any;
      const erpValue = erp ? parseInt(erp, 10) : undefined;
      
      const itemData: Partial<Item> = {
        name: name.trim(),
        groupId,
        uom,
        erp: erpValue,
        itemType,
        typeName: typeName.trim() || undefined,
        customer: customer.trim() || undefined,
        openLength: parseFloat(openLength) || undefined,
        openWidth: parseFloat(openWidth) || undefined,
        opening: parseFloat(opening) || 0,
        gstRate: parseFloat(gstRate) || 0,
        noOfParts: parseInt(noOfParts) || undefined,
        ups: parseInt(ups) || undefined,
        length: parseFloat(length) || undefined,
        breadth: parseFloat(breadth) || undefined,
        height: parseFloat(height) || undefined,
        ply: parseInt(ply) || undefined,
        flute,
        dieCutUps: parseInt(dieCutUps) || undefined,
        topPaperShade: topPaperShade.trim() || undefined,
        plateWeight: parseFloat(plateWeight) || undefined,
        gsmLeastCost: parseFloat(gsmLeastCost) || undefined,
        l1: parseFloat(l1) || undefined,
        f1: parseFloat(f1) || undefined,
        l2: parseFloat(l2) || undefined,
        f2: parseFloat(f2) || undefined,
        l3: parseFloat(l3) || undefined,
        f3: parseFloat(f3) || undefined,
        b3: parseFloat(b3) || undefined,
        backingPaperShade: backingPaperShade.trim() || undefined,
        printingColour1: printingColour1.trim() || undefined,
        printingColour2: printingColour2.trim() || undefined,
        lOd: parseFloat(lOd) || undefined,
        wOd: parseFloat(wOd) || undefined,
        hOd: parseFloat(hOd) || undefined,
        flap: parseFloat(flap) || undefined,
        deckleSize: parseFloat(deckleSize) || undefined,
        cuttingSize: parseFloat(cuttingSize) || undefined,
        rate: parseFloat(itemRate) || undefined,
        artwork: artwork.trim() || undefined,
        spec: spec.trim() || undefined,
        ...audit
      };

      if (editingId) {
        setItems(items.map(img => img.id === editingId ? { ...img, ...itemData } as Item : img));
      } else {
        setItems([...items, { id: crypto.randomUUID(), ...itemData } as Item]);
      }
      
      resetForm();
      setIsFormOpen(false);
      setIsSubmitting(false);
    }, 500);
  };

  const filteredItems = items
    .filter(i => 
      i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (groups.find(g => g.id === i.groupId)?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const timeA = new Date(a.updateTimestamp || 0).getTime();
      const timeB = new Date(b.updateTimestamp || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Items Master</h2>
        {!isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow">
            <Plus size={18} /> Add New Item
          </button>
        )}
      </div>

      {showQuickGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded border-2 border-black max-w-sm w-full shadow-2xl">
            <h3 className="font-bold text-black uppercase mb-4">Quick Add Group</h3>
            <form onSubmit={handleQuickGroupSubmit} className="space-y-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-xs uppercase">Group Name</label>
                <input 
                  autoFocus
                  type="text" 
                  value={quickGroupName}
                  onChange={(e) => setQuickGroupName(e.target.value)}
                  className="border-2 border-black p-2 rounded focus:outline-none focus:border-indigo-600"
                  placeholder="Enter name..."
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded font-bold border border-black flex-1">Add</button>
                <button type="button" onClick={() => setShowQuickGroup(false)} className="bg-slate-200 text-black px-4 py-2 rounded font-bold border border-black flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isFormOpen ? (
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-4xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">{editingId ? "Edit Item" : "Create Item"}</h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-black text-xs uppercase text-slate-500 border-b border-slate-200 pb-1">Basic Info</h4>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Item Name *</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Item Group *</label>
                  <Select value={groupId} onChange={setGroupId} onAdd={handleCreateNewGroup} options={groupOptions} placeholder="Select Item Group..." required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm">UOM *</label>
                    <Select value={uom} onChange={setUom} options={uomOptions} placeholder="Select UOM..." required />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm">GST Rate (%) *</label>
                    <select 
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                      className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                      required
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="28">28%</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">ERP (whole number)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={erp}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      setErp(v);
                    }}
                    placeholder="Enter ERP"
                    className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Item Type *</label>
                  <Select value={itemType} onChange={(value) => setItemType(value as "FG" | "Reel" | "Others")} options={itemTypeOptions} placeholder="Select Item Type..." required />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Type</label>
                  <CreatableDropdown value={typeName} onChange={setTypeName} options={businessTypeOptions} placeholder="Select or add type..." />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Customer</label>
                  <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormItem label="Open Length" value={openLength} onChange={setOpenLength} type="number" />
                  <FormItem label="Open Width" value={openWidth} onChange={setOpenWidth} type="number" />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-black text-sm">Opening</label>
                  <input
                    type="number"
                    step="0.01"
                    value={opening}
                    onChange={(e) => setOpening(e.target.value)}
                    placeholder="Enter opening balance"
                    className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-black text-xs uppercase text-slate-500 border-b border-slate-200 pb-1">Dimensions & Parts</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormItem label="No. of Parts" value={noOfParts} onChange={setNoOfParts} type="number" numericOnly />
                  <FormItem label="UPS" value={ups} onChange={setUps} type="number" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <FormItem label="Length" value={length} onChange={setLength} type="number" />
                  <FormItem label="Breadth" value={breadth} onChange={setBreadth} type="number" />
                  <FormItem label="Height" value={height} onChange={setHeight} type="number" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm uppercase text-[10px]">PLY</label>
                    <CreatableDropdown value={ply} onChange={setPly} options={plyDropdownOptions} placeholder="Select or add ply..." numericOnly />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm uppercase text-[10px]">Flute</label>
                    <CreatableDropdown value={flute} onChange={setFlute} options={fluteDropdownOptions} placeholder="Select or add flute..." />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormItem label="Die Cut Ups" value={dieCutUps} onChange={setDieCutUps} type="number" />
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-black text-sm uppercase text-[10px]">Top Paper Shade</label>
                    <CreatableDropdown value={topPaperShade} onChange={setTopPaperShade} options={colorOptions} placeholder="Select or add shade..." onCreateOption={ensureColorMasterValue} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormItem label="Plate Wt" value={plateWeight} onChange={setPlateWeight} type="number" step="0.00001" />
                  <FormItem label="GSM (Least Cost)" value={gsmLeastCost} onChange={setGsmLeastCost} type="number" />
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
                <h4 className="font-black text-xs uppercase text-slate-500 border-b border-slate-200 pb-1">Default Paper Layers</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <FormItem label="L1 (Top)" value={l1} onChange={setL1} type="number" />
                    <FormItem label="F1 (Flute)" value={f1} onChange={setF1} type="number" />
                    <FormItem label="L2 (Middle)" value={l2} onChange={setL2} type="number" />
                    <FormItem label="F2 (Flute)" value={f2} onChange={setF2} type="number" />
                    <FormItem label="L3 (Bottom)" value={l3} onChange={setL3} type="number" />
                </div>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
                <h4 className="font-black text-xs uppercase text-slate-500 border-b border-slate-200 pb-1">Extended Specs</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FormItem label="F3" value={f3} onChange={setF3} type="number" />
                    <FormItem label="B3" value={b3} onChange={setB3} type="number" />
                    <div className="flex flex-col space-y-1">
                      <label className="font-bold text-black text-sm uppercase text-[10px]">Backing Paper Shade</label>
                      <CreatableDropdown value={backingPaperShade} onChange={setBackingPaperShade} options={colorOptions} placeholder="Select or add shade..." onCreateOption={ensureColorMasterValue} />
                    </div>
                    <div className="flex flex-col space-y-1">
                      <label className="font-bold text-black text-sm uppercase text-[10px]">Printing Colour 1</label>
                      <CreatableDropdown value={printingColour1} onChange={setPrintingColour1} options={colorOptions} placeholder="Select or add colour..." onCreateOption={ensureColorMasterValue} />
                    </div>
                    <div className="flex flex-col space-y-1">
                      <label className="font-bold text-black text-sm uppercase text-[10px]">Printing Colour 2</label>
                      <CreatableDropdown value={printingColour2} onChange={setPrintingColour2} options={colorOptions} placeholder="Select or add colour..." onCreateOption={ensureColorMasterValue} />
                    </div>
                    <FormItem label="L (OD)" value={lOd} onChange={setLOd} type="number" />
                    <FormItem label="W (OD)" value={wOd} onChange={setWOd} type="number" />
                    <FormItem label="H (OD)" value={hOd} onChange={setHOd} type="number" />
                    <FormItem label="Flap" value={flap} onChange={setFlap} type="number" />
                    <FormItem label="Deckle Size" value={deckleSize} onChange={setDeckleSize} type="number" />
                    <FormItem label="Cutting Size" value={cuttingSize} onChange={setCuttingSize} type="number" />
                    <FormItem label="Rate" value={itemRate} onChange={setItemRate} type="number" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormItem label="Artwork" value={artwork} onChange={setArtwork} />
                    <FormItem label="Spec" value={spec} onChange={setSpec} />
                </div>
            </div>

            <div className="flex space-x-3 pt-4 border-t border-black">
              <button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white px-8 py-2 rounded font-bold border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all min-w-[120px]">
                {isSubmitting ? <Spinner size={20} className="text-white" /> : "Save Item"}
              </button>
              <button type="button" onClick={() => { resetForm(); setIsFormOpen(false); }} className="bg-white text-black border-2 border-black px-8 py-2 rounded font-bold hover:bg-slate-50 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <TableControls searchTerm={searchTerm} onSearchChange={setSearchTerm} placeholder="Search items..." />
          <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {filteredItems.map((item) => (
                    <div key={item.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                        <div className="flex justify-between items-center">
                             <div>
                                <div className="text-xs font-black text-slate-500 uppercase">Item</div>
                                <div className="text-sm font-bold">{item.name}</div>
                             </div>
                             <div className="flex items-center gap-2">
                                 <button onClick={() => { 
                                     setName(item.name); 
                                     setGroupId(item.groupId); 
                                     setUom(item.uom); 
                                     setErp(item.erp?.toString() || ""); 
                                     setItemType(item.itemType || "Others");
                                     setTypeName(item.typeName || "");
                                     setCustomer(item.customer || "");
                                     setOpenLength(item.openLength?.toString() || "");
                                     setOpenWidth(item.openWidth?.toString() || "");
                                     setOpening((item.opening ?? 0).toString());
                                     setGstRate((item.gstRate ?? 18).toString()); 
                                     
                                     setNoOfParts(item.noOfParts?.toString() || "");
                                     setUps(item.ups?.toString() || "");
                                     setLength(item.length?.toString() || "");
                                     setBreadth(item.breadth?.toString() || "");
                                     setHeight(item.height?.toString() || "");
                                     setPly(item.ply?.toString() || "");
                                     setFlute(item.flute || "");
                                     setDieCutUps(item.dieCutUps?.toString() || "");
                                     setTopPaperShade(item.topPaperShade || "");
                                     setPlateWeight(item.plateWeight?.toString() || "");
                                     setGsmLeastCost(item.gsmLeastCost?.toString() || "");
                                     setL1(item.l1?.toString() || "");
                                     setF1(item.f1?.toString() || "");
                                     setL2(item.l2?.toString() || "");
                                     setF2(item.f2?.toString() || "");
                                     setL3(item.l3?.toString() || "");
                                     setF3(item.f3?.toString() || "");
                                     setB3(item.b3?.toString() || "");
                                     setBackingPaperShade(item.backingPaperShade || "");
                                     setPrintingColour1(item.printingColour1 || "");
                                     setPrintingColour2(item.printingColour2 || "");
                                     setLOd(item.lOd?.toString() || "");
                                     setWOd(item.wOd?.toString() || "");
                                     setHOd(item.hOd?.toString() || "");
                                     setFlap(item.flap?.toString() || "");
                                     setDeckleSize(item.deckleSize?.toString() || "");
                                     setCuttingSize(item.cuttingSize?.toString() || "");
                                     setItemRate(item.rate?.toString() || "");
                                     setArtwork(item.artwork || "");
                                     setSpec(item.spec || "");
                                     
                                     setEditingId(item.id); 
                                     setIsFormOpen(true); 
                                 }} className="text-indigo-600 hover:text-indigo-900 font-bold"><Edit size={16} /></button>
                                 <button 
                                      onClick={() => handleDelete(item.id)} 
                                      className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                             </div>
                        </div>
                        <div className="flex gap-4 flex-wrap">
                            <div>
                                <div className="text-xs font-black text-slate-500 uppercase">Group</div>
                                <div className="text-sm">{groups.find(g => g.id === item.groupId)?.name || "Unknown"}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">UOM</div>
                              <div className="text-sm">{item.uom}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">GST</div>
                              <div className="text-sm">{item.gstRate ?? 18}%</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">ERP</div>
                              <div className="text-sm">{item.erp ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Item Type</div>
                              <div className="text-sm">{item.itemType || "Others"}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Type</div>
                              <div className="text-sm">{item.typeName ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Customer</div>
                              <div className="text-sm">{item.customer ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Open L/W</div>
                              <div className="text-sm">{item.openLength ?? ""}{item.openLength ? "/" : ""}{item.openWidth ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Opening</div>
                              <div className="text-sm">{Number(item.opening || 0).toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Receipt</div>
                              <div className="text-sm">{Number(item.receipt || 0).toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Production</div>
                              <div className="text-sm">{Number(item.production || 0).toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Invoiced</div>
                              <div className="text-sm">{Number(item.invoiced || 0).toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Balance</div>
                              <div className="text-sm">{Number(item.balance || 0).toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">No. of Parts</div>
                              <div className="text-sm">{item.noOfParts ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">UPS</div>
                              <div className="text-sm">{item.ups ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">L×B×H</div>
                              <div className="text-sm">{(item.length ?? "")}{item.length ? " × " : ""}{(item.breadth ?? "")}{item.breadth ? " × " : ""}{(item.height ?? "")}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">PLY</div>
                              <div className="text-sm">{item.ply ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Flute</div>
                              <div className="text-sm">{item.flute ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Die Cut Ups</div>
                              <div className="text-sm">{item.dieCutUps ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Top Shade</div>
                              <div className="text-sm">{item.topPaperShade ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Plate Wt</div>
                              <div className="text-sm">{item.plateWeight ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">GSM</div>
                              <div className="text-sm">{item.gsmLeastCost ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">L1/F1/L2/F2/L3</div>
                              <div className="text-sm">{item.l1 ?? ""}{item.l1 ? "/" : ""}{item.f1 ?? ""}{item.f1 ? "/" : ""}{item.l2 ?? ""}{item.l2 ? "/" : ""}{item.f2 ?? ""}{item.f2 ? "/" : ""}{item.l3 ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">F3/B3</div>
                              <div className="text-sm">{item.f3 ?? ""}{item.f3 ? "/" : ""}{item.b3 ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Backing Shade</div>
                              <div className="text-sm">{item.backingPaperShade ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Print Colours</div>
                              <div className="text-sm">{item.printingColour1 ?? ""}{item.printingColour1 ? "/" : ""}{item.printingColour2 ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">L/W/H (OD)</div>
                              <div className="text-sm">{item.lOd ?? ""}{item.lOd ? "/" : ""}{item.wOd ?? ""}{item.wOd ? "/" : ""}{item.hOd ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Flap</div>
                              <div className="text-sm">{item.flap ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Deckle/Cutting</div>
                              <div className="text-sm">{item.deckleSize ?? ""}{item.deckleSize ? "/" : ""}{item.cuttingSize ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Rate</div>
                              <div className="text-sm">{item.rate ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Artwork</div>
                              <div className="text-sm">{item.artwork ?? ""}</div>
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-500 uppercase">Spec</div>
                              <div className="text-sm">{item.spec ?? ""}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="overflow-x-auto">
              <table className="hidden md:table min-w-max divide-y divide-black border-collapse border border-black">
              <thead className="bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Name</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Group</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">UOM</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">GST</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">ERP</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Item Type</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Type</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Customer</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Open Length</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Open Width</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Opening</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Receipt</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Production</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Invoiced</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Balance</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">No. of Parts</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">UPS</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Length</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Breadth</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Height</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">PLY</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Flute</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Die Cut Ups</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Top Paper Shade</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Plate Wt</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">GSM</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">L1</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">F1</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">L2</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">F2</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">L3</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">F3</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">B3</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Backing Paper Shade</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Printing Colour 1</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Printing Colour 2</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">L (OD)</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">W (OD)</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">H (OD)</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Flap</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Deckle Size</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Cutting Size</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Rate</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Artwork</th>
                      <th className="px-4 py-3 text-left text-sm font-bold text-black uppercase border border-black">Spec</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                    </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan={45} className="px-6 py-8 text-center text-black font-medium">No items found.</td></tr>
                    ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors divide-x divide-black">
                      <td className="px-4 py-3 text-sm font-medium text-black border border-black">{item.name}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{groups.find(g => g.id === item.groupId)?.name || "Unknown"}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.uom}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.gstRate ?? 18}%</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.erp ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.itemType || "Others"}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.typeName ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.customer ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.openLength ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.openWidth ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black text-right">{Number(item.opening || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black text-right">{Number(item.receipt || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black text-right">{Number(item.production || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black text-right">{Number(item.invoiced || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black text-right font-medium">{Number(item.balance || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.noOfParts ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.ups ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.length ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.breadth ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.height ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.ply ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.flute ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.dieCutUps ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.topPaperShade ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.plateWeight ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.gsmLeastCost ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.l1 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.f1 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.l2 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.f2 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.l3 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.f3 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.b3 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.backingPaperShade ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.printingColour1 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.printingColour2 ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.lOd ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.wOd ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.hOd ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.flap ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.deckleSize ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.cuttingSize ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.rate ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.artwork ?? ""}</td>
                      <td className="px-4 py-3 text-sm text-black border border-black">{item.spec ?? ""}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                            <button onClick={() => { 
                                setName(item.name); 
                                setGroupId(item.groupId); 
                                setUom(item.uom); 
                                setErp(item.erp?.toString() || ""); 
                                setItemType(item.itemType || "Others");
                                setTypeName(item.typeName || "");
                                setCustomer(item.customer || "");
                                setOpenLength(item.openLength?.toString() || "");
                                setOpenWidth(item.openWidth?.toString() || "");
                                setOpening((item.opening ?? 0).toString());
                                setGstRate((item.gstRate ?? 18).toString()); 
                                
                                setNoOfParts(item.noOfParts?.toString() || "");
                                setUps(item.ups?.toString() || "");
                                setLength(item.length?.toString() || "");
                                setBreadth(item.breadth?.toString() || "");
                                setHeight(item.height?.toString() || "");
                                setPly(item.ply?.toString() || "");
                                setFlute(item.flute || "");
                                setDieCutUps(item.dieCutUps?.toString() || "");
                                setTopPaperShade(item.topPaperShade || "");
                                setPlateWeight(item.plateWeight?.toString() || "");
                                setGsmLeastCost(item.gsmLeastCost?.toString() || "");
                                setL1(item.l1?.toString() || "");
                                setF1(item.f1?.toString() || "");
                                setL2(item.l2?.toString() || "");
                                setF2(item.f2?.toString() || "");
                                setL3(item.l3?.toString() || "");
                                setF3(item.f3?.toString() || "");
                                setB3(item.b3?.toString() || "");
                                setBackingPaperShade(item.backingPaperShade || "");
                                setPrintingColour1(item.printingColour1 || "");
                                setPrintingColour2(item.printingColour2 || "");
                                setLOd(item.lOd?.toString() || "");
                                setWOd(item.wOd?.toString() || "");
                                setHOd(item.hOd?.toString() || "");
                                setFlap(item.flap?.toString() || "");
                                setDeckleSize(item.deckleSize?.toString() || "");
                                setCuttingSize(item.cuttingSize?.toString() || "");
                                setItemRate(item.rate?.toString() || "");
                                setArtwork(item.artwork || "");
                                setSpec(item.spec || "");

                                setEditingId(item.id); 
                                setIsFormOpen(true); 
                            }} className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"><Edit size={16} className="mr-1" /> Edit</button>
                        <button 
                          onClick={() => handleDelete(item.id)} 
                          className={`${deletingId === item.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === item.id ? "Confirm?" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FormItem({ label, value, onChange, type = "text", step = "any", numericOnly = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; step?: string; numericOnly?: boolean }) {
  return (
    <div className="flex flex-col space-y-1">
      <label className="font-bold text-black text-sm uppercase text-[10px]">{label}</label>
      <input 
        type={type} 
        step={type === "number" ? step : undefined}
        value={value} 
        onChange={(e) => {
          const nextValue = numericOnly ? e.target.value.replace(/[^0-9]/g, "") : e.target.value;
          onChange(nextValue);
        }} 
        className="border border-black rounded p-1.5 text-sm text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" 
      />
    </div>
  );
}

function CreatableDropdown({
  value,
  onChange,
  options,
  placeholder,
  numericOnly = false,
  onCreateOption,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  numericOnly?: boolean;
  onCreateOption?: (value: string) => void;
}) {
  const selectedOption = options.find((opt) => opt.value === value) || (value ? { value, label: value } : null);

  return (
    <CreatableSelect
      value={selectedOption}
      onChange={(newValue) => onChange(newValue?.value || "")}
      onCreateOption={(inputValue) => {
        const cleaned = inputValue.trim();
        if (!cleaned) return;
        if (numericOnly && Number.isNaN(Number(cleaned))) return;
        onCreateOption?.(cleaned);
        onChange(cleaned);
      }}
      options={options}
      isClearable
      isSearchable
      placeholder={placeholder}
      formatCreateLabel={(inputValue) => `Add "${inputValue}"`}
      isValidNewOption={(inputValue, _value, selectOptions) => {
        const cleaned = inputValue.trim();
        if (!cleaned) return false;
        if (numericOnly && Number.isNaN(Number(cleaned))) return false;
        return !selectOptions.some((opt: any) => opt.value?.toLowerCase() === cleaned.toLowerCase());
      }}
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      menuPosition="fixed"
      menuPlacement="auto"
      styles={{
        control: (base, state) => ({
          ...base,
          borderWidth: "2px",
          borderColor: state.isFocused ? "#4f46e5" : "#000000",
          boxShadow: state.isFocused ? "0 0 0 1px #4f46e5" : "none",
          "&:hover": {
            borderColor: state.isFocused ? "#4f46e5" : "#000000",
          },
          padding: "2px",
          borderRadius: "0.25rem",
          color: "#000000",
          backgroundColor: "#ffffff",
          minHeight: "42px",
        }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isSelected ? "#4f46e5" : state.isFocused ? "#f0f0ff" : "white",
          color: state.isSelected ? "white" : "black",
          fontSize: "14px",
          fontWeight: state.isSelected ? "700" : "500",
          padding: "10px 12px",
          cursor: "pointer",
        }),
        menu: (base) => ({
          ...base,
          zIndex: 9999,
          border: "2px solid black",
          boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)",
        }),
        menuPortal: (base) => ({
          ...base,
          zIndex: 9999,
        }),
        singleValue: (base) => ({
          ...base,
          color: "#000000",
          fontWeight: "700",
          fontSize: "14px",
        }),
        placeholder: (base) => ({
          ...base,
          color: "#64748b",
          fontSize: "14px",
          fontWeight: "600",
        }),
        input: (base) => ({
          ...base,
          color: "#000000",
        }),
      }}
    />
  );
}
