// スキかた - 記念写真の端末カメラロールへの保存

import * as MediaLibrary from 'expo-media-library';

export async function saveImageToLibrary(uri: string): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) return false;
  await MediaLibrary.saveToLibraryAsync(uri);
  return true;
}
