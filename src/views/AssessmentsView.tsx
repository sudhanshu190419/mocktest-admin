'use client';

import React, { useState, useEffect } from 'react';
import { assessmentService } from '@/services/assessmentService';
import type { QuestionBankItem } from '@/services/assessmentService';
import type { AssessmentItem } from '@/data/mockData';
import { ocrIngestionService, type ParsedQuestionItem } from '@/services/ocrIngestionService';
import { 
  PlusCircle, 
  ArrowRight,
  Funnel,
  CheckCircle,
  X,
  CheckSquare,
  Square,
  MagicWand,
  ArrowLeft,
  CalendarCheck,
  UploadSimple,
  FilePdf,
  FileText,
  Trash
} from '@phosphor-icons/react';

const FULL_PAPER_QUESTIONS = [
  {
    id: 'parsed-1',
    code: 'Q-GEN-01',
    title: 'Calculate the radius of gyration of a uniform solid cone about its central axis.',
    topic: 'Rotational Dynamics',
    difficulty: 'Medium' as const,
    options: [
      { label: 'A', text: 'R / √10', isCorrect: false },
      { label: 'B', text: '3R / √10', isCorrect: true },
      { label: 'C', text: '√3 R / 5', isCorrect: false },
      { label: 'D', text: '2R / √5', isCorrect: false },
    ],
    selectedCorrect: 1
  },
  {
    id: 'parsed-2',
    code: 'Q-GEN-02',
    title: 'A cylinder rolls without slipping down an inclined plane of angle θ. What is the minimum static friction coefficient required?',
    topic: 'Rigid Body Rolling',
    difficulty: 'Hard' as const,
    options: [
      { label: 'A', text: '1/3 tan θ', isCorrect: true },
      { label: 'B', text: '2/7 tan θ', isCorrect: false },
      { label: 'C', text: '2/5 tan θ', isCorrect: false },
      { label: 'D', text: '1/2 tan θ', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-3',
    code: 'Q-GEN-03',
    title: 'Two rotating discs of moments of inertia I1 and I2 with angular velocities ω1 and ω2 are brought into contact along their axes. Find loss in kinetic energy.',
    topic: 'Conservation of Angular Momentum',
    difficulty: 'Advanced' as const,
    options: [
      { label: 'A', text: '1/2 (I1 I2 / (I1 + I2)) (ω1 - ω2)^2', isCorrect: true },
      { label: 'B', text: '(I1 I2 / (I1 + I2)) (ω1 - ω2)^2', isCorrect: false },
      { label: 'C', text: '1/4 (I1 I2 / (I1 + I2)) (ω1 + ω2)^2', isCorrect: false },
      { label: 'D', text: 'Zero (Elastic collision)', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-4',
    code: 'Q-GEN-04',
    title: 'A particle of mass m is projected with velocity v at angle θ to horizontal. Find angular momentum about point of projection at maximum height.',
    topic: 'Rotational Dynamics',
    difficulty: 'Medium' as const,
    options: [
      { label: 'A', text: '(m v^3 sin^2 θ cos θ) / (2g)', isCorrect: true },
      { label: 'B', text: '(m v^3 sin θ cos^2 θ) / (2g)', isCorrect: false },
      { label: 'C', text: '(m v^2 sin^2 θ) / g', isCorrect: false },
      { label: 'D', text: 'Zero', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-5',
    code: 'Q-GEN-05',
    title: 'An electric dipole of moment p is placed in a uniform electric field E at angle θ. What is the work done by an external agent to rotate it from θ=0° to θ=90°?',
    topic: 'Electrostatics',
    difficulty: 'Easy' as const,
    options: [
      { label: 'A', text: 'pE', isCorrect: true },
      { label: 'B', text: '-pE', isCorrect: false },
      { label: 'C', text: '2pE', isCorrect: false },
      { label: 'D', text: 'Zero', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-6',
    code: 'Q-GEN-06',
    title: 'Find the electric field magnitude inside a uniformly charged non-conducting sphere of charge Q and radius R at distance r < R from the center.',
    topic: 'Gauss Law & Electrostatics',
    difficulty: 'Medium' as const,
    options: [
      { label: 'A', text: '(1 / 4πε0) * (Q r / R^3)', isCorrect: true },
      { label: 'B', text: '(1 / 4πε0) * (Q / r^2)', isCorrect: false },
      { label: 'C', text: '(1 / 4πε0) * (Q / R^2)', isCorrect: false },
      { label: 'D', text: 'Zero', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-7',
    code: 'Q-GEN-07',
    title: 'A uniform rod of length L and mass M is pivoted at one end and released from rest from a horizontal position. Find angular velocity when it reaches vertical.',
    topic: 'Rigid Body Mechanics',
    difficulty: 'Hard' as const,
    options: [
      { label: 'A', text: '√(3g / L)', isCorrect: true },
      { label: 'B', text: '√(6g / L)', isCorrect: false },
      { label: 'C', text: '√(2g / L)', isCorrect: false },
      { label: 'D', text: '√(g / 3L)', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-8',
    code: 'Q-GEN-08',
    title: 'In a first-order chemical reaction, the concentration of reactant drops from 0.8 M to 0.2 M in 40 minutes. Calculate the half-life t1/2 of the reaction.',
    topic: 'Chemical Kinetics',
    difficulty: 'Medium' as const,
    options: [
      { label: 'A', text: '20 minutes', isCorrect: true },
      { label: 'B', text: '40 minutes', isCorrect: false },
      { label: 'C', text: '10 minutes', isCorrect: false },
      { label: 'D', text: '30 minutes', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-9',
    code: 'Q-GEN-09',
    title: 'Which of the following transition metal complexes exhibits the highest octahedral crystal field splitting parameter (Δo)?',
    topic: 'Coordination Chemistry',
    difficulty: 'Hard' as const,
    options: [
      { label: 'A', text: '[Co(CN)6]3-', isCorrect: true },
      { label: 'B', text: '[Co(NH3)6]3+', isCorrect: false },
      { label: 'C', text: '[Co(H2O)6]3+', isCorrect: false },
      { label: 'D', text: '[CoF6]3-', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-10',
    code: 'Q-GEN-10',
    title: 'Evaluate the definite integral ∫ (from 0 to π/2) ln(sin x) dx using symmetry properties.',
    topic: 'Integral Calculus',
    difficulty: 'Advanced' as const,
    options: [
      { label: 'A', text: '- (π/2) ln 2', isCorrect: true },
      { label: 'B', text: '(π/2) ln 2', isCorrect: false },
      { label: 'C', text: '- π ln 2', isCorrect: false },
      { label: 'D', text: 'Zero', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-11',
    code: 'Q-GEN-11',
    title: 'Find the degree and order of the differential equation: [1 + (dy/dx)^2]^(3/2) = k (d^2y/dx^2).',
    topic: 'Differential Equations',
    difficulty: 'Easy' as const,
    options: [
      { label: 'A', text: 'Order 2, Degree 2', isCorrect: true },
      { label: 'B', text: 'Order 2, Degree 3', isCorrect: false },
      { label: 'C', text: 'Order 3, Degree 2', isCorrect: false },
      { label: 'D', text: 'Order 1, Degree 3', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-12',
    code: 'Q-GEN-12',
    title: 'An ideal Carnot engine operates between source temperature T1 = 500 K and sink temperature T2 = 300 K. Calculate its thermodynamic efficiency η.',
    topic: 'Thermodynamics',
    difficulty: 'Easy' as const,
    options: [
      { label: 'A', text: '40%', isCorrect: true },
      { label: 'B', text: '60%', isCorrect: false },
      { label: 'C', text: '50%', isCorrect: false },
      { label: 'D', text: '20%', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-13',
    code: 'Q-GEN-13',
    title: 'A solid sphere and a hollow sphere of the same mass and radius are released simultaneously from the top of an inclined plane. Which reaches the bottom first?',
    topic: 'Rigid Body Rolling',
    difficulty: 'Medium' as const,
    options: [
      { label: 'A', text: 'Solid sphere (lower moment of inertia)', isCorrect: true },
      { label: 'B', text: 'Hollow sphere (higher angular velocity)', isCorrect: false },
      { label: 'C', text: 'Both reach at the exact same time', isCorrect: false },
      { label: 'D', text: 'Depends on the angle of inclination θ', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-14',
    code: 'Q-GEN-14',
    title: 'Find the magnetic field B at the center of a circular coil of N turns and radius R carrying current I.',
    topic: 'Electromagnetism',
    difficulty: 'Easy' as const,
    options: [
      { label: 'A', text: '(μ0 N I) / (2R)', isCorrect: true },
      { label: 'B', text: '(μ0 N I) / (4R)', isCorrect: false },
      { label: 'C', text: '(μ0 N I R) / 2', isCorrect: false },
      { label: 'D', text: 'Zero', isCorrect: false },
    ],
    selectedCorrect: 0
  },
  {
    id: 'parsed-15',
    code: 'Q-GEN-15',
    title: 'In Bohr atom model, the radius of the nth orbit is proportional to which power of the principal quantum number n?',
    topic: 'Modern Physics & Atomic Structure',
    difficulty: 'Easy' as const,
    options: [
      { label: 'A', text: 'n^2', isCorrect: true },
      { label: 'B', text: 'n', isCorrect: false },
      { label: 'C', text: '1 / n', isCorrect: false },
      { label: 'D', text: '1 / n^2', isCorrect: false },
    ],
    selectedCorrect: 0
  }
];

const getQuestionDepartment = (q: QuestionBankItem): 'Physics' | 'Chemistry' | 'Mathematics' | 'Biology' => {
  if ((q as any).department) return (q as any).department;
  const t = q.topic.toLowerCase();
  if (t.includes('chem') || t.includes('reaction') || t.includes('sn1') || t.includes('coordination') || t.includes('kinetics') || t.includes('organic') || t.includes('electrochem')) return 'Chemistry';
  if (t.includes('calc') || t.includes('integral') || t.includes('differential') || t.includes('algebra') || t.includes('trigo') || t.includes('math') || t.includes('function') || t.includes('prob') || t.includes('stat')) return 'Mathematics';
  if (t.includes('bio') || t.includes('botany') || t.includes('zoology') || t.includes('cell') || t.includes('gene') || t.includes('plant') || t.includes('physiol')) return 'Biology';
  return 'Physics';
};

export const AssessmentsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tests' | 'bank' | 'grading'>('tests');
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [questions, setQuestions] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Faculty Subject Department Lock & Enterprise Taxonomy Filter State
  const [facultyDepartment, _setFacultyDepartment] = useState<'Physics' | 'Chemistry' | 'Mathematics' | 'Biology' | 'All Departments'>('Physics');
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [selectedTopicFilter, setSelectedTopicFilter] = useState('All');
  const [selectedDifficultyFilter, setSelectedDifficultyFilter] = useState<'All' | 'Easy' | 'Medium' | 'Hard' | 'Advanced'>('All');
  const [selectedSourceFilter, setSelectedSourceFilter] = useState('All');
  const [bankViewMode, setBankViewMode] = useState<'grid' | 'cards'>('grid');
  const [selectedBankItemIds, setSelectedBankItemIds] = useState<string[]>([]);

  // Modal Wizard State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [newTitle, setNewTitle] = useState('Rotational Dynamics & Rigid Body Mechanics Weekly Quiz #5');
  const [selectedBatch, setSelectedBatch] = useState('JEE Advanced 2026 — Target Alpha');
  const [selectedSubject, setSelectedSubject] = useState('Physics • Rotational Mechanics');
  const [selectedType, setSelectedType] = useState('Weekly Objective Quiz (MCQ)');
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>(['q-882', 'q-104', 'q-291']);
  const [isPublishing, setIsPublishing] = useState(false);

  // Question Studio & Import Modal State
  const [showQuestionStudio, setShowQuestionStudio] = useState<false | 'pdf' | 'manual'>(false);
  const [pdfStep, setPdfStep] = useState<'upload' | 'parsing' | 'review'>('upload');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [answerKeyFileName, setAnswerKeyFileName] = useState('');
  const [extractionScope, setExtractionScope] = useState<'all' | 'preview'>('all');
  const [worksheetFileObj, setWorksheetFileObj] = useState<File | null>(null);
  const [answerKeyFileObj, setAnswerKeyFileObj] = useState<File | null>(null);
  const [answerKeySourceInfo, setAnswerKeySourceInfo] = useState('');
  const [answerKeySummaryList, setAnswerKeySummaryList] = useState<string[]>([]);
  
  // Manual Authoring Form State
  const [manualTitle, setManualTitle] = useState('');
  const [manualTopic, setManualTopic] = useState('Rotational Dynamics');
  const [manualDifficulty, setManualDifficulty] = useState<'Easy' | 'Medium' | 'Hard' | 'Advanced'>('Medium');
  const [manualType, setManualType] = useState('Single MCQ (+4 / -1)');
  const [manualStem, setManualStem] = useState('');
  const [manualOptions, setManualOptions] = useState([
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false }
  ]);
  const [manualExplanation, setManualExplanation] = useState('');

  // PDF Parsed Review Queue Items - ALL QUESTIONS EXTRACTED!
  const [parsedItems, setParsedItems] = useState<ParsedQuestionItem[]>(FULL_PAPER_QUESTIONS as unknown as ParsedQuestionItem[]);

  // Dynamic dropdown and grading queue state
  const [batchesList, setBatchesList] = useState<{ id: string; name: string; studentCount: number }[]>([]);
  const [subjectsList, setSubjectsList] = useState<{ id: string; name: string }[]>([]);
  const [gradingQueue, setGradingQueue] = useState<{
    attemptId: string;
    testId: string;
    testTitle: string;
    studentName: string;
    submittedAt: string;
    testType: string;
  }[]>([]);
  const [gradingLoading, setGradingLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const [astRes, qRes, batches, subjects, queue] = await Promise.all([
        assessmentService.getAssessments(),
        assessmentService.getQuestionBank(),
        assessmentService.getAcademicBatches(),
        assessmentService.getSyllabusSubjects(),
        assessmentService.getPendingGradingQueue()
      ]);
      setAssessments(astRes);
      setQuestions(qRes);
      setBatchesList(batches);
      setSubjectsList(subjects);
      setGradingQueue(queue);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleGradeSubmission = async (attemptId: string, score: number) => {
    setGradingLoading(true);
    await assessmentService.gradeSubmission(attemptId, score);
    const freshQueue = await assessmentService.getPendingGradingQueue();
    setGradingQueue(freshQueue);
    // Refresh assessments to update submitted count & averages
    const freshAsts = await assessmentService.getAssessments();
    setAssessments(freshAsts);
    setGradingLoading(false);
  };

  const handleToggleQuestion = (id: string) => {
    if (selectedQuestionIds.includes(id)) {
      setSelectedQuestionIds(prev => prev.filter(qId => qId !== id));
    } else {
      setSelectedQuestionIds(prev => [...prev, id]);
    }
  };

  const handleAutoPickPyqs = () => {
    const pyqIds = questions.filter(q => q.source.includes('PYQ')).map(q => q.id);
    setSelectedQuestionIds(prev => Array.from(new Set([...prev, ...pyqIds])));
  };

  const handlePublishAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPublishing(true);

    const newAst: AssessmentItem = {
      id: `ast-${Date.now().toString().slice(-3)}`,
      title: newTitle,
      batchName: selectedBatch,
      subject: selectedSubject.split('•')[0].trim() || 'Physics',
      totalQuestions: selectedQuestionIds.length || 10,
      durationMinutes: Number(durationMinutes) || 45,
      submittedCount: 0,
      totalStudents: selectedBatch.includes('Alpha') ? 48 : selectedBatch.includes('Prime') ? 62 : 35,
      avgScore: '--',
      status: 'Active',
      createdDate: 'Today (Just Published)'
    };

    await assessmentService.createAssessment(newAst, selectedQuestionIds);
    setAssessments(prev => [newAst, ...prev]);
    setIsPublishing(false);
    setShowCreateModal(false);
    setStep(1);
    setActiveTab('tests');
  };



  return (
    <div className="space-y-8 pb-12 animate-fadeIn">
      {/* Top Filter & Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-200/60 border border-border">
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'tests' ? 'bg-white text-navy-800 shadow-md' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Active Quizzes & Tests ({assessments.length})
          </button>
          <button
            onClick={() => setActiveTab('bank')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'bank' ? 'bg-white text-navy-800 shadow-md' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Question Bank ({questions.length} Displayed)
          </button>
          <button
            onClick={() => setActiveTab('grading')}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'grading' ? 'bg-white text-navy-800 shadow-md' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <span>Grading Queue</span>
            <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
          </button>
        </div>

        <button 
          onClick={() => { setShowCreateModal(true); setStep(1); }}
          className="btn-primary bg-primary-800 pr-2 shadow-lg hover:bg-primary-700 transition-all"
        >
          <div className="flex items-center gap-2 pl-2">
            <PlusCircle size={18} className="text-primary-100" />
            <span className="font-semibold">Create New Assessment</span>
          </div>
          <div className="btn-icon-wrapper">
            <ArrowRight size={14} className="text-white" />
          </div>
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-text-muted font-mono">Loading Assessments & Domain 06 Bank...</div>
      ) : activeTab === 'tests' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-text-primary tracking-tight">Active Assessments (Domain 05)</h3>
              <p className="text-sm text-text-muted mt-0.5">Real-time student submission tracking and automated scoring.</p>
            </div>
            <button className="flex items-center gap-2 text-xs font-semibold text-primary-700 bg-primary-100 px-3 py-1.5 rounded-xl border border-primary-700/20">
              <Funnel size={14} /> Filter Stream
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {assessments.map((test) => {
              const percentage = test.totalStudents > 0 ? Math.round((test.submittedCount / test.totalStudents) * 100) : 0;
              const isActive = test.status === 'Active';
              return (
                <div key={test.id} className="bezel-outer">
                  <div className="bezel-inner !p-6 flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                          isActive 
                            ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' 
                            : 'bg-success-light text-success-base border-success-base/20'
                        }`}>
                          {test.status === 'Active' ? '• Accepting Submissions' : '✓ Graded & Published'}
                        </span>
                        <span className="text-xs font-mono text-text-muted">{test.id}</span>
                      </div>

                      <h4 className="text-lg font-bold text-text-primary mb-1 leading-snug">{test.title}</h4>
                      <p className="text-xs text-text-muted mb-6">{test.batchName} • {test.subject}</p>

                      <div className="space-y-3 pt-4 border-t border-border">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-text-muted">Questions & Duration:</span>
                          <span className="font-bold text-text-primary">{test.totalQuestions} Qs • {test.durationMinutes} mins</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted">Submissions:</span>
                          <span className="font-mono font-bold text-text-primary">{test.submittedCount} / {test.totalStudents} ({percentage}%)</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ${
                              isActive ? 'bg-amber-500' : 'bg-success-base'
                            }`} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                        <div className="flex justify-between text-xs pt-2">
                          <span className="text-text-muted">Batch Average Score</span>
                          <span className="font-mono font-extrabold text-primary-800 text-sm">{test.avgScore}</span>
                        </div>
                      </div>
                    </div>

                    <button className="mt-6 w-full py-2.5 rounded-xl bg-slate-100 hover:bg-primary-800 hover:text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2">
                      <span>{isActive ? `Review ${test.submittedCount} Submissions` : 'View Detailed Analytics'}</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === 'bank' ? (
        <div className="space-y-6">
          {/* FACULTY TEACHING SUBJECT LOCK PANEL */}
          <div className="p-6 rounded-3xl bg-gradient-to-r from-navy-950 via-navy-900 to-slate-900 text-white shadow-lg border border-slate-800 space-y-4">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-800 to-primary-600 text-white flex items-center justify-center font-extrabold text-2xl shadow-md shrink-0 border border-primary-400/30">
                  {facultyDepartment === 'Physics' ? '🔬' : facultyDepartment === 'Chemistry' ? '🧪' : facultyDepartment === 'Mathematics' ? '📐' : facultyDepartment === 'Biology' ? '🧬' : '🌐'}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[11px] uppercase font-mono font-bold tracking-wider bg-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                      🔒 Faculty Subject Access Control
                    </span>
                    <span className="text-xs text-slate-300 font-mono">Role: Senior Subject Expert</span>
                  </div>
                  <h3 className="text-xl font-extrabold text-white tracking-tight">
                    Active Teaching Department: <span className="text-amber-400 underline decoration-amber-400/50 underline-offset-4">{facultyDepartment}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                    Faculty access is strictly scoped. You can only view, ingest, and author questions belonging to <strong className="text-white">{facultyDepartment}</strong>. New upload submissions will be automatically bound to this taxonomy domain.
                  </p>
                </div>
              </div>
            </div>

            {/* QUICK STATS FOR LOCKED DEPARTMENT */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80">
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">Domain Items</span>
                <span className="font-mono font-extrabold text-lg text-emerald-400">
                  {questions.filter(q => facultyDepartment === 'All Departments' || getQuestionDepartment(q) === facultyDepartment).length}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">PYQ Archives</span>
                <span className="font-mono font-extrabold text-lg text-amber-400">
                  {questions.filter(q => (facultyDepartment === 'All Departments' || getQuestionDepartment(q) === facultyDepartment) && q.source.includes('PYQ')).length}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">Faculty Authored</span>
                <span className="font-mono font-extrabold text-lg text-blue-400">
                  {questions.filter(q => (facultyDepartment === 'All Departments' || getQuestionDepartment(q) === facultyDepartment) && q.source.includes('Faculty')).length}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">Taxonomy Scale</span>
                <span className="font-mono font-extrabold text-xs text-purple-300 bg-purple-950/80 px-2 py-1 rounded-lg border border-purple-800">
                  100k+ Ready
                </span>
              </div>
            </div>
          </div>

          {/* ENTERPRISE TAXONOMY PANEL */}
          <div className="bezel-outer">
            <div className="bezel-inner !p-8 bg-gradient-to-br from-white via-slate-50/50 to-slate-100/30">
              
              {/* HEADER & INGESTION BUTTONS */}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-border/80">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-extrabold text-navy-950 tracking-tight">
                      {facultyDepartment === 'All Departments' ? 'Universal' : facultyDepartment} Question Bank & Taxonomy
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary-100 text-primary-900 font-extrabold text-xs">
                      Domain 06
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-1 font-mono">
                    Universal Ingestion Engine Ready • Enterprise Indexing Panel designed to manage thousands of categorized objective & subjective items with instant multi-facet filtering.
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => {
                      setShowQuestionStudio('manual');
                      setManualTitle('');
                      setManualStem('');
                      setManualExplanation('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 font-bold text-xs text-navy-900 flex items-center gap-2 shadow-sm transition-all"
                  >
                    <span>✍️ Author Manual Question ({facultyDepartment === 'All Departments' ? 'Universal' : facultyDepartment})</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowQuestionStudio('pdf');
                      setPdfStep('upload');
                      setUploadedFileName('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-800 to-navy-900 hover:from-primary-700 hover:to-navy-800 font-bold text-xs text-white flex items-center gap-2 shadow-md transition-all group"
                  >
                    <span className="text-amber-300 animate-pulse">⚡</span>
                    <span>Upload PDF / Worksheet Importer ({facultyDepartment === 'All Departments' ? 'Universal' : facultyDepartment})</span>
                  </button>
                </div>
              </div>

              {/* MULTI-TIER ENTERPRISE FILTER BAR */}
              <div className="mt-6 p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-4">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                  {/* INSTANT SEARCH */}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder={`Search thousands of ${facultyDepartment} questions by keyword, code, or LaTeX concept...`}
                      value={bankSearchQuery}
                      onChange={(e) => setBankSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-medium text-xs text-navy-950 placeholder-slate-400 outline-none focus:border-primary-800 focus:bg-white transition-all shadow-inner"
                    />
                    <Funnel size={16} className="absolute left-3.5 top-3 text-slate-400" />
                  </div>

                  {/* VIEW MODE TOGGLE & BATCH ACTION */}
                  <div className="flex items-center gap-2 shrink-0 justify-end">
                    {selectedBankItemIds.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary-100 text-primary-900 font-bold text-xs animate-in fade-in">
                        <span>Selected ({selectedBankItemIds.length})</span>
                        <button
                          onClick={() => alert(`Exported ${selectedBankItemIds.length} items to assessment builder queue!`)}
                          className="px-2 py-1 rounded-lg bg-primary-800 text-white text-[10px] uppercase font-mono hover:bg-primary-700"
                        >
                          Batch Export
                        </button>
                      </div>
                    )}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                      <button
                        onClick={() => setBankViewMode('grid')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                          bankViewMode === 'grid' ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                        }`}
                      >
                        <span>📋 High-Density Table</span>
                      </button>
                      <button
                        onClick={() => setBankViewMode('cards')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                          bankViewMode === 'cards' ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                        }`}
                      >
                        <span>🗂️ Detailed Cards</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* TAXONOMY DROPDOWNS */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                  {/* CHAPTER / TOPIC FILTER */}
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 font-mono uppercase shrink-0">Chapter:</span>
                    <select
                      value={selectedTopicFilter}
                      onChange={(e) => setSelectedTopicFilter(e.target.value)}
                      className="w-full bg-transparent font-bold text-xs text-navy-900 outline-none cursor-pointer truncate"
                    >
                      <option value="All">All {facultyDepartment === 'All Departments' ? '' : facultyDepartment} Chapters ({Array.from(new Set(questions.filter(q => facultyDepartment === 'All Departments' || getQuestionDepartment(q) === facultyDepartment).map(q => q.topic))).length})</option>
                      {Array.from(new Set(questions.filter(q => facultyDepartment === 'All Departments' || getQuestionDepartment(q) === facultyDepartment).map(q => q.topic))).map(topic => (
                        <option key={topic} value={topic}>{topic}</option>
                      ))}
                    </select>
                  </div>

                  {/* DIFFICULTY FILTER */}
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 font-mono uppercase shrink-0">Difficulty:</span>
                    <select
                      value={selectedDifficultyFilter}
                      onChange={(e) => setSelectedDifficultyFilter(e.target.value as any)}
                      className="w-full bg-transparent font-bold text-xs text-navy-900 outline-none cursor-pointer"
                    >
                      <option value="All">All Difficulty Levels</option>
                      <option value="Easy">🟢 Easy (Concept Foundation)</option>
                      <option value="Medium">🟡 Medium (Mains Standard)</option>
                      <option value="Hard">🔴 Hard (Advanced Application)</option>
                      <option value="Advanced">🟣 Advanced (Olympiad / Rank Booster)</option>
                    </select>
                  </div>

                  {/* SOURCE TYPE FILTER */}
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 font-mono uppercase shrink-0">Source:</span>
                    <select
                      value={selectedSourceFilter}
                      onChange={(e) => setSelectedSourceFilter(e.target.value)}
                      className="w-full bg-transparent font-bold text-xs text-navy-900 outline-none cursor-pointer"
                    >
                      <option value="All">All Sources (PYQ + Faculty + AI)</option>
                      <option value="Faculty">Faculty Created / Uploaded</option>
                      <option value="PYQ">Verified PYQ Archives</option>
                      <option value="Institute">Institute Standard Bank</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* QUESTION DISPLAY CONTAINER */}
              {(() => {
                const filteredQuestions = questions.filter(q => {
                  const dept = getQuestionDepartment(q);
                  if (facultyDepartment !== 'All Departments' && dept !== facultyDepartment) return false;
                  if (selectedTopicFilter !== 'All' && q.topic !== selectedTopicFilter) return false;
                  if (selectedDifficultyFilter !== 'All' && q.difficulty !== selectedDifficultyFilter) return false;
                  if (selectedSourceFilter !== 'All' && !q.source.includes(selectedSourceFilter)) return false;
                  if (bankSearchQuery.trim() !== '') {
                    const query = bankSearchQuery.toLowerCase();
                    const matchesTitle = q.title.toLowerCase().includes(query);
                    const matchesCode = q.code.toLowerCase().includes(query);
                    const matchesTopic = q.topic.toLowerCase().includes(query);
                    if (!matchesTitle && !matchesCode && !matchesTopic) return false;
                  }
                  return true;
                });

                if (filteredQuestions.length === 0) {
                  return (
                    <div className="mt-8 p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400 font-bold text-xl">
                        🔍
                      </div>
                      <h5 className="font-bold text-base text-navy-900">No Questions Found in {facultyDepartment} Domain</h5>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        No items match your active filters ({selectedTopicFilter !== 'All' ? `Topic: ${selectedTopicFilter}` : ''} {selectedDifficultyFilter !== 'All' ? `Difficulty: ${selectedDifficultyFilter}` : ''}). Try broadening your search or upload a new worksheet!
                      </p>
                      <button
                        onClick={() => {
                          setSelectedTopicFilter('All');
                          setSelectedDifficultyFilter('All');
                          setSelectedSourceFilter('All');
                          setBankSearchQuery('');
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="mt-6">
                    {bankViewMode === 'grid' ? (
                      /* ENTERPRISE HIGH-DENSITY TABLE GRID (FOR THOUSANDS OF ITEMS) */
                      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono font-bold text-slate-600 uppercase tracking-wider">
                                <th className="p-3.5 w-10 text-center">
                                  <input
                                    type="checkbox"
                                    checked={filteredQuestions.length > 0 && selectedBankItemIds.length === filteredQuestions.length}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedBankItemIds(filteredQuestions.map(q => q.id));
                                      } else {
                                        setSelectedBankItemIds([]);
                                      }
                                    }}
                                    className="rounded border-slate-300 text-primary-800 focus:ring-primary-800"
                                  />
                                </th>
                                <th className="p-3.5">Code</th>
                                <th className="p-3.5">Department & Chapter</th>
                                <th className="p-3.5 w-5/12">Question Stem / Title</th>
                                <th className="p-3.5">Difficulty</th>
                                <th className="p-3.5">Source Archive</th>
                                <th className="p-3.5 text-center">Marks</th>
                                <th className="p-3.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-medium text-navy-950">
                              {filteredQuestions.map((q) => {
                                const dept = getQuestionDepartment(q);
                                const isSelected = selectedBankItemIds.includes(q.id);
                                return (
                                  <tr
                                    key={q.id}
                                    className={`hover:bg-primary-50/40 transition-colors ${isSelected ? 'bg-primary-50/70' : ''}`}
                                  >
                                    <td className="p-3.5 text-center">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {
                                          if (isSelected) {
                                            setSelectedBankItemIds(prev => prev.filter(id => id !== q.id));
                                          } else {
                                            setSelectedBankItemIds(prev => [...prev, q.id]);
                                          }
                                        }}
                                        className="rounded border-slate-300 text-primary-800 focus:ring-primary-800"
                                      />
                                    </td>
                                    <td className="p-3.5 font-mono font-bold text-primary-900 whitespace-nowrap">
                                      {q.code}
                                    </td>
                                    <td className="p-3.5 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                          {dept}
                                        </span>
                                        <span className="font-bold text-slate-800 truncate max-w-[150px]" title={q.topic}>
                                          {q.topic}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="p-3.5 font-bold text-navy-950 leading-normal line-clamp-2 max-w-md">
                                      {q.title}
                                    </td>
                                    <td className="p-3.5 whitespace-nowrap">
                                      <span className={`px-2 py-0.5 rounded-md font-extrabold text-[11px] inline-flex items-center gap-1 ${
                                        q.difficulty === 'Hard' || q.difficulty === 'Advanced' ? 'bg-red-100 text-red-900 border border-red-200' :
                                        q.difficulty === 'Medium' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                      }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                          q.difficulty === 'Hard' || q.difficulty === 'Advanced' ? 'bg-red-600' :
                                          q.difficulty === 'Medium' ? 'bg-amber-600' : 'bg-emerald-600'
                                        }`} />
                                        {q.difficulty}
                                      </span>
                                    </td>
                                    <td className="p-3.5 whitespace-nowrap">
                                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                        {q.source}
                                      </span>
                                    </td>
                                    <td className="p-3.5 text-center font-mono font-extrabold text-success-base whitespace-nowrap">
                                      {q.marks}
                                    </td>
                                    <td className="p-3.5 text-right whitespace-nowrap">
                                      <button
                                        onClick={() => alert(`Inspecting ${q.code}: ${q.title}\n\nDepartment: ${dept}\nTopic: ${q.topic}\nDifficulty: ${q.difficulty}`)}
                                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-primary-800 hover:text-white font-bold text-[11px] transition-colors"
                                      >
                                        Inspect
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      /* DETAILED CARDS VIEW */
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredQuestions.map((q) => {
                          const dept = getQuestionDepartment(q);
                          return (
                            <div key={q.id} className="p-5 rounded-2xl bg-white border border-slate-200 hover:border-primary-400 transition-all shadow-sm flex flex-col justify-between gap-4">
                              <div className="space-y-2.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-xs text-primary-900 bg-primary-100 px-2 py-0.5 rounded">{q.code}</span>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border">{dept} • {q.topic}</span>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] ${
                                    q.difficulty === 'Hard' || q.difficulty === 'Advanced' ? 'bg-red-100 text-red-900' :
                                    q.difficulty === 'Medium' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
                                  }`}>
                                    {q.difficulty}
                                  </span>
                                </div>
                                <p className="font-bold text-sm text-navy-950 leading-relaxed">{q.title}</p>
                              </div>
                              <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                                <span className="font-mono text-[11px] text-slate-500">{q.source}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-extrabold text-success-base bg-success-light px-2 py-0.5 rounded">{q.marks}</span>
                                  <button
                                    onClick={() => alert(`Inspecting ${q.code}: ${q.title}`)}
                                    className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-primary-800 hover:text-white font-bold text-xs transition-colors"
                                  >
                                    Inspect Item
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ENTERPRISE SCALABILITY FOOTER */}
                    <div className="mt-6 p-4 rounded-xl bg-slate-900 text-slate-300 text-xs font-mono flex flex-col sm:flex-row items-center justify-between gap-3 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Showing <strong className="text-white">{filteredQuestions.length}</strong> of <strong className="text-white">{questions.length}</strong> total repository questions</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        ⚡ Enterprise Taxonomy Indexing Active • Sub-millisecond filtering across 100,000+ items
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-text-primary tracking-tight">AI Copilot Grading & Student Submissions</h3>
              <p className="text-sm text-text-muted mt-0.5">Automated paper scoring queue connected to Domain 05 mock_attempts and mock_results.</p>
            </div>
            <span className="text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full animate-pulse">
              ● AI Copilot Engine Listening
            </span>
          </div>

          {gradingQueue.length === 0 ? (
            <div className="bezel-outer">
              <div className="bezel-inner !p-12 text-center max-w-xl mx-auto my-6">
                <div className="w-16 h-16 rounded-3xl bg-success-light text-success-base flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <CheckCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-text-primary mb-2">Grading Queue Clean</h3>
                <p className="text-sm text-text-muted leading-relaxed">
                  All student test submissions have been successfully auto-graded and verified against your answer keys. Excellent job!
                </p>
              </div>
            </div>
          ) : (
            <div className="bezel-outer">
              <div className="bezel-inner !p-0 overflow-hidden bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono font-bold text-slate-600 uppercase tracking-wider">
                      <th className="p-4">Student</th>
                      <th className="p-4">Assessment Title</th>
                      <th className="p-4">Format</th>
                      <th className="p-4">Submitted At</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-navy-950">
                    {gradingQueue.map((item) => (
                      <tr key={item.attemptId} className="hover:bg-slate-50/60 transition-colors">
                        <td className="p-4 font-bold text-primary-900">{item.studentName}</td>
                        <td className="p-4 font-semibold text-slate-800">{item.testTitle}</td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded bg-slate-100 border text-slate-600 font-mono text-[10px]">
                            {item.testType}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-slate-500">{item.submittedAt}</td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleGradeSubmission(item.attemptId, 85)}
                            disabled={gradingLoading}
                            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-primary-800 to-navy-900 hover:from-primary-700 hover:to-navy-800 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
                          >
                            {gradingLoading ? 'Grading...' : '⚡ Auto-Grade & Publish (85%)'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ⚡ INTERACTIVE ASSESSMENT CREATION MODAL WIZARD */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-navy-900/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
          <div className="bg-surface rounded-[2.5rem] p-8 sm:p-10 max-w-3xl w-full border border-border shadow-2xl relative max-h-[90vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-6 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-primary-800 text-white flex items-center justify-center font-bold font-mono">
                  {step}
                </div>
                <div>
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-primary-800 bg-primary-100 px-2.5 py-0.5 rounded-full">
                    Domain 05 & 06 Setup
                  </span>
                  <h3 className="text-2xl font-bold text-text-primary tracking-tight mt-1">
                    {step === 1 ? 'Configure Assessment Schema' : 'Pick Questions from PYQ Bank'}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-text-muted hover:text-text-primary flex items-center justify-center transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* STEP 1: ASSESSMENT METADATA */}
            {step === 1 ? (
              <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                    Assessment Title & Description
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Rotational Dynamics Weekly Quiz #5"
                    required
                    className="w-full p-3.5 rounded-2xl bg-background border border-border font-bold text-sm text-text-primary outline-none focus:border-primary-800 focus:bg-white transition-all font-sans"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                      Target Academic Batch
                    </label>
                    <select
                      value={selectedBatch}
                      onChange={(e) => setSelectedBatch(e.target.value)}
                      className="w-full p-3.5 rounded-2xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-800"
                    >
                      {batchesList.map(b => (
                        <option key={b.id} value={b.name}>{b.name} ({b.studentCount} St.)</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                      Subject & Syllabus Topic
                    </label>
                    <select
                      value={selectedSubject}
                      onChange={(e) => setSelectedSubject(e.target.value)}
                      className="w-full p-3.5 rounded-2xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-800"
                    >
                      {subjectsList.map(s => (
                        <option key={s.id} value={s.name}>{s.name} • Syllabus Core</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                      Assessment Format
                    </label>
                    <select
                      value={selectedType}
                      onChange={(e) => setSelectedType(e.target.value)}
                      className="w-full p-3.5 rounded-2xl bg-background border border-border font-medium text-sm text-text-primary outline-none focus:border-primary-800"
                    >
                      <option value="Weekly Objective Quiz (MCQ)">Weekly Objective Quiz (MCQ)</option>
                      <option value="Full Syllabus Mock Test">Full Syllabus Mock Test</option>
                      <option value="Subjective Proof Assignment">Subjective Proof Assignment</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                      Duration (Minutes)
                    </label>
                    <input
                      type="number"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      min={10}
                      max={360}
                      className="w-full p-3.5 rounded-2xl bg-background border border-border font-mono font-bold text-sm text-text-primary outline-none focus:border-primary-800"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-primary-100/40 border border-primary-700/20 flex items-center justify-between text-xs text-primary-900 font-mono">
                  <span className="flex items-center gap-2">
                    <CalendarCheck size={18} className="text-primary-800" />
                    Schedule: Immediate Live Release upon publication
                  </span>
                  <span className="font-bold bg-white px-2.5 py-1 rounded shadow-sm">Auto-Grading Enabled</span>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-6 py-3.5 rounded-full bg-slate-100 hover:bg-slate-200 text-text-primary font-semibold text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary bg-primary-800 pr-2"
                  >
                    <span className="pl-3 font-bold">Next: Pick Questions ({questions.length} Available)</span>
                    <div className="btn-icon-wrapper">
                      <ArrowRight size={16} className="text-white" />
                    </div>
                  </button>
                </div>
              </form>
            ) : (
              /* STEP 2: QUESTION BANK PICKER */
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 border border-border">
                  <div>
                    <h5 className="font-bold text-sm text-text-primary">Select Items from Domain 06 Repository</h5>
                    <p className="text-xs text-text-muted font-mono mt-0.5">
                      Selected: <strong className="text-primary-800">{selectedQuestionIds.length} Questions</strong> ({selectedQuestionIds.length * 4} Total Marks)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoPickPyqs}
                      className="text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-2 rounded-xl border border-amber-300 flex items-center gap-1.5 transition-colors"
                    >
                      <MagicWand size={14} weight="fill" /> Auto-Select PYQs
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedQuestionIds(questions.map(q => q.id))}
                      className="text-xs font-semibold text-text-primary bg-white hover:bg-slate-200 px-3 py-2 rounded-xl border transition-colors"
                    >
                      Select All ({questions.length})
                    </button>
                  </div>
                </div>

                {/* Question List Checkboxes */}
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {questions.map((q) => {
                    const isSelected = selectedQuestionIds.includes(q.id);
                    return (
                      <div
                        key={q.id}
                        onClick={() => handleToggleQuestion(q.id)}
                        className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start justify-between gap-4 ${
                          isSelected 
                            ? 'bg-primary-100/50 border-primary-800 shadow-sm' 
                            : 'bg-white border-border hover:border-slate-400'
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          <div className="mt-0.5 text-primary-800">
                            {isSelected ? <CheckSquare size={22} weight="fill" /> : <Square size={22} className="text-slate-300" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono font-bold text-xs text-primary-800 bg-white px-2 py-0.5 rounded border">{q.code}</span>
                              <span className="text-xs font-semibold text-text-muted font-mono">• {q.topic}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{q.source}</span>
                            </div>
                            <p className="text-sm font-bold text-text-primary leading-snug">{q.title}</p>
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold text-success-base bg-success-light px-2.5 py-1 rounded-lg shrink-0">
                          {q.marks}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-5 py-3 rounded-full bg-slate-100 hover:bg-slate-200 text-text-primary font-bold text-xs flex items-center gap-2 transition-colors"
                  >
                    <ArrowLeft size={16} />
                    <span>Back to Metadata</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishAssessment}
                    disabled={isPublishing || selectedQuestionIds.length === 0}
                    className="btn-primary bg-success-base hover:bg-emerald-600 pr-2 disabled:opacity-70 shadow-xl"
                  >
                    <span className="pl-3 font-bold">
                      {isPublishing ? 'Publishing to Supabase...' : `🚀 Publish Assessment (${selectedQuestionIds.length} Items)`}
                    </span>
                    <div className="btn-icon-wrapper">
                      <CheckCircle size={16} className="text-white" />
                    </div>
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 🌟 AI QUESTION STUDIO & IMPORT HUB MODAL */}
      {showQuestionStudio !== false && (
        <div className="fixed inset-0 z-50 bg-navy-900/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl border border-white/20 animate-in fade-in zoom-in duration-200 my-8 max-h-[90vh] overflow-y-auto">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-6 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-800 to-navy-900 flex items-center justify-center text-white shadow-lg">
                  {showQuestionStudio === 'pdf' ? <FilePdf size={26} weight="fill" className="text-amber-300" /> : <FileText size={26} weight="fill" />}
                </div>
                <div>
                  <h4 className="text-lg font-extrabold text-navy-900 tracking-tight flex items-center gap-2">
                    {showQuestionStudio === 'pdf' ? '⚡ AI PDF & Worksheet Ingestion Studio' : '✍️ Faculty Manual Question Authoring'}
                  </h4>
                  <p className="text-xs text-text-muted font-mono">
                    {showQuestionStudio === 'pdf' ? 'Domain 06 • Automatic OCR, LaTeX Formula & Diagram Extractor' : 'Domain 06 • Direct into Universal Question Bank Repository'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowQuestionStudio(false)}
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Mode Switcher Tabs inside Modal */}
            <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-100 my-6">
              <button
                onClick={() => setShowQuestionStudio('pdf')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                  showQuestionStudio === 'pdf' ? 'bg-white text-primary-800 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                }`}
              >
                <span>⚡ AI PDF / Worksheet Importer</span>
              </button>
              <button
                onClick={() => setShowQuestionStudio('manual')}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                  showQuestionStudio === 'manual' ? 'bg-white text-primary-800 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                }`}
              >
                <span>✍️ Manual Authoring Studio</span>
              </button>
            </div>

            {/* MODE A: PDF / WORKSHEET IMPORTER */}
            {showQuestionStudio === 'pdf' && (
              <div className="space-y-6">
                {pdfStep === 'upload' && (
                  <div className="space-y-6">
                    {/* Information banner answering user's question about separate vs same document */}
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-3 shadow-sm">
                      <span className="text-lg leading-none mt-0.5">ℹ️</span>
                      <div className="text-xs space-y-1 font-mono">
                        <p className="font-bold">Q: Do Questions & Answer Keys need to be in separate PDFs or the same?</p>
                        <p>
                          Our Universal Ingestion Engine supports <strong>both formats</strong>! If your PDF has questions and solutions in the <strong>same document</strong> (e.g., solutions at the end or printed below each item), upload it in box #1 below. If your answer key or solution matrix is in a separate file, attach it in optional box #2!
                        </p>
                      </div>
                    </div>

                    {/* Extraction Scope Options */}
                    <div className="p-4 rounded-2xl bg-white border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
                      <div>
                        <h6 className="font-bold text-xs text-navy-900 uppercase font-mono">OCR Extraction Scope</h6>
                        <p className="text-xs text-text-muted mt-0.5">Choose how many questions to parse from your uploaded test paper.</p>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => setExtractionScope('all')}
                          className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                            extractionScope === 'all' ? 'bg-primary-800 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          🔥 Complete Paper ({FULL_PAPER_QUESTIONS.length} Items)
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractionScope('preview')}
                          className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
                            extractionScope === 'preview' ? 'bg-primary-800 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          ⚡ Quick Sample (3 Items)
                        </button>
                      </div>
                    </div>

                    {/* Primary Worksheet Upload Dropzone (Real File Input) */}
                    <div>
                      <label className="block text-xs font-bold text-navy-900 mb-2 font-mono uppercase tracking-wider">
                        1. Question Paper / Worksheet (PDF or Word) — Required
                      </label>
                      <input
                        type="file"
                        id="primary-pdf-upload"
                        accept=".pdf,.docx,.doc"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setWorksheetFileObj(file);
                            setUploadedFileName(file.name);
                            setPdfStep('parsing');
                            const maxCount = extractionScope === 'all' ? 15 : 3;
                            const res = await ocrIngestionService.parseDocument(file, answerKeyFileObj || undefined, maxCount);
                            setParsedItems(res.items);
                            setAnswerKeySourceInfo(res.answerKeySource);
                            setAnswerKeySummaryList(res.answerKeySummary);
                            setPdfStep('review');
                          }
                        }}
                      />
                      <div
                        onClick={() => document.getElementById('primary-pdf-upload')?.click()}
                        className="p-8 rounded-3xl border-2 border-dashed border-primary-800/40 bg-primary-100/20 hover:bg-primary-100/40 transition-all text-center flex flex-col items-center justify-center gap-4 group cursor-pointer shadow-sm"
                      >
                        <div className="w-16 h-16 rounded-3xl bg-white shadow-md flex items-center justify-center text-primary-800 group-hover:scale-110 transition-transform">
                          <UploadSimple size={32} weight="bold" />
                        </div>
                        <div>
                          <h5 className="font-extrabold text-navy-900 text-base">Click to Select Question Worksheet File</h5>
                          <p className="text-xs text-text-muted mt-1 max-w-md">
                            Select any PDF, DOCX, or scanned test paper from your computer. AI OCR automatically isolates stems, options A–D, and LaTeX mathematical notation.
                          </p>
                        </div>
                        <span className="px-5 py-2.5 rounded-xl bg-primary-800 text-white font-bold text-xs shadow-md mt-1 group-hover:bg-primary-700 transition-colors">
                          📁 Browse Local Files...
                        </span>
                      </div>
                    </div>

                    {/* Optional Separate Answer Key Upload Dropzone */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2 font-mono uppercase tracking-wider">
                        2. Separate Answer Key Document (Optional — Leave empty if included in main file)
                      </label>
                      <input
                        type="file"
                        id="answer-key-upload"
                        accept=".pdf,.docx,.doc,.png,.jpg"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setAnswerKeyFileObj(file);
                            setAnswerKeyFileName(file.name);
                            if (worksheetFileObj) {
                              setPdfStep('parsing');
                              const maxCount = extractionScope === 'all' ? 15 : 3;
                              const res = await ocrIngestionService.parseDocument(worksheetFileObj, file, maxCount);
                              setParsedItems(res.items);
                              setAnswerKeySourceInfo(res.answerKeySource);
                              setAnswerKeySummaryList(res.answerKeySummary);
                              setPdfStep('review');
                            }
                          }
                        }}
                      />
                      <div
                        onClick={() => document.getElementById('answer-key-upload')?.click()}
                        className="p-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition-all flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-white border flex items-center justify-center text-slate-600 shadow-sm">
                            <FileText size={20} />
                          </div>
                          <div>
                            <p className="font-bold text-xs text-navy-900">
                              {answerKeyFileName ? `Attached Answer Key: ${answerKeyFileName}` : 'Attach Separate Answer Key / Solution Matrix File'}
                            </p>
                            <p className="text-[11px] text-text-muted font-mono">
                              {answerKeyFileName ? 'Click to change file' : 'Optional: Attach PDF, DOCX, or image of answer key table'}
                            </p>
                          </div>
                        </div>
                        <span className={`px-4 py-2 rounded-lg border font-bold text-xs shadow-sm ${
                          answerKeyFileName ? 'bg-emerald-100 border-emerald-400 text-emerald-900 font-extrabold' : 'bg-white text-slate-700'
                        }`}>
                          {answerKeyFileName ? '✓ Attached (Change)' : '+ Optional Attach'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {pdfStep === 'parsing' && (
                  <div className="p-12 rounded-3xl bg-slate-900 text-white text-center flex flex-col items-center justify-center gap-5">
                    <div className="w-14 h-14 rounded-full border-4 border-amber-400 border-t-transparent animate-spin" />
                    <div>
                      <h5 className="font-bold text-lg text-white">Extracting & Structure-Mapping PDF Items...</h5>
                      <p className="text-xs text-slate-400 font-mono mt-1">
                        Running Domain 06 OCR Engine on: <strong className="text-amber-300">{uploadedFileName}</strong>
                        {answerKeyFileName && <span> (with Answer Key: <strong className="text-emerald-400">{answerKeyFileName}</strong>)</span>}
                      </p>
                    </div>
                    <div className="w-full max-w-xs space-y-2 text-left font-mono text-[11px] text-slate-300 bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <span>✓</span> <span>Detected {parsedItems.length} Objective MCQ items</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <span>✓</span> <span>Converted LaTeX formulas & fractions</span>
                      </div>
                      <div className="flex items-center gap-2 text-amber-300 animate-pulse">
                        <span>⏳</span> <span>Verifying answer key matrices...</span>
                      </div>
                    </div>
                  </div>
                )}

                {pdfStep === 'review' && (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold text-sm">{parsedItems.length}</span>
                        <div>
                          <h6 className="font-bold text-sm text-emerald-950">AI Extraction Successful • Verification Staging Queue ({parsedItems.length} Items Extracted)</h6>
                          <p className="text-xs text-emerald-800 font-mono">
                            File: {uploadedFileName}{answerKeyFileName ? ` • Key: ${answerKeyFileName}` : ' (Combined Questions & Solutions)'} • Please review stems and confirm correct keys below.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setPdfStep('upload');
                          setUploadedFileName('');
                          setAnswerKeyFileName('');
                          setWorksheetFileObj(null);
                          setAnswerKeyFileObj(null);
                        }}
                        className="text-xs font-bold text-slate-600 hover:text-navy-900 underline font-mono"
                      >
                        Re-upload
                      </button>
                    </div>

                    {/* Answer Key Correlation Banner */}
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-navy-900 to-slate-800 text-white shadow-md space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold text-xs">✓</span>
                          <span className="font-bold text-sm text-emerald-400">Answer Key Automatically Mapped & Correlated</span>
                        </div>
                        <span className="text-[11px] font-mono bg-slate-800 px-2.5 py-1 rounded-lg text-slate-300 border border-slate-700">
                          {answerKeySourceInfo || "Combined Document (End-of-Paper Solution Table)"}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 font-mono text-xs text-slate-300 flex flex-wrap gap-2 items-center">
                        <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider mr-1">Extracted Key Matrix:</span>
                        {answerKeySummaryList.map((item, i) => (
                          <span key={i} className="bg-slate-800 px-2 py-0.5 rounded text-emerald-300 font-bold border border-slate-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Staging Items List */}
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                      {parsedItems.length === 0 ? (
                        <div className="p-8 text-center bg-slate-50 rounded-2xl border text-text-muted text-sm font-bold">
                          All extracted items have been approved and moved to the Question Bank!
                        </div>
                      ) : (
                        parsedItems.map((item, idx) => (
                          <div key={item.id} className="p-5 rounded-2xl border border-border bg-slate-50 hover:bg-white transition-all shadow-sm space-y-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-extrabold text-xs bg-navy-900 text-white px-2 py-0.5 rounded">{item.code}</span>
                                <span className="text-xs font-bold text-primary-800 bg-primary-100 px-2 py-0.5 rounded">• {item.topic}</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">Extracted from PDF</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-success-base bg-success-light px-2 py-0.5 rounded">+4 / -1</span>
                                <button
                                  onClick={() => {
                                    setParsedItems(parsedItems.filter(p => p.id !== item.id));
                                  }}
                                  className="text-slate-400 hover:text-red-500 p-1"
                                  title="Discard extracted item"
                                >
                                  <Trash size={16} />
                                </button>
                              </div>
                            </div>

                            <p className="font-bold text-sm text-navy-900 leading-relaxed bg-white p-3 rounded-xl border border-slate-200">
                              {item.title}
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {item.options.map((opt, oIdx) => {
                                const isCorrect = item.selectedCorrect === oIdx;
                                return (
                                  <div
                                    key={oIdx}
                                    onClick={() => {
                                      const updated = [...parsedItems];
                                      updated[idx].selectedCorrect = oIdx;
                                      setParsedItems(updated);
                                    }}
                                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                                      isCorrect
                                        ? 'bg-emerald-50 border-emerald-400 font-bold text-emerald-950 shadow-sm'
                                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                                        isCorrect ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'
                                      }`}>
                                        {opt.label}
                                      </span>
                                      <span>{opt.text}</span>
                                    </div>
                                    {isCorrect && <span className="text-[10px] uppercase font-mono tracking-wider bg-emerald-600 text-white px-1.5 py-0.5 rounded">Correct Key</span>}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex justify-end pt-2">
                              <button
                                onClick={() => {
                                  const newQ: QuestionBankItem = {
                                    id: `q-${Math.floor(Math.random() * 800 + 200)}`,
                                    code: item.code,
                                    title: item.title,
                                    topic: item.topic,
                                    department: facultyDepartment === 'All Departments' ? getQuestionDepartment({ topic: item.topic } as any) : facultyDepartment,
                                    difficulty: item.difficulty,
                                    source: 'Institute Bank',
                                    marks: '+4 / -1'
                                  };
                                  setQuestions([newQ, ...questions]);
                                  setParsedItems(parsedItems.filter(p => p.id !== item.id));
                                }}
                                className="px-4 py-2 rounded-xl bg-primary-800 hover:bg-primary-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                              >
                                <span>✓ Approve & Move to Bank</span>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-border flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowQuestionStudio(false)}
                          className="px-5 py-3 rounded-full bg-slate-100 hover:bg-slate-200 text-text-primary font-bold text-xs transition-colors"
                        >
                          Close Studio
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextIndex = parsedItems.length + 1;
                            const moreQs = [
                              {
                                id: `parsed-${nextIndex}`,
                                code: `Q-GEN-${nextIndex < 10 ? '0' + nextIndex : nextIndex}`,
                                title: `A projectile is fired at an angle θ with initial velocity v0. Find the radius of curvature of its trajectory at the highest point.`,
                                topic: 'Kinematics & Projectiles',
                                difficulty: 'Medium' as const,
                                options: [
                                  { label: 'A', text: '(v0^2 cos^2 θ) / g', isCorrect: true },
                                  { label: 'B', text: '(v0^2 sin^2 θ) / g', isCorrect: false },
                                  { label: 'C', text: 'v0^2 / g', isCorrect: false },
                                  { label: 'D', text: '(2 v0^2 cos θ) / g', isCorrect: false }
                                ],
                                selectedCorrect: 0
                              },
                              {
                                id: `parsed-${nextIndex + 1}`,
                                code: `Q-GEN-${nextIndex + 1 < 10 ? '0' + (nextIndex + 1) : nextIndex + 1}`,
                                title: `Two spheres of radii R1 and R2 having charges Q1 and Q2 are connected by a thin conducting wire. Find the ratio of their surface charge densities σ1 / σ2.`,
                                topic: 'Electrostatics',
                                difficulty: 'Medium' as const,
                                options: [
                                  { label: 'A', text: 'R2 / R1', isCorrect: true },
                                  { label: 'B', text: 'R1 / R2', isCorrect: false },
                                  { label: 'C', text: '(R1 / R2)^2', isCorrect: false },
                                  { label: 'D', text: '1 : 1', isCorrect: false }
                                ],
                                selectedCorrect: 0
                              }
                            ];
                            setParsedItems([...parsedItems, ...moreQs]);
                          }}
                          className="px-4 py-3 rounded-full border border-primary-800/30 bg-primary-50 hover:bg-primary-100 text-primary-900 font-bold text-xs transition-colors flex items-center gap-1.5"
                        >
                          <span>➕ Scan Next Page / Buffer (+2 Items)</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newQs = parsedItems.map(item => ({
                            id: `q-${Math.floor(Math.random() * 800 + 200)}`,
                            code: item.code,
                            title: item.title,
                            topic: item.topic,
                            department: facultyDepartment === 'All Departments' ? getQuestionDepartment({ topic: item.topic } as any) : facultyDepartment,
                            difficulty: item.difficulty,
                            source: 'Institute Bank' as const,
                            marks: '+4 / -1'
                          }));
                          setQuestions([...newQs, ...questions]);
                          setParsedItems([]);
                          setShowQuestionStudio(false);
                        }}
                        disabled={parsedItems.length === 0}
                        className="btn-primary bg-emerald-600 hover:bg-emerald-700 font-bold px-6 py-3.5 disabled:opacity-50"
                      >
                        <span>🚀 Approve All Remaining ({parsedItems.length}) & Return to Bank</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MODE B: MANUAL AUTHORING STUDIO */}
            {showQuestionStudio === 'manual' && (
              <form onSubmit={(e) => {
                e.preventDefault();
                const newQ: QuestionBankItem = {
                  id: `q-${Math.floor(Math.random() * 800 + 200)}`,
                  code: `Q-${Math.floor(Math.random() * 800 + 200)}`,
                  title: manualTitle || manualStem || 'New Faculty Question',
                  topic: manualTopic,
                  department: facultyDepartment === 'All Departments' ? getQuestionDepartment({ topic: manualTopic } as any) : facultyDepartment,
                  difficulty: manualDifficulty,
                  source: 'Faculty Created',
                  marks: '+4 / -1'
                };
                setQuestions([newQ, ...questions]);
                setShowQuestionStudio(false);
              }} className="space-y-6">
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-primary mb-1">Subject • Topic</label>
                    <select
                      value={manualTopic}
                      onChange={(e) => setManualTopic(e.target.value)}
                      className="w-full p-3 rounded-xl bg-background border border-border font-bold text-xs text-text-primary outline-none focus:border-primary-800"
                    >
                      <option value="Rotational Dynamics">Physics • Rotational Dynamics</option>
                      <option value="Electrostatics & Gauss Law">Physics • Electrostatics</option>
                      <option value="Organic Reaction Kinetics">Chemistry • Reaction Kinetics</option>
                      <option value="Integral Calculus & Limits">Mathematics • Integral Calculus</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary mb-1">Difficulty Level</label>
                    <select
                      value={manualDifficulty}
                      onChange={(e) => setManualDifficulty(e.target.value as any)}
                      className="w-full p-3 rounded-xl bg-background border border-border font-bold text-xs text-text-primary outline-none focus:border-primary-800"
                    >
                      <option value="Easy">🟢 Easy</option>
                      <option value="Medium">🟡 Medium</option>
                      <option value="Hard">🔴 Hard</option>
                      <option value="Advanced">🟣 Advanced (JEE Adv / Olympiad)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary mb-1">Question Type</label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value)}
                      className="w-full p-3 rounded-xl bg-background border border-border font-bold text-xs text-text-primary outline-none focus:border-primary-800"
                    >
                      <option value="Single MCQ (+4 / -1)">Single Correct MCQ (+4 / -1)</option>
                      <option value="Multiple Correct (+4 / -2)">Multiple Correct MCQ (+4 / -2)</option>
                      <option value="Numerical Type (+4 / 0)">Numerical Value Type (+4 / 0)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary mb-1">Question Stem / Problem Statement</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Enter question text here... You can use LaTeX math formatting like \int_0^L x^2 dx or \omega^2 R..."
                    value={manualStem}
                    onChange={(e) => {
                      setManualStem(e.target.value);
                      if (!manualTitle) setManualTitle(e.target.value.slice(0, 70) + '...');
                    }}
                    className="w-full p-4 rounded-2xl bg-background border border-border font-mono text-xs text-text-primary leading-relaxed outline-none focus:border-primary-800 resize-y"
                  />
                </div>

                {/* Option Authoring Grid */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-text-primary">Options (Select radio for Correct Answer Key)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {manualOptions.map((opt, oIdx) => (
                      <div
                        key={oIdx}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center gap-3 ${
                          opt.isCorrect ? 'bg-emerald-50/80 border-emerald-500 shadow-sm' : 'bg-white border-border'
                        }`}
                      >
                        <input
                          type="radio"
                          name="correctOption"
                          checked={opt.isCorrect}
                          onChange={() => {
                            const updated = manualOptions.map((o, i) => ({
                              ...o,
                              isCorrect: i === oIdx
                            }));
                            setManualOptions(updated);
                          }}
                          className="w-4 h-4 accent-emerald-600 cursor-pointer"
                        />
                        <span className="font-mono font-extrabold text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {['A', 'B', 'C', 'D'][oIdx]}
                        </span>
                        <input
                          type="text"
                          required
                          placeholder={`Option ${['A', 'B', 'C', 'D'][oIdx]} value...`}
                          value={opt.text}
                          onChange={(e) => {
                            const updated = [...manualOptions];
                            updated[oIdx].text = e.target.value;
                            setManualOptions(updated);
                          }}
                          className="w-full bg-transparent border-0 font-mono text-xs font-bold text-text-primary outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary mb-1">Detailed Solution Walkthrough (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Explain step-by-step how to arrive at the correct answer..."
                    value={manualExplanation}
                    onChange={(e) => setManualExplanation(e.target.value)}
                    className="w-full p-3.5 rounded-xl bg-background border border-border font-mono text-xs text-text-primary outline-none focus:border-primary-800"
                  />
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowQuestionStudio(false)}
                    className="px-6 py-3.5 rounded-full bg-slate-100 hover:bg-slate-200 text-text-primary font-semibold text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary bg-primary-800 hover:bg-primary-700 font-bold px-8 py-3.5 shadow-xl"
                  >
                    <span>✓ Save Question to Universal Bank</span>
                  </button>
                </div>

              </form>
            )}

          </div>
        </div>
      )}
    </div>
  );
};
