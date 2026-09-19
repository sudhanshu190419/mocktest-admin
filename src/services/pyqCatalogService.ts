import { supabase } from '@/config/supabase';
import type { PYQPackage, PYQPaperPreviewItem } from '@/types/pyqCatalog';

export async function getPYQPapersForPackage(packageId: string): Promise<PYQPaperPreviewItem[]> {
  try {
    const { data, error } = await supabase
      .from('pyq_papers')
      .select(`
        paper_id,
        package_id,
        title,
        exam_year,
        exam_session,
        total_questions,
        total_marks,
        duration_min,
        is_published
      `)
      .eq('package_id', packageId)
      .eq('is_published', true)
      .order('exam_year', { ascending: false });

    if (error || !data || data.length === 0) {
      return [];
    }

    return data.map((r: any) => ({
      paperId: r.paper_id,
      packageId: r.package_id,
      title: r.title || `Official Exam Paper ${r.exam_year || ''}`,
      examYear: r.exam_year ?? null,
      examSession: r.exam_session ?? null,
      totalQuestions: r.total_questions || 180,
      totalMarks: r.total_marks ?? null,
      durationMin: r.duration_min ?? 180,
      isLocked: true,
    }));
  } catch (err) {
    console.warn('[pyqCatalogService] getPYQPapersForPackage warning:', err);
    return [];
  }
}

export async function getPYQPackages(): Promise<PYQPackage[]> {
  try {
    const defaultInstituteId = process.env.NEXT_PUBLIC_INSTITUTE_ID;
    let queryBuilder = supabase
      .from('pyq_packages')
      .select(`
        package_id,
        institute_id,
        stream_id,
        name,
        description,
        price,
        currency,
        thumbnail_path,
        year_from,
        year_to,
        total_papers,
        is_active,
        published_at,
        created_at,
        streams:stream_id (
          stream_id,
          name,
          code
        )
      `)
      .eq('is_active', true)
      .not('published_at', 'is', null);

    if (defaultInstituteId) {
      queryBuilder = queryBuilder.eq('institute_id', defaultInstituteId);
    }

    const { data, error } = await queryBuilder.order('created_at', { ascending: false });

    if (error || !data) {
      if (error) console.error('Failed to fetch pyq packages from Supabase:', error.message);
      return [];
    }

    return data.map((row: any): PYQPackage => {
      const stream = row.streams || {};
      const streamCode = (stream.code || 'NEET').toUpperCase();
      const yFrom = row.year_from || 2018;
      const yTo = row.year_to || 2024;

      return {
        packageId: row.package_id,
        slug: row.package_id,
        streamId: row.stream_id,
        streamCode,
        streamName: stream.name || streamCode,
        title: row.name,
        displayTitle: row.name,
        shortDescription: row.description || `Past papers from ${yFrom} to ${yTo}.`,
        description: row.description || '',
        yearFrom: yFrom,
        yearTo: yTo,
        yearRange: `${yFrom}–${yTo}`,
        totalPapers: row.total_papers || 0,
        totalQuestions: (row.total_papers || 0) * 180,
        originalPrice: row.price || 0,
        discountedPrice: row.price || 0,
        currency: row.currency || 'INR',
        accessType: 'Lifetime Access',
        includesDiagnosticPaper: true,
        features: [
          `${row.total_papers || 0} Official exam papers`,
          'Detailed step-by-step solutions',
          'CBT exam interface simulation',
          'Section-wise accuracy & time analysis',
        ],
        subjectBreakdown: [],
        inclusions: [
          'Full question papers with timer',
          'Answer explanations for every question',
          'Instant result summary & percentile',
        ],
        howItWorks: [
          'Attempt past papers under real exam timed conditions',
          'Review comprehensive explanations and identify weak chapters',
          'Retake questions to solidify concepts',
        ],
        faqs: [
          {
            question: 'Can I attempt papers multiple times?',
            answer: 'Yes, you can practice each past paper multiple times with full review.',
          },
        ],
        status: 'published',
        sortOrder: 0,
      };
    });
  } catch (err) {
    console.error('Error in getPYQPackages:', err);
    return [];
  }
}

export async function getPYQPackageById(packageId: string): Promise<PYQPackage | null> {
  const packages = await getPYQPackages();
  const pkg = packages.find((p) => p.packageId === packageId || p.slug === packageId) || null;
  if (!pkg) return null;

  const actualPackageId = pkg.packageId;
  const papers = await getPYQPapersForPackage(actualPackageId);

  if (papers.length > 0) {
    pkg.papers = papers;
    pkg.totalPapers = papers.length;
    pkg.totalQuestions = papers.reduce((acc, curr) => acc + (curr.totalQuestions || 0), 0);
  } else {
    // Generate preview list for years if papers table is restricted by RLS for public visitors
    const count = pkg.totalPapers > 0 ? pkg.totalPapers : Math.max(1, pkg.yearTo - pkg.yearFrom + 1);
    const generated: PYQPaperPreviewItem[] = [];
    for (let yr = pkg.yearTo; yr >= pkg.yearFrom && generated.length < count; yr--) {
      generated.push({
        paperId: `preview-${pkg.packageId}-${yr}`,
        packageId: pkg.packageId,
        title: `${pkg.streamCode} ${yr} Official Question Paper`,
        examYear: yr,
        examSession: 'Annual Session',
        totalQuestions: 180,
        totalMarks: 720,
        durationMin: 180,
        isLocked: true,
      });
    }
    pkg.papers = generated;
  }

  return pkg;
}
