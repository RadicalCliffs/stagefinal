import { supabase } from './supabase';

export interface ImageOption {
  name: string;
  url: string;
  bucket: string;
  filename: string;
}

/**
 * Fetches all images from Supabase storage buckets
 * @returns Promise<ImageOption[]> - Array of image options with name, url, bucket, and filename
 */
export async function fetchAllStorageImages(): Promise<ImageOption[]> {
  try {
    const allImages: ImageOption[] = [];

    // Get list of all buckets
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();

    if (bucketsError) {
      console.error('Error fetching buckets:', bucketsError);
      return [];
    }

    // Iterate through each bucket
    for (const bucket of buckets) {
      try {
        // List all files in the bucket recursively
        const { data: files, error: filesError } = await supabase.storage
          .from(bucket.name)
          .list('', {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' }
          });

        if (filesError) {
          console.error(`Error fetching files from bucket ${bucket.name}:`, filesError);
          continue;
        }

        // Process files and get public URLs
        for (const file of files || []) {
          // Skip folders (they don't have a size)
          if (!file.metadata || file.name.endsWith('/')) continue;

          // Check if it's an image file
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
          const isImage = imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

          if (isImage) {
            const { data: urlData } = supabase.storage
              .from(bucket.name)
              .getPublicUrl(file.name);

            if (urlData?.publicUrl) {
              allImages.push({
                name: `${bucket.name}/${file.name}`,
                url: urlData.publicUrl,
                bucket: bucket.name,
                filename: file.name
              });
            }
          }
        }

        // Also check nested folders for Competition Images bucket
        if (bucket.name === 'Competition Images') {
          const nestedFolders = ['Competition Images', 'Avatars', 'Web Assets'];

          for (const folder of nestedFolders) {
            const { data: nestedFiles, error: nestedError } = await supabase.storage
              .from(bucket.name)
              .list(folder, {
                limit: 1000,
                sortBy: { column: 'name', order: 'asc' }
              });

            if (nestedError) {
              console.error(`Error fetching files from ${bucket.name}/${folder}:`, nestedError);
              continue;
            }

            for (const file of nestedFiles || []) {
              if (!file.metadata || file.name.endsWith('/')) continue;

              const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
              const isImage = imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

              if (isImage) {
                const filePath = `${folder}/${file.name}`;
                const { data: urlData } = supabase.storage
                  .from(bucket.name)
                  .getPublicUrl(filePath);

                if (urlData?.publicUrl) {
                  allImages.push({
                    name: `${bucket.name}/${folder}/${file.name}`,
                    url: urlData.publicUrl,
                    bucket: bucket.name,
                    filename: file.name
                  });
                }
              }
            }

            // Check for "All Website Images" subfolder under Web Assets
            if (folder === 'Web Assets') {
              const { data: webAssetFiles, error: webAssetError } = await supabase.storage
                .from(bucket.name)
                .list('Web Assets/All Website Images', {
                  limit: 1000,
                  sortBy: { column: 'name', order: 'asc' }
                });

              if (!webAssetError && webAssetFiles) {
                for (const file of webAssetFiles) {
                  if (!file.metadata || file.name.endsWith('/')) continue;

                  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
                  const isImage = imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

                  if (isImage) {
                    const filePath = `Web Assets/All Website Images/${file.name}`;
                    const { data: urlData } = supabase.storage
                      .from(bucket.name)
                      .getPublicUrl(filePath);

                    if (urlData?.publicUrl) {
                      allImages.push({
                        name: `${bucket.name}/Web Assets/All Website Images/${file.name}`,
                        url: urlData.publicUrl,
                        bucket: bucket.name,
                        filename: file.name
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing bucket ${bucket.name}:`, error);
      }
    }

    return allImages;
  } catch (error) {
    console.error('Error fetching storage images:', error);
    return [];
  }
}

/**
 * Component hook to load images with loading state
 */
export function useStorageImages() {
  const [images, setImages] = React.useState<ImageOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const loadImages = async () => {
      setLoading(true);
      const fetchedImages = await fetchAllStorageImages();
      setImages(fetchedImages);
      setLoading(false);
    };

    loadImages();
  }, []);

  return { images, loading };
}

// Import React for the hook
import React from 'react';
