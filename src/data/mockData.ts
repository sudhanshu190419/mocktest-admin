import type { AdminRoleAssignment } from '@/types/adminRoles';

export interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'teacher' | 'admin' | 'student' | 'user';
  accountStatus: 'pending' | 'approved' | 'rejected' | 'suspended' | 'inactive';
  /**
   * Admin role assignments (Domain 18).
   *
   * Populated ONLY for admins (profiles.role = 'admin') during profile
   * loading in AuthContext. Teachers/students leave this undefined.
   */
  adminRoles?: AdminRoleAssignment[];
  department: string;
  designation: string;
  rating: number;
  needsOnboarding?: boolean;
  totalStudents: number;
  activeBatches: number;
  bio: string;
  avatar: string;
  employment: {
    type: 'full_time' | 'part_time' | 'contract';
    salaryBasis: 'monthly_fixed' | 'hourly_rate' | 'revenue_share';
    baseCompensation: string;
    joinedDate: string;
    contractStatus: 'Active' | 'Under Review';
  };
  bankDetails: {
    accountHolder: string;
    bankName: string;
    accountNumberMasked: string;
    ifscCode: string;
    status: 'verified' | 'pending';
  };
  documents: Array<{
    id: string;
    title: string;
    category: 'identity_proof' | 'address_proof' | 'education_cert' | 'contract';
    uploadDate: string;
    status: 'verified' | 'pending' | 'rejected';
    size: string;
  }>;
  qualifications: Array<{
    id: string;
    degreeName: string;
    institution: string;
    fieldOfStudy: string;
    yearCompleted: number;
    isVerified: boolean;
  }>;
  experiences: Array<{
    id: string;
    role: string;
    institutionName: string;
    startDate: string;
    endDate: string | 'Present';
    subjectTaught: string;
  }>;
  specializations: Array<{
    id: string;
    subjectName: string;
    proficiencyLevel: 1 | 2 | 3 | 4 | 5;
    tags: string[];
  }>;
}

export interface AcademicBatch {
  id: string;
  name: string;
  code: string;
  stream: string;
  studentsCount: number;
  nextClass: string;
  room: string;
  progress: number;
  status: 'In Progress' | 'Upcoming' | 'Completed';
  attendanceRate: string;
}

export interface LiveClassSession {
  id: string;
  title: string;
  batchName: string;
  startTime: string;
  durationMinutes: number;
  status: 'live' | 'upcoming' | 'completed';
  joinedStudents: number;
  totalStudents: number;
  topic: string;
}

export interface AssessmentItem {
  id: string;
  title: string;
  batchName: string;
  subject: string;
  totalQuestions: number;
  durationMinutes: number;
  submittedCount: number;
  totalStudents: number;
  avgScore: string;
  status: 'Draft' | 'Active' | 'Graded';
  createdDate: string;
}

export interface LeaveRequest {
  id: string;
  category: 'casual' | 'sick' | 'unpaid' | 'academic' | 'maternity_paternity';
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedDate: string;
}

export interface TeacherAvailabilitySlot {
  id: string;
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  type: 'Lecture Slot' | 'Office Hours / Doubt Solving';
}

export interface TeacherAnalytics {
  totalStudents: number;
  totalClassesConducted: number;
  totalClassesScheduled: number;
  avgAttendanceRate: string;
  totalContentUploaded: number;
  questionsCreated: number;
  testsCreated: number;
  avgStudentScore: string;
  topChapter: string;
}

export const MOCK_ANALYTICS: TeacherAnalytics = {
  totalStudents: 145,
  totalClassesConducted: 128,
  totalClassesScheduled: 130,
  avgAttendanceRate: '91.5%',
  totalContentUploaded: 42,
  questionsCreated: 142,
  testsCreated: 18,
  avgStudentScore: '73.8%',
  topChapter: 'Rotational Dynamics & Electromagnetism',
};

