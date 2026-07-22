import React, { useEffect, useMemo, useState } from "react";
import { useData } from "../hooks/useData";
import { Setting, User } from "../types";
import { Plus, Edit, Trash2, Search, Eye, EyeOff } from "lucide-react";
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

export function Users() {
  const [users, setUsers, usersLoading, userActions] = useData<User>("users", []);
  const [settings] = useData<Setting>("settings", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState("");
  const designationOptions = useMemo(() => parseDesignations(settings[0]), [settings]);
  const allMenuItems = useMemo(() => {
    return NAVIGATION.map((group) => ({
      section: group.section,
      items: group.items.flatMap((item) =>
        "items" in item
          ? item.items.map((child) => ({ name: `${item.section} - ${child.name}`, key: child.href }))
          : [{ name: item.name, key: item.href }]
      ),
    }));
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
    setEditingId(null);
    setShowPassword(false);
    setFormData({ userId: "", name: "", mobile: "", email: "", password: "", designation: "", role: "Employee", status: "Active", menuAccess: ["/"] });
    setIsFormOpen(true);
  };

  const handleEdit = (user: User) => {
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

  const setAllMenus = () => {
    const keys = allMenuItems.flatMap((g) => g.items.map((i) => i.key));
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
                  {editingId ? "Edit User" : "Create User"}
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
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Full Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
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
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Designation</label>
                <select
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
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
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
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
                  className="border-2 border-black rounded p-3 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
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
                  required={!editingId}
                  className="w-full border-2 border-black rounded p-3 pr-12 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-700 hover:text-black"
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
                  <button type="button" onClick={setAllMenus} className="bg-indigo-600 text-white px-3 py-1 rounded text-xs font-black hover:bg-indigo-700">
                    Select All
                  </button>
                  <button type="button" onClick={clearAllMenus} className="bg-white text-black border border-black px-3 py-1 rounded text-xs font-black hover:bg-slate-100">
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-3 max-h-[360px] overflow-auto pr-1">
                  {allMenuItems.map((group) => (
                    <div key={group.section} className="bg-white border border-black rounded p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-black uppercase text-slate-600">{group.section}</div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const keys = group.items.map((i) => i.key);
                              setFormData((prev) => ({ ...prev, menuAccess: Array.from(new Set([...prev.menuAccess, ...keys])) }));
                            }}
                            className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-black hover:bg-indigo-700"
                          >
                            Select
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const remove = new Set(group.items.map((i) => i.key));
                              setFormData((prev) => ({ ...prev, menuAccess: prev.menuAccess.filter((k) => !remove.has(k)) }));
                            }}
                            className="bg-white text-black border border-black px-2 py-0.5 rounded text-[10px] font-black hover:bg-slate-100"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {group.items.map((item) => {
                          const checked = formData.menuAccess.includes(item.key);
                          return (
                            <label key={item.key} className="flex items-center gap-2 text-xs font-bold text-black">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? Array.from(new Set([...formData.menuAccess, item.key]))
                                    : formData.menuAccess.filter((k) => k !== item.key);
                                  setFormData({ ...formData, menuAccess: next });
                                }}
                              />
                              <span>{item.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
                  </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center min-w-[120px] bg-indigo-600 text-white px-6 py-2 rounded font-bold hover:bg-indigo-700 transition disabled:opacity-50 border border-black shadow"
              >
                {isSubmitting ? <Spinner size={20} className="text-white" /> : (editingId ? "Update User" : "Create User")}
              </button>
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
