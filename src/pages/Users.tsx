import React, { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../hooks/useData";
import { Setting, User } from "../types";
import { Plus, Edit, Trash2, Search, Eye, EyeOff, Eraser } from "lucide-react";
import { Spinner } from "../components/Spinner";
import { NAVIGATION } from "../components/Sidebar";
import { ClientPagination } from "../components/ClientPagination";
import { useClientPagination } from "../hooks/useClientPagination";

function parseDesignations(setting?: Setting) {
  if (!setting?.designations) return [];
  try {
    const parsed = JSON.parse(setting.designations);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}
type MenuAccessChild = {
  name: string;
  key: string;
};

type MenuAccessParent = {
  section: string;
  children: MenuAccessChild[];
};

type MenuAccessGroup = {
  section: string;
  parents: MenuAccessParent[];
};

type IndeterminateCheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & {
  indeterminate?: boolean;
};

const DIRECT_MENU_SECTION = "Direct";

function IndeterminateCheckbox({ indeterminate = false, checked, ...props }: IndeterminateCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return <input ref={inputRef} type="checkbox" checked={checked} {...props} />;
}
export function Users() {
  const [users, setUsers, usersLoading, userActions] = useData<User>("users", []);
  const [settings] = useData<Setting>("settings", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit" | "view">("create");
  const [showPassword, setShowPassword] = useState(false);
  const isViewMode = modalMode === "view";
  
  const [searchTerm, setSearchTerm] = useState("");
  const designationOptions = useMemo(() => parseDesignations(settings[0]), [settings]);
  const allMenuItems = useMemo<MenuAccessGroup[]>(() => {
    return NAVIGATION.map((group) => {
      const parents: MenuAccessParent[] = [];
      let directParent: MenuAccessParent | null = null;

      group.items.forEach((item) => {
        if ("items" in item) {
          parents.push({
            section: item.section,
            children: item.items.map((child) => ({ name: child.name, key: child.href })),
          });
          return;
        }

        if (!directParent) {
          directParent = { section: DIRECT_MENU_SECTION, children: [] };
          parents.push(directParent);
        }
        directParent.children.push({ name: item.name, key: item.href });
      });

      return { section: group.section, parents };
    });
  }, []);

  const [formData, setFormData] = useState<{
    userId: string;
    name: string;
    mobile: string;
    email: string;
    password: string;
    designation: string;
    role: "Admin" | "Employee" | "Operator";
    status: "Active" | "Inactive";
    menuAccess: string[];
  }>({
    userId: "",
    name: "",
    mobile: "",
    email: "",
    password: "",
    designation: "",
    role: "Employee",
    status: "Active",
    menuAccess: ["/"],
  });

  const handleCreateNew = () => {
    setModalMode("create");
    setEditingId(null);
    setShowPassword(false);
    setFormData({ userId: "", name: "", mobile: "", email: "", password: "", designation: "", role: "Employee", status: "Active", menuAccess: ["/"] });
    setIsFormOpen(true);
  };

  const loadUserForm = (user: User) => {
    setEditingId(user.id);
    setShowPassword(false);
    setFormData({
      userId: user.userId,
      name: user.name,
      mobile: user.mobile,
      email: user.email || "",
      password: "",
      designation: user.designation || "",
      role: user.role || "Employee",
      status: user.status || "Active",
      menuAccess: Array.isArray(user.menuAccess) ? user.menuAccess : ["/"],
    });
    setIsFormOpen(true);
  };

  const handleView = (user: User) => {
    setModalMode("view");
    loadUserForm(user);
  };

  const handleEdit = (user: User) => {
    setModalMode("edit");
    loadUserForm(user);
  };
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    userActions.removeItem(id)
      .then(() => userActions.refresh())
      .catch((error) => {
        console.error("Failed to delete user:", error);
        alert(error instanceof Error ? error.message : "Failed to delete user.");
      })
      .finally(() => setDeletingId(null));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isViewMode) return;

    if (!formData.userId.trim()) {
      alert("User ID is required.");
      return;
    }
    
    const isDuplicate = users.some(u => 
      u.userId.toLowerCase() === formData.userId.trim().toLowerCase() && u.id !== editingId
    );

    if (isDuplicate) {
      alert("User ID already exists.");
      return;
    }

    if (!editingId && !formData.password.trim()) {
      alert("Password is required for new users.");
      return;
    }

    setIsSubmitting(true);
    try {
      const audit = {
        updatedBy: "System Admin",
        updateTimestamp: new Date().toISOString()
      };

      const payload: any = {
        ...formData,
        userId: formData.userId.trim(),
        name: formData.name.trim(),
        mobile: formData.mobile.trim(),
        email: formData.email.trim() || null,
        designation: formData.designation.trim() || null,
        menuAccess: formData.menuAccess,
      };
      if (editingId && !String(payload.password || "").trim()) {
        delete payload.password;
      }

      const nextUser: User = {
        id: editingId || crypto.randomUUID(),
        ...payload,
        ...audit,
      };

      await userActions.saveItem(nextUser);
      await userActions.refresh();
      setIsFormOpen(false);
    } catch (error) {
      console.error("Failed to save user:", error);
      alert(error instanceof Error ? error.message : "Failed to save user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.designation || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.mobile.includes(searchTerm)
  );
  const sortedFilteredUsers = [...filteredUsers].sort((a, b) => {
    const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
    const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
    return timeB - timeA || a.name.localeCompare(b.name);
  });
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalItems,
    paginatedItems: paginatedUsers,
  } = useClientPagination(sortedFilteredUsers, 25);

  const selectedMenuAccess = useMemo(() => new Set(formData.menuAccess), [formData.menuAccess]);

  const getParentKeys = (parent: MenuAccessParent) => parent.children.map((child) => child.key);
  const getGrandParentKeys = (group: MenuAccessGroup) => group.parents.flatMap(getParentKeys);

  const addMenuKeys = (keys: string[]) => {
    setFormData((prev) => ({ ...prev, menuAccess: Array.from(new Set([...prev.menuAccess, ...keys])) }));
  };

  const removeMenuKeys = (keys: string[]) => {
    const remove = new Set(keys);
    setFormData((prev) => ({ ...prev, menuAccess: prev.menuAccess.filter((key) => !remove.has(key)) }));
  };

  const toggleMenuKeys = (keys: string[], checked: boolean) => {
    if (checked) addMenuKeys(keys);
    else removeMenuKeys(keys);
  };

  const areAllSelected = (keys: string[]) => keys.length > 0 && keys.every((key) => selectedMenuAccess.has(key));
  const areSomeSelected = (keys: string[]) => keys.some((key) => selectedMenuAccess.has(key));

  const setAllMenus = () => {
    const keys = allMenuItems.flatMap(getGrandParentKeys);
    setFormData((prev) => ({ ...prev, menuAccess: Array.from(new Set(keys)) }));
  };

  const clearAllMenus = () => {
    setFormData((prev) => ({ ...prev, menuAccess: [] }));
  };

  useEffect(() => {
    if (!isFormOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) setIsFormOpen(false);
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isFormOpen, isSubmitting]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-black">
        <h2 className="text-xl font-bold text-black uppercase tracking-tight">Users Master</h2>
        {!isFormOpen && (
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded font-bold hover:bg-indigo-700 transition shadow"
          >
            <Plus size={18} />
            Add New User
          </button>
        )}
      </div>

      {isFormOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/40 overflow-y-auto"
          onMouseDown={() => {
            if (!isSubmitting) setIsFormOpen(false);
          }}
        >
          <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
            <div
              role="dialog"
              aria-modal="true"
              className="bg-white w-full max-w-4xl rounded-xl shadow-xl border border-black overflow-hidden"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-black">
                <h3 className="text-lg font-bold text-black uppercase">
                  {isViewMode ? "View User" : editingId ? "Edit User" : "Create User"}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSubmitting}
                  className="bg-indigo-600 text-white px-4 py-1.5 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              <div className="p-6 max-h-[calc(100vh-120px)] overflow-y-auto">
                <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">User ID *</label>
                <input
                  type="text"
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  required
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Full Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Mobile *</label>
                <input
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  required
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Designation</label>
                <select
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="">{designationOptions.length === 0 ? "No designations configured" : "Select designation"}</option>
                  {designationOptions.map((designation) => (
                    <option key={designation} value={designation}>
                      {designation}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value as any }))}
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="Admin">Admin</option>
                  <option value="Employee">Employee</option>
                  <option value="Operator">Operator</option>
                </select>
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  disabled={isViewMode}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">{editingId ? "Set/Reset Password" : "Password *"}</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingId && !isViewMode}
                  disabled={isViewMode}
                  className="w-full border-2 border-black rounded p-3 pr-12 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={isViewMode}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-700 hover:text-black disabled:text-slate-400"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="border-2 border-black rounded p-3 bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="font-black text-black text-sm uppercase">Menu Access</div>
                <div className="flex gap-2">
                  <button type="button" onClick={setAllMenus} disabled={isViewMode} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-black hover:bg-indigo-700 disabled:opacity-50">
                    Select All
                  </button>
                  <button type="button" onClick={clearAllMenus} disabled={isViewMode} className="bg-white text-black border border-black px-3 py-1 rounded text-xs font-black hover:bg-slate-100 disabled:opacity-50">
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {allMenuItems.map((group) => {
                  const groupKeys = getGrandParentKeys(group);
                  const groupChecked = areAllSelected(groupKeys);
                  const groupPartial = !groupChecked && areSomeSelected(groupKeys);

                  return (
                    <div key={group.section} className="bg-white border border-black rounded p-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex min-w-0 items-center gap-2 text-xs font-black uppercase text-slate-700">
                          <IndeterminateCheckbox
                            checked={groupChecked}
                            indeterminate={groupPartial}
                            disabled={isViewMode}
                            onChange={(e) => toggleMenuKeys(groupKeys, e.target.checked)}
                          />
                          <span className="truncate">{group.section}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeMenuKeys(groupKeys)}
                          title="Clear"
                          aria-label={`Clear ${group.section}`}
                          disabled={isViewMode}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Eraser size={13} />
                        </button>
                      </div>

                      <div className="mt-2 space-y-2">
                        {group.parents.map((parent) => {
                          const parentKeys = getParentKeys(parent);
                          const parentChecked = areAllSelected(parentKeys);
                          const parentPartial = !parentChecked && areSomeSelected(parentKeys);
                          const isDirectParent = parent.section === DIRECT_MENU_SECTION;
                          const parentLabel = isDirectParent ? "Direct Menu Items" : parent.section;

                          return (
                            <div
                              key={`${group.section}-${parent.section}`}
                              className="rounded border border-slate-300 bg-white p-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <label className="flex min-w-0 items-center gap-2 text-xs font-black text-black">
                                  <IndeterminateCheckbox
                                    checked={parentChecked}
                                    indeterminate={parentPartial}
                                    disabled={isViewMode}
                                    onChange={(e) => toggleMenuKeys(parentKeys, e.target.checked)}
                                  />
                                  <span className="truncate">{parentLabel}</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeMenuKeys(parentKeys)}
                                  title="Clear"
                                  aria-label={`Clear ${parentLabel}`}
                                  disabled={isViewMode}
                                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-black bg-white text-black hover:bg-slate-100 disabled:opacity-50"
                                >
                                  <Eraser size={13} />
                                </button>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {parent.children.map((child) => {
                                  const checked = selectedMenuAccess.has(child.key);
                                  return (
                                    <label key={`${group.section}-${parent.section}-${child.key}`} className="flex min-w-0 items-start gap-2 rounded border border-indigo-300 bg-indigo-100 p-2 text-xs font-bold text-black">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isViewMode}
                                        onChange={(e) => toggleMenuKeys([child.key], e.target.checked)}
                                      />
                                      <span className="min-w-0 break-words leading-tight">{child.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex space-x-3 pt-2">
              {!isViewMode ? (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center justify-center min-w-[120px] bg-indigo-600 text-white px-6 py-2 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50 border border-black shadow"
                >
                  {isSubmitting ? <Spinner size={20} className="text-white" /> : (editingId ? "Update User" : "Create User")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                disabled={isSubmitting}
                className="bg-white text-black border-2 border-black px-6 py-2 rounded font-bold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
            </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 border border-black rounded shadow-sm">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search users..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border-2 border-black rounded focus:outline-none focus:ring-1 focus:ring-indigo-600"
              />
            </div>
          </div>

          <div className="bg-white rounded shadow-sm overflow-hidden border border-black">
            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4 p-2">
                {paginatedUsers.map((user) => (
                    <div key={user.id} className="bg-white border-2 border-black p-4 space-y-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                        <div className="flex justify-between items-center">
                             <div>
                                <div className="text-xs font-black text-slate-500 uppercase">User / Name</div>
                                <div className="text-sm font-bold">{user.userId} / {user.name}</div>
                             </div>
                             <div className="flex items-center gap-2">
                                 <button
                                    onClick={() => handleView(user)}
                                    className="text-slate-700 hover:text-black font-bold"
                                    title="View"
                                 >
                                    <Eye size={16} />
                                 </button>
                                 <button
                                    onClick={() => handleEdit(user)}
                                    className="text-indigo-600 hover:text-indigo-900 font-bold"
                                 >
                                    <Edit size={16} />
                                 </button>
                                  <button
                                     onClick={() => handleDelete(user.id)}
                                     className="text-red-600 hover:text-red-900 font-bold"
                                  >
                                     <Trash2 size={16} />
                                  </button>
                             </div>
                        </div>
                        <div className="text-xs font-black text-slate-500 uppercase">Contact</div>
                        <div className="text-sm">{user.mobile} | {user.email || "-"}</div>
                        <div className="text-xs font-black text-slate-500 uppercase">Designation</div>
                        <div className="text-sm">{user.designation || "-"}</div>
                    </div>
                ))}
            </div>

            <div className="table-sticky-scroll hidden md:block">
              <table className="min-w-max divide-y divide-black border-collapse border border-black">
                <thead className="sticky top-0 z-30 bg-slate-100 divide-x divide-black">
                  <tr className="divide-x divide-black">
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">User ID</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Role</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Designation</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Mobile</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Email</th>
                    <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black bg-white">
                  {usersLoading ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-black">
                        <div className="flex justify-center">
                          <Spinner />
                        </div>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-black font-medium">No users found.</td>
                    </tr>
                  ) : (
                    paginatedUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50 divide-x divide-black">
                        <td className="px-6 py-4 text-sm font-medium text-black border border-black">{user.userId}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.name}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.role || "Employee"}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.status || "Active"}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.designation || "-"}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.mobile}</td>
                        <td className="px-6 py-4 text-sm text-black border border-black">{user.email || "-"}</td>
                        <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                          <button
                            onClick={() => handleView(user)}
                            className="text-slate-700 hover:text-black mr-4 font-bold inline-flex items-center"
                          >
                            <Eye size={16} className="mr-1" /> View
                          </button>
                          <button
                            onClick={() => handleEdit(user)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"
                          >
                            <Edit size={16} className="mr-1" /> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="text-red-600 hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end"
                          >
                            <Trash2 size={16} className="mr-1" /> Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <ClientPagination
              page={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </div>
      )}
    </div>
  );
}