export const MOCK_AVAILABILITY: TeacherAvailabilitySlot[] = [
  { id: 'avl-1', dayOfWeek: 'Monday', startTime: '09:00 AM', endTime: '01:00 PM', isAvailable: true, type: 'Lecture Slot' },
  { id: 'avl-2', dayOfWeek: 'Monday', startTime: '03:00 PM', endTime: '05:00 PM', isAvailable: true, type: 'Office Hours / Doubt Solving' },
  { id: 'avl-3', dayOfWeek: 'Tuesday', startTime: '10:00 AM', endTime: '02:00 PM', isAvailable: true, type: 'Lecture Slot' },
  { id: 'avl-4', dayOfWeek: 'Wednesday', startTime: '09:00 AM', endTime: '01:00 PM', isAvailable: true, type: 'Lecture Slot' },
  { id: 'avl-5', dayOfWeek: 'Thursday', startTime: '02:00 PM', endTime: '06:00 PM', isAvailable: true, type: 'Lecture Slot' },
  { id: 'avl-6', dayOfWeek: 'Friday', startTime: '11:00 AM', endTime: '03:00 PM', isAvailable: true, type: 'Office Hours / Doubt Solving' },
  { id: 'avl-7', dayOfWeek: 'Saturday', startTime: '10:00 AM', endTime: '01:00 PM', isAvailable: false, type: 'Lecture Slot' },
];

export const MOCK_TEACHER: TeacherProfile = {
  id: 'tch-8492-phy',
  name: 'Dr. Arvind Sharma',
  email: 'arvind.sharma@edtech.org',
  phone: '+91 (982) 341-8920',
  role: 'teacher',
  accountStatus: 'approved',
  department: 'Physics & Applied Mechanics',
  designation: 'Senior Faculty & HOD',
  rating: 4.92,
  totalStudents: 145,
  activeBatches: 3,
  bio: 'Ph.D. in Quantum Mechanics from IIT Delhi. 12+ years mentoring top JEE Advanced and NEET rankers with physics visualizations.',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
  employment: {
    type: 'full_time',
    salaryBasis: 'monthly_fixed',
    baseCompensation: '₹1,45,000 / mo',
    joinedDate: '12 Aug 2022',
    contractStatus: 'Active',
  },
  bankDetails: {
    accountHolder: 'ARVIND SHARMA',
    bankName: 'HDFC Bank Ltd.',
    accountNumberMasked: '•••• •••• 4921',
    ifscCode: 'HDFC0001293',
    status: 'verified',
  },
  documents: [
    { id: 'doc-1', title: 'Aadhaar Card (UIDAI)', category: 'identity_proof', uploadDate: '14 Aug 2022', status: 'verified', size: '2.4 MB' },
    { id: 'doc-2', title: 'PAN Card Verification', category: 'identity_proof', uploadDate: '14 Aug 2022', status: 'verified', size: '1.1 MB' },
    { id: 'doc-3', title: 'Ph.D. Degree Certificate (IITD)', category: 'education_cert', uploadDate: '15 Aug 2022', status: 'verified', size: '4.8 MB' },
    { id: 'doc-4', title: 'Faculty Renewal Agreement 2026', category: 'contract', uploadDate: '01 Jan 2026', status: 'verified', size: '3.2 MB' },
  ],
  qualifications: [
    { id: 'qual-1', degreeName: 'Ph.D. in Quantum Mechanics', institution: 'Indian Institute of Technology (IIT), Delhi', fieldOfStudy: 'Theoretical Physics', yearCompleted: 2014, isVerified: true },
    { id: 'qual-2', degreeName: 'M.Sc. in Physics (Gold Medalist)', institution: "St. Stephen's College, Delhi University", fieldOfStudy: 'Applied Electromagnetism', yearCompleted: 2009, isVerified: true },
    { id: 'qual-3', degreeName: 'B.Sc. (Hons) Physics', institution: 'University of Delhi', fieldOfStudy: 'Physical Sciences', yearCompleted: 2007, isVerified: true },
  ],
  experiences: [
    { id: 'exp-1', role: 'Senior Physics Faculty & HOD', institutionName: 'EdTech Pro Institute (Current)', startDate: 'Aug 2022', endDate: 'Present', subjectTaught: 'JEE Advanced Physics & Mechanics' },
    { id: 'exp-2', role: 'Lead JEE Physics Mentor', institutionName: 'Allen Career Institute, Kota', startDate: 'May 2016', endDate: 'Jul 2022', subjectTaught: 'Electrostatics & Rotational Dynamics' },
    { id: 'exp-3', role: 'Assistant Professor of Physics', institutionName: 'Delhi University', startDate: 'Jul 2014', endDate: 'Apr 2016', subjectTaught: 'Undergraduate Physics' },
  ],
  specializations: [
    { id: 'spec-1', subjectName: 'Rotational Dynamics & Rigid Body Mechanics', proficiencyLevel: 5, tags: ['JEE Advanced', 'Olympiad', 'Level 5 Master'] },
    { id: 'spec-2', subjectName: 'Electrostatics & Capacitance', proficiencyLevel: 5, tags: ['NEET UG', 'JEE Main', 'Level 5 Master'] },
    { id: 'spec-3', subjectName: 'Wave Optics & Thermodynamics', proficiencyLevel: 4, tags: ['Foundation 11-12', 'Level 4 Expert'] },
  ],
};

