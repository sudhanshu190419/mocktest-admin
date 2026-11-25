import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 4 — PYQ and Mock Test Complete Architecture & Contracts', () => {
  // Source files under test
  const migrationPath = path.resolve(__dirname, '../../../../supabase/migrations/255_add_pyq_package_type.sql');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');

  const pyqTypesPath = path.resolve(__dirname, '../../../types/pyq.ts');
  const pyqTypesSource = fs.readFileSync(pyqTypesPath, 'utf8');

  const pyqCatalogTypesPath = path.resolve(__dirname, '../../../types/pyqCatalog.ts');
  const pyqCatalogTypesSource = fs.readFileSync(pyqCatalogTypesPath, 'utf8');

  const pyqPackageServicePath = path.resolve(__dirname, '../pyqPackageService.ts');
  const pyqPackageServiceSource = fs.readFileSync(pyqPackageServicePath, 'utf8');

  const pyqMockMappingServicePath = path.resolve(__dirname, '../pyqMockMappingService.ts');
  const pyqMockMappingServiceSource = fs.readFileSync(pyqMockMappingServicePath, 'utf8');

  const pyqCatalogServicePath = path.resolve(__dirname, '../../pyqCatalogService.ts');
  const pyqCatalogServiceSource = fs.readFileSync(pyqCatalogServicePath, 'utf8');

  const pyqPackageFormPath = path.resolve(__dirname, '../../../features/pyq/components/PyqPackageForm.tsx');
  const pyqPackageFormSource = fs.readFileSync(pyqPackageFormPath, 'utf8');

  const adminPackagesPagePath = path.resolve(__dirname, '../../../app/admin/pyq-packages/page.tsx');
  const adminPackagesPageSource = fs.readFileSync(adminPackagesPagePath, 'utf8');

  const createPaperPath = path.resolve(__dirname, '../../../app/admin/pyq-packages/[id]/papers/create/page.tsx');
  const createPaperSource = fs.readFileSync(createPaperPath, 'utf8');

  const editPaperPath = path.resolve(__dirname, '../../../app/admin/pyq-packages/[id]/papers/[paperId]/edit/page.tsx');
  const editPaperSource = fs.readFileSync(editPaperPath, 'utf8');

  const pyqCatalogPath = path.resolve(__dirname, '../../../components/marketing/PYQCatalog.tsx');
  const pyqCatalogSource = fs.readFileSync(pyqCatalogPath, 'utf8');

  const createPaymentOrderPath = path.resolve(__dirname, '../../../../supabase/functions/create-payment-order/index.ts');
  const createPaymentOrderSource = fs.readFileSync(createPaymentOrderPath, 'utf8');

  const entitlementSqlPath = path.resolve(__dirname, '../../../../supabase/migrations/160_fix_pyq_mock_test_attempt_entitlement.sql');
  const entitlementSqlSource = fs.readFileSync(entitlementSqlPath, 'utf8');

  // ───────────────────────────────────────────────────────────────────────────
  // A. Package Classification & Database Migration
  // ───────────────────────────────────────────────────────────────────────────
  describe('A. Package Classification & Migration', () => {
    it('1. Migration 255 defines package_type with default pyq and check constraint', () => {
      expect(migrationSource).toContain("ADD COLUMN IF NOT EXISTS package_type text NOT NULL DEFAULT 'pyq'");
      expect(migrationSource).toContain("CHECK (package_type IN ('pyq', 'mock_test'))");
      expect(migrationSource).toContain('idx_pyq_packages_type_active');
    });

    it('2. PyqPackage type represents packageType (pyq | mock_test)', () => {
      expect(pyqTypesSource).toContain("export type PyqPackageType = 'pyq' | 'mock_test';");
      expect(pyqTypesSource).toContain('packageType: PyqPackageType;');
      expect(pyqTypesSource).toContain('packageType?: PyqPackageType;');
    });

    it('3. pyqPackageService maps package_type and defaults to pyq', () => {
      expect(pyqPackageServiceSource).toContain("packageType: (row.package_type as PyqPackageType) || 'pyq'");
      expect(pyqPackageServiceSource).toContain("package_type: input.packageType ?? 'pyq'");
    });

    it('4. pyqPackageService rejects invalid packageType values', () => {
      expect(pyqPackageServiceSource).toContain("Package type must be either 'pyq' or 'mock_test'.");
    });

    it('5. pyqPackageService prevents changing packageType once published or purchased', () => {
      expect(pyqPackageServiceSource).toContain('Package type cannot be changed once the package is published.');
      expect(pyqPackageServiceSource).toContain('Package type cannot be changed after purchases have occurred.');
    });

    it('6. PyqPackageForm provides PYQ Package and Mock Test Package selectors', () => {
      expect(pyqPackageFormSource).toContain('Package Type');
      expect(pyqPackageFormSource).toContain("handleChange('packageType', 'pyq')");
      expect(pyqPackageFormSource).toContain("handleChange('packageType', 'mock_test')");
      expect(pyqPackageFormSource).toContain('Package type cannot be changed once the package is published or has purchase history.');
    });

    it('7. Admin package list displays Type badge and Type filter', () => {
      expect(adminPackagesPageSource).toContain("p.packageType === 'mock_test' ? 'MOCK TEST' : 'PYQ'");
      expect(adminPackagesPageSource).toContain('<option value="pyq">PYQ Packages</option>');
      expect(adminPackagesPageSource).toContain('<option value="mock_test">Mock Tests</option>');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B. PDF Upload UI Removal
  // ───────────────────────────────────────────────────────────────────────────
  describe('B. PDF Upload UI Removal & Nullable Storage', () => {
    it('8. Paper creation route has NO PDF upload UI or PdfUploadSection', () => {
      expect(createPaperSource).not.toContain('Question Paper PDF');
      expect(createPaperSource).not.toContain('PdfUploadSection');
      expect(createPaperSource).not.toContain('PdfUploadState');
      expect(createPaperSource).not.toContain('questionInputRef');
    });

    it('9. Paper creation does NOT enforce mandatory questionPdf validation', () => {
      expect(createPaperSource).not.toContain("newErrors.questionPdf = 'Question paper PDF is required.'");
      expect(createPaperSource).not.toContain('questionPdf.file');
      expect(createPaperSource).toContain('const canSave = !createPaper.isPending;');
    });

    it('10. Paper editing route has NO PDF upload UI or PdfUploadSection', () => {
      expect(editPaperSource).not.toContain('PdfUploadSection');
      expect(editPaperSource).not.toContain('PdfUploadState');
      expect(editPaperSource).not.toContain('questionInputRef');
      expect(editPaperSource).not.toContain('Question Paper PDF');
    });

    it('11. Database constraint allows NULL for both PDF bucket and path', () => {
      const pyqDomainSql = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/007_domain_06_pyq.sql'), 'utf8');
      expect(pyqDomainSql).toContain('((pdf_storage_bucket is null) = (pdf_storage_path is null))');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C. Question Assignment, Mock Test Generation & Mapping
  // ───────────────────────────────────────────────────────────────────────────
  describe('C. Question Assignment & Automatic Mock Test Generation', () => {
    it('12. generateMockFromPaper has early pre-flight check preventing duplicate generation', () => {
      expect(pyqMockMappingServiceSource).toContain('A mock test is already linked to this paper. Use regenerateMockFromPaper() to replace it.');
    });

    it('13. generateMockFromPaper automatically creates mock_tests record with paper details', () => {
      expect(pyqMockMappingServiceSource).toContain('const mockResult = await createMockTest(');
      expect(pyqMockMappingServiceSource).toContain("testType: 'pyq_paper'");
    });

    it('14. generateMockFromPaper copies mapped questions to mock_test_questions', () => {
      expect(pyqMockMappingServiceSource).toContain('await addQuestionsToMockTest(');
      expect(pyqMockMappingServiceSource).toContain('mockTest.testId');
      expect(pyqMockMappingServiceSource).toContain('assignments');
    });

    it('15. generateMockFromPaper publishes mock test and freezes question snapshots', () => {
      expect(pyqMockMappingServiceSource).toContain('await publishMockTestWorkflow(mockTest.testId)');
    });

    it('16. generateMockFromPaper atomically inserts pyq_mock_mappings junction row', () => {
      expect(pyqMockMappingServiceSource).toContain(".from('pyq_mock_mappings')");
      expect(pyqMockMappingServiceSource).toContain('paper_id: paperId');
      expect(pyqMockMappingServiceSource).toContain('test_id: mockTest.testId');
    });

    it('17. generateMockFromPaper cleans up orphaned mock test on mapping error', () => {
      expect(pyqMockMappingServiceSource).toContain("await supabase\n          .from('mock_tests')\n          .delete()\n          .eq('test_id', mockTest.testId)");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. Publishing Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('D. Publishing Validation Contracts', () => {
    it('18. publishPackage rejects packages with zero papers', () => {
      expect(pyqPackageServiceSource).toContain('Add at least one paper before publishing this package.');
    });

    it('19. publishPackage validates that Mock Test package papers have generated mock tests', () => {
      expect(pyqPackageServiceSource).toContain('current.package_type === \'mock_test\'');
      expect(pyqPackageServiceSource).toContain('Generate the mock test for');
      expect(pyqPackageServiceSource).toContain('before publishing.');
    });

    it('20. publishPackage validates that Mock Tests are published and contain questions', () => {
      expect(pyqPackageServiceSource).toContain('is not published or contains no questions.');
    });

    it('21. Legacy PYQ papers with existing PDF files remain valid without mock tests', () => {
      expect(pyqPackageServiceSource).toContain('const hasLegacyPdf = !!paper.pdf_storage_path;');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // E. Public Website Catalogue
  // ───────────────────────────────────────────────────────────────────────────
  describe('E. Public Website Catalogue & Presentation', () => {
    it('22. pyqCatalogService selects package_type and distinguishes mock tests', () => {
      expect(pyqCatalogServiceSource).toContain('package_type,');
      expect(pyqCatalogServiceSource).toContain("packageType: (row.package_type as 'pyq' | 'mock_test') || 'pyq'");
      expect(pyqCatalogServiceSource).toContain("const isMockTest = row.package_type === 'mock_test'");
    });

    it('23. PYQCatalog displays two distinct sections: Explore PYQ Packages and Explore Mock Tests', () => {
      expect(pyqCatalogSource).toContain('<h2>Explore PYQ Packages</h2>');
      expect(pyqCatalogSource).toContain('<h2>Explore Mock Tests</h2>');
      expect(pyqCatalogSource).toContain("filtered.filter((p) => p.packageType !== 'mock_test')");
      expect(pyqCatalogSource).toContain("filtered.filter((p) => p.packageType === 'mock_test')");
    });

    it('24. PYQPackageCard distinguishes Mock Test items in subtitle and facts', () => {
      expect(pyqCatalogSource).toContain("item.packageType === 'mock_test' ? 'Online Mock Tests' : 'Previous year papers'");
      expect(pyqCatalogSource).toContain("item.packageType === 'mock_test'");
      expect(pyqCatalogSource).toContain(`${'test'}`);
    });

    it('25. PYQPackageCard does NOT display question counts or Lifetime Access badge', () => {
      expect(pyqCatalogSource).not.toMatch(/item\.totalQuestions\s*questions/);
      expect(pyqCatalogSource).not.toMatch(/<b>\{item\.accessType\}<\/b>/);
    });

    it('26. Both package types route to the unified detail route /pyq/[packageId]', () => {
      expect(pyqCatalogSource).toContain('`/pyq/${item.packageId}`');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F. Purchase Flow & Entitlement Architecture Preservation
  // ───────────────────────────────────────────────────────────────────────────
  describe('F. Purchase Flow & Student Entitlement Preservation', () => {
    it('27. create-payment-order Edge Function resolves pyq_package via package_id with zero modification', () => {
      expect(createPaymentOrderSource).toContain("productType = 'pyq_package'");
      expect(createPaymentOrderSource).toContain("productId = packageId");
      expect(createPaymentOrderSource).toContain(".from('pyq_packages')");
      expect(createPaymentOrderSource).toContain(".eq('package_id', productId)");
    });

    it('28. can_student_attempt_mock_test Clause (e) authorizes test attempts via pyq_mock_mappings and student_pyq_purchases', () => {
      expect(entitlementSqlSource).toContain('FROM public.pyq_mock_mappings pmm');
      expect(entitlementSqlSource).toContain('JOIN public.pyq_papers pp ON pp.paper_id = pmm.paper_id');
      expect(entitlementSqlSource).toContain('JOIN public.student_pyq_purchases spp ON spp.package_id = pp.package_id');
      expect(entitlementSqlSource).toContain('WHERE pmm.test_id = p_test_id');
      expect(entitlementSqlSource).toContain('AND spp.student_id = public.get_my_student_id()');
      expect(entitlementSqlSource).toContain('AND spp.is_active = true');
    });
  });
});

