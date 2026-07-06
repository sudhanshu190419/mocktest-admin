'use client';

import React, { useState, useEffect } from 'react';
import { adminService } from '@/services/adminService';
import { MOCK_BATCHES } from '@/data/mockData';
import type { AdminFacultySummary, LeaveRequest } from '@/data/mockData';
import { 
  ChalkboardTeacher, 
  CalendarCheck, 
  CheckCircle, 
  XCircle, 
  ShieldCheck, 
  WarningCircle, 
  MagnifyingGlass
} from '@phosphor-icons/react';

export const AdminFacultyView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'roster' | 'leaves'>('roster');
  const [teachers, setTeachers] = useState<AdminFacultySummary[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Allotment modal states
  const [selectedTeacher, setSelectedTeacher] = useState<AdminFacultySummary | null>(null);
  const [showAllotModal, setShowAllotModal] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState('b-101');

  useEffect(() => {
    const loadAdminData = async () => {
      setLoading(true);
      const [tRes, lRes] = await Promise.all([
        adminService.getAllTeachers(),
        adminService.getLeaveRequests()
      ]);
      setTeachers(tRes);
      setLeaves(lRes);
      setLoading(false);
    };
    loadAdminData();
  }, []);

  const handleApproveLeave = async (id: string) => {
    await adminService.updateLeaveStatus(id, 'approved');
    setLeaves(prev => prev.map(l => l.id === id ? { ...l, status: 'approved' } : l));
  };

  const handleRejectLeave = async (id: string) => {
    await adminService.updateLeaveStatus(id, 'rejected');
    setLeaves(prev => prev.map(l => l.id === id ? { ...l, status: 'rejected' } : l));
  };

  const handleVerifyKyc = async (id: string) => {
    await adminService.verifyDocument(id);
    setTeachers(prev => prev.map(t => t.id === id ? { ...t, kycVerified: true } : t));
  };

  const handleAllotCourse = async () => {
    if (!selectedTeacher) return;
    const batch = MOCK_BATCHES.find(b => b.id === selectedBatchId);
    if (!batch) return;

    await adminService.allotBatchToTeacher(
      selectedTeacher.id,
      batch.id,
      batch.name,
      selectedTeacher.profileId || selectedTeacher.id
    );

    setTeachers(prev => prev.map(t => 
      t.id === selectedTeacher.id 
        ? { ...t, batchesCount: t.batchesCount + 1 } 
        : t
    ));

    setShowAllotModal(false);
    setSelectedTeacher(null);
    alert(`Successfully allotted ${batch.name} to ${selectedTeacher.name}!`);
  };

  const filteredTeachers = teachers.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.designation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8 pb-12 animate-fadeIn">
      {/* Top Header & Search Bar */}
      <div className="bezel-outer">
        <div className="bezel-inner !p-6 sm:!p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary-800 bg-primary-100 px-2.5 py-0.5 rounded-full">
                Domain 13 Governance
              </span>
            </div>
            <h3 className="text-2xl font-bold text-text-primary tracking-tight">Faculty Roster & HR Payroll Administration</h3>
            <p className="text-sm text-text-muted mt-1">
              Verify teaching credentials, audit compensation models, and process faculty leave requests.
            </p>
          </div>

          {/* Search Box */}
          <div className="flex items-center w-full md:w-80 bg-slate-50 rounded-2xl px-4 py-3 border border-border focus-within:border-primary-800 focus-within:bg-white transition-all">
            <MagnifyingGlass size={18} className="text-text-muted mr-3 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search faculty or department..."
              className="bg-transparent border-none outline-none text-sm text-text-primary w-full placeholder:text-slate-400 font-sans"
            />
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-4 border-b border-border pb-px">
        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'roster'
              ? 'border-primary-800 text-primary-800'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <ChalkboardTeacher size={20} />
          <span>👨‍🏫 Faculty Roster & Payroll ({teachers.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('leaves')}
          className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-all relative ${
            activeTab === 'leaves'
              ? 'border-primary-800 text-primary-800'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <CalendarCheck size={20} />
          <span>🛡️ HR Leave Approval Queue ({leaves.filter(l => l.status === 'pending').length} Pending)</span>
          {leaves.some(l => l.status === 'pending') && (
            <span className="w-2 h-2 rounded-full bg-error animate-ping" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="py-20 text-center text-text-muted font-mono">Loading Admin Records...</div>
      ) : activeTab === 'roster' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTeachers.map((teacher) => (
            <div key={teacher.id} className="bezel-outer hover:scale-[1.01] transition-all duration-300">
              <div className="bezel-inner !p-6 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3.5">
                      <img src={teacher.avatar} alt={teacher.name} className="w-14 h-14 rounded-2xl object-cover border-2 border-border shadow-sm shrink-0" />
                      <div>
                        <h4 className="font-bold text-base text-text-primary leading-snug">{teacher.name}</h4>
                        <p className="text-xs font-mono text-primary-800">{teacher.designation}</p>
                      </div>
                    </div>
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                      teacher.status === 'Active' ? 'bg-success-light text-success-base' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {teacher.status}
                    </span>
                  </div>

                  <p className="text-xs text-text-muted mb-4 pb-4 border-b border-border">
                    Department: <strong className="text-text-primary">{teacher.department}</strong>
                  </p>

                  <div className="space-y-2.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Assigned Batches:</span>
                      <span className="font-bold text-text-primary">{teacher.batchesCount} Active Batches</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Student Rating:</span>
                      <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{teacher.rating}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Salary Model:</span>
                      <span className="font-bold text-primary-800">{teacher.salaryModel}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-border flex flex-col gap-2">
                  {teacher.kycVerified ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-success-base bg-success-light px-3 py-1.5 rounded-xl w-full justify-center">
                      <ShieldCheck size={16} weight="fill" /> KYC Credentials Verified
                    </span>
                  ) : (
                    <button 
                      onClick={() => handleVerifyKyc(teacher.id)}
                      className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                    >
                      <WarningCircle size={16} weight="fill" /> Verify PAN & Degree KYC &rarr;
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setSelectedTeacher(teacher);
                      setShowAllotModal(true);
                    }}
                    className="w-full py-2.5 rounded-xl bg-primary-800 hover:bg-primary-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>Allot Course / Batch &rarr;</span>
                  </button>
                </div>

              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {leaves.map((leave) => (
            <div key={leave.id} className="bezel-outer">
              <div className="bezel-inner !p-6 sm:!p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-slate-100 text-navy-800">
                      ID: {leave.id}
                    </span>
                    <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${
                      leave.category === 'academic' ? 'bg-primary-100 text-primary-800' :
                      leave.category === 'sick' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {leave.category} leave
                    </span>
                    <span className="text-xs font-mono text-text-muted">Applied: {leave.appliedDate}</span>
                  </div>

                  <h4 className="text-lg font-bold text-text-primary">
                    Duration: {leave.startDate} &rarr; {leave.endDate}
                  </h4>
                  <p className="text-sm text-text-muted italic bg-slate-50 p-3 rounded-xl border border-border/60">
                    "{leave.reason}"
                  </p>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
                  {leave.status === 'pending' ? (
                    <>
                      <button
                        onClick={() => handleRejectLeave(leave.id)}
                        className="flex-1 md:flex-initial px-5 py-3 rounded-2xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                      >
                        <XCircle size={18} weight="fill" /> Reject Leave
                      </button>
                      <button
                        onClick={() => handleApproveLeave(leave.id)}
                        className="flex-1 md:flex-initial px-6 py-3 rounded-2xl bg-success-base hover:bg-emerald-600 text-white font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle size={18} weight="fill" /> Approve Leave
                      </button>
                    </>
                  ) : leave.status === 'approved' ? (
                    <span className="px-5 py-2.5 rounded-2xl bg-success-light text-success-base font-bold text-xs flex items-center gap-1.5">
                      <CheckCircle size={18} weight="fill" /> Approved by HR Director
                    </span>
                  ) : (
                    <span className="px-5 py-2.5 rounded-2xl bg-red-100 text-red-700 font-bold text-xs flex items-center gap-1.5">
                      <XCircle size={18} weight="fill" /> Rejected
                    </span>
                  )}
                </div>

              </div>
            </div>
          ))}
        </div>
      )}
      {/* Course Allotment Modal */}
      {showAllotModal && selectedTeacher && (
        <div className="fixed inset-0 z-50 bg-navy-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-[2.5rem] p-8 shadow-2xl flex flex-col gap-5 animate-fadeIn">
            <div>
              <h3 className="text-xl font-bold text-text-primary tracking-tight">Allot Course / Academic Batch</h3>
              <p className="text-xs text-text-muted mt-1">
                Select an academic batch to allot to <strong className="text-text-primary">{selectedTeacher.name}</strong>. This will notify the teacher and populate their workspace roster.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
                  Available Batches
                </label>
                <select
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-border text-sm font-medium text-text-primary outline-none focus:border-primary-800 focus:bg-white"
                >
                  {MOCK_BATCHES.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setShowAllotModal(false);
                  setSelectedTeacher(null);
                }}
                className="px-5 py-2.5 rounded-full border border-border hover:bg-slate-50 text-text-primary text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAllotCourse}
                className="px-6 py-2.5 rounded-full bg-primary-800 hover:bg-primary-700 text-white text-xs font-bold transition-all shadow-md"
              >
                Confirm Allotment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