export const EMPTY_TEACHER: TeacherProfile = {
  id: '',
  name: 'New Faculty',
  email: '',
  phone: '',
  role: 'teacher',
  accountStatus: 'approved',
  department: 'General Science',
  designation: 'Faculty Mentor',
  rating: 5.0,
  totalStudents: 0,
  activeBatches: 0,
  bio: 'Welcome to your teaching dashboard. Update your bio and profile details.',
  avatar: '',
  employment: {
    type: 'full_time',
    salaryBasis: 'monthly_fixed',
    baseCompensation: '--',
    joinedDate: '--',
    contractStatus: 'Active',
  },
  bankDetails: {
    accountHolder: '',
    bankName: '',
    accountNumberMasked: '',
    ifscCode: '',
    status: 'pending',
  },
  documents: [],
  qualifications: [],
  experiences: [],
  specializations: [],
};

export const MOCK_BATCHES: AcademicBatch[] = [
  {
    id: 'b-101',
    name: 'JEE Advanced 2026 — Target Alpha',
    code: 'JEE-ADV-26A',
    stream: 'Engineering (PCM)',
    studentsCount: 48,
    nextClass: 'Today at 2:00 PM',
    room: 'Virtual Studio 01',
    progress: 74,
    status: 'In Progress',
    attendanceRate: '94.2%',
  },
  {
    id: 'b-102',
    name: 'NEET UG 2026 — Aspirant Prime',
    code: 'NEET-UG-26P',
    stream: 'Medical (PCB)',
    studentsCount: 62,
    nextClass: 'Tomorrow at 10:30 AM',
    room: 'Virtual Studio 03',
    progress: 68,
    status: 'In Progress',
    attendanceRate: '91.8%',
  },
  {
    id: 'b-103',
    name: 'Class 11 Foundation — Mechanics & Optics',
    code: 'FND-11-MEC',
    stream: 'Foundation Science',
    studentsCount: 35,
    nextClass: 'Thursday at 4:00 PM',
    room: 'Virtual Studio 02',
    progress: 42,
    status: 'Upcoming',
    attendanceRate: '88.5%',
  },
];

export const MOCK_LIVE_CLASSES: LiveClassSession[] = [
  {
    id: 'lc-901',
    title: 'Rotational Dynamics: Rigid Body Collisions & Angular Momentum',
    batchName: 'JEE Advanced 2026 — Target Alpha',
    startTime: '14:00 (In 35 mins)',
    durationMinutes: 90,
    status: 'upcoming',
    joinedStudents: 0,
    totalStudents: 48,
    topic: 'Physics / Mechanics II',
  },
  {
    id: 'lc-900',
    title: 'Electrostatics: Gauss Law Applications in Cylindrical Symmetry',
    batchName: 'NEET UG 2026 — Aspirant Prime',
    startTime: 'Completed Today 11:30 AM',
    durationMinutes: 75,
    status: 'completed',
    joinedStudents: 59,
    totalStudents: 62,
    topic: 'Physics / Electromagnetism',
  },
];

