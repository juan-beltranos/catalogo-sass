import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { registerStore } from './server/registerStore';
import { buildCatalogShareHtml } from './server/catalogShare';
import activateSubscription from './api/activate-subscription';

const readJsonBody = async (req: any) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const readRawBody = async (req: any) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const requiredEnv = (env: Record<string, string>, name: string) => {
  const value = env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const getR2Client = (env: Record<string, string>) =>
  new S3Client({
    region: 'auto',
    endpoint: `https://${requiredEnv(env, 'R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv(env, 'R2_SECRET_ACCESS_KEY'),
    },
  });

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Las funciones /api usan process.env en produccion; se replica ese entorno en Vite local.
    Object.assign(process.env, {
      VITE_PUBLIC_SUPABASE_URL: env.VITE_PUBLIC_SUPABASE_URL,
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      MAKE_WEBHOOK_SECRET: env.MAKE_WEBHOOK_SECRET,
    });
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        {
          name: 'local-api-register-store',
          configureServer(server) {
            server.middlewares.use('/api/register-store', async (req, res, next) => {
              if (req.method !== 'POST') return next();

              try {
                const body = await readJsonBody(req);
                const result = await registerStore(body, env);
                res.statusCode = result.ok ? 200 : ("status" in result ? result.status : 500);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result));
              } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  ok: false,
                  code: 'local_api_error',
                  message: error?.message || 'No se pudo crear la cuenta/tienda.',
                }));
              }
            });

            server.middlewares.use('/api/activate-subscription', async (req: any, res: any, next) => {
              if (req.method !== 'POST') return next();
              try {
                req.body = await readJsonBody(req);
                res.status = (statusCode: number) => {
                  res.statusCode = statusCode;
                  return res;
                };
                res.json = (payload: unknown) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(payload));
                };
                await activateSubscription(req, res);
              } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, code: 'local_api_error', message: error?.message }));
              }
            });

            server.middlewares.use('/api/r2-upload', async (req, res, next) => {
              if (req.method !== 'PUT') return next();

              try {
                const requestUrl = new URL(req.url || '', 'http://localhost');
                const filePath = String(requestUrl.searchParams.get('path') || '').replace(/^\/+/, '');
                const contentType = String(
                  requestUrl.searchParams.get('contentType') ||
                  req.headers['content-type'] ||
                  'application/octet-stream',
                );

                if (!filePath || filePath.includes('..')) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Path invalido' }));
                  return;
                }

                await getR2Client(env).send(
                  new PutObjectCommand({
                    Bucket: requiredEnv(env, 'R2_BUCKET_NAME'),
                    Key: filePath,
                    Body: await readRawBody(req),
                    ContentType: contentType,
                  }),
                );

                const publicBaseUrl = requiredEnv(env, 'R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ path: filePath, url: `${publicBaseUrl}/${filePath}` }));
              } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: error?.message || 'Error subiendo a R2' }));
              }
            });

            server.middlewares.use('/api/r2-delete', async (req, res, next) => {
              if (req.method !== 'POST') return next();

              try {
                const body = await readJsonBody(req);
                const filePath = String(body.path || '').replace(/^\/+/, '');

                if (!filePath || filePath.includes('..')) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Path invalido' }));
                  return;
                }

                await getR2Client(env).send(
                  new DeleteObjectCommand({
                    Bucket: requiredEnv(env, 'R2_BUCKET_NAME'),
                    Key: filePath,
                  }),
                );

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
              } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: error?.message || 'Error borrando de R2' }));
              }
            });

            server.middlewares.use('/c', async (req, res, next) => {
              if (req.method !== 'GET') return next();

              try {
                const requestUrl = new URL(req.url || '', 'http://localhost');
                const slug = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, '').split('/')[0] || '');
                if (!slug) return next();

                const query = requestUrl.search || '';
                const host = req.headers.host || 'localhost:3000';
                const proto = req.headers['x-forwarded-proto'] || 'http';
                const result = await buildCatalogShareHtml({
                  slug,
                  origin: `${proto}://${host}`,
                  query,
                  env,
                });
                res.statusCode = result.status;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(result.html);
              } catch (error: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end(error?.message || 'No se pudo generar el preview del catalogo.');
              }
            });
          },
        },
        react(),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
