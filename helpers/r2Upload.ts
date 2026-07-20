export type R2ResourceType = "image" | "video";

export type R2UploadResult = {
  url: string;
  path: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
};

const uploadEndpoint =
  import.meta.env.VITE_R2_UPLOAD_ENDPOINT || "/api/r2-upload";
const deleteEndpoint =
  import.meta.env.VITE_R2_DELETE_ENDPOINT || "/api/r2-delete";
const signedUploadEndpoint = "/api/r2-upload-url";
const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

const getExtension = (file: File) => {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName) return fromName;
  return file.type.split("/").pop() || "bin";
};

const buildPath = (folder: string, file: File) => {
  const safeName = file.name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${folder.replace(/^\/+|\/+$/g, "")}/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}_${safeName || "file"}.${getExtension(file)}`;
};

export function r2Url(url: string) {
  return url;
}

export const cldImg = (url: string, _options?: Record<string, any>) => url;

export async function uploadToR2(params: {
  file: File;
  folder: string;
  path?: string;
  resourceType?: R2ResourceType;
  onProgress?: (progress: number) => void;
}): Promise<R2UploadResult> {
  const { file, folder, resourceType = "image", onProgress } = params;
  const path = params.path || buildPath(folder, file);

  // Vercel Functions rechaza cuerpos mayores a 4.5 MB. Para esos archivos
  // obtenemos una URL temporal y enviamos el contenido directamente a R2.
  if (file.size > VERCEL_SAFE_UPLOAD_BYTES) {
    const signedResponse = await fetch(signedUploadEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      }),
    });
    const signed = await signedResponse.json().catch(() => ({}));
    if (!signedResponse.ok || !signed?.uploadUrl) {
      throw new Error(signed?.error || "No se pudo preparar la subida del archivo");
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signed.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`R2 rechazo la subida (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error(
        "R2 bloqueo la subida directa. Revisa la politica CORS del bucket para permitir PUT desde este dominio.",
      ));
      xhr.send(file);
    });

    return {
      url: signed.url,
      path: signed.path ?? path,
      publicId: signed.path ?? path,
      bytes: file.size,
      format: getExtension(file),
    };
  }

  const url = `${uploadEndpoint}?path=${encodeURIComponent(path)}&contentType=${encodeURIComponent(
    file.type || "application/octet-stream",
  )}&resourceType=${encodeURIComponent(resourceType)}`;

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            url: data.url,
            path: data.path ?? path,
            publicId: data.path ?? path,
            bytes: file.size,
            format: getExtension(file),
          });
        } else {
          reject(new Error(data.error || "Error subiendo archivo a R2"));
        }
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("Error de red subiendo archivo a R2"));
    xhr.send(file);
  });
}

export async function uploadImagesToR2(params: {
  files: File[];
  folder: string;
  onFileDone?: (info: { index: number; file: File; data: R2UploadResult }) => void;
}): Promise<R2UploadResult[]> {
  const uploaded: R2UploadResult[] = [];
  for (const [index, file] of params.files.entries()) {
    const data = await uploadToR2({ file, folder: params.folder, resourceType: "image" });
    uploaded.push(data);
    params.onFileDone?.({ index, file, data });
  }
  return uploaded;
}

export async function deleteFromR2(path?: string | null) {
  if (!path) return;
  const res = await fetch(deleteEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo borrar el archivo de R2");
  }
}