export const MOCK_ASSESSMENTS: AssessmentItem[] = [
  {
    id: 'ast-401',
    title: 'Rotational Mechanics Weekly Quiz #4',
    batchName: 'JEE Advanced 2026 — Target Alpha',
    subject: 'Physics',
    totalQuestions: 25,
    durationMinutes: 60,
    submittedCount: 44,
    totalStudents: 48,
    avgScore: '68.4%',
    status: 'Active',
    createdDate: '02 Jul 2026',
  },
  {
    id: 'ast-402',
    title: 'Electrostatics & Capacitance Unit Test',
    batchName: 'NEET UG 2026 — Aspirant Prime',
    subject: 'Physics',
    totalQuestions: 45,
    durationMinutes: 90,
    submittedCount: 58,
    totalStudents: 62,
    avgScore: '72.1%',
    status: 'Graded',
    createdDate: '28 Jun 2026',
  },
  {
    id: 'ast-403',
    title: 'Kinematics Foundation Level Test',
    batchName: 'Class 11 Foundation — Mechanics & Optics',
    subject: 'Physics',
    totalQuestions: 30,
    durationMinutes: 45,
    submittedCount: 35,
    totalStudents: 35,
    avgScore: '81.0%',
    status: 'Graded',
    createdDate: '20 Jun 2026',
  },
];

export const MOCK_LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: 'lvr-101',
    category: 'academic',
    startDate: '18 Jul 2026',
    endDate: '19 Jul 2026',
    reason: 'Keynote Speaker at National Symposium on Applied Quantum Education, IISc Bangalore.',
    status: 'pending',
    appliedDate: '03 Jul 2026',
  },
  {
    id: 'lvr-100',
    category: 'casual',
    startDate: '15 Jun 2026',
    endDate: '16 Jun 2026',
    reason: 'Personal family commitments out of station.',
    status: 'approved',
    appliedDate: '10 Jun 2026',
  },
];

export interface StudentRosterItem {
  id: string;
  name: string;
  rollNumber: string;
  avatar: string;
  attendanceRate: string;
  avgScore: string;
  rank: number;
  status: 'Present Live' | 'Watched Recording' | 'Absent';
  strongChapter: string;
  weakChapter: string;
  pendingDoubt?: string;
}

export interface CourseChapterItem {
  id: string;
  title: string;
  order: number;
  status: 'completed' | 'current' | 'upcoming';
  completedDate?: string;
}

export const MOCK_STUDENTS: StudentRosterItem[] = [
  {
    id: 'stu-01',
    name: 'Aarav Singhania',
    rollNumber: 'STU-2026-0041',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=150',
    attendanceRate: '98.2%',
    avgScore: '92.4%',
    rank: 1,
    status: 'Present Live',
    strongChapter: 'Electrostatics & Gauss Law',
    weakChapter: 'Wave Optics & Interference',
  },
  {
    id: 'stu-02',
    name: 'Riya Mukherjee',
    rollNumber: 'STU-2026-0089',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=150',
    attendanceRate: '96.5%',
    avgScore: '89.1%',
    rank: 2,
    status: 'Present Live',
    strongChapter: 'Rotational Dynamics',
    weakChapter: 'Thermodynamics',
    pendingDoubt: 'Sir, in rigid body rolling without slipping, why is work done by friction zero if contact point is instantaneously at rest?',
  },
  {
    id: 'stu-03',
    name: 'Kabir Mehta',
    rollNumber: 'STU-2026-0112',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
    attendanceRate: '91.0%',
    avgScore: '84.6%',
    rank: 3,
    status: 'Watched Recording',
    strongChapter: 'Kinematics & Newton Laws',
    weakChapter: 'Rotational Dynamics',
  },
  {
    id: 'stu-04',
    name: 'Ananya Nair',
    rollNumber: 'STU-2026-0155',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150',
    attendanceRate: '88.4%',
    avgScore: '78.2%',
    rank: 4,
    status: 'Present Live',
    strongChapter: 'Capacitance & Dielectrics',
    weakChapter: 'Rigid Body Collisions',
    pendingDoubt: 'Could you please re-explain the parallel axis theorem derivation for a continuous lamina in tomorrow’s doubt class?',
  },
  {
    id: 'stu-05',
    name: 'Devansh Verma',
    rollNumber: 'STU-2026-0203',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150',
    attendanceRate: '82.5%',
    avgScore: '71.5%',
    rank: 5,
    status: 'Absent',
    strongChapter: 'Vectors & 1D Motion',
    weakChapter: 'Electrostatics & Potential',
  },
];

