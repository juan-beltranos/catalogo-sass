export const MAX_VIDEO_MB = 20; 
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function validateVideoFile(file: File) {
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
        return "Formato inválido. Usa MP4 / WebM (o MOV).";
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_VIDEO_MB) {
        return `El video pesa ${mb.toFixed(1)}MB. Máximo permitido: ${MAX_VIDEO_MB}MB.`;
    }
    return "";
}
