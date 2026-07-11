import imageCompression from "browser-image-compression";

type CompressionOptions = {
    maxSizeMB?: number;
    maxWidthOrHeight?: number;
    useWebWorker?: boolean;
    initialQuality?: number;
    fileType?: string;
};

const defaultOptions: CompressionOptions = {
    maxSizeMB: 0.6,
    maxWidthOrHeight: 1400,
    useWebWorker: true,
    initialQuality: 0.8,
    fileType: "image/webp",
};

const extensionFromType = (type: string) => {
    if (type.includes("webp")) return "webp";
    if (type.includes("png")) return "png";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    return "jpg";
};

const withExtension = (name: string, extension: string) => {
    const safeName = name.trim() || `image.${extension}`;
    return /\.[a-z0-9]+$/i.test(safeName)
        ? safeName.replace(/\.[a-z0-9]+$/i, `.${extension}`)
        : `${safeName}.${extension}`;
};

export async function compressImage(file: File, options: CompressionOptions = {}) {
    return imageCompression(file, {
        ...defaultOptions,
        ...options,
    });
}

export async function compressImageFile(file: File, options: CompressionOptions = {}) {
    const compressed = await compressImage(file, options);
    const type = compressed.type || options.fileType || defaultOptions.fileType || file.type || "image/jpeg";
    const extension = extensionFromType(type);
    return new File([compressed], withExtension(file.name, extension), { type });
}
