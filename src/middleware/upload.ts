import multer from 'multer';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

const storage = multer.memoryStorage();

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: jpeg, png, webp, gif`));
  }
}

export const uploadSingle = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } }).single('file');

export const uploadMultiple = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } }).array('files', 20);
