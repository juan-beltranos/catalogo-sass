import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const getClient = () =>
  new S3Client({
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
    if (!path || path.includes("..")) {
      res.status(400).json({ error: "Path invalido" });
      return;
    }

    await getClient().send(
      new DeleteObjectCommand({
        Bucket: required("R2_BUCKET_NAME"),
        Key: path,
      }),
    );

    res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error?.message || "Error borrando de R2" });
  }
}
