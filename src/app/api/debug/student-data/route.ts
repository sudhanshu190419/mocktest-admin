import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/config/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId') || '';
  const mode = searchParams.get('mode') || 'batch-students';

  // ── MODE: test student_details → profiles ───────────────────────────────
  if (mode === 'test-details') {
    const { data: studentDetailsData, error: detailsError } = await supabase
      .from('student_details')
      .select('*, profiles(*)')
      .limit(5);

    return NextResponse.json({
      mode: 'test-details',
      rawCount: studentDetailsData?.length ?? 0,
      rawData: studentDetailsData,
      error: detailsError ? {
        message: detailsError.message,
        code: detailsError.code,
        details: detailsError.details,
        hint: detailsError.hint,
      } : null,
    });
  }

  // ── MODE: batch-students (default) ──────────────────────────────────────
  if (!batchId) {
    // Get the current session to find teacher batches
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      // Without auth, try a direct query on batch_students anyway (will be limited by RLS)
      const { data: directData, error: directError } = await supabase
        .from('batch_students')
        .select('*, student_details(*, profiles(*))')
        .limit(5);

      return NextResponse.json({
        mode: 'batch-students-unauthed',
        rawCount: directData?.length ?? 0,
        rawData: directData,
        error: directError ? {
          message: directError.message,
          code: directError.code,
          details: directError.details,
          hint: directError.hint,
        } : null,
      });
    }

    // Try to get teacher_details
    const { data: tDetails } = await supabase
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', session.user.id)
      .single();

    if (!tDetails) {
      return NextResponse.json({ error: 'No teacher details found for user' });
    }

    // Get batches
    const { data: batches } = await supabase
      .from('batch_subject_teachers')
      .select('batch_id')
      .eq('teacher_id', tDetails.teacher_id);

    if (!batches || batches.length === 0) {
      return NextResponse.json({ error: 'No batches assigned to this teacher' });
    }

    // Use the first batch
    const firstBatchId = batches[0].batch_id;

    // Run the exact same query as teacherService.getStudentRoster()
    const { data, error } = await supabase
      .from('batch_students')
      .select('*, student_details(*, profiles(*))')
      .eq('batch_id', firstBatchId);

    return NextResponse.json({
      mode: 'batch-students',
      batchId: firstBatchId,
      rawCount: data?.length ?? 0,
      rawData: data,
      error: error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null,
    });
  }

  // Direct query with provided batchId
  const { data, error } = await supabase
    .from('batch_students')
    .select('*, student_details(*, profiles(*))')
    .eq('batch_id', batchId);

  return NextResponse.json({
    mode: 'batch-students',
    batchId,
    rawCount: data?.length ?? 0,
    rawData: data,
    error: error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null,
  });
}