export const MOCK_CHAPTERS: CourseChapterItem[] = [
  { id: 'ch-01', title: 'Unit 1: Kinematics & Reference Frames', order: 1, status: 'completed', completedDate: '15 May 2026' },
  { id: 'ch-02', title: "Unit 2: Newton's Laws of Motion & Friction", order: 2, status: 'completed', completedDate: '28 May 2026' },
  { id: 'ch-03', title: 'Unit 3: Work, Power, Energy & Conservative Forces', order: 3, status: 'completed', completedDate: '10 Jun 2026' },
  { id: 'ch-04', title: 'Unit 4: Rotational Dynamics & Rigid Body Collisions', order: 4, status: 'current' },
  { id: 'ch-05', title: 'Unit 5: Gravitation & Orbital Mechanics', order: 5, status: 'upcoming' },
  { id: 'ch-06', title: 'Unit 6: Electrostatics, Gauss Law & Dielectric Capacitors', order: 6, status: 'upcoming' },
];

export interface AdminFacultySummary {
  id: string;
  profileId?: string;
  name: string;
  department: string;
  designation: string;
  avatar: string;
  rating: string;
  batchesCount: number;
  salaryModel: string;
  status: 'Active' | 'On Leave' | 'Sabbatical';
  kycVerified: boolean;
}

export const MOCK_ALL_TEACHERS: AdminFacultySummary[] = [
  {
    id: 't-101',
    name: 'Dr. Arvind Sharma',
    department: 'Physics & Applied Mechanics',
    designation: 'Senior Faculty & HOD',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
    rating: '4.92 ★',
    batchesCount: 3,
    salaryModel: '₹1,45,000 / mo (Fixed)',
    status: 'Active',
    kycVerified: true,
  },
  {
    id: 't-102',
    name: 'Dr. Meenakshi Sundaram',
    department: 'Organic & Physical Chemistry',
    designation: 'Principal Mentor (JEE Adv)',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=400',
    rating: '4.88 ★',
    batchesCount: 4,
    salaryModel: '₹1,60,000 / mo (Fixed)',
    status: 'Active',
    kycVerified: true,
  },
  {
    id: 't-103',
    name: 'Prof. Rajeshwar Rao',
    department: 'Pure & Applied Mathematics',
    designation: 'Senior Mathematics Mentor',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400',
    rating: '4.95 ★',
    batchesCount: 3,
    salaryModel: '₹1,50,000 / mo (Fixed)',
    status: 'Active',
    kycVerified: true,
  },
  {
    id: 't-104',
    name: 'Dr. Sneha Kulkarni',
    department: 'Biological Sciences (NEET)',
    designation: 'Zoology & Botany Lead',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=400',
    rating: '4.85 ★',
    batchesCount: 5,
    salaryModel: '₹1,35,000 / mo (Fixed)',
    status: 'On Leave',
    kycVerified: false,
  },
  {
    id: 't-105',
    name: 'Prof. Vikramaditya Rathore',
    department: 'Computer Science & AI',
    designation: 'Olympiad Informatics Lead',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=400',
    rating: '4.90 ★',
    batchesCount: 2,
    salaryModel: '₹2,200 / hr (Hourly)',
    status: 'Active',
    kycVerified: true,
  },
];
