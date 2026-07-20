import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const getClient = () => new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const path = String(req.body?.path || "").replace(/^\/+/, "");
    const contentType = String(req.body?.contentType || "application/octet-stream");
    const size = Number(req.body?.size || 0);

    if (!path || path.includes("..") || !path.startsWith("stores/")) {
      res.status(400).json({ error: "Path invalido" });
      return;
    }
    if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) {
      res.status(400).json({ error: "Tamano de archivo invalido" });
      return;
    }

    const command = new PutObjectCommand({
      Bucket: required("R2_BUCKET_NAME"),
      Key: path,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: 300 });
    const publicBaseUrl = required("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

    res.status(200).json({ uploadUrl, path, url: `${publicBaseUrl}/${path}` });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error?.message || "No se pudo preparar la subida a R2" });
  }
}
