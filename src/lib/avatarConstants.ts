/**
 * Avatar constants - single source of truth for valid avatar URLs
 * 
 * Only avatars EH-01 through EH-34 from the Supabase storage bucket are valid.
 * No references to api.dicebear.com or any other external avatar service.
 */

// Valid avatar filenames (EH-01 through EH-34)
export const VALID_AVATAR_FILENAMES = [
  '777btc_Avatars_EH-01.png', '777btc_Avatars_EH-02.png', '777btc_Avatars_EH-03.png',
  '777btc_Avatars_EH-04.png', '777btc_Avatars_EH-05.png', '777btc_Avatars_EH-06.png',
  '777btc_Avatars_EH-07.png', '777btc_Avatars_EH-08.png', '777btc_Avatars_EH-09.png',
  '777btc_Avatars_EH-10.png', '777btc_Avatars_EH-11.png', '777btc_Avatars_EH-12.png',
  '777btc_Avatars_EH-13.png', '777btc_Avatars_EH-14.png', '777btc_Avatars_EH-15.png',
  '777btc_Avatars_EH-16.png', '777btc_Avatars_EH-17.png', '777btc_Avatars_EH-18.png',
  '777btc_Avatars_EH-19.png', '777btc_Avatars_EH-20.png', '777btc_Avatars_EH-21.png',
  '777btc_Avatars_EH-22.png', '777btc_Avatars_EH-23.png', '777btc_Avatars_EH-24.png',
  '777btc_Avatars_EH-25.png', '777btc_Avatars_EH-26.png', '777btc_Avatars_EH-27.png',
  '777btc_Avatars_EH-28.png', '777btc_Avatars_EH-29.png', '777btc_Avatars_EH-30.png',
  '777btc_Avatars_EH-31.png', '777btc_Avatars_EH-32.png', '777btc_Avatars_EH-33.png',
  '777btc_Avatars_EH-34.png',
] as const;

// Base URL for Supabase storage bucket containing avatars
export const SUPABASE_AVATAR_BASE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Avatars';

/**
 * Get the full URL for an avatar by filename
 */
export function getAvatarUrl(filename: string): string {
  return `${SUPABASE_AVATAR_BASE_URL}/${filename}`;
}

/**
 * Get a random avatar URL from the valid avatar list
 */
export function getRandomAvatarUrl(): string {
  const randomIndex = Math.floor(Math.random() * VALID_AVATAR_FILENAMES.length);
  return getAvatarUrl(VALID_AVATAR_FILENAMES[randomIndex]);
}
