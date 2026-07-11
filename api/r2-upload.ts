import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

const readBody = async (req: any): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export default async function handler(req: any, res: any) {
  if (req.method !== "PUT") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const path = String(req.query?.path || "").replace(/^\/+/, "");
    const contentType = String(req.query?.contentType || req.headers["content-type"] || "application/octet-stream");

    if (!path || path.includes("..")) {
      res.status(400).json({ error: "Path invalido" });
      return;
    }

    const body = await readBody(req);
    await getClient().send(
      new PutObjectCommand({
        Bucket: required("R2_BUCKET_NAME"),
        Key: path,
        Body: body,
        ContentType: contentType,
      }),
    );

    const publicBaseUrl = required("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
    res.status(200).json({
      path,
      url: `${publicBaseUrl}/${path}`,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error?.message || "Error subiendo a R2" });
  }
}
