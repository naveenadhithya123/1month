import { v2 as cloudinary } from "cloudinary";

const configured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function ensureCloudinaryConfig() {
  if (!configured) {
    throw new Error("Cloudinary credentials are missing in backend/.env");
  }
}

export async function uploadBuffer(
  buffer,
  { folder, filename, mimeType = "application/octet-stream", resourceType = "auto" },
) {
  ensureCloudinaryConfig();

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: filename,
      },
      (error, response) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(response);
      },
    );

    stream.end(buffer);
  });

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
  };
}

export function buildPdfPreviewUrl(publicId, page = 1) {
  ensureCloudinaryConfig();

  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "upload",
    secure: true,
    format: "jpg",
    page,
  });
}
