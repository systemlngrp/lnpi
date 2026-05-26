import React, { useState } from "react";
import { useData } from "../hooks/useData";
import { User } from "../types";
import { Plus, Edit, Trash2, Search } from "lucide-react";
import { Spinner } from "../components/Spinner";

export function Users() {
  const [users, setUsers] = useData<User>("users", []);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    userId: "",
    name: "",
    mobile: "",
    email: "",
    password: "",
  });

  const handleCreateNew = () => {
    setEditingId(null);
    setFormData({ userId: "", name: "", mobile: "", email: "", password: "" });
    setIsFormOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingId(user.id);
    setFormData({
      userId: user.userId,
      name: user.name,
      mobile: user.mobile,
      email: user.email,
      password: user.password || "",
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
    setUsers(users.filter(u => u.id !== id));
    setDeletingId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const isDuplicate = users.some(u => 
      u.userId.toLowerCase() === formData.userId.trim().toLowerCase() && u.id !== editingId
    );

    if (isDuplicate) {
      alert("User ID already exists.");
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const audit = {
        updatedBy: "System Admin",
        updateTimestamp: new Date().toISOString()
      };

      if (editingId) {
        setUsers(users.map(u => u.id === editingId ? { ...u, ...formData, ...audit } : u));
      } else {
        const newUser: User = {
          id: crypto.randomUUID(),
          ...formData,
          ...audit
        };
        setUsers([newUser, ...users]);
      }
      setIsSubmitting(false);
      setIsFormOpen(false);
    }, 500);
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.mobile.includes(searchTerm)
  );

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
        <div className="bg-white p-6 rounded shadow-sm border border-black max-w-xl">
          <h3 className="text-lg font-bold text-black mb-6 uppercase">
            {editingId ? "Edit User" : "Create User"}
          </h3>
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">User ID *</label>
                <input
                  type="text"
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Full Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Mobile *</label>
                <input
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-black text-sm">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                />
              </div>
            </div>

            <div className="flex flex-col space-y-1">
              <label className="font-bold text-black text-sm">Password *</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                className="border-2 border-black rounded p-2 text-black focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
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
                {filteredUsers.sort((a, b) => {
                    const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                    const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                    return timeB - timeA || a.name.localeCompare(b.name);
                }).map((user) => (
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
                                    className={`${deletingId === user.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold`}
                                 >
                                    <Trash2 size={16} />
                                 </button>
                             </div>
                        </div>
                        <div className="text-xs font-black text-slate-500 uppercase">Contact</div>
                        <div className="text-sm">{user.mobile} | {user.email}</div>
                    </div>
                ))}
            </div>

            <table className="hidden md:table min-w-full divide-y divide-black border-collapse border border-black">
              <thead className="bg-slate-100 divide-x divide-black">
                <tr className="divide-x divide-black">
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">User ID</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Mobile</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-black uppercase border border-black">Email</th>
                  <th className="px-6 py-3 text-right text-sm font-bold text-black uppercase border border-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black bg-white">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-black font-medium">No users found.</td>
                  </tr>
                ) : (
                  filteredUsers.sort((a, b) => {
                    const timeA = a.updateTimestamp ? new Date(a.updateTimestamp).getTime() : 0;
                    const timeB = b.updateTimestamp ? new Date(b.updateTimestamp).getTime() : 0;
                    return timeB - timeA || a.name.localeCompare(b.name);
                  }).map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 divide-x divide-black">
                      <td className="px-6 py-4 text-sm font-medium text-black border border-black">{user.userId}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{user.name}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{user.mobile}</td>
                      <td className="px-6 py-4 text-sm text-black border border-black">{user.email}</td>
                      <td className="px-6 py-4 text-right text-sm font-medium border border-black whitespace-nowrap">
                        <button
                          onClick={() => handleEdit(user)}
                          className="text-indigo-600 hover:text-indigo-900 mr-4 font-bold inline-flex items-center"
                        >
                          <Edit size={16} className="mr-1" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className={`${deletingId === user.id ? "text-amber-600 animate-pulse" : "text-red-600"} hover:text-red-900 font-bold inline-flex items-center min-w-[80px] justify-end`}
                        >
                          <Trash2 size={16} className="mr-1" /> {deletingId === user.id ? "Confirm?" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
