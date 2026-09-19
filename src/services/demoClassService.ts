import { supabase } from '@/config/supabase';
import type { DemoClass } from '@/types/demoClass';

export async function getPublishedDemoClasses(streamId?: string): Promise<DemoClass[]> {
  try {
    const defaultInstituteId = process.env.NEXT_PUBLIC_INSTITUTE_ID || 'e97ebfd2-ca4d-4637-a583-1078568f1b2f';
    let query = supabase
      .from('demo_classes')
      .select(`
        *,
        streams:stream_id (
          stream_id,
          name,
          code
        )
      `)
      .eq('status', 'published')
      .is('deleted_at', null)
      .order('display_order', { ascending: true });

    if (defaultInstituteId) {
      query = query.eq('institute_id', defaultInstituteId);
    }

    if (streamId) {
      query = query.eq('stream_id', streamId);
    }

    const { data, error } = await query;
    if (error || !data) {
      if (error) console.error('Failed to fetch demo classes from Supabase:', error.message);
      return [];
    }

    return data.map((row: any): DemoClass => ({
      demoClassId: row.demo_class_id,
      instituteId: row.institute_id,
      streamId: row.stream_id,
      streamName: row.streams?.name || null,
      streamCode: (row.streams?.code || row.streams?.name || '').toUpperCase() || null,
      title: row.title,
      description: row.description,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
      thumbnailBucket: row.thumbnail_bucket,
      thumbnailPath: row.thumbnail_path,
      durationSeconds: row.duration_seconds,
      status: row.status,
      displayOrder: row.display_order,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    }));
  } catch (err) {
    console.error('Error in getPublishedDemoClasses:', err);
    return [];
  }
}

/**
 * Generates a short-lived signed streaming URL for a demo class video.
 */
export async function getDemoClassVideoSignedUrl(
  demoClass: Pick<DemoClass, 'storageBucket' | 'storagePath'>
): Promise<{ signedUrl: string } | null> {
  try {
    if (!demoClass.storageBucket || !demoClass.storagePath) {
      return null;
    }
    const { data, error } = await supabase.storage
      .from(demoClass.storageBucket)
      .createSignedUrl(demoClass.storagePath, 3600);

    if (error || !data?.signedUrl) {
      console.warn('Failed to generate signed URL for demo class:', error?.message);
      return null;
    }

    return { signedUrl: data.signedUrl };
  } catch (err) {
    console.error('Error generating demo class signed URL:', err);
    return null;
  }
}

/**
 * Returns the public URL for a demo class thumbnail, if available.
 */
export function getDemoClassThumbnailUrl(
  demoClass: Pick<DemoClass, 'thumbnailBucket' | 'thumbnailPath'>
): string | null {
  if (!demoClass.thumbnailBucket || !demoClass.thumbnailPath) return null;
  try {
    const { data } = supabase.storage
      .from(demoClass.thumbnailBucket)
      .getPublicUrl(demoClass.thumbnailPath);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('Error getting public thumbnail URL:', err);
    return null;
  }
}

