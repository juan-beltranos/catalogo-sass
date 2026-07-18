import { deleteFromR2, uploadToR2 } from "@/helpers/r2Upload";

export const ref = (_storage: unknown, path: string) => ({ path });

export const uploadBytes = async (
  storageRef: { path: string },
  file: Blob | File,
) => {
  const uploadFile =
    file instanceof File
      ? file
      : new File([file], storageRef.path.split("/").pop() || "file", {
          type: file.type || "application/octet-stream",
        });
  return uploadToR2({
    file: uploadFile,
    folder: storageRef.path.split("/").slice(0, -1).join("/") || "uploads",
    path: storageRef.path,
  });
};

export const getDownloadURL = async (
  storageRef: { path: string },
  uploadedUrl?: string,
) => {
  // La API conoce la URL publica real del objeto. Preferirla evita depender
  // de que VITE_R2_PUBLIC_BASE_URL coincida exactamente en produccion.
  if (uploadedUrl) return uploadedUrl;
  const publicBaseUrl = import.meta.env.VITE_R2_PUBLIC_BASE_URL || "";
  if (!publicBaseUrl) return storageRef.path;
  return `${publicBaseUrl.replace(/\/+$/, "")}/${storageRef.path.replace(/^\/+/, "")}`;
};

export const deleteObject = async (storageRef: { path: string }) => {
  await deleteFromR2(storageRef.path);
};

export const storage = {};
