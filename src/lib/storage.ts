import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';

const BUCKET = 'pet-photos';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

function extractPath(publicUrl: string): string | null {
  const idx = publicUrl.indexOf(PUBLIC_MARKER);
  return idx !== -1 ? publicUrl.slice(idx + PUBLIC_MARKER.length) : null;
}

// Derives the _thumb.jpg path from the full path, works for photos uploaded after
// the dual-upload change. Old single-upload photos won't have a thumb; that's fine —
// Supabase remove() is a no-op for missing files.
function thumbPathFor(path: string): string {
  return path.replace(/\.jpg$/, '_thumb.jpg');
}

export async function deletePhoto(photoUrl: string): Promise<void> {
  const path = extractPath(photoUrl);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path, thumbPathFor(path)]);
  if (error) throw new Error(error.message);
}

export function toThumbPublicUrl(photoUrl: string): string {
  return photoUrl.replace(/\.jpg$/, '_thumb.jpg');
}

export interface UploadResult {
  publicUrl: string;
  thumbPublicUrl: string;
}

async function compressAndUpload(
  localUri: string,
  storagePath: string,
  width: number,
  quality: number,
  token: string,
): Promise<void> {
  const { uri } = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
  );

  const result = await uploadAsync(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
    },
  );

  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`Upload failed (${result.status}): ${result.body}`);
  }
}

export async function uploadPhoto(
  localUri: string,
  folder: 'sightings' | 'pets',
  id: string,
): Promise<UploadResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const fullPath  = `${folder}/${id}.jpg`;
  const thumbPath = `${folder}/${id}_thumb.jpg`;

  // Full (1080 px @ 82 %) and thumb (300 px @ 70 %) uploaded in parallel
  await Promise.all([
    compressAndUpload(localUri, fullPath,  1080, 0.82, token),
    compressAndUpload(localUri, thumbPath,  300, 0.70, token),
  ]);

  const { data: full  } = supabase.storage.from(BUCKET).getPublicUrl(fullPath);
  const { data: thumb } = supabase.storage.from(BUCKET).getPublicUrl(thumbPath);

  return {
    publicUrl:      full.publicUrl,
    thumbPublicUrl: thumb.publicUrl,
  };
}
