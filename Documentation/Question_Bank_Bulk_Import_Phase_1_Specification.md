# Question Bank Bulk Import — Phase 1 Specification

> **Status:** Specification (pre-implementation)
> **Target Module:** `src/features/question-bank/import/`
> **Existing File:** `src/app/teacher/questions/import/page.tsx` (to be superseded)
>
> This document defines the architecture, contracts, and design for a
> source-agnostic bulk import pipeline. The pipeline must support imports
> from Excel, PDF, Word, and OCR **without changing the import pipeline** —
> only the source-specific parser changes.

---

## Table of Contents

1. [Import Pipeline Architecture](#1-import-pipeline-architecture)
2. [TypeScript Interfaces](#2-typescript-interfaces)
3. [Excel Template Specification](#3-excel-template-specification)
4. [ZIP Folder Structure](#4-zip-folder-structure)
5. [File Naming Conventions](#5-file-naming-conventions)
6. [Validation Rules](#6-validation-rules)
7. [Preview Page Wireframe](#7-preview-page-wireframe)
8. [Error Report Format](#8-error-report-format)

---

## 1. Import Pipeline Architecture

The pipeline follows a **Parser → Normaliser → Validator → Preview → Committer**
architecture. Each stage has a single responsibility and a well-defined
contract with the next stage.

```
+-----------+     +------------+     +------------+     +----------+     +-----------+
|  Source   |────▶|  Parser    |────▶| Normaliser |────▶| Validator |────▶| Committer |
|  (File)   |     | (Plugin)   |     |            |     |           |     | (Phase 2) |
+-----------+     +------------+     +------------+     +----------+     +-----------+
                        │                    │                │
                        ▼                    ▼                ▼
                 RawDocument         NormalisedDoc      ValidationErrors
                 (plugin-           (canonical          (ValidationError[])
                  specific)          shape)
```

### 1.1 Stage Descriptions

| Stage | Input | Output | Responsibility |
|-------|-------|--------|----------------|
| **Parser** | File (File \| Blob \| Buffer) | `RawDocument` (plugin-specific shape) | Reads the source file and extracts structured data. One plugin per source type (Excel, PDF, Word, OCR). |
| **Normaliser** | `RawDocument` | `ImportQuestion[]` | Converts the plugin-specific raw shape into the canonical `ImportQuestion` shape. This is the **only** stage that knows about plugin-specific details. |
| **Validator** | `ImportQuestion[]` | `{ valid: ImportQuestion[]; errors: ValidationError[] }` | Applies validation rules to every question and its options/images. Returns the valid subset alongside structured errors. |
| **Preview** | `{ valid: ImportQuestion[]; errors: ValidationError[] }` | Render | Displays the validated questions in a preview table with inline error highlighting. User confirms or rejects. |
| **Committer** | `ImportQuestion[]` | `ImportResult` | Inserts valid questions into the database (Phase 2). Returns per-row success/failure. |

### 1.2 Plugin Contract

Every source plugin must implement the following interface:

```typescript
/**
 * Contract for all source-specific parser plugins.
 *
 * Each plugin reads a source file and returns a RawDocument. The
 * Normaliser stage maps this to the canonical ImportQuestion shape.
 *
 * @template T - The plugin-specific raw document shape.
 */
interface ImportParserPlugin<T = unknown> {
  /** Human-readable source type identifier. */
  readonly sourceType: ImportSourceType;

  /** MIME types this plugin can handle. */
  readonly supportedMimeTypes: readonly string[];

  /** File extensions this plugin can handle. */
  readonly supportedExtensions: readonly string[];

  /**
   * Parse the source file into a structured raw document.
   *
   * @param file - The source file to parse.
   * @param signal - Optional AbortSignal for cancellation.
   * @returns The parsed raw document.
   * @throws ImportParseError on unrecoverable parse failures.
   */
  parse(file: File | Blob | Buffer, signal?: AbortSignal): Promise<T>;

  /**
   * Optional: Extract embedded images from the source.
   * Used by Excel (embedded images in cells) and OCR (extracted figures).
   *
   * @param raw - The parsed raw document.
   * @returns Map of image references to their binary data.
   */
  extractImages?(raw: T): Map<string, ArrayBuffer>;
}

/**
 * Discriminator for supported import source types.
 * Adding a new source type only requires adding a new entry here
 * and implementing the corresponding plugin.
 */
type ImportSourceType =
  | 'excel'
  | 'pdf'
  | 'word'
  | 'ocr';
```

### 1.3 Normaliser Contract

```typescript
/**
 * Normalises a plugin-specific RawDocument into the canonical
 * ImportQuestion[] shape.
 *
 * One normaliser per source type. The normaliser is the bridge
 * between plugin-specific parsing and the shared validation pipeline.
 */
interface ImportNormaliser<T = unknown> {
  /** The source type this normaliser handles. */
  readonly sourceType: ImportSourceType;

  /**
   * Convert a raw document into canonical import questions.
   *
   * @param raw - The plugin-specific raw document.
   * @returns The canonical import questions.
   */
  normalise(raw: T): ImportQuestion[];
}
```

### 1.4 Pipeline Orchestrator

```typescript
/**
 * Top-level orchestrator for the import pipeline.
 *
 * Manages the flow: Parse → Normalise → Validate → Return.
 * The Committer (Phase 2) will be a separate step.
 */
interface ImportPipeline {
  /**
   * Run the full pipeline (parse + normalise + validate).
   *
   * @param file    - The uploaded source file.
   * @param options - Optional pipeline configuration.
   * @returns The validation result with valid questions and any errors.
   */
  run(
    file: File | Blob | Buffer,
    options?: PipelineOptions,
  ): Promise<{ data: ImportQuestion[]; errors: ValidationError[] }>;

  /**
   * Run only the parse stage (for debugging / raw inspection).
   */
  parseOnly(
    file: File | Blob | Buffer,
  ): Promise<{ raw: unknown; errors: ImportParseError[] }>;

  /**
   * Register a parser plugin and its corresponding normaliser.
   * Called during application initialisation.
   */
  registerPlugin(
    plugin: ImportParserPlugin,
    normaliser: ImportNormaliser,
  ): void;

  /**
   * Select the appropriate plugin based on file type.
   */
  resolvePlugin(file: File | Blob | Buffer): ImportParserPlugin;
}
```

---

## 2. TypeScript Interfaces

All types live at `src/features/question-bank/import/types.ts`.

### 2.1 ImportSourceType

```typescript
/**
 * Discriminator for supported import source types.
 * Adding a new source requires no pipeline changes — only a new
 * plugin + normaliser registration.
 */
type ImportSourceType =
  | 'excel'
  | 'pdf'
  | 'word'
  | 'ocr';
```

### 2.2 ImportQuestion

```typescript
/**
 * Canonical shape produced by the Normaliser and consumed by the
 * Validator. This is the lingua franca of the import pipeline —
 * every source type normalises to this shape.
 */
interface ImportQuestion {
  /**
   * Row number from the source file (1-indexed).
   * Used for error reporting back to the user.
   *
   * For non-tabular sources (PDF, OCR), this is a sequential
   * page/section counter.
   */
  rowNumber: number;

  /**
   * Question stem in plain text or Markdown.
   * Minimum 10 characters after trimming.
   */
  questionText: string;

  /**
   * Question type discriminator.
   * Maps to the `QuestionType` enum in the database.
   */
  questionType: QuestionType;

  /**
   * Difficulty level.
   * Maps to the `DifficultyLevel` enum.
   */
  difficulty: DifficultyLevel;

  /**
   * Subject identifier.
   * One of:
   * - A UUID (if the subject exists in the system)
   * - A subject code/name (to be resolved during commit)
   * - An empty string (error: required field missing)
   */
  subjectId: string;

  /**
   * Chapter identifier.
   * One of:
   * - A UUID (if the chapter exists in the system)
   * - A chapter code/name (to be resolved during commit)
   * - An empty string (error: required field missing)
   */
  chapterId: string;

  /**
   * Topic identifier (optional).
   * One of:
   * - A UUID (if the topic exists in the system)
   * - A topic code/name (to be resolved during commit)
   * - An empty string or null (optional / no topic)
   */
  topicId?: string | null;

  /**
   * Marks awarded for a correct answer.
   * Default: 4. Must be > 0.
   */
  marks: number;

  /**
   * Negative marks for a wrong answer.
   * Default: 1. Must be >= 0. 0 means no negative marking.
   */
  negativeMarks: number;

  /**
   * Answer options.
   * Required for: mcq, msq, true_false.
   * Must be empty for: numerical.
   */
  options: ImportOption[];

  /**
   * Embedded images for this question (stem, options, explanation).
   */
  images: ImportImage[];

  /**
   * Explanation / solution walkthrough (optional).
   * Required before a question can be published, but optional for draft import.
   */
  explanationText?: string | null;

  /**
   * Correct answer for numerical type questions.
   * Only applicable when questionType === 'numerical'.
   */
  correctNumericalAnswer?: number | null;

  /**
   * Acceptable margin of error for numerical answers.
   * NULL = exact match required.
   */
  numericalTolerance?: number | null;

  /**
   * Optional video solution URL.
   */
  explanationVideoUrl?: string | null;

  /**
   * Tags to associate with this question (optional).
   * Will be created on-the-fly or linked to existing tags during commit.
   */
  tags?: string[];
}
```

### 2.3 ImportOption

```typescript
/**
 * An answer option within an ImportQuestion.
 */
interface ImportOption {
  /**
   * The option content in plain text or Markdown.
   */
  optionText: string;

  /**
   * TRUE if this is a correct answer.
   * - MCQ:  exactly one option should be TRUE.
   * - MSQ:  one or more options can be TRUE.
   * - True/False: exactly one of two options is TRUE.
   */
  isCorrect: boolean;

  /**
   * 1-indexed display order within the question.
   */
  orderSequence: number;

  /**
   * Optional: Reference to an image embedded in this option.
   * Maps to the `imageRef` field in ImportImage.
   */
  imageRef?: string | null;
}
```

### 2.4 ImportImage

```typescript
/**
 * An image associated during import.
 *
 * Images can come from:
 * - Embedded in an Excel file (via `extractImages()`)
 * - Referenced by filename from a ZIP archive
 * - Extracted from a PDF or Word document
 * - Captured via OCR
 */
interface ImportImage {
  /**
   * Unique reference identifier for this image within the import batch.
   * Used by ImportOption.imageRef to link options to images.
   * Format: `img_{sequentialNumber}` (e.g. `img_001`, `img_002`).
   */
  imageRef: string;

  /**
   * Where this image is used:
   * - `stem`:       Embedded in the question text.
   * - `option_a`–`option_h`: Embedded in a specific option.
   * - `explanation`: Used in the solution walkthrough.
   */
  imageRole: string;

  /**
   * The original filename as submitted.
   * For ZIP imports, this is the filename inside the ZIP.
   * For embedded extractions, this is auto-generated.
   */
  originalFileName: string;

  /**
   * Binary image data.
   * Present only during the in-memory pipeline stage.
   * Not serialised in the preview payload.
   */
  data?: ArrayBuffer;

  /**
   * Accessibility description. Required for WCAG 2.1 Level AA.
   */
  altText?: string | null;

  /**
   * 1-indexed display order for questions with multiple stem images.
   */
  orderSequence: number;
}
```

### 2.5 ValidationError

```typescript
/**
 * Structured validation error for a single field within an import row.
 */
interface ValidationError {
  /**
   * 1-indexed row number from the source file.
   * For non-tabular sources, this is a sequential counter.
   */
  row: number;

  /**
   * The field path within ImportQuestion that failed validation.
   * Uses dot notation for nested fields.
   *
   * Examples:
   * - `questionText`
   * - `options[0].optionText`
   * - `options[1].isCorrect`
   * - `images[0].imageRef`
   * - `marks`
   * - `subjectId`
   */
  field: string;

  /**
   * Human-readable error message describing the validation failure.
   */
  message: string;

  /**
   * Severity level.
   * - `error`:   This field's value is invalid. The row cannot be imported
   *              without fixing this field.
   * - `warning`: The field is valid but suspicious (e.g. low mark value,
   *              duplicate option text). The row can still be imported.
   */
  severity: 'error' | 'warning';

  /**
   * A machine-readable code for programmatic handling.
   *
   * Format: `{CATEGORY}_{RULE}`
   *
   * Examples:
   * - `REQUIRED_MISSING` — a required field is empty
   * - `TEXT_TOO_SHORT` — text is below minimum length
   * - `OPTIONS_CORRECT_COUNT_MCQ` — MCQ must have exactly 1 correct option
   * - `OPTIONS_CORRECT_COUNT_MSQ` — MSQ must have at least 1 correct option
   * - `MARKS_INVALID` — marks <= 0 or not a finite number
   * - `IMAGE_NOT_FOUND` — an imageRef references a non-existent image
   * - `SUBJECT_UNRESOLVABLE` — subjectId could not be matched to a system subject
   * - `CHAPTER_UNRESOLVABLE` — chapterId could not be matched
   * - `DUPLICATE_OPTION_TEXT` — two options have identical text
   * - `OPTIONS_COUNT_MIN` — too few options (minimum 2)
   * - `OPTIONS_COUNT_MAX` — too many options (maximum 8)
   * - `TEXT_LENGTH_EXCEEDED` — text exceeds maximum allowed length
   * - `INVALID_QUESTION_TYPE` — questionType is not a valid enum value
   * - `INVALID_DIFFICULTY` — difficulty is not a valid enum value
   */
  code: string;

  /**
   * The actual value that failed validation (for display purposes).
   * Omitted for warnings where the value is technically valid.
   */
  actualValue?: unknown;

  /**
   * The expected constraint that was violated (for display purposes).
   *
   * Examples:
   * - "Must be at least 10 characters"
   * - "Must be greater than 0"
   * - "Expected exactly 1 correct option for MCQ, got 3"
   */
  constraint?: string;
}
```

### 2.6 ImportResult

```typescript
/**
 * Overall result of an import operation.
 */
interface ImportResult {
  /**
   * Import session identifier.
   * Generated when the user starts an import workflow.
   */
  importId: string;

  /**
   * Source file name that was imported.
   */
  sourceFileName: string;

  /**
   * Source type that was detected and used.
   */
  sourceType: ImportSourceType;

  /**
   * Total number of rows detected in the source file.
   */
  totalRows: number;

  /**
   * Number of rows that passed validation.
   */
  validRowCount: number;

  /**
   * Number of rows with validation errors.
   */
  errorRowCount: number;

  /**
   * Number of rows with warnings (valid, but suspicious).
   */
  warningRowCount: number;

  /**
   * All validation errors grouped for display.
   */
  errors: ValidationError[];

  /**
   * Validated import questions (ready for preview or commit).
   */
  validQuestions: ImportQuestion[];

  /**
   * Timeline metrics for the pipeline stages.
   */
  metrics?: {
    parseMs: number;
    normaliseMs: number;
    validateMs: number;
    totalMs: number;
  };
}
```

### 2.7 Supporting Types

```typescript
/**
 * Options passed to the pipeline orchestrator.
 */
interface PipelineOptions {
  /**
   * AbortSignal for cancellation support.
   */
  signal?: AbortSignal;

  /**
   * When true, the validator attempts to resolve subject/chapter
   * names to UUIDs (requires an API call). When false, names are
   * left as-is and resolution happens during commit.
   * Default: false.
   */
  resolveReferences?: boolean;

  /**
   * Institute context for reference resolution.
   * Required when resolveReferences is true.
   */
  instituteId?: string;

  /**
   * Whether to import questions as `draft` or `pending_approval`.
   * Default: 'draft'.
   */
  defaultStatus?: 'draft' | 'pending_approval';
}

/**
 * Error thrown by a parser plugin when the source file cannot be parsed.
 */
interface ImportParseError {
  /**
   * Human-readable error message.
   */
  message: string;

  /**
   * Machine-readable error code.
   */
  code: 'UNREADABLE_FILE' | 'UNSUPPORTED_FORMAT' | 'CORRUPTED_FILE' | 'PASSWORD_PROTECTED' | 'EMPTY_FILE' | 'PARSE_INTERNAL';

  /**
   * Whether retrying with a different parser might succeed.
   */
  isRetriable: boolean;
}
```

---

## 3. Excel Template Specification

### 3.1 Template File

- **File name:** `question_bank_import_template.xlsx`
- **Works with:** Microsoft Excel 2010+, LibreOffice Calc, Google Sheets
- **Max rows:** 1000 (enforced by application layer; Excel supports 1,048,576)

### 3.2 Sheet Structure

The workbook contains a single sheet named **"Questions"**.

### 3.3 Column Definitions

| # | Column Header | Required | Type | Validation | Default | Example |
|---|---|---|---|---|---|---|
| 1 | `question_text` | **Yes** | Text (Markdown) | Min 10 chars, Max 20000 chars | — | `What is Newton's First Law of Motion?` |
| 2 | `question_type` | **Yes** | Enum | One of: `mcq`, `msq`, `numerical`, `true_false` | — | `mcq` |
| 3 | `difficulty` | **Yes** | Enum | One of: `easy`, `medium`, `hard` | — | `medium` |
| 4 | `subject_id` | **Yes** | Text | Must resolve to a system subject. Accepts UUID, code, or name. | — | `PHY` or `a1b2c3d4-...` |
| 5 | `chapter_id` | **Yes** | Text | Must resolve to a system chapter. Accepts UUID, code, or name. | — | `Laws of Motion` |
| 6 | `topic_id` | No | Text | Optional. Accepts UUID, code, or name. | — | `Newton's First Law` |
| 7 | `marks` | No | Number | Integer or decimal > 0. Max: 1000. | `4` | `4` |
| 8 | `negative_marks` | No | Number | Decimal >= 0. Max: marks value. | `1` | `1` |
| 9 | `option_a` | Conditional* | Text (Markdown) | Max 5000 chars. Required for mcq, msq, true_false. | — | `An object at rest stays at rest...` |
| 10 | `option_b` | Conditional* | Text (Markdown) | Same as option_a | — | `Force equals mass times acceleration` |
| 11 | `option_c` | No | Text (Markdown) | Optional extra option | — | `For every action there is an equal...` |
| 12 | `option_d` | No | Text (Markdown) | Optional extra option | — | `Energy cannot be created or destroyed` |
| 13 | `option_e` | No | Text (Markdown) | Optional extra option (for MSQ) | — | `Momentum is conserved` |
| 14 | `option_f` | No | Text (Markdown) | Optional extra option (for MSQ) | — | — |
| 15 | `option_g` | No | Text (Markdown) | Optional extra option (for MSQ) | — | — |
| 16 | `option_h` | No | Text (Markdown) | Optional extra option (for MSQ) | — | — |
| 17 | `correct_option` | Conditional* | Text | Space-separated list of option letters (A–H). For MCQ: exactly one. For MSQ: one or more. For true_false: exactly one. | — | `A` or `A C` |
| 18 | `explanation_text` | No | Text (Markdown) | Max 50000 chars. Required before publication. | — | `Newton's First Law states that...` |
| 19 | `numerical_answer` | Conditional | Number | Required when question_type = `numerical`. Accepts decimal. | — | `9.81` |
| 20 | `numerical_tolerance` | No | Number | Acceptable margin of error. NULL = exact match. | — | `0.1` |
| 21 | `explanation_video_url` | No | URL | Valid URL format. Max 2048 chars. | — | `https://youtu.be/...` |
| 22 | `tags` | No | Text | Comma-separated tag names. Will be created/linked during commit. | — | `mechanics, newton, laws-of-motion` |

> `*` Conditional: Required for MCQ, MSQ, and True/False. Not applicable for Numerical.

### 3.4 Excel Data Validation Rules

The template should pre-configure the following Excel data validations:

| Column | Validation Type | Rule |
|--------|----------------|------|
| `question_type` | List | `mcq,msq,numerical,true_false` |
| `difficulty` | List | `easy,medium,hard` |
| `correct_option` | Text length | Max 8 characters (A–H with spaces) |
| `marks` | Decimal | Between 0.1 and 1000 |
| `negative_marks` | Decimal | Between 0 and 1000 |
| `numerical_answer` | Decimal | Any valid number |

### 3.5 Column Headers Row

Row 1 is the header row. Row 2 onwards are data rows.

The first row **must** exactly match the column headers above (case-insensitive).
A helper method `normaliseExcelHeaders()` will map case-insensitive headers to
canonical field names.

### 3.6 Excel Template Download

The system provides a downloadable `.xlsx` template file with:
- Pre-populated headers
- Data validation dropdowns for enum columns
- Example row (can be deleted by the user)
- Conditional formatting to highlight required columns (light red background)
- Protected header row (optional)

---

## 4. ZIP Folder Structure

For bulk imports that include images, the user can upload a ZIP file.

### 4.1 Structure

```
questions_batch_2024_01.zip
├── questions.xlsx                      # The Excel template file
├── images/
│   ├── q001_stem_diagram.png           # Image for question 1, stem role
│   ├── q001_option_a_graph.svg         # Image for question 1, option A
│   ├── q002_stem_circuit.png           # Image for question 2, stem role
│   ├── q002_explanation_figure.png     # Image for question 2, explanation
│   ├── q003_stem_biology_diagram.jpg   # Image for question 3, stem role (Note: .jpg)
│   └── q003_option_c_graph.png
└── metadata.json                       # Optional: batch-level metadata
```

### 4.2 Rules

1. **Exactly one `.xlsx` file** at the root level is required.
2. An **`images/` directory** is optional. If present, subdirectories are
   **not** allowed — all images must be flat inside `images/`.
3. A **`metadata.json`** file at the root level is optional.
4. Total ZIP size must not exceed **500 MB** (configurable).
5. Maximum **1000 images** per ZIP (configurable).

### 4.3 metadata.json Schema

```typescript
interface ImportMetadata {
  /** Source description. Free text. */
  source?: string;
  /** Author name or faculty ID. */
  author?: string;
  /** Batch description for audit trail. */
  description?: string;
  /** Version of the template used. */
  templateVersion?: string;
  /** ISO 8601 date when the export was created. */
  exportedAt?: string;
  /** Custom tags applied to all questions in this batch. */
  defaultTags?: string[];
}
```

Example `metadata.json`:
```json
{
  "source": "Physics Faculty Question Bank Export",
  "author": "Dr. Sharma (tch-8492-phy)",
  "description": "Class 11 Mechanics questions for NEET 2026 batch",
  "templateVersion": "1.0",
  "exportedAt": "2025-12-15T10:30:00Z",
  "defaultTags": ["neet-2026", "mechanics"]
}
```

---

## 5. File Naming Conventions

### 5.1 Image Reference Linking

In the Excel template, whenever an image should be embedded at a specific
location, the cell value uses the syntax:

```
{{image:q001_stem_diagram.png}}
```

The normaliser parses this syntax and:
1. Strips the `{{image:...}}` placeholder from the text content
2. Creates an `ImportImage` entry with `imageRef` = the filename stem
3. Links the image to the appropriate field and role

### 5.2 Image Reference by Role

If the user does not use the `{{image:...}}` syntax, images can be linked
by the following role-based convention in the `images/` directory:

| Role | Naming Pattern | Example |
|------|----------------|---------|
| Stem image (question text) | `q{rowNumber}_stem.{ext}` | `q001_stem.png` |
| Option A image | `q{rowNumber}_option_a.{ext}` | `q001_option_a.png` |
| Option B image | `q{rowNumber}_option_b.{ext}` | `q001_option_b.png` |
| Option C image | `q{rowNumber}_option_c.{ext}` | `q001_option_c.png` |
| Option D image | `q{rowNumber}_option_d.{ext}` | `q001_option_d.png` |
| Option E image | `q{rowNumber}_option_e.{ext}` | `q001_option_e.png` |
| Option F image | `q{rowNumber}_option_f.{ext}` | `q001_option_f.png` |
| Option G image | `q{rowNumber}_option_g.{ext}` | `q001_option_g.png` |
| Option H image | `q{rowNumber}_option_h.{ext}` | `q001_option_h.png` |
| Explanation image | `q{rowNumber}_explanation.{ext}` | `q001_explanation.png` |

The `{rowNumber}` is zero-padded to 3 digits (001, 002, ..., 999).

The normaliser scans the `images/` directory for files matching these
patterns and creates the corresponding `ImportImage` entries.

### 5.3 Image Reference by explicit `imageRef` column

Future extension: Optionally, a column `image_refs` in the Excel template
can explicitly list image references per question row.

### 5.4 Supported Image Formats

| Format | Extension | MIME Type | Max Size |
|--------|-----------|-----------|----------|
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` | 10 MB |
| PNG | `.png` | `image/png` | 10 MB |
| WebP | `.webp` | `image/webp` | 10 MB |
| GIF | `.gif` | `image/gif` | 10 MB |
| SVG | `.svg` | `image/svg+xml` | 2 MB |

### 5.5 Conflict Resolution

If both `{{image:...}}` syntax and role-based naming exist for the same
image position, the `{{image:...}}` syntax takes precedence.

---

## 6. Validation Rules

### 6.1 Row-Level Rules

#### 6.1.1 Required Fields

| Field | Rule | Error Code |
|-------|------|------------|
| `questionText` | Must be non-empty after trimming | `REQUIRED_MISSING` |
| `questionType` | Must be one of `mcq`, `msq`, `numerical`, `true_false` | `INVALID_QUESTION_TYPE` |
| `difficulty` | Must be one of `easy`, `medium`, `hard` | `INVALID_DIFFICULTY` |
| `subjectId` | Must be non-empty | `REQUIRED_MISSING` |
| `chapterId` | Must be non-empty | `REQUIRED_MISSING` |

#### 6.1.2 Text Rules

| Field | Rule | Error Code |
|-------|------|------------|
| `questionText` | Min 10 characters after trimming | `TEXT_TOO_SHORT` |
| `questionText` | Max 20000 characters | `TEXT_LENGTH_EXCEEDED` |
| `option.text` (each) | Min 1 character after trimming | `OPTION_TEXT_EMPTY` |
| `option.text` (each) | Max 5000 characters | `OPTION_TEXT_TOO_LONG` |
| `explanationText` | Max 50000 characters | `EXPLANATION_TOO_LONG` |

#### 6.1.3 Numeric Rules

| Field | Rule | Error Code |
|-------|------|------------|
| `marks` | Must be > 0 | `MARKS_INVALID` |
| `marks` | Must be ≤ 1000 | `MARKS_EXCEEDED` |
| `negativeMarks` | Must be ≥ 0 | `NEGATIVE_MARKS_INVALID` |
| `negativeMarks` | Must be ≤ marks | `NEGATIVE_MARKS_EXCEEDED` |
| `correctNumericalAnswer` | Required when questionType = 'numerical' | `NUMERICAL_ANSWER_REQUIRED` |

#### 6.1.4 Options Rules

| Rule | Error Code | Notes |
|------|------------|-------|
| At least 2 options provided for mcq/msq/true_false | `OPTIONS_COUNT_MIN` | — |
| At most 8 options provided | `OPTIONS_COUNT_MAX` | — |
| Options must have unique `orderSequence` values | `OPTIONS_DUPLICATE_ORDER` | — |
| Exactly 1 correct option for MCQ | `OPTIONS_CORRECT_COUNT_MCQ` | — |
| At least 1 correct option for MSQ | `OPTIONS_CORRECT_COUNT_MSQ` | — |
| Exactly 1 correct option for True/False | `OPTIONS_CORRECT_COUNT_TF` | — |
| No correct options allowed for Numerical | `OPTIONS_CORRECT_FOR_NUMERICAL` | Numerical must have zero options |
| No duplicate option text (case-insensitive) | `OPTIONS_DUPLICATE_TEXT` | Warning (not error) |

#### 6.1.5 Image Rules

| Rule | Error Code | Severity |
|------|------------|----------|
| Image file referenced by `{{image:...}}` must exist in the ZIP | `IMAGE_NOT_FOUND` | Error |
| Image file size must not exceed 10 MB (2 MB for SVG) | `IMAGE_SIZE_EXCEEDED` | Error |
| Image MIME type must be in the allowed list | `IMAGE_TYPE_INVALID` | Error |
| Max 10 images per question | `IMAGES_PER_QUESTION_EXCEEDED` | Error |
| Image role must be a valid role string | `IMAGE_ROLE_INVALID` | Error |

#### 6.1.6 Reference Resolution Rules

When `resolveReferences: true` is set:

| Rule | Error Code |
|------|------------|
| `subjectId` must resolve to an existing subject in the institute | `SUBJECT_UNRESOLVABLE` |
| `chapterId` must resolve to an existing chapter in the given subject | `CHAPTER_UNRESOLVABLE` |
| `topicId` must resolve to an existing topic in the given chapter (if provided) | `TOPIC_UNRESOLVABLE` |

When `resolveReferences: false` (default), references are not validated
at this stage. Resolution happens during the commit phase (Phase 2).

### 6.2 Batch-Level Rules

| Rule | Error Code |
|------|------------|
| At least 1 valid row in the import | `BATCH_EMPTY` |
| Max 1000 rows per batch | `BATCH_SIZE_EXCEEDED` |
| Source file must not be empty | `EMPTY_FILE` |

### 6.3 Validator Function Signature

```typescript
/**
 * Validates an array of ImportQuestion objects.
 *
 * @param questions - The canonical import questions to validate.
 * @param options   - Optional validation configuration.
 * @returns Separated valid questions and validation errors.
 */
interface ImportValidator {
  validate(
    questions: ImportQuestion[],
    options?: ValidationOptions,
  ): { valid: ImportQuestion[]; errors: ValidationError[] };
}

interface ValidationOptions {
  /** Maximum question text length. Default: 20000. */
  maxQuestionTextLength?: number;
  /** Maximum option text length. Default: 5000. */
  maxOptionTextLength?: number;
  /** Maximum explanation text length. Default: 50000. */
  maxExplanationTextLength?: number;
  /** Maximum marks value. Default: 1000. */
  maxMarks?: number;
  /** Minimum options for mcq/msq/tf. Default: 2. */
  minOptions?: number;
  /** Maximum options. Default: 8. */
  maxOptions?: number;
  /** Maximum images per question. Default: 10. */
  maxImagesPerQuestion?: number;
  /** Whether to attempt reference resolution. Default: false. */
  resolveReferences?: boolean;
  /** Institute context for reference resolution. */
  instituteId?: string;
}
```

---

## 7. Preview Page Wireframe

### 7.1 Page Location

`src/app/teacher/questions/import/page.tsx` (refactored, superseding the
existing implementation)

### 7.2 Page States

| State | Description |
|-------|-------------|
| **Empty** | Initial state. No file selected. Shows upload area and template download. |
| **Selected** | File is selected but not yet processed. Shows file name, size, and a "Preview" button. |
| **Loading** | Pipeline is running (parse → normalise → validate). Spinner with stage indicator. |
| **Preview** | Validation complete. Shows preview table with inline errors and summary cards. |
| **Error** | Fatal error (file could not be parsed at all). Shows error message and retry option. |

### 7.3 Component Tree

```
ImportPage
├── PageHeader                    # "Bulk Import" title, breadcrumbs
│   └── DownloadTemplateButton    # Download .xlsx template
├── UploadZone                    # (Empty / Selected state)
│   ├── FileDropArea (drag & drop, click to browse)
│   ├── FileInfoCard (file name, size, detected format)
│   └── PreviewButton
├── PipelineProgress              # (Loading state)
│   ├── StageIndicator (Parsing → Normalising → Validating)
│   └── ProgressBar
├── PreviewPanel                  # (Preview state)
│   ├── SummaryCards
│   │   ├── MetricCard (Valid count, green)
│   │   ├── MetricCard (Errors count, red)
│   │   └── MetricCard (Warnings count, amber)
│   ├── ErrorSummaryBanner
│   │   └── Collapsible grouped-by-error-code sections
│   ├── ImportPreviewTable
│   │   ├── ColumnVisibilityToggle
│   │   ├── TableHeader (Row, Status, Question, Type, Difficulty, Subject, Chapter, Marks, Options)
│   │   └── TableRow (status dot, question text truncated, inline error badges)
│   │       └── RowExpansionPanel (full question details, options, images, explanations)
│   └── ActionBar
│       ├── ImportButton (enabled when validRowCount > 0)
│       └── CancelButton
├── FatalErrorPanel               # (Error state)
│   ├── ErrorIcon
│   ├── ErrorMessage
│   └── RetryButton
└── ImportResultPanel             # (Post-commit, Phase 2)
    ├── SuccessBanner
    └── ResultTable (per-row import status)
```

### 7.4 Key UI Specifications

#### SummaryCards

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │  ✅ 45   │  │  ❌  3   │  │  ⚠️  2   │                   │
│  │  Valid   │  │  Errors  │  │ Warnings │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
│  50 total rows detected                                      │
└─────────────────────────────────────────────────────────────┘
```

#### ImportPreviewTable

```
┌────┬────────┬──────────────────────────┬──────┬──────────┬─────────┬────────┬───────┬──────────┐
│ #  │ Status │ Question                 │ Type │ Diff.    │ Subject │ Ch.    │ Marks │ Options  │
├────┼────────┼──────────────────────────┼──────┼──────────┼─────────┼────────┼───────┼──────────┤
│ 1  │ ●      │ What is Newton's First…  │ MCQ  │ Medium   │ Physics │ Laws… │ 4     │ A, B, C…│
│ 2  │ ● err  │ [Empty]                  │ ---  │ ---      │ ---     │ ---   │ ---   │ ---      │
│ 3  │ ●      │ Calculate the force…     │ Num. │ Hard     │ Physics │ Laws… │ 5     │ [N/A]    │
└────┴────────┴──────────────────────────┴──────┴──────────┴─────────┴────────┴───────┴──────────┘
```

- **Status dot:** Green = valid, Red = errors, Amber = warnings only
- **Row expansion:** Clicking a row expands an inline panel showing:
  - Full question text
  - All options with correct/wrong indicators
  - Images (thumbnail grid)
  - Explanation text
  - Inline validation error details

#### Error Badge

Inline error badges appear on cells that have errors:

```
┌──────────────────────────────────┐
│  What is Newton's First Law?     │
│  ┌─────────────────────────┐     │
│  │ ⚠️ Warning: Duplicate   │     │
│  │ text with row 5         │     │
│  └─────────────────────────┘     │
└──────────────────────────────────┘
```

#### PipelineProgress

```
Parsing ──●─────── Normalising ──○──── Validating ──○────
          [████████░░░░░░░░░]  45%
```

Animated with green fill for completed stages, blue for current,
grey for pending.

---

## 8. Error Report Format

### 8.1 In-Memory Format

The pipeline produces errors grouped in two ways:

1. **Flat array** (`ValidationError[]`) — for programmatic iteration
2. **Grouped by row** (`Map<number, ValidationError[]>`) — for row-level rendering
3. **Grouped by code** (`Map<string, ValidationError[]>`) — for summary view

### 8.2 Downloadable Error Report (Excel)

After validation, the user can download an **Error Report** `.xlsx` file.

#### Structure

The report contains two sheets:

**Sheet 1: "Error Summary"**

| Error Code | Count | Example Row | Description |
|------------|-------|-------------|-------------|
| `REQUIRED_MISSING` | 12 | 5, 8, 12, … | Required fields that were left empty |
| `OPTIONS_CORRECT_COUNT_MCQ` | 3 | 2, 15, 22 | MCQ questions with != 1 correct option |
| `TEXT_TOO_SHORT` | 2 | 7, 19 | Question text under 10 characters |

**Sheet 2: "Row-Level Details"**

| Row | Field | Code | Severity | Actual Value | Constraint | Message |
|-----|-------|------|----------|-------------|------------|---------|
| 5 | `questionText` | `REQUIRED_MISSING` | error | (empty) | Must be non-empty | Question text is required. |
| 5 | `questionType` | `INVALID_QUESTION_TYPE` | error | `checkbox` | Must be one of: mcq, msq, numerical, true_false | "checkbox" is not a valid question type. |
| 5 | `options[0].isCorrect` | `OPTIONS_CORRECT_COUNT_MCQ` | error | 0 correct | Expected exactly 1 correct option for MCQ | MCQ questions must have exactly one correct option. Got 0. |
| 7 | `questionText` | `TEXT_TOO_SHORT` | error | `Force` | Minimum 10 characters | Question text is too short (5 characters). Minimum is 10. |
| 8 | `marks` | `MARKS_INVALID` | error | `-2` | Must be greater than 0 | Marks must be greater than 0. |
| 12 | `options[0].optionText` | `OPTIONS_DUPLICATE_TEXT` | warning | `Newton's First Law` | No duplicate option text within question | Option "A" has the same text as option "C". |

### 8.3 Error Report Generation

```typescript
interface ErrorReportGenerator {
  /**
   * Generate an Excel-compatible error report from validation errors.
   *
   * @param errors - All validation errors from the pipeline.
   * @param sourceFileName - Original source file name for reference.
   * @param timestamp - ISO 8601 timestamp of the validation.
   * @returns Blob containing the .xlsx error report.
   */
  generateErrorReport(
    errors: ValidationError[],
    sourceFileName: string,
    timestamp: string,
  ): Blob;
}

interface ErrorReportRow {
  row: number;
  field: string;
  code: string;
  severity: 'error' | 'warning';
  actualValue: string;
  constraint: string;
  message: string;
}

interface ErrorSummaryRow {
  code: string;
  count: number;
  exampleRows: string; // comma-separated row numbers
  description: string;
}
```

### 8.4 Error Report File Name Format

```
error_report_{sourceFileName}_{timestamp}.xlsx
```

Example:
```
error_report_questions_batch_2024_01_2025-12-15_10-30-00.xlsx
```

---

## Appendix A: File and Directory Structure

```
src/features/question-bank/import/
├── types.ts                        # All TypeScript interfaces (this spec §2)
├── pipeline/
│   ├── ImportPipeline.ts           # Pipeline orchestrator (§1.4)
│   ├── ImportValidator.ts          # Validation engine (§6.3)
│   └── ImportNormaliser.ts         # Base normaliser contract (§1.3)
├── plugins/
│   ├── ExcelImportPlugin.ts        # Excel parser plugin
│   ├── ExcelNormaliser.ts          # Excel normaliser
│   ├── PdfImportPlugin.ts          # PDF parser plugin (future)
│   ├── PdfNormaliser.ts            # PDF normaliser (future)
│   ├── WordImportPlugin.ts         # Word parser plugin (future)
│   ├── WordNormaliser.ts           # Word normaliser (future)
│   ├── OcrImportPlugin.ts          # OCR parser plugin (future)
│   └── OcrNormaliser.ts            # OCR normaliser (future)
├── utils/
│   ├── excelTemplate.ts            # Template download generator
│   ├── errorReport.ts              # Error report generator (§8.3)
│   ├── imageExtractor.ts           # Image extraction from ZIP
│   └── referenceResolver.ts        # Subject/chapter name → UUID resolution
└── components/
    ├── ImportPage.tsx               # Page container (§7)
    ├── UploadZone.tsx              # File drop & selection
    ├── PipelineProgress.tsx        # Loading state with stages
    ├── PreviewPanel.tsx            # Preview state container
    ├── ImportPreviewTable.tsx      # Main preview table
    ├── SummaryCards.tsx            # Valid/Errors/Warnings cards
    ├── ErrorSummaryBanner.tsx      # Grouped error summary
    ├── RowExpansionPanel.tsx       # Expanded row details
    ├── FatalErrorPanel.tsx         # Fatal error display
    └── DownloadTemplateButton.tsx  # Template download button
```

---

## Appendix B: Existing Code Alignment

The specification aligns with the following existing types and services:

| Spec Interface | Existing Type | Alignment Notes |
|----------------|---------------|-----------------|
| `ImportQuestion.questionType` | `QuestionType` (`'mcq' \| 'msq' \| 'numerical' \| 'true_false'`) | Direct mapping |
| `ImportQuestion.difficulty` | `DifficultyLevel` (`'easy' \| 'medium' \| 'hard'`) | Direct mapping |
| `ImportQuestion.marks` | `Question.marks` | Direct mapping |
| `ImportQuestion.negativeMarks` | `Question.negativeMarks` | Direct mapping |
| `ImportOption` | `QuestionOption` | Canonical shape drops DB-only fields (optionId, createdAt) |
| `ImportImage` | `QuestionImage` | Canonical shape differs during import; maps to DB shape at commit time |
| `ImportQuestion.explanationText` | `QuestionExplanation.explanationText` | Maps to explanation at commit time |
| `ImportQuestion.correctNumericalAnswer` | `QuestionExplanation.correctNumericalAnswer` | Maps to explanation at commit time |
| `ImportQuestion.numericalTolerance` | `QuestionExplanation.numericalTolerance` | Maps to explanation at commit time |
| `ImportQuestion.explanationVideoUrl` | `QuestionExplanation.explanationVideoUrl` | Maps to explanation at commit time |
| `StorageResourceType` | Already has `question_image` resource type | Image uploads reuse the existing resource config |

The existing `src/app/teacher/questions/import/page.tsx` will be refactored
to use this pipeline architecture, replacing the inline CSV/JSON/XLSX parsing
with the plugin-based system.

---

## Appendix C: Future-Proofing

### Adding a New Source Type

To add PDF support (Phase 2):

1. Create `PdfImportPlugin.ts` (implements `ImportParserPlugin`)
2. Create `PdfNormaliser.ts` (implements `ImportNormaliser<PdfRawDoc>`)
3. Register both in `ImportPipeline.ts`:

```typescript
pipeline.registerPlugin(
  new PdfImportPlugin(),
  new PdfNormaliser(),
);
```

No changes to the validator, preview, or committer are needed.
The same `ImportQuestion[]` shape is used throughout.

### Adding OCR Support

Same pattern: plugin + normaliser. The OCR parser extracts text and
figures from scanned images; the normaliser converts them to
`ImportQuestion[]`. All downstream stages remain unchanged.
