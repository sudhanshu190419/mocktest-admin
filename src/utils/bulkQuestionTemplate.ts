/**
 * Bulk Question Import — Template Generator
 *
 * Generates official XLSX and CSV templates for question bank bulk upload.
 * Includes realistic sample rows covering all supported question types (MCQ,
 * MSQ, True/False, Numerical) and an active reference data sheet in XLSX.
 *
 * @module utils/bulkQuestionTemplate
 */

import {
  BULK_QUESTION_HEADERS,
  BULK_QUESTION_TEMPLATE_VERSION,
} from '@/types/bulkQuestionImport';
import type { QuestionReferenceData } from '@/types/bulkQuestionImport';
import { downloadCsv } from '@/utils/csv';

/**
 * Realistic example rows demonstrating each supported question type.
 */
const EXAMPLE_ROWS: (string | number | null)[][] = [
  // 1. Single-choice MCQ
  [
    'What is the SI unit of electric current?',
    'MCQ',
    'PHY',
    'Current Electricity',
    'Electric Current',
    'Easy',
    4,
    1,
    'Volt',
    'Ampere',
    'Ohm',
    'Watt',
    'B',
    null,
    null,
    'The SI unit of electric current is the Ampere (A).',
  ],
  // 2. Multiple-choice MSQ (Multiple Correct)
  [
    'Which of the following are noble gases?',
    'MSQ',
    'CHE',
    'Periodic Table',
    'Noble Gases',
    'Medium',
    4,
    1,
    'Helium',
    'Oxygen',
    'Argon',
    'Nitrogen',
    'A, C',
    null,
    null,
    'Helium (He) and Argon (Ar) are inert noble gases located in Group 18.',
  ],
  // 3. True / False
  [
    'The acceleration due to gravity on the Moon is greater than that on Earth.',
    'TRUE_FALSE',
    'PHY',
    'Gravitation',
    null,
    'Easy',
    2,
    0.5,
    'True',
    'False',
    null,
    null,
    'False',
    null,
    null,
    'Lunar gravity is approximately 1/6th of Earth gravity.',
  ],
  // 4. Numerical / Integer Type
  [
    'Calculate the velocity (in m/s) of an object falling freely for 3 seconds under gravity (g = 9.8 m/s^2).',
    'NUMERICAL',
    'PHY',
    'Kinematics',
    'Motion Under Gravity',
    'Hard',
    4,
    0,
    null,
    null,
    null,
    null,
    null,
    29.4,
    0.1,
    'v = u + gt => v = 0 + (9.8 * 3) = 29.4 m/s.',
  ],
  // 5. Text-Based / Short Answer
  [
    'What is the SI unit of force?',
    'TEXT_BASED',
    'PHY',
    'Laws of Motion',
    'Force and Momentum',
    'Easy',
    4,
    1,
    null,
    null,
    null,
    null,
    'Newton',
    null,
    null,
    'The SI unit of force is the Newton (N).',
  ],
];

/**
 * Download the official XLSX template with a reference sheet of institute subjects and chapters.
 */
export async function downloadQuestionXlsxTemplate(ref?: QuestionReferenceData): Promise<boolean> {
  try {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();

    // ── Sheet 1: Questions Data Sheet ──────────────────────────────────────
    const questionsAoA: (string | number | null)[][] = [
      [BULK_QUESTION_TEMPLATE_VERSION],
      [...BULK_QUESTION_HEADERS],
      ...EXAMPLE_ROWS,
    ];
    const questionsSheet = XLSX.utils.aoa_to_sheet(questionsAoA);

    // Set column widths for readability
    questionsSheet['!cols'] = [
      { wch: 45 }, // Question Text
      { wch: 15 }, // Question Type
      { wch: 15 }, // Subject
      { wch: 22 }, // Chapter
      { wch: 20 }, // Topic
      { wch: 12 }, // Difficulty
      { wch: 8 },  // Marks
      { wch: 14 }, // Negative Marks
      { wch: 20 }, // Option A
      { wch: 20 }, // Option B
      { wch: 20 }, // Option C
      { wch: 20 }, // Option D
      { wch: 14 }, // Correct Answer
      { wch: 16 }, // Numerical Answer
      { wch: 12 }, // Tolerance
      { wch: 35 }, // Explanation
    ];

    XLSX.utils.book_append_sheet(book, questionsSheet, 'Questions');

    // ── Sheet 2: Reference Data (Subjects & Chapters) ──────────────────────
    if (ref && ref.subjects.length > 0) {
      const subjectMap = new Map(ref.subjects.map((s) => [s.subjectId, s]));
      const refAoA: string[][] = [
        ['Subject Code', 'Subject Name', 'Chapter Name'],
      ];

      for (const ch of ref.chapters) {
        const sub = subjectMap.get(ch.subjectId);
        if (sub) {
          refAoA.push([sub.code ?? '', sub.name, ch.name]);
        }
      }

      if (refAoA.length > 1) {
        const refSheet = XLSX.utils.aoa_to_sheet(refAoA);
        refSheet['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(book, refSheet, 'Reference_Subjects_Chapters');
      }
    }

    XLSX.writeFile(book, 'bulk_questions_template.xlsx');
    return true;
  } catch (err) {
    console.error('Failed to generate XLSX template:', err);
    return false;
  }
}

/**
 * Download the official CSV template.
 */
export function downloadQuestionCsvTemplate(): boolean {
  try {
    downloadCsv(
      'bulk_questions_template.csv',
      [BULK_QUESTION_TEMPLATE_VERSION],
      [[...BULK_QUESTION_HEADERS], ...EXAMPLE_ROWS],
    );
    return true;
  } catch (err) {
    console.error('Failed to generate CSV template:', err);
    return false;
  }
}
