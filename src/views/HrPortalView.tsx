'use client';

import React, { useState, useEffect } from 'react';
import { MOCK_TEACHER, MOCK_LEAVE_REQUESTS, EMPTY_TEACHER } from '@/data/mockData';
import type { LeaveRequest } from '@/data/mockData';
import { 
  Bank, 
  CalendarPlus, 
  CheckCircle, 
  Clock, 
  XCircle,
  DownloadSimple,
  ShieldCheck,
  ArrowRight,
  PlusCircle,
  GraduationCap,
  Medal,
  Briefcase
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { teacherService } from '@/services/teacherService';

export const HrPortalView: React.FC = () => {
  const { teacherProfile, isDemoMode } = useAuth();
  
  // SWR local states initialized with mock data as fallback/initial if in demo mode
  const [leaves, setLeaves] = useState<LeaveRequest[]>(() => isDemoMode ? MOCK_LEAVE_REQUESTS : []);
  const [employment, setEmployment] = useState(() => isDemoMode ? MOCK_TEACHER.employment : EMPTY_TEACHER.employment);
  const [bankDetails, setBankDetails] = useState(() => isDemoMode ? MOCK_TEACHER.bankDetails : EMPTY_TEACHER.bankDetails);
  const [qualifications, setQualifications] = useState(() => isDemoMode ? MOCK_TEACHER.qualifications : EMPTY_TEACHER.qualifications);
  const [experiences, setExperiences] = useState(() => isDemoMode ? MOCK_TEACHER.experiences : EMPTY_TEACHER.experiences);
  const [documents, setDocuments] = useState(() => isDemoMode ? MOCK_TEACHER.documents : EMPTY_TEACHER.documents);
  const [specializations, setSpecializations] = useState(() => isDemoMode ? MOCK_TEACHER.specializations : EMPTY_TEACHER.specializations);

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [newCategory, setNewCategory] = useState<LeaveRequest['category']>('casual');
  const [startDate, setStartDate] = useState('25 Jul 2026');
  const [endDate, setEndDate] = useState('26 Jul 2026');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const fetchHrPortalStats = async () => {
      if (teacherProfile && !isDemoMode) {
        const res = await teacherService.getTeacherHrData(teacherProfile.id);
        if (res) {
          if (res.leaves) setLeaves(res.leaves);
          if (res.employment) setEmployment(res.employment);
          if (res.bankDetails) setBankDetails(res.bankDetails);
          if (res.qualifications) setQualifications(res.qualifications);
          if (res.experiences) setExperiences(res.experiences);
          if (res.documents) setDocuments(res.documents);
          if (res.specializations) setSpecializations(res.specializations);
        }
      }
    };
    fetchHrPortalStats();
  }, [teacherProfile, isDemoMode]);

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;

    if (teacherProfile && !isDemoMode) {
      const res = await teacherService.applyForLeave(
        teacherProfile.id,
        newCategory,
        startDate,
        endDate,
        reason
      );
      if (res) {
        setLeaves(prev => [res, ...prev]);
      }
    } else {
      // Demo fallback
      const newReq: LeaveRequest = {
        id: `lvr-${Date.now().toString().slice(-3)}`,
        category: newCategory,
        startDate,
        endDate,
        reason,
        status: 'pending',
        appliedDate: 'Today',
      };
      setLeaves(prev => [newReq, ...prev]);
    }
    
    setReason('');
    setShowLeaveModal(false);
  };

  const getStatusBadge = (status: LeaveRequest['status']) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success-light text-success-base text-xs font-semibold border border-success-base/20">
            <CheckCircle size={14} /> Approved
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold border border-amber-500/20 animate-pulse">
            <Clock size={14} /> HR Review
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-800 text-xs font-semibold border border-red-500/20">
            <XCircle size={14} /> Rejected
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 pb-12 animate-fadeIn">
      {/* Domain 13 Explainer Header */}
      <div className="bezel-outer bg-gradient-to-r from-navy-800 to-primary-900 text-white p-2">
        <div className="bg-navy-800/80 p-8 rounded-[calc(2.5rem-0.5rem)] border border-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-blue-200 text-xs font-mono tracking-wider uppercase border border-white/15 mb-2">
              <span>Supabase Domain 13 • HR & Business Operations</span>
            </div>
            <h3 className="text-2xl font-bold tracking-tight leading-tight">
              Faculty Employment & Operational Vault
            </h3>
            <p className="text-sm text-blue-100/80 max-w-2xl mt-1 leading-relaxed">
              Strictly confidential records under <code className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-xs text-amber-300">teacher_employment_records</code> and <code className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-xs text-amber-300">teacher_bank_details</code> RLS policies.
            </p>
          </div>
          <button 
            onClick={() => setShowLeaveModal(true)}
            className="btn-primary bg-amber-400 text-slate-900 hover:bg-amber-300 pr-2 shadow-2xl shrink-0"
          >
            <div className="flex items-center gap-2 pl-2">
              <CalendarPlus size={18} className="text-slate-900" />
              <span className="font-bold">Apply For Leave</span>
            </div>
            <div className="btn-icon-wrapper-dark">
              <ArrowRight size={14} />
            </div>
          </button>
        </div>
      </div>

      {/* Grid Section 1: Employment & Bank Details */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Employment & Compensation (Span 7) */}
        <div className="md:col-span-7 bezel-outer">
          <div className="bezel-inner">
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-bold uppercase tracking-wider text-primary-800 bg-primary-100 px-3 py-1 rounded-full">
                  • {employment.type.replace('_', ' ').toUpperCase()} CONTRACT
                </span>
                <span className="text-xs font-mono text-text-muted">Joined: {employment.joinedDate}</span>
              </div>

              <h4 className="text-xl font-bold text-text-primary mb-1">Faculty Compensation Schema</h4>
              <p className="text-xs text-text-muted mb-6">Enforcing <code className="font-mono bg-slate-100 px-1 rounded">salary_basis_type = monthly_fixed</code></p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl bg-slate-50 border border-border mb-6">
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase">Monthly Base Rate</p>
                  <p className="text-2xl font-extrabold text-primary-800 font-mono mt-1">{employment.baseCompensation}</p>
                </div>
                <div>
                  <p className="text-xs text-text-muted font-medium uppercase">Contract Status</p>
                  <p className="text-lg font-bold text-success-base font-sans mt-1 flex items-center gap-1.5">
                    <ShieldCheck size={20} className="text-success-base" />
                    <span>{employment.contractStatus}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-primary-100/50 border border-primary-700/10 flex items-center justify-between text-xs text-primary-900">
              <span>Next Disbursement Cycle: <strong>July 31, 2026</strong></span>
              <span className="font-mono font-bold bg-white px-2.5 py-1 rounded-lg shadow-sm">Automated via Bank</span>
            </div>
          </div>
        </div>

        {/* Bank Details (Span 5) */}
        <div className="md:col-span-5 bezel-outer">
          <div className="bezel-inner">
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-bold uppercase tracking-wider text-success-base bg-success-light px-3 py-1 rounded-full border border-success-base/20">
                  ✓ Bank Verified
                </span>
                <span className="text-xs font-mono text-text-muted">Domain 13 Banking</span>
              </div>

              <h4 className="text-xl font-bold text-text-primary mb-1">Disbursement Account</h4>
              <p className="text-xs text-text-muted mb-6">Direct NEFT/RTGS Transfer Setup</p>

              <div className="space-y-4 p-5 rounded-2xl bg-slate-50 border border-border">
                <div className="flex items-center gap-3 pb-3 border-b border-border/60">
                  <Bank size={24} className="text-primary-800" />
                  <div>
                    <p className="text-[11px] text-text-muted uppercase font-medium">Bank Name</p>
                    <p className="text-sm font-bold text-text-primary">{bankDetails.bankName || 'Not Provided'}</p>
                  </div>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Account Holder</span>
                  <span className="font-mono font-bold text-text-primary">{bankDetails.accountHolder || 'Not Provided'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Account Number</span>
                  <span className="font-mono font-bold text-primary-800">{bankDetails.accountNumberMasked || 'Not Provided'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">IFSC Code</span>
                  <span className="font-mono font-bold text-text-primary">{bankDetails.ifscCode || 'Not Provided'}</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-text-muted text-center mt-4 font-sans">
              To change bank details, submit verification proof to Institute HR.
            </p>
          </div>
        </div>
      </div>

      {/* NEW: Qualifications & Specializations (Domain 13 Alignment) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Qualifications & Degrees (Span 7) */}
        <div className="md:col-span-7 bezel-outer">
          <div className="bezel-inner">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap size={22} className="text-primary-800" />
                <h4 className="text-lg font-bold text-text-primary">Academic Qualifications</h4>
              </div>
              <span className="text-xs font-mono bg-slate-100 px-2.5 py-1 rounded-lg">teacher_qualifications</span>
            </div>
            <div className="space-y-3">
              {qualifications && qualifications.length > 0 ? (
                qualifications.map((q) => (
                  <div key={q.id} className="p-4 rounded-xl bg-slate-50 border border-border flex items-start justify-between gap-4">
                    <div>
                      <p className="font-bold text-sm text-text-primary">{q.degreeName}</p>
                      <p className="text-xs text-text-muted mt-0.5">{q.institution} • {q.fieldOfStudy}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-bold text-primary-800 bg-white px-2 py-0.5 rounded border">{q.yearCompleted}</span>
                      <p className="text-[10px] text-success-base font-semibold mt-1">✓ Verified</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-text-muted text-center py-4 bg-slate-50 border border-border rounded-xl">No qualifications listed.</p>
              )}
            </div>
          </div>
        </div>

        {/* Specializations (Span 5) */}
        <div className="md:col-span-5 bezel-outer">
          <div className="bezel-inner">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Medal size={22} className="text-amber-500" />
                <h4 className="text-lg font-bold text-text-primary">Subject Specializations</h4>
              </div>
              <span className="text-xs font-mono bg-slate-100 px-2.5 py-1 rounded-lg">teacher_specializations</span>
            </div>
            <div className="space-y-3">
              {specializations && specializations.length > 0 ? (
                specializations.map((spec) => (
                  <div key={spec.id} className="p-4 rounded-xl bg-slate-50 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-sm text-text-primary">{spec.subjectName}</p>
                      <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">Level {spec.proficiencyLevel}/5</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {spec.tags.map((t, idx) => (
                        <span key={idx} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-border text-text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-text-muted text-center py-4 bg-slate-50 border border-border rounded-xl">No specializations listed.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* NEW: Teaching Experience Timeline (Domain 13 Alignment) */}
      <div className="bezel-outer">
        <div className="bezel-inner !p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Briefcase size={22} className="text-primary-800" />
              <h4 className="text-xl font-bold text-text-primary tracking-tight">Professional Experience Timeline</h4>
            </div>
            <span className="text-xs font-mono bg-slate-100 px-2.5 py-1 rounded-lg">teacher_experiences schema</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {experiences && experiences.length > 0 ? (
              experiences.map((exp) => (
                <div key={exp.id} className="p-5 rounded-2xl bg-white border border-border shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-primary-100 text-primary-800">
                      {exp.startDate} — {exp.endDate}
                    </span>
                    <h5 className="font-bold text-sm text-text-primary mt-2 mb-1">{exp.role}</h5>
                    <p className="text-xs text-navy-800 font-semibold">{exp.institutionName}</p>
                  </div>
                  <p className="text-xs text-text-muted mt-4 pt-3 border-t border-border/60 font-mono">Taught: {exp.subjectTaught}</p>
                </div>
              ))
            ) : (
              <p className="col-span-3 text-xs text-text-muted text-center py-4 bg-slate-50 border border-border rounded-xl">No experience timeline documented.</p>
            )}
          </div>
        </div>
      </div>

      {/* Grid Section 2: KYC & Document Vault */}
      <div className="bezel-outer">
        <div className="bezel-inner !p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h4 className="text-xl font-bold text-text-primary tracking-tight">Verified KYC & Professional Document Vault</h4>
              <p className="text-sm text-text-muted mt-0.5">
                Stored in <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">teacher_documents</code> with standard KYC workflow states.
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-text-primary font-mono">
              {documents ? documents.length : 0} Documents Archived
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {documents && documents.length > 0 ? (
              documents.map((doc) => (
                <div key={doc.id} className="p-5 rounded-2xl bg-slate-50 border border-border hover:border-primary-700/30 hover:shadow-md transition-all flex flex-col justify-between group">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-white px-2 py-1 rounded border text-text-muted">
                        {doc.category.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-success-base bg-success-light px-2 py-0.5 rounded-full font-semibold">
                        ✓ Verified
                      </span>
                    </div>
                    <h5 className="font-bold text-sm text-text-primary mb-1 group-hover:text-primary-800 transition-colors">
                      {doc.title}
                    </h5>
                    <p className="text-[11px] text-text-muted font-mono">Uploaded: {doc.uploadDate}</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-border/60 flex items-center justify-between">
                    <span className="text-xs font-mono text-text-muted">{doc.size}</span>
                    <button className="text-xs font-semibold text-primary-700 hover:text-primary-900 flex items-center gap-1">
                      <DownloadSimple size={14} /> View
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="col-span-4 text-xs text-text-muted text-center py-4 bg-slate-50 border border-border rounded-xl">No documents uploaded.</p>
            )}
          </div>
        </div>
      </div>

      {/* Grid Section 3: Leave Management Workflow */}
      <div className="bezel-outer">
        <div className="bezel-inner !p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h4 className="text-xl font-bold text-text-primary tracking-tight">Leave Requests & Attendance Log</h4>
              <p className="text-sm text-text-muted mt-0.5">
                Enforcing <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">leave_category_type</code> and approval workflow.
              </p>
            </div>
            <button 
              onClick={() => setShowLeaveModal(true)}
              className="btn-primary bg-primary-800 pr-2 text-xs"
            >
              <div className="flex items-center gap-1.5 pl-2">
                <PlusCircle size={16} />
                <span>Apply For Leave</span>
              </div>
              <div className="btn-icon-wrapper">
                <ArrowRight size={12} className="text-white" />
              </div>
            </button>
          </div>

          <div className="space-y-3">
            {leaves && leaves.length > 0 ? (
              leaves.map((lvr) => (
                <div key={lvr.id} className="p-5 rounded-2xl bg-white border border-border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-navy-800 flex items-center justify-center shrink-0 font-bold uppercase text-xs mt-0.5">
                      {lvr.category.slice(0, 3)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-text-primary uppercase tracking-wide">
                          {lvr.category} Leave
                        </span>
                        <span className="text-xs text-text-muted font-mono">• {lvr.startDate} — {lvr.endDate}</span>
                      </div>
                      <p className="text-xs text-text-muted max-w-xl leading-relaxed">{lvr.reason}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end md:self-center shrink-0">
                    <span className="text-[11px] font-mono text-text-muted">Applied: {lvr.appliedDate}</span>
                    {getStatusBadge(lvr.status)}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-text-muted text-center py-4 bg-white border border-border rounded-xl">No leave requests filed.</p>
            )}
          </div>
        </div>
      </div>

      {/* Leave Application Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-navy-800/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface rounded-[2.5rem] p-8 max-w-lg w-full border border-border shadow-2xl relative">
            <h3 className="text-2xl font-bold text-text-primary mb-1">Apply for Faculty Leave</h3>
            <p className="text-xs text-text-muted mb-6">Submitting to <code className="font-mono">teacher_leave_requests</code> schema for HOD approval.</p>

            <form onSubmit={handleApplyLeave} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Leave Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full p-3 rounded-xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-700"
                >
                  <option value="casual">Casual Leave (Paid Balance)</option>
                  <option value="sick">Sick / Medical Leave</option>
                  <option value="academic">Academic Conference / Symposium</option>
                  <option value="unpaid">Unpaid Leave</option>
                  <option value="maternity_paternity">Maternity / Paternity Leave</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Start Date</label>
                  <input
                    type="text"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full p-3 rounded-xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">End Date</label>
                  <input
                    type="text"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full p-3 rounded-xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Reason / Academic Justification</label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Provide detailed justification or event name..."
                  className="w-full p-3 rounded-xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-700"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-6 py-3 rounded-full bg-slate-100 hover:bg-slate-200 text-text-primary font-semibold text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary bg-primary-800 pr-2"
                >
                  <span className="pl-2 font-semibold">Submit Request</span>
                  <div className="btn-icon-wrapper">
                    <ArrowRight size={14} className="text-white" />
                  </div>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
